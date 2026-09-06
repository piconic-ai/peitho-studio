//! Vendored copies of peitho's built-in layout and base theme
//! (`layouts/title-body-code.html`, `themes/base.css` in the peitho repo).
//! peitho-core doesn't export these itself — only the `peitho` CLI binary
//! embeds them (`crates/peitho/src/main.rs::BUILTIN_LAYOUT_HTML`/
//! `BUILTIN_BASE_CSS`) — so a deck with no `layouts/`/`css/` directory of
//! its own needs a local copy to fall back to. Keep these in sync with the
//! upstream files (a mismatch only shows up as a slightly different
//! built-in look, not a hard failure); see the plan's upstream proposal to
//! have peitho-core export these directly so this copy can go away.

pub const LAYOUT_HTML: &str = include_str!("builtin/title-body-code.html");
pub const BASE_CSS: &str = include_str!("builtin/base.css");
