//! Dummy implementations of peitho-core's code-image/embed traits.
//!
//! `parse_deck_and_transform` needs a `SvgRunner` (external commands like
//! `dot`/mermaid CLIs), `EmbedRenderer` (headless-Chrome screenshots) and
//! `OEmbedFetcher` (network oEmbed lookups) — all of which the CLI
//! implements by shelling out or hitting the network. None of that belongs
//! on the hot path of a live in-editor preview, so Phase 1 declines them
//! with a clear error instead; `peitho build`/`peitho present` (still
//! shelled out to for Present, and always available as a fallback) support
//! them fully. Mermaid and math (KaTeX) render fine without any of this —
//! they're handled inside peitho-core itself, not through these traits.

use peitho_core::code_images::{EmbedRenderParams, EmbedRenderer, OEmbedFetcher, SvgRunner};
use peitho_core::domain::CodeImageCommand;
use peitho_core::error::{BuildError, ErrorKind};
use peitho_core::Result;

fn unsupported(what: &str) -> BuildError {
    BuildError::new(
        ErrorKind::Asset,
        None,
        format!("{what} isn't supported in Peitho Studio's live preview yet"),
        "run `peitho build` or `peitho present` for decks that need this — Studio's editor preview covers Markdown, layouts, Mermaid, and math directly",
    )
}

pub struct UnsupportedSvgRunner;

impl SvgRunner for UnsupportedSvgRunner {
    fn run(&self, _command: &CodeImageCommand, _stdin: &str) -> Result<Vec<u8>> {
        Err(unsupported("external code-image commands"))
    }
}

pub struct UnsupportedEmbedRenderer;

impl EmbedRenderer for UnsupportedEmbedRenderer {
    fn render(&self, _normalized_url: &str, _params: EmbedRenderParams) -> Result<Vec<u8>> {
        Err(unsupported("card/screenshot embeds"))
    }
}

pub struct UnsupportedOEmbedFetcher;

impl OEmbedFetcher for UnsupportedOEmbedFetcher {
    fn fetch(&self, _normalized_url: &str) -> Result<String> {
        Err(unsupported("oEmbed lookups"))
    }

    fn fetch_discovery_page(&self, _page_url: &str) -> Result<Vec<u8>> {
        Err(unsupported("oEmbed discovery"))
    }

    fn fetch_discovered_oembed(&self, _endpoint_url: &str) -> Result<Vec<u8>> {
        Err(unsupported("oEmbed discovery"))
    }

    fn fetch_thumbnail(&self, _image_url: &str) -> Result<Vec<u8>> {
        Err(unsupported("oEmbed thumbnails"))
    }
}
