//! The placeholder slide the "Change Layout" picker renders each layout
//! with (`preview_layouts`). One fixed text (a heading, a paragraph and a
//! list) only builds on a layout with a title slot and a body slot, so most
//! of the standard layouts (`builtin::STANDARD_LAYOUTS`) would show up
//! blank in the picker. Instead the placeholder is written from the
//! layout's own slots: content only for the slots it has, routed to a slot
//! the way a deck would route it.

use peitho_core::domain::{Accepts, SlotContract};
use peitho_core::Layout;

/// The slide key the placeholder is rendered under.
pub const PREVIEW_KEY: &str = "preview";

/// A one-slide deck source pinned to `layout`, with placeholder content in
/// each of its slots that takes headings, text blocks or a list:
/// - `title` gets a heading, the slot a heading goes to by convention
/// - a `body` taking blocks gets them as is, as body text is written
/// - every other slot gets its content in its own `::: {slot=...}` block,
///   since only `title`/`body` are reached by convention
///
/// `code`, `image` and `footnotes` slots, and any slot of another kind,
/// are left empty: their content (a code block, an image file, a footnote)
/// isn't placeholder text, and a required one makes the layout fail to
/// preview, as it always did.
pub fn placeholder_source(layout: &Layout) -> String {
    let slots = layout.slots();
    let has = |name: &str| slots.values().any(|slot| slot.name.as_str() == name);
    let mut parts = vec![format!("<!-- {{\"key\":\"{PREVIEW_KEY}\",\"layout\":\"{}\"}} -->", layout.name())];
    if has("title") {
        parts.push("# Placeholder title".to_string());
    }
    let mut fenced = Vec::new();
    for slot in slots.values().filter(|slot| !["title", "code", "footnotes"].contains(&slot.name.as_str())) {
        let Some(content) = placeholder_content(slot) else { continue };
        match (slot.name.as_str(), slot.accepts) {
            ("body", Accepts::Blocks) => parts.push(content),
            (name, _) => fenced.push(format!("::: {{slot={name}}}\n\n{content}\n\n:::")),
        }
    }
    parts.extend(fenced);
    parts.join("\n\n") + "\n"
}

