//! The actual parse -> map -> check -> resolve -> render pipeline, run
//! in-process. Mirrors `peitho`'s own `build_artifacts`
//! (crates/peitho/src/main.rs) — that function is the reference this was
//! ported from; re-check it there if peitho-core's API shifts underneath.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use peitho_core::domain::{Accepts, SlotContract};
use peitho_core::phase::Parsed;
use peitho_core::{
    build_manifest, build_theme_css, check_deck, dispatch_by_convention, explain_dispatch, manifest_json, DispatchResult,
    parse_deck_and_transform, parse_frontmatter, render_deck, resolve_image_paths, BuildError, Deck,
    EditAnnotations, ImageRequest, Layout, LayoutAssets, Layouts, ResolvedImageAsset, ResolvedImagePath,
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
    /// The layout each slide was built on, keyed like `fragments` — named
    /// by its `"layout"`, or picked by peitho-core when it names none. Not
    /// part of `manifest_json`, which carries no layouts.
    pub slide_layouts: HashMap<String, String>,
    /// The deck's layouts (its `layouts/` files, or the built-in fallback)
    /// that a slide holding only a heading builds on, by name — see
    /// `takes_bare_heading`.
    pub heading_layouts: Vec<String>,
    pub css: String,
    pub has_math: bool,
    /// `assets/<hash>-<name>` (as referenced from `css`/fragment HTML) ->
    /// absolute source path on disk, for `engine::serve` to read from.
    pub image_assets: HashMap<String, PathBuf>,
    /// Present only when the deck has its own `fonts/` directory.
    pub fonts_dir: Option<PathBuf>,
    /// The deck's own directory — `engine::serve` falls back to reading
    /// `deck_dir/assets/<name>` directly for a request `image_assets`
    /// doesn't recognize (e.g. a module chunk a layout's own script
    /// imports relatively, which no layout attribute names).
    pub deck_dir: PathBuf,
}

/// A deck source parsed up to (not including) layout dispatch, plus the
/// deck-adjacent assets the parse resolved — the shared first half of
/// `render_source` and `engine::layout_fit`, which needs the parsed slides
/// and the deck's layouts but none of the rendering after them.
pub struct ParsedSource {
    pub deck: Deck<Parsed>,
    pub assets: ResolvedAssets,
}

