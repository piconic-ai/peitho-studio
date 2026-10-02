//! The layout screen's file operations on a deck's own `layouts/` and
//! `css/`: creating a layout (blank, or from a standard layout),
//! duplicating one, deleting one, and reading and saving one's HTML/CSS.
//!
//! A layout is `layouts/<name>.html`, with its CSS — when it has any — in
//! `css/<name>.css`, scoped under the `layout-<name>` class its `<section>`
//! carries (`builtin::STANDARD_LAYOUTS` is laid out the same way). Every
//! `css/*.css` reaches every slide, so a copy has its class renamed along
//! with its files, or its rules would style the original's slides too.
//!
//! Changing the set of layouts isn't free for the rest of the deck (see
//! `image_layout`'s module doc): peitho-core only structurally matches an
//! unpinned slide in a deck of two or more layouts, and needs exactly one
//! match. `check_layout_set_change` decides, before anything is written or
//! removed, that every slide that builds today keeps building on the same
//! layout — or, for a deleted layout's slides, on the one they were
//! re-pinned to.

use std::path::{Path, PathBuf};

use peitho_core::{parse_layout, CssFile, Layout, Layouts};
use serde::Serialize;

use super::assets::ResolvedAssets;
use super::builtin;
use super::image_layout::{dispatched_layout, refuse_taken, write_new_file, Written};
use super::layout_fit::{self, LayoutFit};
use super::pipeline;

/// The longest name a layout may be given — a file stem, and a class name.
const MAX_NAME_LEN: usize = 64;

/// Checks a name typed for a new layout and returns it trimmed. Rejected:
/// an empty name, one longer than `MAX_NAME_LEN`, one with anything but
/// ASCII letters, digits, `-` and `_` (so no path separator, no dot, no
/// space — the name is a file stem and a CSS class), one not starting with
/// a letter or digit, and one any of `existing` already has, case aside
/// (macOS's file system doesn't tell `A.html` from `a.html`).
pub fn validate_layout_name(name: &str, existing: &[&str]) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("a layout name can't be empty".to_string());
    }
    if trimmed.len() > MAX_NAME_LEN {
        return Err(format!("a layout name can be at most {MAX_NAME_LEN} characters"));
    }
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("'{trimmed}' can only use letters a-z, digits, '-' and '_'"));
    }
    if !trimmed.starts_with(|c: char| c.is_ascii_alphanumeric()) {
        return Err(format!("'{trimmed}' must start with a letter or a digit"));
    }
    if existing.iter().any(|taken| taken.eq_ignore_ascii_case(trimmed)) {
        return Err(format!("the deck already has a layout named '{trimmed}'"));
    }
    Ok(trimmed.to_string())
}

/// The name a copy of `name` gets: `<name>-copy`, or `<name>-copy-2`,
/// `-copy-3`, ... when that's taken (case aside, as in
/// `validate_layout_name`). A name too long to take the suffix within
/// `MAX_NAME_LEN` is cut short first, so the copy is always a name the
/// deck can open, save and delete.
pub fn duplicate_name(name: &str, existing: &[&str]) -> String {
    let taken = |candidate: &str| existing.iter().any(|name| name.eq_ignore_ascii_case(candidate));
    let with_suffix = |suffix: String| format!("{}{suffix}", truncated(name, MAX_NAME_LEN.saturating_sub(suffix.len())));
    let first = with_suffix("-copy".to_string());
    if !taken(&first) {
        return first;
    }
    (2..)
        .map(|n| with_suffix(format!("-copy-{n}")))
        .find(|candidate| !taken(candidate))
        .expect("an unbounded range always finds a free name")
}

/// `text` cut to at most `max_len` bytes, on a character boundary.
fn truncated(text: &str, max_len: usize) -> &str {
    if text.len() <= max_len {
        return text;
    }
    let end = (0..=max_len).rev().find(|&at| text.is_char_boundary(at)).unwrap_or(0);
    &text[..end]
}

/// `text` with every `layout-<from>` class token renamed `layout-<to>` —
/// only the whole token, so `layout-a` doesn't touch `layout-a-b`.
pub fn retarget_layout_class(text: &str, from: &str, to: &str) -> String {
    let needle = format!("layout-{from}");
    let is_name_char = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(&needle) {
        let before_ok = rest[..at].chars().next_back().is_none_or(|c| !is_name_char(c));
        let after_ok = rest[at + needle.len()..].chars().next().is_none_or(|c| !is_name_char(c));
        out.push_str(&rest[..at]);
        if before_ok && after_ok {
            out.push_str(&format!("layout-{to}"));
        } else {
            out.push_str(&needle);
        }
        rest = &rest[at + needle.len()..];
    }
    out.push_str(rest);
    out
}

/// A layout's two files: its HTML, and its CSS when it has any.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LayoutSource {
    pub html: String,
    pub css: Option<String>,
}

/// What a new layout starts from: an empty one with just a title, or a
/// copy of one of the standard layouts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutTemplate<'a> {
    Blank,
    Standard(&'a str),
}

impl<'a> LayoutTemplate<'a> {
    /// `None` for the blank layout, otherwise a standard layout's name.
    pub fn parse(template: Option<&'a str>) -> Result<Self, String> {
        match template {
            None => Ok(Self::Blank),
            Some(name) if builtin::STANDARD_LAYOUTS.iter().any(|layout| layout.name == name) => Ok(Self::Standard(name)),
            Some(name) => Err(format!("'{name}' is not a standard layout")),
        }
    }
}

/// The files a new layout named `name` starts with, from `template`. The
/// blank one has a single title slot and a CSS rule to fill in; a standard
/// one is that layout with its class renamed for `name`.
pub fn template_source(template: LayoutTemplate, name: &str) -> LayoutSource {
    match template {
        LayoutTemplate::Blank => LayoutSource {
            html: format!(
                "<section class=\"peitho-slide layout-{name}\">\n  <h1><slot name=\"title\" accepts=\"inline\" arity=\"1\"></slot></h1>\n</section>\n"
            ),
            css: Some(format!(
                "/* {name}: scope every rule under .layout-{name} — every css/ file\n   reaches every slide of the deck. */\n.peitho-slide.layout-{name} {{\n}}\n"
            )),
        },
        LayoutTemplate::Standard(standard) => {
            let layout = builtin::STANDARD_LAYOUTS.iter().find(|layout| layout.name == standard).expect("LayoutTemplate::parse checked the name");
            LayoutSource {
                html: retarget_layout_class(layout.html, standard, name),
                css: Some(retarget_layout_class(layout.css, standard, name)),
            }
        }
    }
}

/// The deck-relative files that add layout `name` with `source` to a deck,
/// with the fallbacks a first file in an empty spot replaces (see
/// `image_layout::image_layout_files`): the built-in `title-body-code`
/// when the deck has no `layouts/`, and the built-in theme when it has no
/// `css/` and the layout brings CSS.
pub fn layout_files(name: &str, source: &LayoutSource, has_layouts_dir: bool, has_css_dir: bool) -> Vec<(String, String)> {
    let mut files = Vec::new();
    if !has_layouts_dir {
        files.push(("layouts/title-body-code.html".to_string(), builtin::LAYOUT_HTML.to_string()));
    }
    files.push((format!("layouts/{name}.html"), source.html.clone()));
    if let Some(css) = &source.css {
        if !has_css_dir {
            files.push(("css/base.css".to_string(), builtin::scaffolded_base_css()));
        }
        files.push((format!("css/{name}.css"), css.clone()));
    }
    files
}

