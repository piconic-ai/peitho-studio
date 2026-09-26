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
}

/// Fixtures for the engine's tests: real decks from the sibling `peitho`
/// checkout (`crates/peitho/examples/*`), the same corpus peitho's own test
/// suite and this app's manual verification this session used. Exercising
/// the embedded engine against real, maintained decks (rather than
/// hand-rolled snippets) is what actually catches a peitho-core API/behavior
/// drift — see `engine/mod.rs`'s module doc on why that's the real risk of
/// this design.
#[cfg(test)]
pub(crate) mod fixtures {
    use std::path::PathBuf;

    /// Where the `peitho` checkout's `examples/` is: `PEITHO_EXAMPLES_DIR`
    /// when set (CI checks out peitho at the tag `Cargo.toml` pins), the
    /// author's sibling checkout otherwise.
    const DEFAULT_EXAMPLES_DIR: &str = "/Users/kfly8/src/github.com/mizzy/peitho/examples";

    pub fn example_deck(name: &str) -> PathBuf {
        let examples = std::env::var_os("PEITHO_EXAMPLES_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(DEFAULT_EXAMPLES_DIR));
        examples.join(name).join("deck.md")
    }
}