/// What fills `slot` — a paragraph (and a list, when it takes more than one
/// block), a heading or a list, by what it accepts — or `None` for a slot
/// whose content can't be placeholder text.
fn placeholder_content(slot: &SlotContract) -> Option<String> {
    let name = slot.name.as_str();
    match slot.accepts {
        Accepts::Blocks if slot.arity.allows(2) => Some(format!("Placeholder {name} copy.\n\n- First point\n- Second point")),
        Accepts::Blocks => Some(format!("Placeholder {name} copy.")),
        Accepts::Inline => Some(format!("## Placeholder {name}")),
        Accepts::List => Some("- First point\n- Second point".to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::builtin;
    use crate::engine::pipeline::render_source;
    use peitho_core::parse_layout;

    /// A deck folder whose `layouts/` holds just `layouts` and whose `css/`
    /// holds just `css` (peitho-core refuses a theme naming a `.slot-*`
    /// class no layout has, so the base theme only goes with layouts that
    /// have its slots), and its `deck.md` path.
    fn deck_with(layouts: &[(&str, &str)], css: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("layouts")).unwrap();
        for (name, html) in layouts {
            std::fs::write(dir.path().join("layouts").join(format!("{name}.html")), html).unwrap();
        }
        std::fs::create_dir(dir.path().join("css")).unwrap();
        std::fs::write(dir.path().join("css/theme.css"), css).unwrap();
        let deck_path = dir.path().join("deck.md");
        (dir, deck_path)
    }

    #[test]
    fn given_peithos_title_body_code_when_previewed_then_the_placeholder_is_the_one_the_picker_always_used() {
        let layout = parse_layout("title-body-code", builtin::LAYOUT_HTML).unwrap();
        assert_eq!(
            placeholder_source(&layout),
            "<!-- {\"key\":\"preview\",\"layout\":\"title-body-code\"} -->\n\n# Placeholder title\n\nPlaceholder body copy.\n\n- First point\n- Second point\n"
        );
    }

    #[test]
    fn given_two_column_when_previewed_then_each_column_gets_its_own_slot_block() {
        let layout = builtin::STANDARD_LAYOUTS.iter().find(|layout| layout.name == "two-column").unwrap();
        let source = placeholder_source(&parse_layout(layout.name, layout.html).unwrap());
        assert!(source.contains("# Placeholder title"), "{source}");
        assert!(source.contains("::: {slot=left}\n\nPlaceholder left copy.\n\n- First point\n- Second point\n\n:::"), "{source}");
        assert!(source.contains("::: {slot=right}\n\nPlaceholder right copy."), "{source}");
        assert!(!source.contains("Placeholder body"), "{source}");
    }

    #[test]
    fn given_title_slide_when_previewed_then_its_one_block_body_takes_a_paragraph_and_no_list() {
        let layout = builtin::STANDARD_LAYOUTS.iter().find(|layout| layout.name == "title-slide").unwrap();
        let source = placeholder_source(&parse_layout(layout.name, layout.html).unwrap());
        assert!(source.ends_with("# Placeholder title\n\nPlaceholder body copy.\n"), "{source}");
    }

    #[test]
    fn given_slots_taking_a_heading_or_a_list_when_previewed_then_each_gets_one_and_the_slide_builds() {
        let html = "<section class=\"peitho-slide\"><slot name=\"kicker\" accepts=\"inline\" arity=\"1\"></slot><slot name=\"points\" accepts=\"list\" arity=\"1\"></slot></section>";
        let source = placeholder_source(&parse_layout("custom", html).unwrap());
        assert!(source.contains("::: {slot=kicker}\n\n## Placeholder kicker\n\n:::"), "{source}");
        assert!(source.contains("::: {slot=points}\n\n- First point\n- Second point\n\n:::"), "{source}");
        let (_dir, deck_path) = deck_with(&[("custom", html)], "");
        render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{err}\n{source}"));
    }

    #[test]
    fn given_each_standard_layout_when_its_placeholder_is_rendered_in_a_deck_holding_them_all_then_it_builds() {
        let layouts: Vec<(&str, &str)> = builtin::STANDARD_LAYOUTS.iter().map(|layout| (layout.name, layout.html)).collect();
        let (_dir, deck_path) = deck_with(&layouts, builtin::BASE_CSS);
        for layout in builtin::STANDARD_LAYOUTS {
            let source = placeholder_source(&parse_layout(layout.name, layout.html).unwrap());
            let output = render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{}: {err}\n{source}", layout.name));
            let fragment = &output.fragments[PREVIEW_KEY];
            assert!(fragment.contains("Placeholder"), "{}: {fragment}", layout.name);
        }
    }

    #[test]
    fn adversarial_a_layout_with_no_slots_gets_only_its_pin() {
        let layout = parse_layout("empty", "<section class=\"peitho-slide\"></section>").unwrap();
        let source = placeholder_source(&layout);
        assert_eq!(source, "<!-- {\"key\":\"preview\",\"layout\":\"empty\"} -->\n");
        let (_dir, deck_path) = deck_with(&[("empty", "<section class=\"peitho-slide\"></section>")], "");
        assert!(render_source(&deck_path, &source).is_ok());
    }

    #[test]
    fn adversarial_a_body_taking_exactly_one_block_gets_no_list() {
        let html = "<section class=\"peitho-slide\"><slot name=\"body\" accepts=\"blocks\" arity=\"1\"></slot></section>";
        let source = placeholder_source(&parse_layout("one", html).unwrap());
        assert!(source.contains("Placeholder body copy."), "{source}");
        assert!(!source.contains("- First point"), "{source}");
        let (_dir, deck_path) = deck_with(&[("one", html)], "");
        render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{err}"));
    }

    #[test]
    fn adversarial_image_code_and_footnote_slots_are_left_empty() {
        let source = placeholder_source(&parse_layout("title-body-image", builtin::IMAGE_LAYOUT_HTML).unwrap());
        assert!(!source.contains("slot=image"), "{source}");
        assert!(!source.contains("slot=footnotes"), "{source}");
        assert!(!source.contains("slot=code"), "{source}");
        assert!(!source.contains("!["), "{source}");
    }
}
