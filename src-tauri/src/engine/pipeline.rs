//! The actual parse -> map -> check -> resolve -> render pipeline, run
//! in-process. Mirrors `peitho`'s own `build_artifacts`
//! (crates/peitho/src/main.rs) — that function is the reference this was
//! ported from; re-check it there if peitho-core's API shifts underneath.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use peitho_core::{
    build_manifest, build_theme_css, check_deck, dispatch_by_convention, manifest_json,
    parse_deck_and_transform, parse_frontmatter, render_deck, resolve_image_paths, BuildError,
    ImageRequest, ResolvedImageAsset, ResolvedImagePath,
};

use super::assets::{self, ResolvedAssets};
use super::unsupported::{UnsupportedEmbedRenderer, UnsupportedOEmbedFetcher, UnsupportedSvgRunner};

pub struct RenderOutput {
    /// Exactly what `peitho_core::manifest_json` produces — the same
    /// contract peitho documents for external tools, so the frontend's
    /// `Manifest`/`ManifestSlide`/`ManifestSection` types (which parse this)
    /// don't need to change even though it's no longer fetched over HTTP.
    pub manifest_json: String,
    /// Rendered fragment HTML per slide, keyed by slide key (matches what
    /// the frontend already keys `slideFragments` by).
    pub fragments: HashMap<String, String>,
    pub css: String,
    pub has_math: bool,
    /// `assets/<hash>-<name>` (as referenced from `css`/fragment HTML) ->
    /// absolute source path on disk, for `engine::serve` to read from.
    pub image_assets: HashMap<String, PathBuf>,
    /// Present only when the deck has its own `fonts/` directory.
    pub fonts_dir: Option<PathBuf>,
}

pub fn render_source(deck_path: &Path, source: &str) -> Result<RenderOutput, String> {
    let deck_dir = deck_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));

    let frontmatter = parse_frontmatter(source).map_err(|err| err.to_string())?;
    let expanded = peitho_core::include::expand_includes(source, frontmatter.body_start(), deck_path)
        .map_err(|err| err.to_string())?;

    let ResolvedAssets { layouts, css: css_files, highlighter, fonts_dir } =
        assets::resolve(deck_dir)?;
    let highlighter = highlighter.get();

    let code_images_cache_dir = deck_dir.join(peitho_core::CODE_IMAGES_CACHE_DIR);
    let embeds_cache_dir = deck_dir.join(peitho_core::EMBEDS_CACHE_DIR);

    let parsed = parse_deck_and_transform(
        &expanded.source,
        frontmatter,
        highlighter,
        &UnsupportedSvgRunner,
        &UnsupportedEmbedRenderer,
        &UnsupportedOEmbedFetcher,
        &code_images_cache_dir,
        &embeds_cache_dir,
    )
    .map_err(|err| err.to_string())?;

    let mapped = dispatch_by_convention(parsed, &layouts).map_err(|err| err.to_string())?;
    let checked = check_deck(mapped).map_err(|err| err.to_string())?;

    let theme_css = build_theme_css(
        &css_files,
        &checked.slide_slot_classes(),
        &layouts.slot_classes(),
        &layouts.root_classes(),
    )
    .map_err(|err| err.to_string())?;

    let mut resolver = DraftImageResolver::new(deck_dir);
    let (resolved, image_assets) =
        resolve_image_paths(checked, |request| resolver.resolve(request)).map_err(|err| err.to_string())?;

    let manifest = build_manifest(&resolved, &image_assets);
    let manifest_json = manifest_json(&manifest).map_err(|err| err.to_string())?;

    let rendered = render_deck(resolved, highlighter, theme_css).map_err(|err| err.to_string())?;
    let has_math = rendered.math_assets().is_some();
    let css = rendered.css().to_string();

    let fragments = rendered
        .slides()
        .iter()
        .map(|slide| (slide.key().as_str().to_string(), slide.html().to_string()))
        .collect();

    let image_assets = image_assets
        .into_iter()
        .map(|asset| (asset.dist_rel.as_str().to_string(), asset.source_abs))
        .collect();

    Ok(RenderOutput { manifest_json, fragments, css, has_math, image_assets, fonts_dir })
}

/// Resolves an author-written image path to an `assets/<hash>-<name>`
/// reference, matching `peitho`'s own `ImageResolver`
/// (crates/peitho/src/main.rs) byte for byte so rendered HTML/manifest
/// paths are stable across a Studio-embedded render and a real
/// `peitho build`. Unlike the CLI, this never copies bytes anywhere —
/// `engine::serve` reads `source_abs` directly on request.
struct DraftImageResolver {
    deck_dir: PathBuf,
    by_hash: BTreeMap<String, ResolvedImageAsset>,
}

impl DraftImageResolver {
    fn new(deck_dir: &Path) -> Self {
        Self { deck_dir: deck_dir.to_path_buf(), by_hash: BTreeMap::new() }
    }

