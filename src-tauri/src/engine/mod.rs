//! In-process Peitho rendering engine.
//!
//! peitho-studio used to shell out to `peitho preview` and fetch
//! manifest.json / slide fragments over HTTP. That round trip has a real
//! floor: `peitho-core::highlight::Highlighter::defaults()` re-links
//! syntect's entire syntax set on first use (~250-300ms), and every edit
//! paid that cost fresh in a new `peitho preview` subprocess, plus the
//! subprocess's own polling file watcher (200ms poll + 200ms debounce) and
//! an HTTP round trip on top. None of that is required: peitho-core's
//! parse -> map -> check -> resolve -> render pipeline is `pub` end to end,
//! so it can run directly in this process. `default_highlighter()` builds
//! the highlighter exactly once per app run (peitho-core's own `OnceLock`
//! backs this too, so even a second call anywhere would be cheap) — after
//! that first pay, a render is on the order of tens of milliseconds.
//!
//! This intentionally depends on peitho-core's internal API rather than the
//! manifest.json/notes.json contract peitho documents for external tools
//! (see docs/PEITHO_KICKOFF.md in the peitho repo) — that contract is still
//! honored at the boundary (`pipeline::RenderOutput::manifest_json` is byte
//! for byte what `peitho_core::manifest_json` produces), but the dependency
//! on peitho-core's Rust API itself carries no semver guarantee. Keeping it
//! confined to this module is deliberate, so an upstream API change has one
//! place to be fixed.

pub mod assets;
pub mod builtin;
pub mod layout_fit;
pub mod pipeline;
pub mod serve;
pub mod unsupported;

use std::path::PathBuf;
use std::sync::OnceLock;

use peitho_core::highlight::Highlighter;

static DEFAULT_HIGHLIGHTER: OnceLock<Highlighter> = OnceLock::new();

/// The built-in (no deck-adjacent `syntaxes/`) highlighter, built once and
/// shared for the lifetime of the app.
pub fn default_highlighter() -> &'static Highlighter {
    DEFAULT_HIGHLIGHTER.get_or_init(Highlighter::defaults)
}

/// Pays the renderer's one-time costs ahead of the first `open_deck`:
/// building the default highlighter, and syntect compiling each language's
/// regexes the first time a code block in that language is highlighted.
/// Rendering the decks most likely to be opened next (and discarding the
/// output) warms exactly the languages they use. Errors are ignored — a
/// deck that fails to render here fails again, visibly, when opened.
pub fn warm_up(deck_paths: &[PathBuf]) {
    default_highlighter();
    for deck_path in deck_paths {
        if let Ok(source) = std::fs::read_to_string(deck_path) {
            let _ = pipeline::render_source(deck_path, &source);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warm_up_spec_renders_real_decks_without_disturbing_later_renders() {
        let deck_path = fixtures::example_deck("minimal");
        warm_up(std::slice::from_ref(&deck_path));

        let source = std::fs::read_to_string(&deck_path).expect("fixture deck should exist on disk");
        let output = pipeline::render_source(&deck_path, &source).expect("a warmed deck should still render");
        assert_eq!(output.fragments.len(), 3);
    }

    #[test]
    fn warm_up_adversarial_ignores_missing_and_unrenderable_decks() {
        let dir = tempfile::tempdir().expect("tempdir");
        let broken = dir.path().join("deck.md");
        std::fs::write(&broken, "# Broken\n\n```no-such-language\nx\n```\n").expect("write deck");
        assert!(pipeline::render_source(&broken, &std::fs::read_to_string(&broken).unwrap()).is_err());

        warm_up(&[]);
        warm_up(&[PathBuf::new(), dir.path().join("missing/deck.md"), dir.path().to_path_buf(), broken]);
    }

    #[test]
    fn peitho_core_manifest_spec_finds_it_among_the_packages() {
        let json = r#"{"packages":[
            {"name":"serde","manifest_path":"/reg/serde-1.0/Cargo.toml"},
            {"name":"peitho-core","manifest_path":"/git/checkouts/peitho-abc/5c5734e/crates/peitho-core/Cargo.toml"}
        ]}"#;
        assert_eq!(
            fixtures::peitho_core_manifest(json),
            Ok(PathBuf::from("/git/checkouts/peitho-abc/5c5734e/crates/peitho-core/Cargo.toml"))
        );
    }

    #[test]
    fn peitho_core_manifest_adversarial_missing_or_malformed_metadata_is_an_error() {
        for json in [
            "",
            "not json",
            "{}",
            r#"{"packages":{}}"#,
            r#"{"packages":[]}"#,
            r#"{"packages":[{"name":"peitho"}]}"#,
            r#"{"packages":[{"name":"Peitho-Core","manifest_path":"/x/Cargo.toml"}]}"#,
            r#"{"packages":[{"name":"peitho-core"}]}"#,
            r#"{"packages":[{"name":"peitho-core","manifest_path":7}]}"#,
        ] {
            assert!(fixtures::peitho_core_manifest(json).is_err(), "{json:?}");
        }
    }

    #[test]
    fn example_deck_spec_resolves_to_a_real_deck_of_the_pinned_peitho() {
        assert!(fixtures::example_deck("minimal").is_file());
    }
}

