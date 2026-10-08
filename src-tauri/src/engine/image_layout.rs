//! Adds Studio's built-in image layout (`builtin::IMAGE_LAYOUT_HTML`, with
//! its CSS) to a deck that has none, so a slide holding an image can be
//! laid out — the way out of peitho-core's "no slot accepts image" error
//! when none of the deck's own layouts fits that slide.
//!
//! Adding a layout isn't free for the rest of the deck. peitho-core only
//! structurally matches a slide with no explicit layout when the deck has
//! two or more layouts; with one, every such slide is just mapped onto it.
//! So a one-layout deck switches every unpinned slide to structural
//! matching the moment a second layout appears, and in any deck a slide
//! that fits the new layout as well as its current one becomes ambiguous.
//! `check_addition` decides, before anything is written, that every slide
//! that builds today keeps building on the same layout.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use peitho_core::{parse_layout, Layouts};

use super::builtin;
use super::layout_fit::{self, LayoutFit};
use super::pipeline;

/// The name the image layout goes by in a deck: its file stem.
pub const IMAGE_LAYOUT_NAME: &str = "title-body-image";

/// The files that give a deck the image layout, as deck-relative paths and
/// contents. A deck with no `layouts/` builds with the built-in
/// `title-body-code` alone, and one with no `css/` with the built-in base
/// theme: the first file written into either directory replaces that
/// fallback, so a copy of it goes in alongside.
pub fn image_layout_files(has_layouts_dir: bool, has_css_dir: bool) -> Vec<(&'static str, String)> {
    let mut files = Vec::new();
    if !has_layouts_dir {
        files.push(("layouts/title-body-code.html", builtin::LAYOUT_HTML.to_string()));
    }
    files.push(("layouts/title-body-image.html", builtin::IMAGE_LAYOUT_HTML.to_string()));
    if !has_css_dir {
        files.push(("css/base.css", builtin::scaffolded_base_css()));
    }
    files.push(("css/title-body-image.css", builtin::IMAGE_LAYOUT_CSS.to_string()));
    files
}

/// Refuses the whole set when any of its paths is already taken (`is_taken`
/// answers per deck-relative path): an existing file is never overwritten.
pub fn refuse_taken<P: AsRef<str>>(files: &[(P, String)], is_taken: impl Fn(&str) -> bool) -> Result<(), String> {
    match files.iter().map(|(path, _)| path.as_ref()).find(|path| is_taken(path)) {
        Some(path) => Err(format!("{path} already exists in the deck; Peitho Studio won't overwrite it")),
        None => Ok(()),
    }
}

/// The layout peitho-core's dispatch gives a slide, or `None` when the
/// slide doesn't build: `pin` is the slide's explicit layout, `layouts` the
/// deck's layout names, and `fitting` the ones the slide's content fits
/// (see `layout_fit`). Mirrors `mapping.rs::try_dispatch` — a pin wins,
/// a lone layout is used as is, and otherwise exactly one must fit.
pub fn dispatched_layout(pin: Option<&str>, layouts: &[&str], fitting: &[&str]) -> Option<String> {
    let fits = |name: &str| layouts.contains(&name) && fitting.contains(&name);
    match (pin, layouts) {
        (Some(pin), _) => fits(pin).then(|| pin.to_string()),
        (None, [only]) => fits(only).then(|| only.to_string()),
        (None, _) => match layouts.iter().filter(|name| fits(name)).collect::<Vec<_>>().as_slice() {
            [one] => Some(one.to_string()),
            _ => None,
        },
    }
}