/// Whether going from the deck's current layouts to `next` keeps every
/// slide building as it does today. `original` is the deck source now, and
/// `changed` the same source as it will be alongside `next` — the slides
/// of a deleted layout (`removed`) already re-pinned to another. Each
/// slide of `original` that builds today must, in `changed` and on `next`,
/// still build on the same layout, or, when it was on `removed`, build at
/// all. A slide that doesn't build today may keep failing: this only
/// guards against making things worse.
pub fn check_layout_set_change(
    deck_path: &Path,
    original: &str,
    changed: &str,
    next: &Layouts,
    removed: Option<&str>,
    action: &str,
) -> Result<(), String> {
    let before_deck = pipeline::parse_source(deck_path, original)?;
    let after_deck = if changed == original { None } else { Some(pipeline::parse_source(deck_path, changed)?) };
    let current = &before_deck.assets.layouts;
    let before_slides = before_deck.deck.parsed_slides();
    let after_slides = after_deck.as_ref().map_or(before_slides, |deck| deck.deck.parsed_slides());
    if after_slides.len() != before_slides.len() {
        return Err("the deck's slides changed while the layout was being changed; try again".to_string());
    }
    let current_names = current.names();
    let next_names = next.names();
    for (before_slide, after_slide) in before_slides.iter().zip(after_slides) {
        let pin_of = |slide: &peitho_core::phase::ParsedSlide| slide.layout_request.as_ref().map(|request| request.name.as_str().to_string());
        let before_fitting = fitting(before_slide, current)?;
        let before = dispatched_layout(pin_of(before_slide).as_deref(), &current_names, &as_strs(&before_fitting));
        let Some(before) = before else { continue };
        let after_pin = pin_of(after_slide);
        let after_fitting = fitting(after_slide, next)?;
        let after = dispatched_layout(after_pin.as_deref(), &next_names, &as_strs(&after_fitting));
        let number = before_slide.source_index + 1;
        let key = before_slide.key.as_str();
        if removed == Some(before.as_str()) {
            if after.is_none() {
                return Err(match after_pin {
                    Some(pin) => format!("slide {number} ('{key}') doesn't fit '{pin}', the layout it would move to"),
                    None => format!("slide {number} ('{key}') is on '{before}' — pick another layout for it first"),
                });
            }
        } else if after.as_deref() != Some(before.as_str()) {
            return Err(format!("{action} would stop slide {number} ('{key}') from building on '{before}' — pick its layout explicitly first"));
        }
    }
    Ok(())
}

fn as_strs(names: &[String]) -> Vec<&str> {
    names.iter().map(String::as_str).collect()
}

/// The names of `layouts` the slide fits, as owned strings.
fn fitting(slide: &peitho_core::phase::ParsedSlide, layouts: &Layouts) -> Result<Vec<String>, String> {
    Ok(layout_fit::verdicts_for(slide, layouts)?
        .into_iter()
        .filter(|verdict| verdict.fit == LayoutFit::Fits)
        .map(|verdict| verdict.layout)
        .collect())
}

/// Adds layout `name` with `source` to `deck_path`'s deck (see
/// `layout_files`) once its HTML parses and `check_layout_set_change`
/// agrees for `content`, the deck source as the frontend has it. Never
/// overwrites a file: nothing is written when any of them exists, and a
/// write that fails partway removes what it had written. Returns the
/// deck-relative paths written.
fn add_layout(deck_path: &Path, content: &str, name: &str, source: &LayoutSource, action: &str) -> Result<Vec<String>, String> {
    let deck_dir = pipeline::deck_dir_of(deck_path);
    let layout = parse_layout(name, &source.html).map_err(|err| err.to_string())?;
    let current = pipeline::parse_source(deck_path, content)?.assets.layouts;
    let next = Layouts::new(current.iter().cloned().chain([layout]).collect()).map_err(|err| err.to_string())?;
    let files = layout_files(name, source, deck_dir.join("layouts").is_dir(), deck_dir.join("css").is_dir());
    refuse_taken(&files, |path| std::fs::symlink_metadata(deck_dir.join(path)).is_ok())?;
    check_layout_set_change(deck_path, content, content, &next, None, action)?;
    let mut written = Written::default();
    for (relative_path, text) in &files {
        if let Err(err) = write_new_file(&deck_dir.join(relative_path), text, &mut written) {
            written.remove();
            return Err(err);
        }
    }
    Ok(files.into_iter().map(|(path, _)| path).collect())
}

/// The names of the deck's layouts, for `content`'s deck.
fn layout_names(deck_path: &Path, content: &str) -> Result<Vec<String>, String> {
    Ok(pipeline::parse_source(deck_path, content)?.assets.layouts.names().into_iter().map(str::to_string).collect())
}

/// Creates layout `name` (checked by `validate_layout_name`) from
/// `template` in `deck_path`'s deck; see `add_layout`. Returns the name as
/// it was saved (trimmed).
pub fn create_layout(deck_path: &Path, content: &str, name: &str, template: LayoutTemplate) -> Result<String, String> {
    let names = layout_names(deck_path, content)?;
    let name = validate_layout_name(name, &names.iter().map(String::as_str).collect::<Vec<_>>())?;
    add_layout(deck_path, content, &name, &template_source(template, &name), &format!("adding the '{name}' layout"))?;
    Ok(name)
}

/// Copies layout `name` of `deck_path`'s deck — its HTML, and its CSS when
/// it has its own — under `duplicate_name`'s name, with its class renamed
/// to match; see `add_layout`. Returns the copy's name. The deck's
/// built-in fallback layout (no `layouts/`) can be copied too.
pub fn duplicate_layout(deck_path: &Path, content: &str, name: &str) -> Result<String, String> {
    let names = layout_names(deck_path, content)?;
    let source = read_layout(deck_path, name).or_else(|err| builtin_layout_source(deck_path, name).ok_or(err))?;
    let names = names.iter().map(String::as_str).collect::<Vec<_>>();
    let copy = validate_layout_name(&duplicate_name(name, &names), &names)?;
    let source = LayoutSource {
        html: retarget_layout_class(&source.html, name, &copy),
        css: source.css.map(|css| retarget_layout_class(&css, name, &copy)),
    };
    add_layout(deck_path, content, &copy, &source, &format!("adding the '{copy}' layout"))?;
    Ok(copy)
}

/// The built-in fallback layout's source, when `name` is it and the deck
/// runs on it (has no `layouts/`).
fn builtin_layout_source(deck_path: &Path, name: &str) -> Option<LayoutSource> {
    let has_layouts_dir = pipeline::deck_dir_of(deck_path).join("layouts").is_dir();
    (!has_layouts_dir && name == "title-body-code").then(|| LayoutSource { html: builtin::LAYOUT_HTML.to_string(), css: None })
}

/// `layouts/<name>.html` and `css/<name>.css` under `deck_dir`, refusing a
/// name that isn't a plain file stem (see `validate_layout_name`), so the
/// paths stay inside the deck.
fn layout_paths(deck_dir: &Path, name: &str) -> Result<(PathBuf, PathBuf), String> {
    validate_layout_name(name, &[])?;
    Ok((deck_dir.join("layouts").join(format!("{name}.html")), deck_dir.join("css").join(format!("{name}.css"))))
}

/// Layout `name`'s HTML and own CSS, read from `deck_path`'s deck. An
/// error when it isn't a file of the deck (the built-in fallback isn't).
pub fn read_layout(deck_path: &Path, name: &str) -> Result<LayoutSource, String> {
    let (html_path, css_path) = layout_paths(pipeline::deck_dir_of(deck_path), name)?;
    if !html_path.is_file() {
        return Err(format!("'{name}' is not a layout file of this deck"));
    }
    let html = std::fs::read_to_string(&html_path).map_err(|err| format!("failed to read {}: {err}", html_path.display()))?;
    let css = match css_path.is_file() {
        true => Some(std::fs::read_to_string(&css_path).map_err(|err| format!("failed to read {}: {err}", css_path.display()))?),
        false => None,
    };
    Ok(LayoutSource { html, css })
}