    fn resolve(&mut self, request: ImageRequest<'_>) -> peitho_core::Result<ResolvedImageAsset> {
        let display_path = request.raw.as_str();
        let source = self.deck_dir.join(display_path);
        let asset_error = |message: String, help: &str| {
            BuildError::new(peitho_core::error::ErrorKind::Asset, None, message, help.to_string())
        };
        let deck_abs = std::fs::canonicalize(&self.deck_dir)
            .map_err(|err| asset_error(format!("deck directory could not be resolved: {err}"), "check filesystem permissions"))?;
        let source_abs = std::fs::canonicalize(&source).map_err(|err| {
            asset_error(format!("image metadata could not be read: {display_path} ({err})"), "check the image path")
        })?;
        if !source_abs.starts_with(&deck_abs) {
            return Err(asset_error(
                format!("image path escapes deck directory: {display_path}"),
                "keep image files inside the deck directory",
            ));
        }
        let metadata = std::fs::metadata(&source_abs).map_err(|err| {
            asset_error(format!("image metadata could not be read: {display_path} ({err})"), "check the image path")
        })?;
        if !metadata.is_file() {
            return Err(asset_error(format!("image file not found: {display_path}"), "place the image at the deck-relative path"));
        }
        let bytes = std::fs::read(&source_abs).map_err(|err| {
            asset_error(format!("image could not be read: {display_path} ({err})"), "check filesystem permissions")
        })?;
        let hash = short_sha256_hex(&bytes, 16);
        if let Some(asset) = self.by_hash.get(&hash) {
            return Ok(asset.clone());
        }
        let basename = Path::new(display_path).file_name().and_then(|n| n.to_str()).ok_or_else(|| {
            asset_error(format!("image path has no file name: {display_path}"), "write a deck-relative image path with a file name")
        })?;
        let dist_rel = ResolvedImagePath::from_hashed_asset(&hash, basename)
            .map_err(|message| asset_error(message, "keep generated image asset paths under assets/"))?;
        let asset = ResolvedImageAsset { source_abs, dist_rel };
        self.by_hash.insert(hash, asset.clone());
        Ok(asset)
    }
}

fn short_sha256_hex(bytes: &[u8], hex_chars: usize) -> String {
    use std::fmt::Write as _;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash: [u8; 32] = hasher.finalize().into();
    let byte_count = hex_chars.div_ceil(2).min(hash.len());
    let mut hex = String::with_capacity(byte_count * 2);
    for byte in &hash[..byte_count] {
        write!(&mut hex, "{byte:02x}").expect("writing to String cannot fail");
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_source_spec_renders_a_real_example_deck() {
        // Exercises the embedded engine against a real, maintained deck
        // from the sibling peitho checkout (see `engine::fixtures`) rather
        // than a hand-rolled snippet — that's what actually catches a
        // peitho-core API/behavior drift.
        let deck_path = crate::engine::fixtures::example_deck("minimal");
        let source = std::fs::read_to_string(&deck_path).expect("fixture deck should exist on disk");
        let output = render_source(&deck_path, &source).expect("a valid example deck should render");

        let manifest: serde_json::Value = serde_json::from_str(&output.manifest_json).expect("manifest_json should be valid JSON");
        assert_eq!(manifest["slideCount"], 3);
        assert_eq!(output.fragments.len(), 3);
        assert!(!output.css.is_empty());
    }

    #[test]
    fn render_source_adversarial_duplicate_keys_is_a_build_error() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let source = "<!-- {\"key\":\"a\"} -->\n# One\n\n---\n\n<!-- {\"key\":\"a\"} -->\n# Two\n";
        assert!(render_source(&deck_path, source).is_err());
    }

    #[test]
    fn render_source_adversarial_section_without_time_is_a_build_error() {
        // peitho requires `section` and `time` to be set together in a
        // PageComment — one without the other is rejected at build time.
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let source = "<!-- {\"section\":\"Intro\"} -->\n# One\n";
        assert!(render_source(&deck_path, source).is_err());
    }

    #[test]
    fn short_sha256_hex_spec_matches_a_known_sha256_prefix() {
        // sha256("") == e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(short_sha256_hex(b"", 16), "e3b0c44298fc1c14");
    }

    #[test]
    fn short_sha256_hex_spec_same_bytes_always_hash_the_same() {
        assert_eq!(short_sha256_hex(b"peitho", 16), short_sha256_hex(b"peitho", 16));
        assert_ne!(short_sha256_hex(b"peitho", 16), short_sha256_hex(b"peitho!", 16));
    }

    #[test]
    fn short_sha256_hex_adversarial_hex_chars_zero_returns_empty() {
        assert_eq!(short_sha256_hex(b"anything", 0), "");
    }

    #[test]
    fn short_sha256_hex_adversarial_odd_hex_chars_rounds_up_a_full_byte() {
        // 1 hex char still needs a whole byte (2 hex digits) to render.
        assert_eq!(short_sha256_hex(b"", 1), "e3");
    }

    #[test]
    fn short_sha256_hex_adversarial_hex_chars_beyond_digest_length_is_clamped() {
        // A 32-byte SHA-256 digest is 64 hex chars long — asking for more
        // must not panic on an out-of-bounds slice.
        let full = short_sha256_hex(b"", 64);
        assert_eq!(full.len(), 64);
        assert_eq!(short_sha256_hex(b"", 1000), full);
    }
}