pub(crate) fn deck_dir_of(deck_path: &Path) -> &Path {
    deck_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

pub fn parse_source(deck_path: &Path, source: &str) -> Result<ParsedSource, String> {
    let deck_dir = deck_dir_of(deck_path);

    let frontmatter = parse_frontmatter(source).map_err(|err| err.to_string())?;
    let expanded = peitho_core::include::expand_includes(source, frontmatter.body_start(), deck_path)
        .map_err(|err| err.to_string())?;

    let assets = assets::resolve(deck_dir)?;

    let code_images_cache_dir = deck_dir.join(peitho_core::CODE_IMAGES_CACHE_DIR);
    let embeds_cache_dir = deck_dir.join(peitho_core::EMBEDS_CACHE_DIR);

    let deck = parse_deck_and_transform(
        &expanded.source,
        frontmatter,
        assets.highlighter.get(),
        &UnsupportedSvgRunner,
        &UnsupportedEmbedRenderer,
        &UnsupportedOEmbedFetcher,
        &code_images_cache_dir,
        &embeds_cache_dir,
    )
    .map_err(|err| err.to_string())?;

    Ok(ParsedSource { deck, assets })
}

pub fn render_source(deck_path: &Path, source: &str) -> Result<RenderOutput, String> {
    let deck_dir = deck_dir_of(deck_path);

    let ParsedSource { deck: parsed, assets: ResolvedAssets { layouts, css: css_files, highlighter, fonts_dir } } =
        parse_source(deck_path, source)?;
    let highlighter = highlighter.get();

    let slide_layouts = slide_layouts(&parsed, &layouts);
    let heading_layouts = layouts.iter().filter(|layout| takes_bare_heading(layout)).map(|layout| layout.name().to_string()).collect();
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
    let (resolved, mut image_assets) =
        resolve_image_paths(checked, |request| resolver.resolve(request)).map_err(|err| err.to_string())?;
    // Resolved after Markdown images so a file referenced from both dedupes
    // onto the asset the Markdown path already registered (same order as
    // `peitho`'s own `build_artifacts`).
    let layout_assets = resolve_layout_assets(&layouts, &mut resolver, &mut image_assets)?;

    let manifest = build_manifest(&resolved, &image_assets);
    let manifest_json = manifest_json(&manifest).map_err(|err| err.to_string())?;

    // `On`, as `peitho preview` renders: paragraphs, headings, list items
    // and table cells carry `data-peitho-src` (their UTF-8 byte span in the
    // source the parser read) and `data-peitho-md` (that Markdown), which
    // the preview's comment UI reads (`domain/reviewComment.ts`). Nothing
    // Studio renders here is ever published, which is the only place
    // peitho-core refuses the attributes (`find_edit_annotation_attribute`).
    let rendered = render_deck(resolved, highlighter, theme_css, EditAnnotations::On, &layout_assets)
        .map_err(|err| err.to_string())?;
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

    Ok(RenderOutput {
        manifest_json,
        fragments,
        slide_layouts,
        heading_layouts,
        css,
        has_math,
        image_assets,
        fonts_dir,
        deck_dir: deck_dir.to_path_buf(),
    })
}

/// Whether a slide holding nothing but one heading builds on `layout` when
/// it names it: the heading goes to a `title` slot taking exactly one
/// heading, and every other slot may stay empty.
pub fn takes_bare_heading(layout: &Layout) -> bool {
    let is_title = |slot: &SlotContract| slot.name.as_str() == "title";
    let slots = layout.slots().values();
    slots.clone().any(|slot| is_title(slot) && matches!(slot.accepts, Accepts::Inline | Accepts::Blocks) && slot.arity.allows(1))
        && slots.filter(|slot| !is_title(slot)).all(|slot| slot.arity.allows(0))
}

/// The layout peitho-core's dispatch gives each slide of `parsed`, by slide
/// key — leaving out a slide it can't place (unknown, ambiguous or
/// mismatched layout), which `dispatch_by_convention` then reports.
/// peitho-core keeps the layout a mapped slide was given to itself, so
/// this asks `explain_dispatch` for the same decision instead.
fn slide_layouts(parsed: &Deck<Parsed>, layouts: &Layouts) -> HashMap<String, String> {
    parsed
        .parsed_slides()
        .iter()
        .filter_map(|slide| match explain_dispatch(slide, layouts).result() {
            DispatchResult::Matched(layout) => Some((slide.key.as_str().to_string(), layout.clone())),
            _ => None,
        })
        .collect()
}

/// Resolves every deck-relative asset a layout's own HTML references
/// (`<video src>`, `poster`, `<script src>`, ...) to its hashed
/// `assets/<hash>-<name>` path, mirroring `peitho`'s `resolve_layout_assets`
/// (crates/peitho/src/main.rs). Each newly seen asset is appended to
/// `image_assets` so `engine::serve` can serve it like a Markdown image.
fn resolve_layout_assets(
    layouts: &Layouts,
    resolver: &mut DraftImageResolver,
    image_assets: &mut Vec<ResolvedImageAsset>,
) -> Result<LayoutAssets, String> {
    let mut per_layout = BTreeMap::new();
    for layout in layouts.iter() {
        let mut resolved = BTreeMap::new();
        for reference in layout.asset_refs() {
            let asset = resolver.resolve_deck_relative(reference.raw()).map_err(|err| {
                format!(
                    "{} (referenced by <{} {}=\"{}\"> in layout '{}')",
                    err.message,
                    reference.element(),
                    reference.attribute(),
                    reference.raw(),
                    layout.name()
                )
            })?;
            if !image_assets.iter().any(|existing| existing.dist_rel == asset.dist_rel) {
                image_assets.push(asset.clone());
            }
            resolved.insert(reference.raw().to_owned(), asset.dist_rel);
        }
        if !resolved.is_empty() {
            per_layout.insert(layout.name().to_owned(), resolved);
        }
    }
    Ok(LayoutAssets::new(per_layout))
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
        self.resolve_deck_relative(request.raw.as_str())
    }

    /// Resolves any deck-relative path, whether a Markdown image or a
    /// layout's own asset reference referenced it.
    fn resolve_deck_relative(&mut self, display_path: &str) -> peitho_core::Result<ResolvedImageAsset> {
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

    /// Each `data-peitho-src="<start>-<end>"` and its `data-peitho-md` in
    /// `html`, with the Markdown decoded the way a browser's `getAttribute`
    /// would (only the entities peitho-core writes).
    fn edit_annotations(html: &str) -> Vec<(usize, usize, String)> {
        const SRC: &str = "data-peitho-src=\"";
        const MD: &str = "data-peitho-md=\"";
        let mut found = Vec::new();
        let mut rest = html;
        while let Some(at) = rest.find(SRC) {
            rest = &rest[at + SRC.len()..];
            let (span, after) = rest.split_once('"').unwrap();
            let (start, end) = span.split_once('-').unwrap();
            let md_at = after.find(MD).unwrap() + MD.len();
            let raw = &after[md_at..md_at + after[md_at..].find('"').unwrap()];
            let markdown =
                raw.replace("&#10;", "\n").replace("&#13;", "\r").replace("&quot;", "\"").replace("&lt;", "<").replace("&amp;", "&");
            found.push((start.parse().unwrap(), end.parse().unwrap(), markdown));
        }
        found
    }

    #[test]
    fn render_source_spec_edit_annotations_are_byte_spans_into_the_source_as_given() {
        // Given a deck with frontmatter, multibyte text, a list and a table,
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let source = "---\nlang: ja\n---\n\n# 見出し 🎉 & \"q\"\n\n段落の\nテキスト\n\n- 項目 one\n- two\n\n| a | 表 |\n|---|---|\n| 1 | 😀 |\n";
        // When it is rendered,
        let output = render_source(&deck_path, source).expect("the deck should render");
        let annotations: Vec<_> = output.fragments.values().flat_map(|html| edit_annotations(html)).collect();
        // Then every annotated element's span, read as UTF-8 bytes of the
        // source Studio passed in (frontmatter included), is exactly its
        // Markdown — which `domain/reviewComment.ts` relies on,
        assert!(annotations.len() >= 6, "{annotations:?}");
        for (start, end, markdown) in &annotations {
            assert_eq!(&source.as_bytes()[*start..*end], markdown.as_bytes(), "span {start}-{end}");
        }
        // and the kinds the comment UI targets are all annotated.
        let markdowns: Vec<&str> = annotations.iter().map(|(_, _, markdown)| markdown.as_str()).collect();
        for expected in ["見出し 🎉 & \"q\"", "段落の\nテキスト", "項目 one", "two", "表", "😀"] {
            assert!(markdowns.contains(&expected), "{expected:?} not in {markdowns:?}");
        }
    }

    // A deck with two layouts where one ("cover") is a strict subset of the
    // other ("title-body-code", every slot but title optional) makes a bare
    // title-only slide structurally match both — peitho-core refuses to
    // guess and requires an explicit `"layout"` in that case. Discovered via
    // a real "New Slide" doing nothing on such a deck (the frontend's
    // `newSlideConfig` in `domain/slides.ts` now carries over the previous
    // slide's explicit layout for exactly this reason). This deck shape,
    // not a hand-picked minimal one, is what actually caught the bug.
    fn write_two_layout_deck(dir: &std::path::Path, second_slide_comment: &str) -> std::path::PathBuf {
        let layouts_dir = dir.join("layouts");
        std::fs::create_dir_all(&layouts_dir).unwrap();
        std::fs::write(
            layouts_dir.join("cover.html"),
            "<section class=\"peitho-slide\"><h1><slot name=\"title\" accepts=\"inline\" arity=\"1\"></slot></h1></section>",
        )
        .unwrap();
        std::fs::write(layouts_dir.join("title-body-code.html"), crate::engine::builtin::LAYOUT_HTML).unwrap();

        let deck_path = dir.join("deck.md");
        let source = format!(
            "<!-- {{\"key\":\"cover\",\"layout\":\"cover\"}} -->\n# Cover\n\n---\n\n{second_slide_comment}\n# New Slide\n"
        );
        std::fs::write(&deck_path, source).unwrap();
        deck_path
    }

    #[test]
    fn render_source_adversarial_a_title_only_slide_with_no_explicit_layout_is_ambiguous() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = write_two_layout_deck(dir.path(), "<!-- {\"key\":\"new-slide\"} -->");
        let source = std::fs::read_to_string(&deck_path).unwrap();

        match render_source(&deck_path, &source) {
            Ok(_) => panic!("expected a layout-ambiguity error, got Ok"),
            Err(err) => assert!(err.contains("matches multiple layouts"), "unexpected error: {err}"),
        }
    }

    #[test]
    fn render_source_spec_an_explicit_layout_disambiguates_a_title_only_slide() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = write_two_layout_deck(dir.path(), "<!-- {\"key\":\"new-slide\",\"layout\":\"cover\"} -->");
        let source = std::fs::read_to_string(&deck_path).unwrap();

        let output = render_source(&deck_path, &source).expect("an explicit layout should resolve the ambiguity");
        assert_eq!(output.fragments.len(), 2);
    }

    #[test]
    fn given_slides_naming_a_layout_or_not_when_rendered_then_each_ones_layout_is_reported_by_key() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = write_two_layout_deck(dir.path(), "<!-- {\"key\":\"new-slide\",\"layout\":\"cover\"} -->");
        let source = format!("{}\n---\n\n# Picked by structure\n\nA body paragraph.\n", std::fs::read_to_string(&deck_path).unwrap());

        let output = render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(
            output.slide_layouts,
            HashMap::from([
                ("cover".to_string(), "cover".to_string()),
                ("new-slide".to_string(), "cover".to_string()),
                ("picked-by-structure".to_string(), "title-body-code".to_string()),
            ])
        );
        assert_eq!(output.heading_layouts, ["cover", "title-body-code"]);
    }

    #[test]
    fn given_a_deck_without_layouts_when_rendered_then_every_slide_reports_the_built_in_layout() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let output = render_source(&deck_path, "# One\n\n---\n\n# Two\n").unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(output.slide_layouts.values().collect::<Vec<_>>(), ["title-body-code", "title-body-code"]);
        assert_eq!(output.heading_layouts, ["title-body-code"]);
    }

    #[test]
    fn given_the_layouts_a_new_deck_has_then_only_the_image_and_titleless_ones_refuse_a_bare_heading() {
        use crate::engine::builtin;
        let mut takes: Vec<&str> = builtin::STANDARD_LAYOUTS
            .iter()
            .filter(|layout| takes_bare_heading(&peitho_core::parse_layout(layout.name, layout.html).unwrap()))
            .map(|layout| layout.name)
            .collect();
        takes.sort();
        assert_eq!(
            takes,
            ["big-number", "main-point", "one-column-text", "section-header", "section-title-description", "title-body", "title-only", "title-slide", "two-column"]
        );
        assert!(!takes_bare_heading(&peitho_core::parse_layout("title-body-image", builtin::IMAGE_LAYOUT_HTML).unwrap()));
        assert!(takes_bare_heading(&peitho_core::parse_layout("title-body-code", builtin::LAYOUT_HTML).unwrap()));
    }

    #[test]
    fn given_each_layout_takes_bare_heading_judges_when_a_heading_only_slide_names_it_then_the_build_agrees() {
        // The judgement from slot contracts must match what peitho-core does.
        use crate::engine::builtin;
        let html_of = |name: &str| match name {
            "title-body-image" => builtin::IMAGE_LAYOUT_HTML,
            other => builtin::STANDARD_LAYOUTS.iter().find(|layout| layout.name == other).unwrap().html,
        };
        let names: Vec<&str> = builtin::STANDARD_LAYOUTS.iter().map(|layout| layout.name).chain(["title-body-image"]).collect();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("layouts")).unwrap();
        for name in &names {
            std::fs::write(dir.path().join("layouts").join(format!("{name}.html")), html_of(name)).unwrap();
        }
        std::fs::create_dir(dir.path().join("css")).unwrap();
        let deck_path = dir.path().join("deck.md");
        for name in names {
            let builds = render_source(&deck_path, &format!("<!-- {{\"layout\":\"{name}\"}} -->\n# New Slide\n")).is_ok();
            assert_eq!(takes_bare_heading(&peitho_core::parse_layout(name, html_of(name)).unwrap()), builds, "{name}");
        }
    }

    /// A 1x1 PNG.
    const TINY_PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0xe9, 0xfa, 0xdc, 0xd8, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn given_a_deck_scaffolded_before_standard_layouts_when_new_slide_follows_an_image_slide_then_a_bare_heading_still_builds() {
        // The shape New Deck used to write: title-body-code next to the
        // image layout. The image slide is built on title-body-image, which
        // `heading_layouts` leaves out, so New Slide names no layout and
        // peitho-core picks title-body-code for the heading as it always did.
        use crate::engine::builtin;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("layouts")).unwrap();
        std::fs::write(dir.path().join("layouts/title-body-code.html"), builtin::LAYOUT_HTML).unwrap();
        std::fs::write(dir.path().join("layouts/title-body-image.html"), builtin::IMAGE_LAYOUT_HTML).unwrap();
        let deck_path = dir.path().join("deck.md");
        crate::engine::images::import_image(dir.path(), "photo.png", TINY_PNG).unwrap();
        let before = "# Photo\n\n![](img/photo.png)\n";

        let output = render_source(&deck_path, before).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(output.slide_layouts["photo"], "title-body-image");
        assert_eq!(output.heading_layouts, ["title-body-code"]);

        let after = format!("{before}\n---\n\n<!-- {{\"key\":\"new-slide\"}} -->\n# New Slide\n");
        let output = render_source(&deck_path, &after).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(output.slide_layouts["new-slide"], "title-body-code");
        let pinned = format!("{before}\n---\n\n<!-- {{\"key\":\"new-slide\",\"layout\":\"title-body-image\"}} -->\n# New Slide\n");
        assert!(render_source(&deck_path, &pinned).is_err(), "pinning the image layout is what must not happen");
    }

    #[test]
    fn adversarial_takes_bare_heading_refuses_a_title_that_wants_more_or_takes_no_heading() {
        let judge = |html: &str| takes_bare_heading(&peitho_core::parse_layout("x", html).unwrap());
        assert!(!judge("<section></section>"));
        assert!(!judge("<section><slot name=\"title\" accepts=\"inline\" arity=\"0..1\"></slot><slot name=\"body\" accepts=\"blocks\" arity=\"1..*\"></slot></section>"));
        assert!(!judge("<section><slot name=\"title\" accepts=\"code\" arity=\"1\"></slot></section>"));
        assert!(judge("<section><slot name=\"title\" accepts=\"inline\" arity=\"1..*\"></slot></section>"));
        assert!(judge("<section><slot name=\"title\" accepts=\"blocks\" arity=\"0..*\"></slot><slot name=\"aside\" accepts=\"list\" arity=\"0..1\"></slot></section>"));
    }

    #[test]
    fn adversarial_given_a_draft_slide_when_rendered_then_it_has_no_reported_layout() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let source = "# One\n\n---\n\n<!-- {\"key\":\"hidden\",\"draft\":true} -->\n# Two\n";
        let output = render_source(&deck_path, source).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(output.slide_layouts.keys().collect::<Vec<_>>(), ["one"]);
    }

    #[test]
    fn adversarial_slide_layouts_leaves_out_a_slide_it_cannot_place() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = write_two_layout_deck(dir.path(), "<!-- {\"key\":\"new-slide\"} -->");
        let source = std::fs::read_to_string(&deck_path).unwrap();
        let parsed = parse_source(&deck_path, &source).unwrap();

        let layouts = slide_layouts(&parsed.deck, &parsed.assets.layouts);
        assert_eq!(layouts, HashMap::from([("cover".to_string(), "cover".to_string())]));
    }

    #[test]
    fn render_source_adversarial_duplicate_keys_is_a_build_error() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let source = "<!-- {\"key\":\"a\"} -->\n# One\n\n---\n\n<!-- {\"key\":\"a\"} -->\n# Two\n";
        assert!(render_source(&deck_path, source).is_err());
    }

    // A 4-section, 15-minute deck (mirroring a real example deck) — the
    // fixture the next few tests mutate the way Studio.tsx's
    // deleteSlide/addSlide/toggleSlideSection do, to confirm the
    // frontend's frontmatter-time bookkeeping actually produces something
    // peitho-core accepts.
    const FOUR_SECTION_DECK: &str = "---\ntime: 15m\n---\n\
<!-- {\"key\":\"problem\",\"section\":\"Problem\",\"time\":\"1m\"} -->\n# One\n\n---\n\n\
<!-- {\"key\":\"approach\",\"section\":\"Approach\",\"time\":\"2m\"} -->\n# Two\n\n---\n\n\
<!-- {\"key\":\"wrapup\",\"section\":\"Wrap-up\",\"time\":\"1m\"} -->\n# Three\n\n---\n\n\
<!-- {\"key\":\"setup\",\"section\":\"Setup\",\"time\":\"11m\"} -->\n# Four\n\n---\n\n\
<!-- {\"key\":\"review\"} -->\n# Five\n";

    #[test]
    fn render_source_spec_deck_after_deleting_a_section_slide_stays_valid() {
        // Studio.tsx's deleteSlide removes the "Problem" slide (1m) and
        // resyncs frontmatter time to the remaining sections' sum (14m) —
        // this is the exact bug (tmp/todo.md: "it errors when a time is
        // specified") this test guards against regressing.
        let source = "---\ntime: 14m\n---\n\
<!-- {\"key\":\"approach\",\"section\":\"Approach\",\"time\":\"2m\"} -->\n# Two\n\n---\n\n\
<!-- {\"key\":\"wrapup\",\"section\":\"Wrap-up\",\"time\":\"1m\"} -->\n# Three\n\n---\n\n\
<!-- {\"key\":\"setup\",\"section\":\"Setup\",\"time\":\"11m\"} -->\n# Four\n\n---\n\n\
<!-- {\"key\":\"review\"} -->\n# Five\n";
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let output = render_source(&deck_path, source).expect("resynced frontmatter time should build cleanly");
        let manifest: serde_json::Value = serde_json::from_str(&output.manifest_json).unwrap();
        assert_eq!(manifest["slideCount"], 4);
        assert_eq!(manifest["plannedDurationMs"], 14 * 60_000);
    }

    #[test]
    fn render_source_adversarial_deleting_a_section_slide_without_resyncing_time_fails() {
        // The bug itself: same deletion as above, but frontmatter still
        // says 15m — proves the resync in `syncedSource` (Studio.tsx) is
        // load-bearing, not just tidiness.
        let source = "---\ntime: 15m\n---\n\
<!-- {\"key\":\"approach\",\"section\":\"Approach\",\"time\":\"2m\"} -->\n# Two\n\n---\n\n\
<!-- {\"key\":\"wrapup\",\"section\":\"Wrap-up\",\"time\":\"1m\"} -->\n# Three\n\n---\n\n\
<!-- {\"key\":\"setup\",\"section\":\"Setup\",\"time\":\"11m\"} -->\n# Four\n\n---\n\n\
<!-- {\"key\":\"review\"} -->\n# Five\n";
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        assert!(render_source(&deck_path, source).is_err());
    }

    #[test]
    fn render_source_spec_deck_after_adding_a_plain_slide_stays_valid() {
        // Studio.tsx's addSlide inserts a section-less blank slide — the
        // section sum (and so the frontmatter time) is unchanged.
        let source = "---\ntime: 15m\n---\n\
<!-- {\"key\":\"problem\",\"section\":\"Problem\",\"time\":\"1m\"} -->\n# One\n\n---\n\n\
# New Slide\n\n---\n\n\
<!-- {\"key\":\"approach\",\"section\":\"Approach\",\"time\":\"2m\"} -->\n# Two\n\n---\n\n\
<!-- {\"key\":\"wrapup\",\"section\":\"Wrap-up\",\"time\":\"1m\"} -->\n# Three\n\n---\n\n\
<!-- {\"key\":\"setup\",\"section\":\"Setup\",\"time\":\"11m\"} -->\n# Four\n\n---\n\n\
<!-- {\"key\":\"review\"} -->\n# Five\n";
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let output = render_source(&deck_path, source).expect("adding a plain slide shouldn't need a time resync");
        let manifest: serde_json::Value = serde_json::from_str(&output.manifest_json).unwrap();
        assert_eq!(manifest["slideCount"], 6);
        assert_eq!(manifest["plannedDurationMs"], 15 * 60_000);
    }

    #[test]
    fn render_source_spec_deck_after_marking_a_slide_as_a_new_section_stays_valid() {
        // Studio.tsx's toggleSlideSection promotes the plain "review" slide
        // to a section start (default 30s) — frontmatter time grows to
        // match the new sum (15m30s).
        let source = "---\ntime: 15m30s\n---\n\
<!-- {\"key\":\"problem\",\"section\":\"Problem\",\"time\":\"1m\"} -->\n# One\n\n---\n\n\
<!-- {\"key\":\"approach\",\"section\":\"Approach\",\"time\":\"2m\"} -->\n# Two\n\n---\n\n\
<!-- {\"key\":\"wrapup\",\"section\":\"Wrap-up\",\"time\":\"1m\"} -->\n# Three\n\n---\n\n\
<!-- {\"key\":\"setup\",\"section\":\"Setup\",\"time\":\"11m\"} -->\n# Four\n\n---\n\n\
<!-- {\"key\":\"review\",\"section\":\"New Section\",\"time\":\"30s\"} -->\n# Five\n";
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let output = render_source(&deck_path, source).expect("a freshly-sectioned slide should build cleanly");
        let manifest: serde_json::Value = serde_json::from_str(&output.manifest_json).unwrap();
        assert_eq!(manifest["slideCount"], 5);
        assert_eq!(manifest["plannedDurationMs"], 15 * 60_000 + 30_000);
        assert_eq!(manifest["sections"].as_array().unwrap().len(), 5);
    }

    #[test]
    fn render_source_spec_deck_after_removing_a_section_stays_valid() {
        // Studio.tsx's toggleSlideSection demotes a section start back to
        // a plain slide (both `section` and `time` dropped together) —
        // frontmatter time shrinks to match.
        let source = "---\ntime: 14m\n---\n\
<!-- {\"key\":\"approach\",\"section\":\"Approach\",\"time\":\"2m\"} -->\n# Two\n\n---\n\n\
<!-- {\"key\":\"wrapup\",\"section\":\"Wrap-up\",\"time\":\"1m\"} -->\n# Three\n\n---\n\n\
<!-- {\"key\":\"setup\",\"section\":\"Setup\",\"time\":\"11m\"} -->\n# Four\n\n---\n\n\
<!-- {\"key\":\"review\"} -->\n# Five\n";
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let output = render_source(&deck_path, source).expect("demoting a section should build cleanly");
        let manifest: serde_json::Value = serde_json::from_str(&output.manifest_json).unwrap();
        assert_eq!(manifest["sections"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn render_source_spec_four_section_fixture_itself_is_valid() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let output = render_source(&deck_path, FOUR_SECTION_DECK).expect("fixture deck should be valid");
        let manifest: serde_json::Value = serde_json::from_str(&output.manifest_json).unwrap();
        assert_eq!(manifest["slideCount"], 5);
        assert_eq!(manifest["plannedDurationMs"], 15 * 60_000);
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

    // The slide list's status badge (`domain/slideStatus.ts`) reads the
    // manifest `render_draft` returns, so these two pin what that manifest
    // actually carries for skipped and draft slides.
    #[test]
    fn render_source_spec_a_skipped_slide_stays_in_the_manifest_flagged_skip() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let source = "<!-- {\"key\":\"opening\"} -->\n# Opening\n\n---\n\n<!-- {\"key\":\"backup\",\"skip\":true} -->\n# Backup\n";
        let output = render_source(&deck_path, source).expect("a skipped slide should build cleanly");
        let manifest: serde_json::Value = serde_json::from_str(&output.manifest_json).unwrap();
        let slides = manifest["slides"].as_array().unwrap();
        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0]["skip"], false);
        assert_eq!((slides[1]["key"].as_str(), slides[1]["skip"].as_bool()), (Some("backup"), Some(true)));
        assert!(output.fragments.contains_key("backup"));
    }

    #[test]
    fn render_source_adversarial_a_draft_slide_never_reaches_the_manifest() {
        // Why the thumbnail DRAFT badge can't show yet: peitho-core drops
        // draft slides while parsing, so there is no manifest entry (or
        // fragment) to put a badge on, and later slides' indices shift down.
        // If this starts failing, peitho-core changed how drafts are built —
        // revisit todo/slide-status-badges.md.
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let source = "<!-- {\"key\":\"wip\",\"draft\":true} -->\n# Work in progress\n\n---\n\n<!-- {\"key\":\"opening\"} -->\n# Opening\n";
        let output = render_source(&deck_path, source).expect("a deck with one draft and one live slide should build");
        let manifest: serde_json::Value = serde_json::from_str(&output.manifest_json).unwrap();
        let slides = manifest["slides"].as_array().unwrap();
        assert_eq!(slides.len(), 1);
        assert_eq!((slides[0]["key"].as_str(), slides[0]["index"].as_u64()), (Some("opening"), Some(0)));
        assert!(slides[0].get("draft").is_none());
        assert!(!output.fragments.contains_key("wip"));
    }

    // A layout that references its own asset directly (not through Markdown
    // image syntax) — the shape of a video-background cover slide.
    fn write_video_layout_deck(dir: &std::path::Path, with_asset: bool) -> std::path::PathBuf {
        let layouts_dir = dir.join("layouts");
        std::fs::create_dir_all(&layouts_dir).unwrap();
        // The built-in layout satisfies the built-in theme's slot selectors;
        // splice the video in right after its root `<section ...>` tag.
        let base = crate::engine::builtin::LAYOUT_HTML;
        let root_end = base.find('>').expect("built-in layout has a root tag") + 1;
        let html = format!("{}<video src=\"assets/hero.mp4\" autoplay muted></video>{}", &base[..root_end], &base[root_end..]);
        std::fs::write(layouts_dir.join("cover.html"), html).unwrap();
        if with_asset {
            std::fs::create_dir_all(dir.join("assets")).unwrap();
            std::fs::write(dir.join("assets/hero.mp4"), b"not really a video").unwrap();
        }
        let deck_path = dir.join("deck.md");
        std::fs::write(&deck_path, "<!-- {\"key\":\"cover\"} -->\n# Cover\n").unwrap();
        deck_path
    }

    #[test]
    fn render_source_spec_a_layout_asset_is_rewritten_to_its_hashed_path_and_served() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = write_video_layout_deck(dir.path(), true);
        let source = std::fs::read_to_string(&deck_path).unwrap();

        let output = render_source(&deck_path, &source).expect("a deck whose layout asset exists should render");

        let (dist_rel, source_abs) = output
            .image_assets
            .iter()
            .find(|(dist_rel, _)| dist_rel.ends_with("-hero.mp4"))
            .expect("the layout's video should be registered for engine::serve");
        assert!(dist_rel.starts_with("assets/"), "unexpected dist path: {dist_rel}");
        assert_eq!(source_abs, &std::fs::canonicalize(dir.path().join("assets/hero.mp4")).unwrap());
        assert!(
            output.fragments["cover"].contains(&format!("src=\"{dist_rel}\"")),
            "fragment should reference the hashed path: {}",
            output.fragments["cover"]
        );
    }

    #[test]
    fn render_source_adversarial_a_missing_layout_asset_names_the_layout_and_attribute() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = write_video_layout_deck(dir.path(), false);
        let source = std::fs::read_to_string(&deck_path).unwrap();

        match render_source(&deck_path, &source) {
            Ok(_) => panic!("expected a missing-asset error, got Ok"),
            Err(err) => {
                assert!(err.contains("assets/hero.mp4"), "unexpected error: {err}");
                assert!(err.contains("<video src="), "unexpected error: {err}");
                assert!(err.contains("layout 'cover'"), "unexpected error: {err}");
            }
        }
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