/// Whether adding the image layout to `deck_path`'s deck lets the slide at
/// `slide_index` of `source` build (its position among every slide, drafts
/// included, as in `layout_fit::check_slide_layouts`) without changing the
/// layout of any other slide that builds today. `source` is the deck as it
/// will be once the layout is there — a slide pinned to another layout
/// already re-pinned to `IMAGE_LAYOUT_NAME`. A slide that doesn't build
/// today may keep failing: this only guards against making things worse.
pub fn check_addition(deck_path: &Path, source: &str, slide_index: usize) -> Result<(), String> {
    let parsed = pipeline::parse_source(deck_path, source)?;
    let current = &parsed.assets.layouts;
    if current.get(IMAGE_LAYOUT_NAME).is_some() {
        return Err(format!("the deck already has a '{IMAGE_LAYOUT_NAME}' layout"));
    }
    let image_layout = parse_layout(IMAGE_LAYOUT_NAME, builtin::IMAGE_LAYOUT_HTML).map_err(|err| err.to_string())?;
    let extended = Layouts::new(current.iter().cloned().chain([image_layout]).collect()).map_err(|err| err.to_string())?;
    let current_names = current.names();
    let extended_names = extended.names();

    let mut target_found = false;
    for slide in parsed.deck.parsed_slides() {
        let verdicts = layout_fit::verdicts_for(slide, &extended)?;
        let fitting: Vec<&str> =
            verdicts.iter().filter(|verdict| verdict.fit == LayoutFit::Fits).map(|verdict| verdict.layout.as_str()).collect();
        let pin = slide.layout_request.as_ref().map(|request| request.name.as_str());
        let after = dispatched_layout(pin, &extended_names, &fitting);
        let number = slide.source_index + 1;
        let key = slide.key.as_str();
        if slide.source_index == slide_index {
            target_found = true;
            if after.is_none() {
                return Err(match verdicts.iter().find(|verdict| verdict.layout == IMAGE_LAYOUT_NAME).map(|verdict| &verdict.fit) {
                    Some(LayoutFit::Mismatch { reason }) => {
                        format!("slide {number} ('{key}') wouldn't fit the '{IMAGE_LAYOUT_NAME}' layout either: {reason}")
                    }
                    _ => format!("slide {number} ('{key}') still wouldn't build with the '{IMAGE_LAYOUT_NAME}' layout added"),
                });
            }
            continue;
        }
        let before = dispatched_layout(pin, &current_names, &fitting);
        if let Some(before) = before.filter(|before| after.as_deref() != Some(before.as_str())) {
            return Err(format!(
                "adding the '{IMAGE_LAYOUT_NAME}' layout would stop slide {number} ('{key}') from building on '{before}' — pick its layout explicitly first"
            ));
        }
    }
    if !target_found {
        return Err(format!("slide {} is not in the deck, or is a draft", slide_index.saturating_add(1)));
    }
    Ok(())
}

/// Writes the image layout's files (see `image_layout_files`) into
/// `deck_path`'s folder once `check_addition` agrees, and returns the
/// deck-relative paths written. Nothing is written when any of them already
/// exists or the check fails, and a write that fails partway removes what
/// it had already written — a half-added layout would otherwise be refused
/// as "already exists" on every retry.
pub fn add_image_layout(deck_path: &Path, source: &str, slide_index: usize) -> Result<Vec<&'static str>, String> {
    let deck_dir = pipeline::deck_dir_of(deck_path);
    let files = image_layout_files(deck_dir.join("layouts").is_dir(), deck_dir.join("css").is_dir());
    refuse_taken(&files, |path| std::fs::symlink_metadata(deck_dir.join(path)).is_ok())?;
    check_addition(deck_path, source, slide_index)?;
    let mut written = Written::default();
    for (relative_path, content) in &files {
        if let Err(err) = write_new_file(&deck_dir.join(relative_path), content, &mut written) {
            written.remove();
            return Err(err);
        }
    }
    Ok(files.iter().map(|(path, _)| *path).collect())
}

/// What `add_image_layout` (or `layout_files`) has created so far, for
/// undoing a partial write.
#[derive(Default)]
pub(crate) struct Written {
    files: Vec<PathBuf>,
    dirs: Vec<PathBuf>,
}

impl Written {
    pub(crate) fn remove(self) {
        for file in self.files.iter().rev() {
            let _ = std::fs::remove_file(file);
        }
        // Only directories this call created, innermost first; `remove_dir`
        // leaves one alone if something else has since been put in it.
        for dir in self.dirs.iter().rev() {
            let _ = std::fs::remove_dir(dir);
        }
    }
}

