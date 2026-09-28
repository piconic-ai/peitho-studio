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

/// Studio's own layout for a slide holding one image (a title, optional
/// body text, and the image below), scaffolded next to `LAYOUT_HTML` by
/// `create_deck` so an image dropped or pasted into a new deck shows up
/// (see `engine::images`). Not part of the no-`layouts/` fallback: peitho's
/// CLI has only `title-body-code` built in, and a deck without its own
/// layouts should build the same in both.
///
/// Its image slot is required (`arity="1"`), so with both layouts in a deck
/// a slide without an image fits only `title-body-code` and a slide with
/// one fits only this — peitho-core needs exactly one structural match.
pub const IMAGE_LAYOUT_HTML: &str = include_str!("builtin/title-body-image.html");

/// Sizes `IMAGE_LAYOUT_HTML`'s image to the space left under the title and
/// body, scaffolded as its own `css/` file so `css/base.css` stays a plain
/// copy of peitho's theme.
pub const IMAGE_LAYOUT_CSS: &str = include_str!("builtin/title-body-image.css");

/// Matches `crates/peitho/templates/new/gitignore` in the peitho repo —
/// `dist/` and `.peitho/` are directories `peitho build`/`preview`/`present`
/// write into, so a scaffolded deck should ignore them from the start.
pub const GITIGNORE: &str = "dist/\n.peitho/\n";