/// The deck's CSS files as they will be once layout `name`'s own CSS is
/// saved as `css` (see `save_layout`): `css/<name>.css` replaced, or added
/// when `css` isn't blank. `css_exists` says whether that file is there
/// now (a blank save then empties it rather than removing it), and
/// `has_css_dir` whether the deck has a `css/` at all — without one, `css`
/// that isn't blank brings the scaffolded theme in place of the built-in
/// one, as `save_layout` writes it. Sorted by name, as `assets::resolve`
/// reads them.
fn css_with_layout_css(current: Vec<CssFile>, name: &str, css: &str, css_exists: bool, has_css_dir: bool) -> Vec<CssFile> {
    let own_css = format!("{name}.css");
    let written = css_exists || !css.trim().is_empty();
    if !has_css_dir && !written {
        return current;
    }
    let mut files: Vec<CssFile> = if has_css_dir {
        current.into_iter().filter(|file| file.name != own_css).collect()
    } else {
        vec![CssFile { name: "base.css".to_string(), content: builtin::scaffolded_base_css() }]
    };
    if written {
        files.push(CssFile { name: own_css, content: css.to_string() });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    files
}

/// Whether saving `layout` (layout `name`'s new HTML, parsed) with `css`
/// keeps `deck_path`'s deck building as it does for `content`, the deck
/// source now: every slide that builds today stays on the same layout
/// (`check_layout_set_change`), and the deck as a whole still renders with
/// the edited layout and CSS in place — checked before anything is
/// written, so an edit that would leave the deck unable to open is refused.
/// A deck that doesn't build today isn't held to the render.
fn check_layout_edit(deck_path: &Path, content: &str, layout: Layout, css: &str, css_exists: bool, has_css_dir: bool) -> Result<(), String> {
    let name = layout.name().to_string();
    let parsed = pipeline::parse_source(deck_path, content)?;
    let next = Layouts::new(parsed.assets.layouts.iter().map(|current| if current.name() == name { layout.clone() } else { current.clone() }).collect())
        .map_err(|err| err.to_string())?;
    check_layout_set_change(deck_path, content, content, &next, None, &format!("this edit to the '{name}' layout"))?;
    if pipeline::render_source(deck_path, content).is_err() {
        return Ok(());
    }
    let mut edited = parsed;
    let css_files = std::mem::take(&mut edited.assets.css);
    edited.assets.css = css_with_layout_css(css_files, &name, css, css_exists, has_css_dir);
    edited.assets.layouts = next;
    pipeline::render_parsed(deck_path, edited)
        .map(|_| ())
        .map_err(|err| format!("this edit to the '{name}' layout would stop the deck from building: {err}"))
}

/// Saves `html` and `css` as layout `name`'s files in `deck_path`'s deck —
/// the one place a layout file is overwritten. Nothing is written unless
/// the HTML parses as a layout, the layout already exists, and the deck
/// (`content`, its source now) keeps building as it does
/// (`check_layout_edit`). Its CSS file is created only for CSS that isn't
/// blank (along with the built-in theme when the deck has no `css/`, as in
/// `layout_files`).
pub fn save_layout(deck_path: &Path, content: &str, name: &str, html: &str, css: &str) -> Result<(), String> {
    let deck_dir = pipeline::deck_dir_of(deck_path);
    let (html_path, css_path) = layout_paths(deck_dir, name)?;
    if !html_path.is_file() {
        return Err(format!("'{name}' is not a layout file of this deck"));
    }
    let layout = parse_layout(name, html).map_err(|err| err.to_string())?;
    let css_exists = css_path.is_file();
    let has_css_dir = deck_dir.join("css").is_dir();
    check_layout_edit(deck_path, content, layout, css, css_exists, has_css_dir)?;
    if !css_exists && !css.trim().is_empty() && !has_css_dir {
        let mut written = Written::default();
        write_new_file(&deck_dir.join("css/base.css"), &builtin::scaffolded_base_css(), &mut written)?;
    }
    std::fs::write(&html_path, html).map_err(|err| format!("failed to write {}: {err}", html_path.display()))?;
    if css_exists || !css.trim().is_empty() {
        std::fs::write(&css_path, css).map_err(|err| format!("failed to write {}: {err}", css_path.display()))?;
    }
    Ok(())
}

/// `current` without layout `name`: an error when the deck has no such
/// layout, or when it's the only one (a deck needs a layout to build).
fn without_layout(current: &Layouts, name: &str) -> Result<Layouts, String> {
    if current.get(name).is_none() {
        return Err(format!("the deck has no layout named '{name}'"));
    }
    let rest: Vec<Layout> = current.iter().filter(|layout| layout.name() != name).cloned().collect();
    if rest.is_empty() {
        return Err(format!("'{name}' is the deck's only layout; a deck needs at least one"));
    }
    Layouts::new(rest).map_err(|err| err.to_string())
}

/// `assets` as they will be once layout `name` is deleted: its layouts
/// replaced by `next` (the deck's layouts without `name`, see
/// `without_layout`), and without `css/<name>.css` — the CSS file a layout
/// of the deck's own has. Every other CSS file stays, even one whose name
/// merely starts with `name`.
fn assets_without_layout(assets: ResolvedAssets, next: Layouts, name: &str) -> ResolvedAssets {
    let own_css = format!("{name}.css");
    ResolvedAssets { layouts: next, css: assets.css.into_iter().filter(|file| file.name != own_css).collect(), ..assets }
}

/// Whether `deck_path`'s deck still builds once layout `name` and its CSS
/// are gone: `repinned` rendered against the deck's assets without them
/// (`assets_without_layout`), before any file is touched — say another
/// CSS file names a `.slot-*` only this layout had. A deck that doesn't
/// build today (`original`) isn't held to it: this only guards against
/// making things worse.
fn check_build_without_layout(deck_path: &Path, original: &str, repinned: &str, next: Layouts, name: &str) -> Result<(), String> {
    if pipeline::render_source(deck_path, original).is_err() {
        return Ok(());
    }
    let mut parsed = pipeline::parse_source(deck_path, repinned)?;
    parsed.assets = assets_without_layout(parsed.assets, next, name);
    pipeline::render_parsed(deck_path, parsed)
        .map(|_| ())
        .map_err(|err| format!("removing the '{name}' layout would stop the deck from building: {err}"))
}

/// Whether deleting layout `name` from `deck_path`'s deck is safe:
/// `original` is the deck source now, `repinned` the same with every slide
/// on `name` re-pinned to the layout picked in its place. Every slide must
/// keep building as it does (see `check_layout_set_change`), and the deck
/// as a whole must still build without the layout's files
/// (`check_build_without_layout`) — so a deletion `delete_layout` would
/// refuse is refused here, before the frontend re-pins any slide.
pub fn check_layout_removal(deck_path: &Path, original: &str, repinned: &str, name: &str) -> Result<(), String> {
    let current = pipeline::parse_source(deck_path, original)?.assets.layouts;
    let next = without_layout(&current, name)?;
    check_layout_set_change(deck_path, original, repinned, &next, Some(name), &format!("removing the '{name}' layout"))?;
    check_build_without_layout(deck_path, original, repinned, next, name)
}

/// Deletes layout `name`'s files (`layouts/<name>.html`, and `css/<name>.css`
/// when there is one) from `deck_path`'s deck once `check_layout_removal`
/// agrees for `content`, the deck source as it is now (its slides already
/// moved off `name`) — including that the deck still builds without them,
/// so nothing is removed for a deletion the build would refuse.
pub fn delete_layout(deck_path: &Path, content: &str, name: &str) -> Result<(), String> {
    let (html_path, css_path) = layout_paths(pipeline::deck_dir_of(deck_path), name)?;
    if !html_path.is_file() {
        return Err(format!("'{name}' is not a layout file of this deck"));
    }
    check_layout_removal(deck_path, content, content, name)?;
    let removed = read_layout(deck_path, name)?;
    std::fs::remove_file(&html_path).map_err(|err| format!("failed to delete {}: {err}", html_path.display()))?;
    if removed.css.is_some() {
        if let Err(err) = std::fs::remove_file(&css_path) {
            let _ = std::fs::write(&html_path, &removed.html);
            return Err(format!("failed to delete {}: {err}", css_path.display()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::pipeline::render_source;

    // --- validate_layout_name ---

    #[test]
    fn given_a_plain_name_when_validated_then_it_is_accepted_trimmed() {
        assert_eq!(validate_layout_name("  quote ", &["title-body"]), Ok("quote".to_string()));
        assert_eq!(validate_layout_name("my_layout-2", &[]), Ok("my_layout-2".to_string()));
        assert_eq!(validate_layout_name("2col", &[]), Ok("2col".to_string()));
    }

    #[test]
    fn adversarial_empty_or_blank_names_are_rejected() {
        for name in ["", " ", "\t\n"] {
            let err = validate_layout_name(name, &[]).unwrap_err();
            assert!(err.contains("empty"), "{name:?}: {err}");
        }
    }

    #[test]
    fn adversarial_names_that_could_act_as_paths_are_rejected() {
        for name in ["../x", "a/b", "a\\b", ".hidden", ".", "..", "x.html", "a b", "a:b"] {
            assert!(validate_layout_name(name, &[]).is_err(), "{name:?}");
        }
    }

    #[test]
    fn adversarial_non_ascii_names_are_rejected() {
        for name in ["表紙", "café", "ｑｕｏｔｅ"] {
            assert!(validate_layout_name(name, &[]).is_err(), "{name:?}");
        }
    }

    #[test]
    fn adversarial_a_name_not_starting_with_a_letter_or_digit_is_rejected() {
        for name in ["-x", "_x", "--"] {
            let err = validate_layout_name(name, &[]).unwrap_err();
            assert!(err.contains("start with"), "{name:?}: {err}");
        }
    }

    #[test]
    fn adversarial_an_existing_name_is_rejected_whatever_its_case() {
        for name in ["title-body", "Title-Body", " TITLE-BODY "] {
            let err = validate_layout_name(name, &["title-body"]).unwrap_err();
            assert!(err.contains("already has"), "{name:?}: {err}");
        }
    }

    #[test]
    fn adversarial_an_overlong_name_is_rejected_and_the_longest_allowed_is_accepted() {
        assert!(validate_layout_name(&"a".repeat(MAX_NAME_LEN), &[]).is_ok());
        assert!(validate_layout_name(&"a".repeat(MAX_NAME_LEN + 1), &[]).is_err());
    }

    // --- duplicate_name ---

    #[test]
    fn given_a_free_copy_name_when_duplicated_then_it_is_name_copy() {
        assert_eq!(duplicate_name("quote", &["quote"]), "quote-copy");
    }

    #[test]
    fn given_taken_copy_names_when_duplicated_then_the_next_free_number_is_used() {
        assert_eq!(duplicate_name("x", &["x", "x-copy"]), "x-copy-2");
        assert_eq!(duplicate_name("x", &["x", "x-copy", "x-copy-2", "x-copy-3"]), "x-copy-4");
        // A gap is filled first.
        assert_eq!(duplicate_name("x", &["x", "x-copy", "x-copy-3"]), "x-copy-2");
    }

    #[test]
    fn adversarial_copy_names_are_compared_case_aside_and_a_copy_can_be_copied() {
        assert_eq!(duplicate_name("x", &["X-COPY"]), "x-copy-2");
        assert_eq!(duplicate_name("x-copy", &["x", "x-copy"]), "x-copy-copy");
        assert_eq!(duplicate_name("", &[]), "-copy");
    }

    #[test]
    fn given_a_name_too_long_for_the_suffix_when_duplicated_then_it_is_cut_short_so_the_copy_is_a_valid_name() {
        let longest = "a".repeat(MAX_NAME_LEN);
        let copy = duplicate_name(&longest, &[&longest]);
        assert_eq!(copy, format!("{}-copy", "a".repeat(MAX_NAME_LEN - "-copy".len())));
        assert!(validate_layout_name(&copy, &[&longest]).is_ok(), "{copy}");

        // One that just fits keeps its whole name.
        let fits = "b".repeat(MAX_NAME_LEN - "-copy".len());
        assert_eq!(duplicate_name(&fits, &[]), format!("{fits}-copy"));
    }

    #[test]
    fn adversarial_numbered_copies_of_a_long_name_stay_within_the_limit_and_never_collide() {
        let longest = "a".repeat(MAX_NAME_LEN);
        let mut existing = vec![longest.clone()];
        for _ in 0..12 {
            let refs: Vec<&str> = existing.iter().map(String::as_str).collect();
            let copy = duplicate_name(&longest, &refs);
            assert!(copy.len() <= MAX_NAME_LEN, "{copy}");
            assert!(validate_layout_name(&copy, &refs).is_ok(), "{copy}");
            existing.push(copy);
        }
        assert!(existing.contains(&format!("{}-copy-10", "a".repeat(MAX_NAME_LEN - "-copy-10".len()))));
    }

    #[test]
    fn adversarial_truncation_never_splits_a_character() {
        assert_eq!(truncated("ab", 5), "ab");
        assert_eq!(truncated("abc", 0), "");
        assert_eq!(truncated("aé", 2), "a");
        assert_eq!(truncated("", 3), "");
    }

    // --- retarget_layout_class ---

    #[test]
    fn given_a_standard_layout_when_retargeted_then_only_its_own_class_is_renamed() {
        let html = "<section class=\"peitho-slide layout-title-only\"><h1>x</h1></section>";
        assert_eq!(retarget_layout_class(html, "title-only", "quote"), "<section class=\"peitho-slide layout-quote\"><h1>x</h1></section>");
        let css = ".peitho-slide.layout-a h1, .layout-a p { x: y }";
        assert_eq!(retarget_layout_class(css, "a", "b"), ".peitho-slide.layout-b h1, .layout-b p { x: y }");
    }

    #[test]
    fn adversarial_longer_classes_sharing_the_prefix_are_left_alone() {
        assert_eq!(retarget_layout_class(".layout-a-b .layout-ab .xlayout-a", "a", "c"), ".layout-a-b .layout-ab .xlayout-a");
        assert_eq!(retarget_layout_class("", "a", "c"), "");
        assert_eq!(retarget_layout_class("layout-a", "a", "c"), "layout-c");
    }

    // --- template_source / LayoutTemplate ---

    #[test]
    fn given_the_blank_template_when_written_then_it_parses_and_carries_the_layouts_class() {
        let source = template_source(LayoutTemplate::Blank, "quote");
        let layout = parse_layout("quote", &source.html).unwrap();
        assert!(layout.root_classes().contains("layout-quote"));
        assert!(source.css.unwrap().contains(".peitho-slide.layout-quote"));
    }

    #[test]
    fn given_each_standard_template_when_written_under_a_new_name_then_it_parses_with_the_new_class_only() {
        for standard in builtin::STANDARD_LAYOUTS {
            let source = template_source(LayoutTemplate::Standard(standard.name), "mine");
            let layout = parse_layout("mine", &source.html).unwrap_or_else(|err| panic!("{}: {err}", standard.name));
            assert!(layout.root_classes().contains("layout-mine"), "{}", standard.name);
            let css = source.css.unwrap();
            assert!(!css.contains(&format!("layout-{} ", standard.name)) && !css.contains(&format!("layout-{}{{", standard.name)), "{}: {css}", standard.name);
            assert!(css.contains("layout-mine"), "{}", standard.name);
        }
    }

    #[test]
    fn adversarial_an_unknown_template_name_is_rejected() {
        assert_eq!(LayoutTemplate::parse(None), Ok(LayoutTemplate::Blank));
        assert_eq!(LayoutTemplate::parse(Some("two-column")), Ok(LayoutTemplate::Standard("two-column")));
        for name in ["", "title-body-code", "title-body-image", "../x", "Two-Column"] {
            assert!(LayoutTemplate::parse(Some(name)).is_err(), "{name:?}");
        }
    }

    // --- layout_files ---

    #[test]
    fn given_a_deck_with_layouts_and_css_when_planned_then_only_the_layouts_two_files_go_in() {
        let source = LayoutSource { html: "h".to_string(), css: Some("c".to_string()) };
        let files = layout_files("q", &source, true, true);
        assert_eq!(files, vec![("layouts/q.html".to_string(), "h".to_string()), ("css/q.css".to_string(), "c".to_string())]);
    }

    #[test]
    fn given_a_deck_on_the_built_in_layout_and_theme_when_planned_then_both_fallbacks_go_in_too() {
        let source = LayoutSource { html: "h".to_string(), css: Some("c".to_string()) };
        let paths: Vec<String> = layout_files("q", &source, false, false).into_iter().map(|(path, _)| path).collect();
        assert_eq!(paths, ["layouts/title-body-code.html", "layouts/q.html", "css/base.css", "css/q.css"]);
    }

    #[test]
    fn adversarial_a_layout_without_css_never_writes_into_css() {
        let source = LayoutSource { html: "h".to_string(), css: None };
        let paths: Vec<String> = layout_files("q", &source, true, false).into_iter().map(|(path, _)| path).collect();
        assert_eq!(paths, ["layouts/q.html"]);
    }

    // --- deck-level operations ---

    /// A deck folder with the standard layouts and their CSS (and
    /// `css/base.css`), as `create_deck` writes them, and `deck.md` holding
    /// `source`.
    fn standard_deck(source: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("layouts")).unwrap();
        std::fs::create_dir(dir.path().join("css")).unwrap();
        for layout in builtin::STANDARD_LAYOUTS {
            std::fs::write(dir.path().join(layout.html_path), layout.html).unwrap();
            std::fs::write(dir.path().join(layout.css_path), layout.css).unwrap();
        }
        std::fs::write(dir.path().join("css/base.css"), builtin::BASE_CSS).unwrap();
        let deck_path = dir.path().join("deck.md");
        std::fs::write(&deck_path, source).unwrap();
        (dir, deck_path)
    }

    /// A deck folder with just the given `layouts/` files (none: no
    /// `layouts/` at all) and no `css/`.
    fn deck_with(layouts: &[(&str, &str)], source: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        if !layouts.is_empty() {
            std::fs::create_dir(dir.path().join("layouts")).unwrap();
            for (name, html) in layouts {
                std::fs::write(dir.path().join("layouts").join(format!("{name}.html")), html).unwrap();
            }
        }
        let deck_path = dir.path().join("deck.md");
        std::fs::write(&deck_path, source).unwrap();
        (dir, deck_path)
    }

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

    const PINNED: &str = "<!-- {\"key\":\"cover\",\"layout\":\"title-slide\"} -->\n# Cover\n\n---\n\n<!-- {\"key\":\"intro\",\"layout\":\"title-body\"} -->\n# Intro\n\nText.\n\n---\n\n<!-- {\"key\":\"more\",\"layout\":\"title-body\"} -->\n# More\n\nText.\n";

    const COVER: &str = "<section><h1><slot name=\"title\" accepts=\"inline\" arity=\"1\"></slot></h1></section>";
    const STATEMENT: &str = "<section><h1><slot name=\"title\" accepts=\"inline\" arity=\"1\"></slot></h1><div><slot name=\"body\" accepts=\"blocks\" arity=\"1..*\"></slot></div></section>";

    #[test]
    fn given_a_standard_deck_when_a_blank_layout_is_created_then_its_two_files_are_written_and_a_slide_can_use_it() {
        let (dir, deck_path) = standard_deck(PINNED);

        let name = create_layout(&deck_path, PINNED, " quote ", LayoutTemplate::Blank).unwrap();

        assert_eq!(name, "quote");
        assert!(dir.path().join("layouts/quote.html").is_file());
        assert!(dir.path().join("css/quote.css").is_file());
        let using = PINNED.replace("\"layout\":\"title-slide\"", "\"layout\":\"quote\"");
        let output = render_source(&deck_path, &using).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(output.slide_layouts["cover"], "quote");
        assert!(output.fragments["cover"].contains("layout-quote"), "{}", output.fragments["cover"]);
    }

    #[test]
    fn given_a_standard_template_when_created_then_it_builds_like_the_original_under_its_own_class() {
        let (_dir, deck_path) = standard_deck(PINNED);

        create_layout(&deck_path, PINNED, "my-columns", LayoutTemplate::Standard("two-column")).unwrap();

        let using = PINNED.replace("\"key\":\"intro\",\"layout\":\"title-body\"", "\"key\":\"intro\",\"layout\":\"my-columns\"");
        let using = using.replace("# Intro\n\nText.", "# Intro\n\n::: {slot=left}\n\nL\n\n:::\n\n::: {slot=right}\n\nR\n\n:::");
        let output = render_source(&deck_path, &using).unwrap_or_else(|err| panic!("{err}"));
        assert!(output.fragments["intro"].contains("layout-my-columns"));
        assert!(output.css.contains(".layout-my-columns"), "the copy's CSS is loaded");
    }

    #[test]
    fn adversarial_creating_a_layout_under_an_existing_or_invalid_name_writes_nothing() {
        let (dir, deck_path) = standard_deck(PINNED);
        let before = files_under(dir.path());
        for name in ["title-body", "Title-Body", "", "../evil", "a/b", ".hidden", "表紙"] {
            assert!(create_layout(&deck_path, PINNED, name, LayoutTemplate::Blank).is_err(), "{name:?}");
        }
        assert_eq!(files_under(dir.path()), before);
    }

    #[test]
    fn adversarial_an_orphan_css_file_with_the_new_name_is_never_overwritten() {
        let (dir, deck_path) = standard_deck(PINNED);
        std::fs::write(dir.path().join("css/quote.css"), "/* mine */").unwrap();

        let err = create_layout(&deck_path, PINNED, "quote", LayoutTemplate::Blank).unwrap_err();

        assert!(err.contains("won't overwrite"), "{err}");
        assert!(!dir.path().join("layouts/quote.html").exists());
        assert_eq!(std::fs::read_to_string(dir.path().join("css/quote.css")).unwrap(), "/* mine */");
    }

    #[test]
    fn given_a_deck_on_the_built_in_layout_when_a_layout_is_created_then_the_built_in_one_is_kept_beside_it() {
        // One unpinned slide with a body: on the blank layout (title only) it
        // wouldn't fit, so it stays on title-body-code under structural
        // matching.
        let source = "# Title\n\nBody.\n";
        let (dir, deck_path) = deck_with(&[], source);
        let before = render_source(&deck_path, source).unwrap();

        create_layout(&deck_path, source, "quote", LayoutTemplate::Blank).unwrap();

        assert_eq!(files_under(dir.path()), ["css/base.css", "css/quote.css", "deck.md", "layouts/quote.html", "layouts/title-body-code.html"]);
        let after = render_source(&deck_path, source).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(after.slide_layouts, before.slide_layouts);
    }

    #[test]
    fn adversarial_a_new_layout_that_would_make_an_unpinned_slide_ambiguous_is_refused() {
        // `cover` is the deck's only layout, so the heading-only slide builds
        // on it without matching; the blank layout fits it just as well.
        let source = "# Only a heading\n";
        let (dir, deck_path) = deck_with(&[("cover", COVER)], source);
        let before = files_under(dir.path());

        let err = create_layout(&deck_path, source, "quote", LayoutTemplate::Blank).unwrap_err();

        assert!(err.contains("slide 1"), "{err}");
        assert!(err.contains("'cover'"), "{err}");
        assert_eq!(files_under(dir.path()), before);
    }

    #[test]
    fn given_a_layout_with_its_css_when_duplicated_then_both_files_are_copied_under_the_copys_class() {
        let (dir, deck_path) = standard_deck(PINNED);

        let copy = duplicate_layout(&deck_path, PINNED, "title-slide").unwrap();

        assert_eq!(copy, "title-slide-copy");
        let html = std::fs::read_to_string(dir.path().join("layouts/title-slide-copy.html")).unwrap();
        let css = std::fs::read_to_string(dir.path().join("css/title-slide-copy.css")).unwrap();
        assert!(html.contains("layout-title-slide-copy") && !html.contains("layout-title-slide\""), "{html}");
        assert!(css.contains("layout-title-slide-copy"), "{css}");
        let using = PINNED.replace("\"layout\":\"title-slide\"", "\"layout\":\"title-slide-copy\"");
        assert_eq!(render_source(&deck_path, &using).unwrap().slide_layouts["cover"], "title-slide-copy");

        assert_eq!(duplicate_layout(&deck_path, PINNED, "title-slide").unwrap(), "title-slide-copy-2");
    }

    #[test]
    fn given_a_layout_without_its_own_css_when_duplicated_then_only_its_html_is_copied() {
        let source = "<!-- {\"key\":\"a\",\"layout\":\"cover\"} -->\n# A\n\n---\n\n<!-- {\"key\":\"b\",\"layout\":\"statement\"} -->\n# B\n\nText.\n";
        let (dir, deck_path) = deck_with(&[("cover", COVER), ("statement", STATEMENT)], source);

        duplicate_layout(&deck_path, source, "cover").unwrap();

        assert_eq!(files_under(dir.path()), ["deck.md", "layouts/cover-copy.html", "layouts/cover.html", "layouts/statement.html"]);
    }

    #[test]
    fn given_a_layout_with_the_longest_name_when_duplicated_then_the_copy_can_be_read_and_deleted() {
        let source = "<!-- {\"key\":\"a\",\"layout\":\"statement\"} -->\n# A\n\nBody.\n";
        let longest = "c".repeat(MAX_NAME_LEN);
        let (dir, deck_path) = deck_with(&[(longest.as_str(), COVER), ("statement", STATEMENT)], source);

        let copy = duplicate_layout(&deck_path, source, &longest).unwrap_or_else(|err| panic!("{err}"));

        assert!(copy.len() <= MAX_NAME_LEN, "{copy}");
        assert!(dir.path().join(format!("layouts/{copy}.html")).is_file());
        assert!(read_layout(&deck_path, &copy).is_ok());
    }

    #[test]
    fn adversarial_a_layout_the_deck_lacks_cannot_be_duplicated() {
        let (dir, deck_path) = standard_deck(PINNED);
        let before = files_under(dir.path());
        for name in ["nope", "../base", "title-body-code"] {
            assert!(duplicate_layout(&deck_path, PINNED, name).is_err(), "{name:?}");
        }
        assert_eq!(files_under(dir.path()), before);
    }

    #[test]
    fn given_the_built_in_layout_when_duplicated_then_the_deck_gets_both_as_files() {
        let source = "<!-- {\"key\":\"a\",\"layout\":\"title-body-code\"} -->\n# A\n\nBody.\n";
        let (dir, deck_path) = deck_with(&[], source);

        let copy = duplicate_layout(&deck_path, source, "title-body-code").unwrap();

        assert_eq!(copy, "title-body-code-copy");
        assert_eq!(files_under(dir.path()), ["deck.md", "layouts/title-body-code-copy.html", "layouts/title-body-code.html"]);
        assert!(render_source(&deck_path, source).is_ok());
    }

    // --- read_layout / save_layout ---

    #[test]
    fn given_a_layout_when_read_then_its_html_and_css_come_back() {
        let (_dir, deck_path) = standard_deck(PINNED);
        let standard = &builtin::STANDARD_LAYOUTS[0];

        let source = read_layout(&deck_path, standard.name).unwrap();

        assert_eq!(source, LayoutSource { html: standard.html.to_string(), css: Some(standard.css.to_string()) });
    }

    #[test]
    fn adversarial_reading_a_missing_or_path_like_layout_is_an_error() {
        let (_dir, deck_path) = standard_deck(PINNED);
        for name in ["nope", "../deck", "", "layouts/title-body"] {
            assert!(read_layout(&deck_path, name).is_err(), "{name:?}");
        }
    }

    #[test]
    fn given_edited_html_and_css_when_saved_then_the_next_render_uses_them() {
        let (dir, deck_path) = standard_deck(PINNED);
        let html = "<section class=\"peitho-slide layout-title-slide edited\"><h1><slot name=\"title\" accepts=\"inline\" arity=\"1\"></slot></h1><div><slot name=\"body\" accepts=\"blocks\" arity=\"0..1\"></slot></div></section>";
        let css = ".peitho-slide.layout-title-slide { color: rebeccapurple; }";

        save_layout(&deck_path, PINNED, "title-slide", html, css).unwrap();

        assert_eq!(std::fs::read_to_string(dir.path().join("layouts/title-slide.html")).unwrap(), html);
        let output = render_source(&deck_path, PINNED).unwrap_or_else(|err| panic!("{err}"));
        assert!(output.fragments["cover"].contains("edited"), "{}", output.fragments["cover"]);
        assert!(output.css.contains("rebeccapurple"));
    }

    #[test]
    fn adversarial_broken_html_is_refused_and_nothing_is_written() {
        let (dir, deck_path) = standard_deck(PINNED);
        let before_html = std::fs::read_to_string(dir.path().join("layouts/title-slide.html")).unwrap();
        let before_css = std::fs::read_to_string(dir.path().join("css/title-slide.css")).unwrap();
        for html in [
            "",
            "<section></section><section></section>",
            "<section><slot accepts=\"inline\" arity=\"1\"></slot></section>",
            "<section><slot name=\"title\" arity=\"1\"></slot></section>",
            "<section><slot name=\"title\" accepts=\"nonsense\" arity=\"1\"></slot></section>",
            "<div>no section</div>",
        ] {
            assert!(save_layout(&deck_path, PINNED, "title-slide", html, "x {}").is_err(), "{html:?}");
        }
        assert_eq!(std::fs::read_to_string(dir.path().join("layouts/title-slide.html")).unwrap(), before_html);
        assert_eq!(std::fs::read_to_string(dir.path().join("css/title-slide.css")).unwrap(), before_css);
    }

    #[test]
    fn adversarial_saving_a_layout_that_does_not_exist_creates_nothing() {
        let (dir, deck_path) = standard_deck(PINNED);
        let before = files_under(dir.path());
        for name in ["nope", "../deck", ""] {
            assert!(save_layout(&deck_path, PINNED, name, COVER, "").is_err(), "{name:?}");
        }
        assert_eq!(files_under(dir.path()), before);
    }

    #[test]
    fn given_a_layout_without_css_when_saved_with_blank_css_then_no_css_file_appears_and_with_css_then_one_does() {
        let source = "<!-- {\"key\":\"a\",\"layout\":\"cover\"} -->\n# A\n";
        let (dir, deck_path) = deck_with(&[("cover", COVER), ("statement", STATEMENT)], source);

        save_layout(&deck_path, source, "cover", COVER, "  \n").unwrap();
        assert!(!dir.path().join("css").exists());

        save_layout(&deck_path, source, "cover", COVER, "h1 { color: red; }").unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("css/cover.css")).unwrap(), "h1 { color: red; }");
        assert!(dir.path().join("css/base.css").is_file(), "the built-in theme comes along with the first css/ file");
    }

    #[test]
    fn adversarial_an_edit_that_parses_but_drops_a_slot_a_slide_uses_is_refused_and_nothing_is_written() {
        // `intro` and `more` are title+body slides pinned to `title-body`;
        // without its body slot they'd stop building — and the deck with
        // them, so Studio couldn't open it again.
        let (dir, deck_path) = standard_deck(PINNED);
        let before = files_under(dir.path());
        let before_html = std::fs::read_to_string(dir.path().join("layouts/title-body.html")).unwrap();
        let title_only = "<section class=\"peitho-slide layout-title-body\"><h1><slot name=\"title\" accepts=\"inline\" arity=\"1\"></slot></h1></section>";

        let err = save_layout(&deck_path, PINNED, "title-body", title_only, "").unwrap_err();

        assert!(err.contains("slide 2 ('intro')"), "{err}");
        assert_eq!(files_under(dir.path()), before);
        assert_eq!(std::fs::read_to_string(dir.path().join("layouts/title-body.html")).unwrap(), before_html);
        assert!(render_source(&deck_path, PINNED).is_ok());
    }

    #[test]
    fn adversarial_css_that_would_break_the_build_is_refused_and_nothing_is_written() {
        // A theme naming a slot class no layout has is refused by peitho-core.
        let (dir, deck_path) = standard_deck(PINNED);
        let before_css = std::fs::read_to_string(dir.path().join("css/title-slide.css")).unwrap();
        let html = std::fs::read_to_string(dir.path().join("layouts/title-slide.html")).unwrap();

        let err = save_layout(&deck_path, PINNED, "title-slide", &html, ".slot-nowhere { color: red; }").unwrap_err();

        assert!(err.contains("stop the deck from building"), "{err}");
        assert_eq!(std::fs::read_to_string(dir.path().join("css/title-slide.css")).unwrap(), before_css);
    }

    #[test]
    fn adversarial_a_deck_that_does_not_build_today_can_still_save_an_edit_that_keeps_its_slides() {
        let (dir, deck_path) = standard_deck(PINNED);
        let broken = PINNED.replace("\"layout\":\"title-slide\"", "\"layout\":\"quote\"");
        assert!(render_source(&deck_path, &broken).is_err());
        let css = ".peitho-slide.layout-big-number { color: teal; }";
        let html = std::fs::read_to_string(dir.path().join("layouts/big-number.html")).unwrap();

        save_layout(&deck_path, &broken, "big-number", &html, css).unwrap();

        assert_eq!(std::fs::read_to_string(dir.path().join("css/big-number.css")).unwrap(), css);
    }

    // --- css_with_layout_css ---

    fn css_file(name: &str, content: &str) -> CssFile {
        CssFile { name: name.to_string(), content: content.to_string() }
    }

    fn css_pairs(files: &[CssFile]) -> Vec<(&str, &str)> {
        files.iter().map(|file| (file.name.as_str(), file.content.as_str())).collect()
    }

    #[test]
    fn given_a_deck_with_css_when_a_layouts_css_is_saved_then_only_its_file_changes_or_appears() {
        let current = vec![css_file("base.css", "b"), css_file("quote.css", "old"), css_file("quote-copy.css", "c")];
        assert_eq!(
            css_pairs(&css_with_layout_css(current.clone(), "quote", "new", true, true)),
            vec![("base.css", "b"), ("quote-copy.css", "c"), ("quote.css", "new")],
        );
        let current = vec![css_file("base.css", "b")];
        assert_eq!(css_pairs(&css_with_layout_css(current, "cover", "x", false, true)), vec![("base.css", "b"), ("cover.css", "x")]);
    }

    #[test]
    fn adversarial_blank_css_empties_an_existing_file_but_adds_none_and_a_deck_without_css_dir_gets_the_theme() {
        let current = vec![css_file("base.css", "b"), css_file("quote.css", "old")];
        assert_eq!(css_pairs(&css_with_layout_css(current, "quote", " \n", true, true)), vec![("base.css", "b"), ("quote.css", " \n")]);

        let builtin = vec![css_file("base.css (built-in)", "t")];
        assert_eq!(css_pairs(&css_with_layout_css(builtin.clone(), "cover", "", false, false)), vec![("base.css (built-in)", "t")]);
        let scaffolded = builtin::scaffolded_base_css();
        assert_eq!(
            css_pairs(&css_with_layout_css(builtin, "cover", "h1 {}", false, false)),
            vec![("base.css", scaffolded.as_str()), ("cover.css", "h1 {}")],
        );
    }

    // --- check_layout_removal / delete_layout ---

    #[test]
    fn given_an_unused_layout_when_deleted_then_its_files_go_and_the_deck_still_builds_the_same() {
        let (dir, deck_path) = standard_deck(PINNED);
        let before = render_source(&deck_path, PINNED).unwrap();

        delete_layout(&deck_path, PINNED, "big-number").unwrap();

        assert!(!dir.path().join("layouts/big-number.html").exists());
        assert!(!dir.path().join("css/big-number.css").exists());
        assert_eq!(render_source(&deck_path, PINNED).unwrap().slide_layouts, before.slide_layouts);
    }

    #[test]
    fn given_a_used_layout_and_its_slides_repinned_when_checked_and_deleted_then_they_build_on_the_replacement() {
        let (dir, deck_path) = standard_deck(PINNED);
        let repinned = PINNED.replace("\"layout\":\"title-slide\"", "\"layout\":\"section-header\"");

        check_layout_removal(&deck_path, PINNED, &repinned, "title-slide").unwrap();
        delete_layout(&deck_path, &repinned, "title-slide").unwrap();

        assert!(!dir.path().join("layouts/title-slide.html").exists());
        assert!(!dir.path().join("css/title-slide.css").exists());
        let output = render_source(&deck_path, &repinned).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(output.slide_layouts["cover"], "section-header");
        assert_eq!(output.slide_layouts["intro"], "title-body");
    }

    #[test]
    fn adversarial_deleting_a_layout_slides_are_still_on_is_refused_and_nothing_is_deleted() {
        let (dir, deck_path) = standard_deck(PINNED);
        let before = files_under(dir.path());

        let err = check_layout_removal(&deck_path, PINNED, PINNED, "title-body").unwrap_err();
        assert!(err.contains("slide 2 ('intro')"), "{err}");
        assert!(delete_layout(&deck_path, PINNED, "title-body").is_err());

        assert_eq!(files_under(dir.path()), before);
    }

    #[test]
    fn adversarial_a_replacement_the_slides_do_not_fit_is_refused() {
        // `blank` has no title slot: a slide with a heading doesn't fit it.
        let (_dir, deck_path) = standard_deck(PINNED);
        let repinned = PINNED.replace("\"layout\":\"title-body\"", "\"layout\":\"blank\"");

        let err = check_layout_removal(&deck_path, PINNED, &repinned, "title-body").unwrap_err();

        assert!(err.contains("doesn't fit 'blank'"), "{err}");
    }

    #[test]
    fn adversarial_the_last_layout_cannot_be_deleted() {
        let source = "# Only\n";
        let (dir, deck_path) = deck_with(&[("cover", COVER)], source);

        let err = delete_layout(&deck_path, source, "cover").unwrap_err();

        assert!(err.contains("only layout"), "{err}");
        assert!(dir.path().join("layouts/cover.html").is_file());
    }

    #[test]
    fn adversarial_going_from_two_layouts_to_one_must_not_move_an_unpinned_slide() {
        // With `cover` and `statement`, the title+body slide builds on
        // `statement` by matching; deleting `statement` leaves `cover` as the
        // only layout, and peitho-core then maps every unpinned slide onto
        // it — the body doesn't fit.
        let source = "<!-- {\"key\":\"a\"} -->\n# A\n\nBody.\n\n---\n\n<!-- {\"key\":\"b\"} -->\n# B\n";
        let (_dir, deck_path) = deck_with(&[("cover", COVER), ("statement", STATEMENT)], source);

        let err = check_layout_removal(&deck_path, source, source, "statement").unwrap_err();
        assert!(err.contains("slide 1 ('a')"), "{err}");

        // Deleting `cover` instead is fine: `b` (heading only) was on cover…
        let err = check_layout_removal(&deck_path, source, source, "cover").unwrap_err();
        assert!(err.contains("slide 2 ('b')"), "{err}");
        // Re-pinning it to `statement` doesn't help: it has no body.
        let repinned = source.replace("{\"key\":\"b\"}", "{\"key\":\"b\",\"layout\":\"statement\"}");
        assert!(check_layout_removal(&deck_path, source, &repinned, "cover").is_err());
    }

    #[test]
    fn adversarial_a_layout_name_the_deck_lacks_or_that_looks_like_a_path_cannot_be_deleted() {
        let (dir, deck_path) = standard_deck(PINNED);
        let before = files_under(dir.path());
        for name in ["nope", "../deck", "", "title-body-image"] {
            assert!(delete_layout(&deck_path, PINNED, name).is_err(), "{name:?}");
        }
        assert_eq!(files_under(dir.path()), before);
    }

    #[test]
    fn adversarial_a_changed_source_with_a_different_slide_count_is_refused() {
        let (_dir, deck_path) = standard_deck(PINNED);
        let shorter = PINNED.split("\n---\n").next().unwrap();
        let err = check_layout_removal(&deck_path, PINNED, shorter, "big-number").unwrap_err();
        assert!(err.contains("try again"), "{err}");
    }

    #[test]
    fn adversarial_a_deletion_that_would_break_the_build_is_refused_by_the_check_before_anything_changes() {
        // `css/base.css` styles `.slot-code`, and in a new deck `title-body`
        // is the only layout with a code slot: peitho-core refuses a theme
        // naming a slot class no layout has. The dispatch check passes (the
        // slides moved to `one-column-text`), the build doesn't — and the
        // check says so before the frontend re-pins any slide.
        let (dir, deck_path) = standard_deck(PINNED);
        let repinned = PINNED.replace("\"layout\":\"title-body\"", "\"layout\":\"one-column-text\"");
        let before = files_under(dir.path());

        let err = check_layout_removal(&deck_path, PINNED, &repinned, "title-body").unwrap_err();
        assert!(err.contains("stop the deck from building"), "{err}");
        assert!(err.contains(".slot-code"), "{err}");

        let err = delete_layout(&deck_path, &repinned, "title-body").unwrap_err();
        assert!(err.contains("stop the deck from building"), "{err}");
        assert_eq!(files_under(dir.path()), before);
        assert!(render_source(&deck_path, &repinned).is_ok());
    }

    #[test]
    fn given_the_build_check_then_it_renders_the_repinned_source_not_the_original() {
        // The original still has slides on `title-slide`; only the
        // re-pinned source can build without it.
        let (_dir, deck_path) = standard_deck(PINNED);
        let repinned = PINNED.replace("\"layout\":\"title-slide\"", "\"layout\":\"section-header\"");
        let current = pipeline::parse_source(&deck_path, PINNED).unwrap().assets.layouts;

        let next = without_layout(&current, "title-slide").unwrap();
        assert!(check_build_without_layout(&deck_path, PINNED, &repinned, next, "title-slide").is_ok());
        let next = without_layout(&current, "title-slide").unwrap();
        assert!(check_build_without_layout(&deck_path, PINNED, PINNED, next, "title-slide").is_err());
    }

    #[test]
    fn adversarial_a_deck_that_does_not_build_today_is_not_held_to_the_build_check() {
        // `quote` isn't a layout of the deck: the original doesn't build,
        // so the deletion isn't blamed for it.
        let (_dir, deck_path) = standard_deck(PINNED);
        let broken = PINNED.replace("\"layout\":\"title-slide\"", "\"layout\":\"quote\"");
        assert!(render_source(&deck_path, &broken).is_err());
        let current = pipeline::parse_source(&deck_path, PINNED).unwrap().assets.layouts;
        let next = without_layout(&current, "big-number").unwrap();

        assert!(check_build_without_layout(&deck_path, &broken, &broken, next, "big-number").is_ok());
    }

    // --- assets_without_layout ---

    fn css_names(assets: &ResolvedAssets) -> Vec<&str> {
        assets.css.iter().map(|file| file.name.as_str()).collect()
    }

    #[test]
    fn given_a_layout_with_its_css_when_left_out_then_its_layout_and_css_file_go_and_the_rest_stay() {
        let (dir, _deck_path) = standard_deck(PINNED);
        std::fs::write(dir.path().join("css/title-body-extra.css"), ".peitho-slide {}\n").unwrap();
        let assets = crate::engine::assets::resolve(dir.path()).unwrap();
        let next = without_layout(&assets.layouts, "title-body").unwrap();

        let without = assets_without_layout(assets, next, "title-body");

        assert!(without.layouts.get("title-body").is_none());
        assert!(without.layouts.get("title-slide").is_some());
        let names = css_names(&without);
        assert!(!names.contains(&"title-body.css"), "{names:?}");
        assert!(names.contains(&"title-body-extra.css"), "a CSS file merely sharing the prefix stays: {names:?}");
        assert!(names.contains(&"title-slide.css"), "{names:?}");
        assert!(names.contains(&"base.css"), "{names:?}");
    }

    #[test]
    fn adversarial_a_layout_without_css_or_a_deck_on_the_built_in_theme_loses_no_css_file() {
        let (dir, _deck_path) = deck_with(&[("cover", COVER), ("statement", STATEMENT)], "# A\n");
        let assets = crate::engine::assets::resolve(dir.path()).unwrap();
        let before: Vec<String> = assets.css.iter().map(|file| file.name.clone()).collect();
        let next = without_layout(&assets.layouts, "cover").unwrap();

        let without = assets_without_layout(assets, next, "cover");

        assert_eq!(css_names(&without), before.iter().map(String::as_str).collect::<Vec<_>>());
        assert_eq!(without.layouts.names(), vec!["statement"]);
    }
}