pub(crate) fn write_new_file(path: &Path, content: &str, written: &mut Written) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            std::fs::create_dir(parent).map_err(|err| format!("failed to create {}: {err}", parent.display()))?;
            written.dirs.push(parent.to_path_buf());
        }
    }
    // `create_new`: a file that appeared since `refuse_taken` looked is
    // left alone rather than overwritten.
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|err| format!("failed to write {}: {err}", path.display()))?;
    written.files.push(path.to_path_buf());
    file.write_all(content.as_bytes()).map_err(|err| format!("failed to write {}: {err}", path.display()))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::engine::pipeline::render_source;
    use std::path::PathBuf;

    /// A 1x1 PNG, for tests that need an image file peitho-core accepts.
    pub(crate) const TINY_PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49,
        0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d,
        0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    // A layout of the deck's own with an image slot but no body: a slide
    // with just a title and an image fits it *and* `title-body-image`.
    const PHOTO: &str = "<section><h1><slot name=\"title\" accepts=\"inline\" arity=\"1\"></slot></h1><figure><slot name=\"image\" accepts=\"image\" arity=\"1\"></slot></figure></section>";

    /// `html` without its `data-peitho-src="…"` values: those are byte
    /// offsets into the source, so a slide after an edited one moves along
    /// without looking any different.
    fn without_edit_spans(html: &str) -> String {
        const SRC: &str = "data-peitho-src=\"";
        let mut out = String::new();
        let mut rest = html;
        while let Some(at) = rest.find(SRC) {
            out.push_str(&rest[..at + SRC.len()]);
            rest = &rest[at + SRC.len()..];
            rest = &rest[rest.find('"').unwrap_or(rest.len())..];
        }
        out.push_str(rest);
        out
    }

    /// A deck folder holding `img/photo.png`, the given `layouts/` files
    /// (none: no `layouts/` at all), the given `css/` files (likewise) and
    /// `deck.md` with `source`.
    fn deck(layouts: &[(&str, &str)], css: &[(&str, &str)], source: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("img")).unwrap();
        std::fs::write(dir.path().join("img/photo.png"), TINY_PNG).unwrap();
        for (sub, files) in [("layouts", layouts), ("css", css)] {
            if files.is_empty() {
                continue;
            }
            std::fs::create_dir(dir.path().join(sub)).unwrap();
            for (name, content) in files {
                std::fs::write(dir.path().join(sub).join(name), content).unwrap();
            }
        }
        let deck_path = dir.path().join("deck.md");
        std::fs::write(&deck_path, source).unwrap();
        (dir, deck_path)
    }

    /// Every file under `dir`, relative and sorted — to show nothing was
    /// written.
    fn files_under(dir: &Path) -> Vec<String> {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
            for entry in std::fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(root, &path, out);
                } else {
                    out.push(path.strip_prefix(root).unwrap().display().to_string());
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, dir, &mut out);
        out.sort();
        out
    }

    fn paths(files: &[(&'static str, String)]) -> Vec<&'static str> {
        files.iter().map(|(path, _)| *path).collect()
    }

    // --- image_layout_files ---

    #[test]
    fn given_a_deck_with_its_own_layouts_and_css_when_the_files_are_planned_then_only_the_image_layout_and_its_css_go_in() {
        let files = image_layout_files(true, true);

        assert_eq!(paths(&files), vec!["layouts/title-body-image.html", "css/title-body-image.css"]);
        assert_eq!(files[0].1, builtin::IMAGE_LAYOUT_HTML);
        assert_eq!(files[1].1, builtin::IMAGE_LAYOUT_CSS);
    }

    #[test]
    fn given_a_deck_without_layouts_when_the_files_are_planned_then_the_built_in_layout_goes_in_too() {
        let files = image_layout_files(false, true);

        assert_eq!(paths(&files), vec!["layouts/title-body-code.html", "layouts/title-body-image.html", "css/title-body-image.css"]);
        assert_eq!(files[0].1, builtin::LAYOUT_HTML);
    }

    #[test]
    fn given_a_deck_without_css_when_the_files_are_planned_then_the_built_in_theme_goes_in_too_with_its_header() {
        let files = image_layout_files(true, false);

        assert_eq!(paths(&files), vec!["layouts/title-body-image.html", "css/base.css", "css/title-body-image.css"]);
        assert!(files[1].1.starts_with(builtin::BASE_CSS_HEADER));
        assert!(files[1].1.ends_with(builtin::BASE_CSS));
    }

    #[test]
    fn given_a_deck_with_neither_when_the_files_are_planned_then_all_four_go_in() {
        assert_eq!(
            paths(&image_layout_files(false, false)),
            vec!["layouts/title-body-code.html", "layouts/title-body-image.html", "css/base.css", "css/title-body-image.css"]
        );
    }

    // --- refuse_taken ---

    #[test]
    fn given_no_path_taken_when_checked_then_the_set_is_accepted() {
        assert_eq!(refuse_taken(&image_layout_files(false, false), |_| false), Ok(()));
    }

    #[test]
    fn given_any_one_path_taken_when_checked_then_the_whole_set_is_refused_naming_it() {
        for taken in paths(&image_layout_files(false, false)) {
            let err = refuse_taken(&image_layout_files(false, false), |path| path == taken).unwrap_err();
            assert!(err.contains(taken), "{err}");
            assert!(err.contains("won't overwrite"), "{err}");
        }
    }

    #[test]
    fn given_an_empty_set_when_checked_then_there_is_nothing_to_refuse() {
        assert_eq!(refuse_taken::<&str>(&[], |_| true), Ok(()));
    }

    // --- dispatched_layout ---

    #[test]
    fn given_a_pin_when_dispatched_then_the_pinned_layout_is_used_only_if_the_slide_fits_it() {
        let layouts = ["a", "b"];
        assert_eq!(dispatched_layout(Some("b"), &layouts, &["a", "b"]), Some("b".to_string()));
        assert_eq!(dispatched_layout(Some("b"), &layouts, &["a"]), None);
    }

    #[test]
    fn given_one_layout_and_no_pin_when_dispatched_then_it_is_used_if_the_slide_fits_it() {
        assert_eq!(dispatched_layout(None, &["a"], &["a"]), Some("a".to_string()));
        assert_eq!(dispatched_layout(None, &["a"], &[]), None);
    }

    #[test]
    fn given_several_layouts_and_no_pin_when_dispatched_then_exactly_one_must_fit() {
        let layouts = ["a", "b", "c"];
        assert_eq!(dispatched_layout(None, &layouts, &["b"]), Some("b".to_string()));
        assert_eq!(dispatched_layout(None, &layouts, &[]), None, "no match");
        assert_eq!(dispatched_layout(None, &layouts, &["a", "c"]), None, "ambiguous");
    }

    #[test]
    fn given_names_outside_the_deck_when_dispatched_then_they_never_count() {
        // A pin to a layout the deck doesn't have is an unknown-layout error.
        assert_eq!(dispatched_layout(Some("gone"), &["a", "b"], &["gone"]), None);
        // A fit for a layout outside this set (the image layout, when
        // judging the deck before it is added) doesn't make an ambiguity.
        assert_eq!(dispatched_layout(None, &["a", "b"], &["a", IMAGE_LAYOUT_NAME]), Some("a".to_string()));
        assert_eq!(dispatched_layout(None, &["a"], &[IMAGE_LAYOUT_NAME]), None);
    }

    #[test]
    fn given_no_layouts_or_an_empty_pin_when_dispatched_then_nothing_builds() {
        assert_eq!(dispatched_layout(None, &[], &[]), None);
        assert_eq!(dispatched_layout(Some(""), &["a"], &["a"]), None);
    }

    // --- add_image_layout / check_addition ---

    #[test]
    fn given_a_deck_on_the_built_in_layout_and_theme_when_the_image_layout_is_added_then_every_slide_renders_and_the_others_look_the_same() {
        let others = "# Just text\n\n- a point\n\n---\n\n# With code\n\n```rust\nfn main() {}\n```\n";
        let without_image = format!("# Cover\n\nIntro.\n\n---\n\n{others}");
        let with_image = format!("# Cover\n\nIntro.\n\n![](img/photo.png)\n\n---\n\n{others}");
        let (dir, deck_path) = deck(&[], &[], &with_image);
        let before = render_source(&deck_path, &without_image).unwrap();
        let err = render_source(&deck_path, &with_image).err().unwrap().to_string();
        assert!(err.contains("no slot accepts image"), "{err}");

        let written = add_image_layout(&deck_path, &with_image, 0).unwrap();

        assert_eq!(written, vec!["layouts/title-body-code.html", "layouts/title-body-image.html", "css/base.css", "css/title-body-image.css"]);
        assert!(files_under(dir.path()).contains(&"layouts/title-body-code.html".to_string()));
        let after = render_source(&deck_path, &with_image).unwrap_or_else(|err| panic!("{err}"));
        assert!(after.fragments["cover"].contains("<img"), "{}", after.fragments["cover"]);
        for key in ["just-text", "with-code"] {
            assert_eq!(without_edit_spans(&after.fragments[key]), without_edit_spans(&before.fragments[key]), "{key} changed");
        }
        assert!(after.css.contains("object-fit: contain"), "the image layout's CSS is loaded");
    }

    /// A copy of peitho's `examples/<name>` deck (its `deck.md`, `layouts/`
    /// and `css/`) plus `img/photo.png`, with a slide holding that image
    /// appended — its path, and the appended slide's index.
    fn example_with_image_slide(name: &str) -> (tempfile::TempDir, PathBuf, usize) {
        let example = crate::engine::fixtures::example_deck(name);
        let example_dir = example.parent().unwrap();
        let dir = tempfile::tempdir().unwrap();
        for sub in ["layouts", "css"] {
            if example_dir.join(sub).is_dir() {
                std::fs::create_dir(dir.path().join(sub)).unwrap();
                for entry in std::fs::read_dir(example_dir.join(sub)).unwrap() {
                    let path = entry.unwrap().path();
                    std::fs::copy(&path, dir.path().join(sub).join(path.file_name().unwrap())).unwrap();
                }
            }
        }
        std::fs::create_dir(dir.path().join("img")).unwrap();
        std::fs::write(dir.path().join("img/photo.png"), TINY_PNG).unwrap();
        let source = std::fs::read_to_string(&example).unwrap();
        let slide_count = render_source(&example, &source).unwrap().fragments.len();
        let deck_path = dir.path().join("deck.md");
        std::fs::write(&deck_path, format!("{}\n\n---\n\n<!-- {{\"key\":\"added-photo\"}} -->\n# A photo\n\n![](img/photo.png)\n", source.trim_end()))
            .unwrap();
        (dir, deck_path, slide_count)
    }

    #[test]
    fn given_peithos_own_example_decks_when_an_image_slide_gets_the_image_layout_then_every_other_slide_renders_the_same() {
        // `minimal` runs on the built-in layout and theme; `keynote` has
        // two layouts of its own and dispatches by structure.
        for name in ["minimal", "keynote"] {
            let example = crate::engine::fixtures::example_deck(name);
            let before = render_source(&example, &std::fs::read_to_string(&example).unwrap()).unwrap();
            let (_dir, deck_path, image_slide) = example_with_image_slide(name);
            let source = std::fs::read_to_string(&deck_path).unwrap();
            let err = render_source(&deck_path, &source).err().unwrap().to_string();
            assert!(err.contains("no slot accepts image in layout '"), "{name}: {err}");
            // The shape `domain/imageSlot.ts`'s `parseImageSlotError` reads
            // the slide's position from.
            assert!(err.starts_with(&format!("slide {} ('added-photo'), line ", image_slide + 1)), "{name}: {err}");

            add_image_layout(&deck_path, &source, image_slide).unwrap_or_else(|err| panic!("{name}: {err}"));

            let after = render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{name}: {err}"));
            assert!(after.fragments["added-photo"].contains("<img"), "{name}");
            for (key, fragment) in &before.fragments {
                assert_eq!(&after.fragments[key], fragment, "{name}: slide '{key}' changed");
            }
        }
    }

    #[test]
    fn given_a_deck_with_its_own_layouts_and_css_when_the_image_layout_is_added_then_only_its_two_files_are_written() {
        let source = "# Title\n\n![](img/photo.png)\n";
        let (dir, deck_path) = deck(&[("title-body-code.html", builtin::LAYOUT_HTML)], &[("theme.css", "h1 { color: red; }")], source);

        let written = add_image_layout(&deck_path, source, 0).unwrap();

        assert_eq!(written, vec!["layouts/title-body-image.html", "css/title-body-image.css"]);
        assert_eq!(
            files_under(dir.path()),
            vec!["css/theme.css", "css/title-body-image.css", "deck.md", "img/photo.png", "layouts/title-body-code.html", "layouts/title-body-image.html"]
        );
        let after = render_source(&deck_path, source).unwrap_or_else(|err| panic!("{err}"));
        assert!(after.css.contains("color: red"), "the deck's own theme stays");
    }

    #[test]
    fn given_a_write_that_fails_partway_when_the_image_layout_is_added_then_what_was_written_is_removed_again() {
        let source = "# Title\n\n![](img/photo.png)\n";
        // No `layouts/`, and a plain file where `css/` would go: both
        // layouts get written before creating `css/` fails.
        let (dir, deck_path) = deck(&[], &[], source);
        std::fs::write(dir.path().join("css"), "not a directory").unwrap();

        let err = add_image_layout(&deck_path, source, 0).unwrap_err();

        assert!(err.contains("css"), "{err}");
        assert_eq!(files_under(dir.path()), vec!["css", "deck.md", "img/photo.png"]);
        assert!(!dir.path().join("layouts").exists(), "the layouts/ it created is removed too");
    }

    #[test]
    fn given_a_slide_pinned_to_the_image_layout_in_the_source_when_it_is_added_then_the_pinned_slide_renders() {
        // The frontend re-pins a slide pinned to another layout before
        // asking; the source it sends already names the new layout.
        let source = "<!-- {\"key\":\"a\",\"layout\":\"title-body-image\"} -->\n# Title\n\n![](img/photo.png)\n\n---\n\n<!-- {\"key\":\"b\",\"layout\":\"title-body-code\"} -->\n# Text\n\nBody.\n";
        let (_dir, deck_path) = deck(&[], &[], source);

        add_image_layout(&deck_path, source, 0).unwrap();

        assert!(render_source(&deck_path, source).unwrap_or_else(|err| panic!("{err}")).fragments["a"].contains("<img"));
    }

    #[test]
    fn given_another_slide_that_is_already_broken_when_the_image_layout_is_added_then_it_is_added_anyway() {
        // Slide 2 is pinned to the built-in layout with an image of its own:
        // broken before, still broken after — not made any worse.
        let source = "# First\n\n![](img/photo.png)\n\n---\n\n<!-- {\"key\":\"second\",\"layout\":\"title-body-code\"} -->\n# Second\n\n![](img/photo.png)\n";
        let (dir, deck_path) = deck(&[], &[], source);

        assert!(add_image_layout(&deck_path, source, 0).is_ok());
        assert!(files_under(dir.path()).contains(&"layouts/title-body-image.html".to_string()));
    }

    #[test]
    fn given_a_slide_that_would_become_ambiguous_when_the_image_layout_is_added_then_it_is_refused_and_nothing_is_written() {
        // `photo` is the deck's only layout, so slide 2 (title + image)
        // builds on it today without any structural matching. With a second
        // layout, it'd fit both `photo` and `title-body-image`.
        let source = "<!-- {\"key\":\"target\"} -->\n# Title\n\nSome text.\n\n![](img/photo.png)\n\n---\n\n<!-- {\"key\":\"photo-only\"} -->\n# Title\n\n![](img/photo.png)\n";
        let (dir, deck_path) = deck(&[("photo.html", PHOTO)], &[], source);
        let before = files_under(dir.path());

        let err = add_image_layout(&deck_path, source, 0).unwrap_err();

        assert!(err.contains("slide 2 ('photo-only')"), "{err}");
        assert!(err.contains("'photo'"), "{err}");
        assert_eq!(files_under(dir.path()), before);
    }

    #[test]
    fn given_a_slide_the_image_layout_does_not_fit_either_when_it_is_added_then_it_is_refused_with_the_reason() {
        // An image and a code block: the image layout has no code slot.
        let source = "# Title\n\n![](img/photo.png)\n\n```sh\necho hi\n```\n";
        let (dir, deck_path) = deck(&[], &[], source);
        let before = files_under(dir.path());

        let err = add_image_layout(&deck_path, source, 0).unwrap_err();

        assert!(err.contains("wouldn't fit the 'title-body-image' layout"), "{err}");
        assert_eq!(files_under(dir.path()), before);
    }

    #[test]
    fn given_any_of_the_files_already_on_disk_when_the_image_layout_is_added_then_nothing_is_overwritten_or_written() {
        let source = "# Title\n\n![](img/photo.png)\n";
        for (layouts, css) in [
            (vec![("title-body-code.html", builtin::LAYOUT_HTML), ("title-body-image.html", "<!-- mine -->")], vec![("base.css", "")]),
            (vec![("title-body-code.html", builtin::LAYOUT_HTML)], vec![("title-body-image.css", "/* mine */")]),
        ] {
            let (dir, deck_path) = deck(&layouts, &css, source);
            let before = files_under(dir.path());

            let err = add_image_layout(&deck_path, source, 0).unwrap_err();

            assert!(err.contains("won't overwrite"), "{err}");
            assert_eq!(files_under(dir.path()), before);
            for (name, content) in layouts {
                assert_eq!(std::fs::read_to_string(dir.path().join("layouts").join(name)).unwrap(), content);
            }
            for (name, content) in css {
                assert_eq!(std::fs::read_to_string(dir.path().join("css").join(name)).unwrap(), content);
            }
        }
    }

    #[test]
    fn given_a_slide_index_with_no_such_slide_when_the_image_layout_is_added_then_it_is_refused() {
        let source = "<!-- {\"key\":\"draft\",\"draft\":true} -->\n# Draft\n\n---\n\n# Kept\n\n![](img/photo.png)\n";
        let (dir, deck_path) = deck(&[], &[], source);
        let before = files_under(dir.path());

        for index in [0, 2, usize::MAX] {
            let err = add_image_layout(&deck_path, source, index).unwrap_err();
            assert!(err.contains("is not in the deck, or is a draft"), "{index}: {err}");
        }
        assert_eq!(files_under(dir.path()), before);
        assert!(check_addition(&deck_path, source, 1).is_ok(), "the kept slide counts the draft before it");
    }

    #[test]
    fn given_a_source_that_does_not_parse_when_the_image_layout_is_added_then_it_is_an_error_and_nothing_is_written() {
        for source in ["", "<!-- {\"section\":\"Intro\"} -->\n# One\n"] {
            let (dir, deck_path) = deck(&[], &[], "# One\n");
            let before = files_under(dir.path());

            assert!(add_image_layout(&deck_path, source, 0).is_err(), "{source:?}");
            assert_eq!(files_under(dir.path()), before);
        }
    }

    // --- a deck holding the standard layouts ---

    /// A deck folder with the standard layouts and their CSS (and
    /// `css/base.css`), as `create_deck` writes them — minus the image
    /// layout unless `with_image_layout`.
    fn standard_deck(source: &str, with_image_layout: bool) -> (tempfile::TempDir, PathBuf) {
        let mut layouts: Vec<(String, &str)> =
            builtin::STANDARD_LAYOUTS.iter().map(|layout| (format!("{}.html", layout.name), layout.html)).collect();
        let mut css: Vec<(String, &str)> =
            builtin::STANDARD_LAYOUTS.iter().map(|layout| (format!("{}.css", layout.name), layout.css)).collect();
        css.push(("base.css".to_string(), builtin::BASE_CSS));
        if with_image_layout {
            layouts.push(("title-body-image.html".to_string(), builtin::IMAGE_LAYOUT_HTML));
            css.push(("title-body-image.css".to_string(), builtin::IMAGE_LAYOUT_CSS));
        }
        fn borrow<'a>(files: &'a [(String, &'static str)]) -> Vec<(&'a str, &'static str)> {
            files.iter().map(|(name, content)| (name.as_str(), *content)).collect()
        }
        deck(&borrow(&layouts), &borrow(&css), source)
    }

    #[test]
    fn given_a_standard_layout_deck_without_the_image_layout_when_it_is_added_then_no_other_slide_changes_layout() {
        let source = "<!-- {\"key\":\"cover\",\"layout\":\"title-slide\"} -->\n# Cover\n\n---\n\n\
# With code\n\n```rust\nfn main() {}\n```\n\n---\n\n\
<!-- {\"key\":\"cols\",\"layout\":\"two-column\"} -->\n# Columns\n\n---\n\n\
# A photo\n\n![](img/photo.png)\n";
        let (_dir, deck_path) = standard_deck(source, false);
        let without_photo = source.rsplit_once("\n---\n").unwrap().0;
        let before = render_source(&deck_path, without_photo).unwrap_or_else(|err| panic!("{err}"));

        let written = add_image_layout(&deck_path, source, 3).unwrap_or_else(|err| panic!("{err}"));

        assert_eq!(written, vec!["layouts/title-body-image.html", "css/title-body-image.css"]);
        let after = render_source(&deck_path, source).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(after.slide_layouts["a-photo"], IMAGE_LAYOUT_NAME);
        for key in ["cover", "with-code", "cols"] {
            assert_eq!(after.slide_layouts[key], before.slide_layouts[key], "slide '{key}' changed layout");
        }
    }

    #[test]
    fn adversarial_given_a_deck_created_with_the_image_layout_when_it_is_added_again_then_it_is_refused_and_nothing_is_written() {
        let source = "<!-- {\"key\":\"x\",\"layout\":\"title-body\"} -->\n# Title\n\n![](img/photo.png)\n";
        let (dir, deck_path) = standard_deck(source, true);
        let before = files_under(dir.path());

        let err = add_image_layout(&deck_path, source, 0).unwrap_err();

        assert!(err.contains("already exists"), "{err}");
        assert_eq!(files_under(dir.path()), before);
    }
}
