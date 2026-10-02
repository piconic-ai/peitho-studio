//! Vendored copies of peitho's built-in layout and base theme
//! (`layouts/title-body-code.html`, `themes/base.css` in the peitho repo).
//! peitho-core doesn't export these itself — only the `peitho` CLI binary
//! embeds them (`crates/peitho/src/main.rs::BUILTIN_LAYOUT_HTML`/
//! `BUILTIN_BASE_CSS`) — so a deck with no `layouts/`/`css/` directory of
//! its own needs a local copy to fall back to. Keep these in sync with the
//! upstream files (a mismatch only shows up as a slightly different
//! built-in look, not a hard failure); see the plan's upstream proposal to
//! have peitho-core export these directly so this copy can go away.
//!
//! Also Studio's own layouts, which only ever reach a deck as files
//! `create_deck` (or `engine::image_layout`) writes into it: the standard
//! set (`STANDARD_LAYOUTS`) and the image layout (`IMAGE_LAYOUT_HTML`).

pub const LAYOUT_HTML: &str = include_str!("builtin/title-body-code.html");
pub const BASE_CSS: &str = include_str!("builtin/base.css");

/// Mirrors the header `peitho new` prepends to its scaffolded
/// `css/base.css` (see `crates/peitho/src/new_cmd.rs::BASE_CSS_HEADER` in
/// the peitho repo) — explains why the file exists before the copied
/// built-in rules.
pub const BASE_CSS_HEADER: &str = "/*\n  This file replaces peitho's embedded themes/base.css for this deck.\n  Edit it as your deck's complete theme.\n*/\n\n";

/// `css/base.css` as Studio writes it into a deck: `BASE_CSS` under
/// `BASE_CSS_HEADER`.
pub fn scaffolded_base_css() -> String {
    format!("{BASE_CSS_HEADER}{BASE_CSS}")
}

/// Studio's own layout for a slide holding one image (a title, optional
/// body text, and the image below), scaffolded next to `STANDARD_LAYOUTS`
/// by `create_deck` so an image dropped or pasted into a new deck has a
/// layout to show it (see `engine::images`). Not part of the
/// no-`layouts/` fallback: peitho's CLI has only `title-body-code` built
/// in, and a deck without its own layouts should build the same in both.
///
/// Its image slot is required (`arity="1"`) and no other layout Studio
/// writes has one, so a slide with an image and no explicit layout fits
/// only this, and a slide without one never does — peitho-core needs
/// exactly one structural match.
pub const IMAGE_LAYOUT_HTML: &str = include_str!("builtin/title-body-image.html");

/// Sizes `IMAGE_LAYOUT_HTML`'s image to the space left under the title and
/// body, scaffolded as its own `css/` file so `css/base.css` stays a plain
/// copy of peitho's theme.
pub const IMAGE_LAYOUT_CSS: &str = include_str!("builtin/title-body-image.css");

/// One of the standard layouts every new deck is scaffolded with: its
/// name (the layout file's stem, which a slide's `"layout"` names), its
/// HTML, and its own CSS, each with the deck-relative path it's written to.
/// Every layout's CSS is scoped under its `<section>`'s `layout-<name>`
/// class, since `css/*.css` all reaches every slide of the deck.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StandardLayout {
    pub name: &'static str,
    pub html: &'static str,
    pub css: &'static str,
    pub html_path: &'static str,
    pub css_path: &'static str,
}

macro_rules! standard_layout {
    ($name:literal) => {
        StandardLayout {
            name: $name,
            html: include_str!(concat!("builtin/standard/", $name, ".html")),
            css: include_str!(concat!("builtin/standard/", $name, ".css")),
            html_path: concat!("layouts/", $name, ".html"),
            css_path: concat!("css/", $name, ".css"),
        }
    };
}

/// The standard layouts, in the order a layout list shows them (that of
/// the slide-layout menus they're modeled on). Their names are mirrored in
/// the frontend's `domain/standardLayouts.ts`, which gives each a display
/// name.
///
/// Several of them take the same content (a heading alone fits
/// `title-slide`, `section-header`, `title-only`, `main-point` and more),
/// so peitho-core can't pick between them by structure: a slide in a deck
/// holding them all needs an explicit `"layout"`, which is why Studio
/// writes one on every slide it creates.
pub const STANDARD_LAYOUTS: &[StandardLayout] = &[
    standard_layout!("title-slide"),
    standard_layout!("section-header"),
    standard_layout!("title-body"),
    standard_layout!("two-column"),
    standard_layout!("title-only"),
    standard_layout!("one-column-text"),
    standard_layout!("main-point"),
    standard_layout!("section-title-description"),
    standard_layout!("caption"),
    standard_layout!("big-number"),
    standard_layout!("blank"),
];

/// Matches `crates/peitho/templates/new/gitignore` in the peitho repo —
/// `dist/` and `.peitho/` are directories `peitho build`/`preview`/`present`
/// write into, so a scaffolded deck should ignore them from the start.
pub const GITIGNORE: &str = "dist/\n.peitho/\n";

