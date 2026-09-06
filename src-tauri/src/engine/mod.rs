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
pub mod pipeline;
pub mod serve;
pub mod unsupported;

use std::sync::OnceLock;

use peitho_core::highlight::Highlighter;

static DEFAULT_HIGHLIGHTER: OnceLock<Highlighter> = OnceLock::new();

/// The built-in (no deck-adjacent `syntaxes/`) highlighter, built once and
/// shared for the lifetime of the app.
pub fn default_highlighter() -> &'static Highlighter {
    DEFAULT_HIGHLIGHTER.get_or_init(Highlighter::defaults)
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

    pub fn example_deck(name: &str) -> PathBuf {
        PathBuf::from("/Users/kfly8/src/github.com/mizzy/peitho/examples")
            .join(name)
            .join("deck.md")
    }
}