/// Fixtures for the engine's tests: real decks from peitho's own
/// `examples/`, the same corpus peitho's own test suite uses. Exercising
/// the embedded engine against real, maintained decks (rather than
/// hand-rolled snippets) is what actually catches a peitho-core API/behavior
/// drift — see `engine/mod.rs`'s module doc on why that's the real risk of
/// this design.
///
/// Taken from the checkout Cargo itself fetched for the `peitho-core` git
/// dependency, which holds the whole peitho repository at exactly the tag
/// `Cargo.toml` pins, so the decks always match the engine under test.
/// `PEITHO_EXAMPLES_DIR` overrides it (e.g. to try a local peitho branch).
#[cfg(test)]
pub(crate) mod fixtures {
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;

    pub fn example_deck(name: &str) -> PathBuf {
        examples_dir().join(name).join("deck.md")
    }

    fn examples_dir() -> &'static Path {
        static DIR: OnceLock<PathBuf> = OnceLock::new();
        DIR.get_or_init(|| match std::env::var_os("PEITHO_EXAMPLES_DIR") {
            Some(dir) => PathBuf::from(dir),
            None => examples_dir_from_cargo().unwrap_or_else(|err| panic!("can't find peitho's examples: {err}")),
        })
    }

    fn examples_dir_from_cargo() -> Result<PathBuf, String> {
        let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
        let output = std::process::Command::new(cargo)
            .args(["metadata", "--format-version", "1", "--locked", "--offline", "--filter-platform", env!("PEITHO_STUDIO_TARGET")])
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .output()
            .map_err(|err| format!("running cargo metadata: {err}"))?;
        if !output.status.success() {
            return Err(format!("cargo metadata failed: {}", String::from_utf8_lossy(&output.stderr)));
        }
        let manifest = peitho_core_manifest(&String::from_utf8_lossy(&output.stdout))?;
        manifest
            .ancestors()
            .map(|dir| dir.join("examples"))
            .find(|examples| examples.is_dir())
            .ok_or_else(|| format!("no examples/ above {}", manifest.display()))
    }

    /// `peitho-core`'s `Cargo.toml` path, from `cargo metadata`'s JSON.
    pub(super) fn peitho_core_manifest(metadata_json: &str) -> Result<PathBuf, String> {
        let metadata: serde_json::Value = serde_json::from_str(metadata_json).map_err(|err| format!("bad cargo metadata: {err}"))?;
        metadata["packages"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|package| package["name"] == "peitho-core")
            .and_then(|package| package["manifest_path"].as_str())
            .map(PathBuf::from)
            .ok_or_else(|| "peitho-core is not among cargo metadata's packages".to_string())
    }
}