#[cfg(test)]
mod tests {
    use super::*;
    use peitho_core::domain::SlotName;
    use peitho_core::{parse_layout, Layouts};

    /// The selectors of every rule in `css`, comments stripped — enough for
    /// the plain rule lists these files hold (no at-rules, no nesting).
    fn selectors(css: &str) -> Vec<String> {
        let mut uncommented = String::new();
        let mut rest = css;
        while let Some(start) = rest.find("/*") {
            uncommented.push_str(&rest[..start]);
            rest = rest[start..].find("*/").map_or("", |end| &rest[start + end + 2..]);
        }
        uncommented.push_str(rest);
        uncommented
            .split('}')
            .filter_map(|rule| rule.split_once('{').map(|(selector, _)| selector))
            .flat_map(|selector| selector.split(','))
            .map(|selector| selector.trim().to_string())
            .filter(|selector| !selector.is_empty())
            .collect()
    }

    /// Whether `selector` names the class `.{class}` itself, not merely one
    /// it's a prefix of (`.layout-two-column` vs `.layout-two-column-x`).
    fn has_class(selector: &str, class: &str) -> bool {
        let needle = format!(".{class}");
        selector.match_indices(&needle).any(|(at, _)| {
            selector[at + needle.len()..].chars().next().is_none_or(|next| !(next.is_ascii_alphanumeric() || next == '-' || next == '_'))
        })
    }

    #[test]
    fn given_the_standard_layouts_then_they_are_the_eleven_planned_ones_in_menu_order() {
        let names: Vec<&str> = STANDARD_LAYOUTS.iter().map(|layout| layout.name).collect();
        assert_eq!(
            names,
            [
                "title-slide",
                "section-header",
                "title-body",
                "two-column",
                "title-only",
                "one-column-text",
                "main-point",
                "section-title-description",
                "caption",
                "big-number",
                "blank",
            ]
        );
    }

    #[test]
    fn given_each_standard_layout_when_parsed_then_peitho_core_accepts_it() {
        for layout in STANDARD_LAYOUTS {
            let parsed = parse_layout(layout.name, layout.html).unwrap_or_else(|err| panic!("{}: {err}", layout.name));
            assert_eq!(parsed.name(), layout.name);
        }
    }

    #[test]
    fn given_each_standard_layout_then_only_caption_and_blank_go_without_a_title() {
        let title = SlotName::new("title").unwrap();
        let titleless: Vec<&str> = STANDARD_LAYOUTS
            .iter()
            .filter(|layout| !parse_layout(layout.name, layout.html).unwrap().slots().contains_key(&title))
            .map(|layout| layout.name)
            .collect();
        assert_eq!(titleless, ["caption", "blank"]);
    }

    #[test]
    fn given_the_standard_layouts_and_the_image_layout_in_one_deck_then_no_two_share_a_name() {
        let mut layouts: Vec<_> = STANDARD_LAYOUTS.iter().map(|layout| parse_layout(layout.name, layout.html).unwrap()).collect();
        layouts.push(parse_layout("title-body-image", IMAGE_LAYOUT_HTML).unwrap());
        assert_eq!(Layouts::new(layouts).unwrap().len(), 12);
    }

    #[test]
    fn given_a_standard_layout_then_its_files_are_named_after_it() {
        for layout in STANDARD_LAYOUTS {
            assert_eq!(layout.html_path, format!("layouts/{}.html", layout.name));
            assert_eq!(layout.css_path, format!("css/{}.css", layout.name));
        }
    }

    #[test]
    fn given_a_standard_layout_then_its_section_carries_the_class_its_css_is_scoped_by() {
        for layout in STANDARD_LAYOUTS {
            let parsed = parse_layout(layout.name, layout.html).unwrap();
            assert!(parsed.root_classes().contains("peitho-slide"), "{}", layout.name);
            assert!(parsed.root_classes().contains(&format!("layout-{}", layout.name)), "{}", layout.name);
        }
    }

    #[test]
    fn adversarial_no_standard_layout_css_rule_reaches_a_slide_of_another_layout() {
        for layout in STANDARD_LAYOUTS {
            let class = format!("layout-{}", layout.name);
            let selectors = selectors(layout.css);
            assert!(!selectors.is_empty(), "{} has no rules", layout.name);
            for selector in selectors {
                assert!(has_class(&selector, &class), "{}: '{selector}' isn't scoped by .{class}", layout.name);
            }
        }
    }

    #[test]
    fn adversarial_the_test_helpers_handle_comments_lists_and_prefixes() {
        assert_eq!(selectors("/* a { b } */ .x .y, .z { color: red; }\n/* c */"), vec![".x .y", ".z"]);
        assert!(selectors("").is_empty());
        assert!(selectors("/* only a comment */").is_empty());
        assert!(has_class(".layout-a h1", "layout-a"));
        assert!(has_class(".peitho-slide.layout-a", "layout-a"));
        assert!(!has_class(".layout-a-b h1", "layout-a"));
        assert!(!has_class(".layout-ab", "layout-a"));
        assert!(!has_class("layout-a", "layout-a"));
    }
}
