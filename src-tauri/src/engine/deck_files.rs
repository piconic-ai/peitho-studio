//! The layout screen's file tree and its editor tabs: which of a deck's
//! files the tree shows, which of them can be opened as text, and reading
//! and saving one — a layout's HTML or CSS, or a CSS file no layout owns
//! (`css/base.css`).
//!
//! The tree shows `layouts/`, `css/`, `img/` and `fonts/` (`TREE_DIRS`),
//! never `deck.md` (the slides screen edits it) and never a hidden file.
//! Only the files peitho-core reads as the deck's layouts and CSS —
//! `layouts/<name>.html` and `css/<name>.css`, directly in their folder
//! (`EditableFile`) — open as text; everything else is listed, not opened.
//!
//! Saving keeps `layout_files::save_layout`'s guarantees for a layout's own
//! files (the HTML parses, every slide keeps its layout, the deck keeps
//! building, nothing written over a change made on disk meanwhile), and
//! holds a shared CSS file to the same build check (`check_css_edit`).

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use super::layout_files::{self, LayoutBase, LAYOUT_CHANGED_ON_DISK};
use super::pipeline;

/// The deck folders the file tree shows, in this order.
pub const TREE_DIRS: [&str; 4] = ["layouts", "css", "img", "fonts"];

/// How deep the tree follows subfolders below each of `TREE_DIRS` — deep
/// enough for any image folder a deck keeps, shallow enough that a
/// runaway folder can't stall the listing.
const MAX_TREE_DEPTH: usize = 8;

/// What a tree entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeckFileKind {
    Dir,
    File,
}

/// One entry of the file tree: its path relative to the deck's folder
/// (`/`-separated), whether it's a folder, and — for a file — whether it
/// opens as text in the editor (`editable_file`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckFileEntry {
    pub path: String,
    pub kind: DeckFileKind,
    pub editable: bool,
}

/// A file the editor can open: layout `name`'s HTML, or a CSS file
/// (`css/<stem>.css`) — a layout's own when a layout of the same name
/// exists, else one every slide shares (`base.css`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditableFile {
    LayoutHtml { name: String },
    Css { stem: String },
}

impl EditableFile {
    /// Its path relative to the deck's folder.
    pub fn path(&self) -> String {
        match self {
            EditableFile::LayoutHtml { name } => format!("layouts/{name}.html"),
            EditableFile::Css { stem } => format!("css/{stem}.css"),
        }
    }
}

/// Whether `stem` is a plain file stem: what a layout may be named
/// (`layout_files::validate_layout_name`) — so no path separator, no dot,
/// no leading `-`, nothing around it.
fn plain_stem(stem: &str) -> bool {
    layout_files::validate_layout_name(stem, &[]).is_ok_and(|valid| valid == stem)
}

/// Which editable file `path` (relative to the deck's folder) is, or why
/// it isn't one: `layouts/<name>.html` or `css/<stem>.css`, directly in
/// that folder, with a plain stem (`plain_stem`). An absolute path, `..`,
/// `.`, a backslash or a subfolder is refused, so the path never leaves
/// those two folders.
pub fn editable_file(path: &str) -> Result<EditableFile, String> {
    let refuse = || format!("'{path}' is not a layout or CSS file Studio can edit");
    if path.contains('\\') {
        return Err(refuse());
    }
    let mut parts = Path::new(path).components();
    let (Some(Component::Normal(dir)), Some(Component::Normal(file)), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err(refuse());
    };
    let (Some(dir), Some(file)) = (dir.to_str(), file.to_str()) else { return Err(refuse()) };
    // `Path::components` drops a trailing `/` and inner `./`; the path must
    // be spelled exactly as the file's, so a lookalike can't pass.
    if format!("{dir}/{file}") != path {
        return Err(refuse());
    }
    let editable = match dir {
        "layouts" => file.strip_suffix(".html").filter(|stem| plain_stem(stem)).map(|name| EditableFile::LayoutHtml { name: name.to_string() }),
        "css" => file.strip_suffix(".css").filter(|stem| plain_stem(stem)).map(|stem| EditableFile::Css { stem: stem.to_string() }),
        _ => None,
    };
    editable.ok_or_else(refuse)
}

/// Whether anything at `path` is a symbolic link (`false` when nothing is
/// there).
fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink())
}

/// `file`'s path under `deck_dir`, refusing one reached through a symbolic
/// link (its folder or itself), which could point outside the deck.
fn real_path(deck_dir: &Path, file: &EditableFile) -> Result<PathBuf, String> {
    let relative = file.path();
    let path = deck_dir.join(&relative);
    let dir = path.parent().unwrap_or(deck_dir);
    if is_symlink(dir) || is_symlink(&path) {
        return Err(format!("'{relative}' is reached through a symbolic link; Studio edits only the deck's own files"));
    }
    Ok(path)
}

/// The entries under `dir` (`relative` to the deck's folder), folders
/// before files and each group by name, following subfolders down to
/// `depth` more levels. Hidden entries (a leading `.`) and symbolic links
/// are left out; an unreadable folder lists as empty.
fn entries_under(dir: &Path, relative: &str, depth: usize, out: &mut Vec<DeckFileEntry>) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let mut children: Vec<(String, bool)> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            let file_type = entry.file_type().ok()?;
            (!name.starts_with('.') && !file_type.is_symlink() && (file_type.is_dir() || file_type.is_file())).then_some((name, file_type.is_dir()))
        })
        .collect();
    children.sort_by(|(a, a_dir), (b, b_dir)| b_dir.cmp(a_dir).then_with(|| a.cmp(b)));
    for (name, is_dir) in children {
        let path = format!("{relative}/{name}");
        if is_dir {
            out.push(DeckFileEntry { path: path.clone(), kind: DeckFileKind::Dir, editable: false });
            if depth > 0 {
                entries_under(&dir.join(&name), &path, depth - 1, out);
            }
        } else {
            let editable = editable_file(&path).is_ok();
            out.push(DeckFileEntry { path, kind: DeckFileKind::File, editable });
        }
    }
}

/// The file tree of `deck_dir`: each of `TREE_DIRS` the deck has (a real
/// folder, not a link to one), then everything under it (`entries_under`).
pub fn list_deck_files(deck_dir: &Path) -> Vec<DeckFileEntry> {
    let mut out = Vec::new();
    for dir in TREE_DIRS {
        let path = deck_dir.join(dir);
        if is_symlink(&path) || !path.is_dir() {
            continue;
        }
        out.push(DeckFileEntry { path: dir.to_string(), kind: DeckFileKind::Dir, editable: false });
        entries_under(&path, dir, MAX_TREE_DEPTH, &mut out);
    }
    out
}

/// Whether `deck_dir` has layout `name`'s HTML file.
fn has_layout(deck_dir: &Path, name: &str) -> bool {
    deck_dir.join("layouts").join(format!("{name}.html")).is_file()
}

/// The text of editable file `path` in `deck_path`'s deck. A layout's own
/// CSS file that isn't there yet reads as blank CSS (saving CSS that isn't
/// blank creates it, as `layout_files::save_layout` does); any other
/// missing file is an error.
pub fn read_deck_file(deck_path: &Path, path: &str) -> Result<String, String> {
    let deck_dir = pipeline::deck_dir_of(deck_path);
    let file = editable_file(path)?;
    let real = real_path(deck_dir, &file)?;
    if !real.is_file() {
        return match &file {
            EditableFile::Css { stem } if has_layout(deck_dir, stem) => Ok(String::new()),
            _ => Err(format!("'{path}' is not a file of this deck")),
        };
    }
    std::fs::read_to_string(&real).map_err(|err| format!("failed to read {path}: {err}"))
}

/// Whether replacing shared CSS file `name` (`base.css`) with `css` keeps
/// `deck_path`'s deck (`content`, its source now) building — checked before
/// anything is written. A deck that doesn't build today isn't held to it.
fn check_css_edit(deck_path: &Path, content: &str, name: &str, css: &str) -> Result<(), String> {
    if pipeline::render_source(deck_path, content).is_err() {
        return Ok(());
    }
    let mut parsed = pipeline::parse_source(deck_path, content)?;
    for file in parsed.assets.css.iter_mut().filter(|file| file.name == name) {
        file.content = css.to_string();
    }
    pipeline::render_parsed(deck_path, parsed)
        .map(|_| ())
        .map_err(|err| format!("this edit to css/{name} would stop the deck from building: {err}"))
}

/// Saves `text` as editable file `path` of `deck_path`'s deck (`content`
/// is the deck source now). A layout's HTML or own CSS is saved through
/// `layout_files::save_layout` with the other file of the pair as it is on
/// disk, so the same checks hold; a shared CSS file (one no layout owns)
/// must already exist and pass `check_css_edit`.
///
/// With `base` (the text the editor last read or wrote), nothing is written
/// either when the file no longer holds it — someone else (the Coding
/// Agent) wrote it meanwhile: the error is `LAYOUT_CHANGED_ON_DISK`.
pub fn save_deck_file(deck_path: &Path, content: &str, path: &str, text: &str, base: Option<&str>) -> Result<(), String> {
    let deck_dir = pipeline::deck_dir_of(deck_path);
    let file = editable_file(path)?;
    let real = real_path(deck_dir, &file)?;
    match &file {
        EditableFile::LayoutHtml { name } => {
            let css = read_deck_file(deck_path, &EditableFile::Css { stem: name.clone() }.path())?;
            let base = base.map(|html| LayoutBase { html: html.to_string(), css: css.clone() });
            layout_files::save_layout(deck_path, content, name, text, &css, base.as_ref())
        }
        EditableFile::Css { stem } if has_layout(deck_dir, stem) => {
            let html = read_deck_file(deck_path, &EditableFile::LayoutHtml { name: stem.clone() }.path())?;
            let base = base.map(|css| LayoutBase { html: html.clone(), css: css.to_string() });
            layout_files::save_layout(deck_path, content, stem, &html, text, base.as_ref())
        }
        EditableFile::Css { stem } => {
            if !real.is_file() {
                return Err(format!("'{path}' is not a file of this deck"));
            }
            check_css_edit(deck_path, content, &format!("{stem}.css"), text)?;
            if let Some(base) = base {
                if std::fs::read_to_string(&real).ok().as_deref() != Some(base) {
                    return Err(LAYOUT_CHANGED_ON_DISK.to_string());
                }
            }
            std::fs::write(&real, text).map_err(|err| format!("failed to write {path}: {err}"))
        }
    }
}

/// Layout `name`'s HTML and CSS for a draft preview: `html` and `css` as
/// the editor holds them, a side the editor doesn't have open (`None`)
/// read from disk (`read_deck_file`).
pub fn layout_draft_texts(deck_path: &Path, name: &str, html: Option<String>, css: Option<String>) -> Result<(String, String), String> {
    let html = match html {
        Some(html) => html,
        None => read_deck_file(deck_path, &EditableFile::LayoutHtml { name: name.to_string() }.path())?,
    };
    let css = match css {
        Some(css) => css,
        None => read_deck_file(deck_path, &EditableFile::Css { stem: name.to_string() }.path())?,
    };
    Ok((html, css))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::builtin;
    use crate::engine::pipeline::render_source;

    const PINNED: &str = "<!-- {\"key\":\"cover\",\"layout\":\"title-slide\"} -->\n# Cover\n\n---\n\n<!-- {\"key\":\"intro\",\"layout\":\"title-body\"} -->\n# Intro\n\nText.\n";

    /// A deck folder as `create_deck` writes it: the standard layouts, their
    /// CSS and `css/base.css`, and `deck.md` holding `PINNED`.
    fn standard_deck() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("layouts")).unwrap();
        std::fs::create_dir(dir.path().join("css")).unwrap();
        for layout in builtin::STANDARD_LAYOUTS {
            std::fs::write(dir.path().join(layout.html_path), layout.html).unwrap();
            std::fs::write(dir.path().join(layout.css_path), layout.css).unwrap();
        }
        std::fs::write(dir.path().join("css/base.css"), builtin::BASE_CSS).unwrap();
        let deck_path = dir.path().join("deck.md");
        std::fs::write(&deck_path, PINNED).unwrap();
        (dir, deck_path)
    }

    fn read(dir: &Path, path: &str) -> String {
        std::fs::read_to_string(dir.join(path)).unwrap()
    }

    // --- editable_file ---

    #[test]
    fn given_a_layouts_html_or_a_css_file_then_it_is_editable() {
        assert_eq!(editable_file("layouts/title-body.html"), Ok(EditableFile::LayoutHtml { name: "title-body".into() }));
        assert_eq!(editable_file("css/base.css"), Ok(EditableFile::Css { stem: "base".into() }));
        assert_eq!(editable_file("css/title_body2.css"), Ok(EditableFile::Css { stem: "title_body2".into() }));
        assert_eq!(EditableFile::Css { stem: "base".into() }.path(), "css/base.css");
        assert_eq!(EditableFile::LayoutHtml { name: "cover".into() }.path(), "layouts/cover.html");
    }

    #[test]
    fn adversarial_paths_that_leave_the_two_folders_or_are_not_text_are_not_editable() {
        for path in [
            "",
            "deck.md",
            "layouts",
            "layouts/",
            "layouts/.html",
            "layouts/x.css",
            "css/x.html",
            "css/x.CSS",
            "img/logo.png",
            "fonts/a.woff2",
            "/layouts/x.html",
            "/etc/passwd",
            "../layouts/x.html",
            "layouts/../deck.md",
            "layouts/../css/base.css",
            "./layouts/x.html",
            "layouts/./x.html",
            "layouts//x.html",
            "layouts/x.html/",
            "layouts/sub/x.html",
            "layouts\\x.html",
            "css/.hidden.css",
            "css/-x.css",
            "css/a b.css",
            "css/theme.dark.css",
            "css/ base.css",
            "css/日本.css",
            "Layouts/x.html",
        ] {
            assert!(editable_file(path).is_err(), "{path:?}");
        }
    }

    // --- list_deck_files ---

    #[test]
    fn given_a_deck_then_the_tree_lists_its_four_folders_in_order_folders_first() {
        let (dir, _) = standard_deck();
        std::fs::create_dir_all(dir.path().join("img/photos")).unwrap();
        std::fs::write(dir.path().join("img/logo.png"), b"png").unwrap();
        std::fs::write(dir.path().join("img/photos/a.jpg"), b"jpg").unwrap();
        std::fs::create_dir(dir.path().join("fonts")).unwrap();
        std::fs::write(dir.path().join("syntax.txt"), "not listed").unwrap();

        let entries = list_deck_files(dir.path());
        let paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();

        assert_eq!(paths[0], "layouts");
        let at = |path: &str| paths.iter().position(|p| *p == path).unwrap_or_else(|| panic!("{path} missing from {paths:?}"));
        assert!(at("layouts") < at("css") && at("css") < at("img") && at("img") < at("fonts"));
        assert!(at("img/photos") < at("img/photos/a.jpg") && at("img/photos/a.jpg") < at("img/logo.png"), "{paths:?}");
        assert!(!paths.contains(&"deck.md") && !paths.contains(&"syntax.txt"));
        let entry = |path: &str| entries.iter().find(|entry| entry.path == path).unwrap();
        assert_eq!(entry("css/base.css"), &DeckFileEntry { path: "css/base.css".into(), kind: DeckFileKind::File, editable: true });
        assert!(!entry("img/logo.png").editable);
        assert_eq!(entry("fonts").kind, DeckFileKind::Dir);
    }

    #[test]
    fn adversarial_hidden_entries_links_and_missing_folders_are_left_out() {
        let dir = tempfile::tempdir().unwrap();
        // Nothing at all: an empty tree.
        assert!(list_deck_files(dir.path()).is_empty());
        std::fs::create_dir_all(dir.path().join("css/.cache")).unwrap();
        std::fs::write(dir.path().join("css/.DS_Store"), "x").unwrap();
        std::fs::write(dir.path().join("css/.cache/a.css"), "x").unwrap();
        std::fs::write(dir.path().join("css/base.css"), "x").unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.css"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.css"), dir.path().join("css/linked.css")).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("img")).unwrap();

        let paths: Vec<String> = list_deck_files(dir.path()).into_iter().map(|entry| entry.path).collect();

        assert_eq!(paths, vec!["css".to_string(), "css/base.css".to_string()]);
    }

    #[test]
    fn adversarial_a_deeply_nested_folder_is_listed_only_so_far() {
        let dir = tempfile::tempdir().unwrap();
        let mut deep = dir.path().join("img");
        for level in 0..12 {
            deep = deep.join(format!("d{level}"));
        }
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(deep.join("a.png"), b"x").unwrap();
        let entries = list_deck_files(dir.path());
        assert!(entries.len() <= MAX_TREE_DEPTH + 2, "{}", entries.len());
        assert!(entries.iter().all(|entry| !entry.path.ends_with("a.png")));
    }

    // --- read_deck_file ---

    #[test]
    fn given_editable_files_when_read_then_their_text_comes_back() {
        let (dir, deck_path) = standard_deck();
        assert_eq!(read_deck_file(&deck_path, "css/base.css").unwrap(), builtin::BASE_CSS);
        assert_eq!(read_deck_file(&deck_path, "layouts/title-body.html").unwrap(), read(dir.path(), "layouts/title-body.html"));
    }

    #[test]
    fn given_a_layout_without_its_own_css_then_its_css_reads_blank_but_an_unowned_missing_css_is_an_error() {
        let (dir, deck_path) = standard_deck();
        std::fs::remove_file(dir.path().join("css/title-body.css")).unwrap();
        assert_eq!(read_deck_file(&deck_path, "css/title-body.css").unwrap(), "");
        assert!(read_deck_file(&deck_path, "css/nowhere.css").is_err());
        assert!(read_deck_file(&deck_path, "layouts/nowhere.html").is_err());
    }

    #[test]
    fn adversarial_reading_through_a_link_or_outside_the_folders_is_refused() {
        let (dir, deck_path) = standard_deck();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.css"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.css"), dir.path().join("css/linked.css")).unwrap();
        for path in ["css/linked.css", "../secret.css", "deck.md", "/etc/hosts"] {
            assert!(read_deck_file(&deck_path, path).is_err(), "{path:?}");
        }
    }

    // --- save_deck_file ---

    #[test]
    fn given_an_edit_to_base_css_when_saved_then_the_next_render_uses_it() {
        let (dir, deck_path) = standard_deck();
        let css = format!("{}\n.peitho-slide {{ outline: 3px solid teal; }}\n", builtin::BASE_CSS);

        save_deck_file(&deck_path, PINNED, "css/base.css", &css, Some(builtin::BASE_CSS)).unwrap();

        assert_eq!(read(dir.path(), "css/base.css"), css);
        assert!(render_source(&deck_path, PINNED).unwrap().css.contains("3px solid teal"));
    }

    #[test]
    fn given_a_layouts_html_alone_when_saved_then_only_it_changes_and_its_css_file_is_not_rewritten() {
        let (dir, deck_path) = standard_deck();
        let css_path = dir.path().join("css/title-slide.css");
        let css_before = std::fs::metadata(&css_path).unwrap().modified().unwrap();
        let html = read(dir.path(), "layouts/title-slide.html");
        let edited = html.replace("<h1", "<h1 data-edited");
        std::thread::sleep(std::time::Duration::from_millis(20));

        save_deck_file(&deck_path, PINNED, "layouts/title-slide.html", &edited, Some(&html)).unwrap();

        assert_eq!(read(dir.path(), "layouts/title-slide.html"), edited);
        assert_eq!(std::fs::metadata(&css_path).unwrap().modified().unwrap(), css_before);
    }

    #[test]
    fn given_a_layouts_own_css_when_saved_then_it_goes_through_the_layout_check() {
        let (dir, deck_path) = standard_deck();
        let css = read(dir.path(), "css/title-slide.css");
        save_deck_file(&deck_path, PINNED, "css/title-slide.css", ".x { color: red; }", Some(&css)).unwrap();
        assert_eq!(read(dir.path(), "css/title-slide.css"), ".x { color: red; }");
        // CSS peitho-core refuses (a slot no layout has) is refused like a layout's own save.
        let err = save_deck_file(&deck_path, PINNED, "css/title-slide.css", ".slot-nowhere { color: red; }", None).unwrap_err();
        assert!(err.contains("title-slide"), "{err}");
        assert_eq!(read(dir.path(), "css/title-slide.css"), ".x { color: red; }");
    }

    #[test]
    fn adversarial_base_css_that_would_break_the_build_is_refused_and_nothing_is_written() {
        let (dir, deck_path) = standard_deck();
        let err = save_deck_file(&deck_path, PINNED, "css/base.css", ".slot-nowhere { color: red; }", None).unwrap_err();
        assert!(err.contains("css/base.css"), "{err}");
        assert_eq!(read(dir.path(), "css/base.css"), builtin::BASE_CSS);
    }

    #[test]
    fn adversarial_a_file_changed_on_disk_since_it_was_read_is_not_overwritten() {
        let (dir, deck_path) = standard_deck();
        std::fs::write(dir.path().join("css/base.css"), "/* the agent's */").unwrap();
        let err = save_deck_file(&deck_path, PINNED, "css/base.css", "/* mine */", Some(builtin::BASE_CSS)).unwrap_err();
        assert_eq!(err, LAYOUT_CHANGED_ON_DISK);
        assert_eq!(read(dir.path(), "css/base.css"), "/* the agent's */");
        let html = read(dir.path(), "layouts/title-body.html");
        std::fs::write(dir.path().join("layouts/title-body.html"), html.replace("<h1", "<h1 data-agent")).unwrap();
        let err = save_deck_file(&deck_path, PINNED, "layouts/title-body.html", &html.replace("<h1", "<h1 data-mine"), Some(&html)).unwrap_err();
        assert_eq!(err, LAYOUT_CHANGED_ON_DISK);
    }

    #[test]
    fn adversarial_saving_a_missing_unowned_file_a_link_or_a_path_outside_creates_nothing() {
        let (dir, deck_path) = standard_deck();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.css"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.css"), dir.path().join("css/linked.css")).unwrap();
        for path in ["css/new.css", "css/linked.css", "deck.md", "../x.css", "layouts/new.html", "img/a.css"] {
            assert!(save_deck_file(&deck_path, PINNED, path, "a {}", None).is_err(), "{path:?}");
        }
        assert!(!dir.path().join("css/new.css").exists());
        assert!(!dir.path().join("layouts/new.html").exists());
        assert_eq!(std::fs::read_to_string(outside.path().join("secret.css")).unwrap(), "secret");
    }

    // --- layout_draft_texts ---

    #[test]
    fn given_one_side_of_a_layout_in_the_editor_then_the_other_is_read_from_disk() {
        let (dir, deck_path) = standard_deck();
        let html = read(dir.path(), "layouts/title-body.html");
        let css = read(dir.path(), "css/title-body.css");
        assert_eq!(layout_draft_texts(&deck_path, "title-body", Some("<section></section>".into()), None).unwrap(), ("<section></section>".to_string(), css.clone()));
        assert_eq!(layout_draft_texts(&deck_path, "title-body", None, Some("a{}".into())).unwrap(), (html.clone(), "a{}".to_string()));
        assert_eq!(layout_draft_texts(&deck_path, "title-body", None, None).unwrap(), (html, css));
    }

    #[test]
    fn adversarial_a_draft_of_a_layout_the_deck_lacks_or_a_path_like_name_is_an_error_when_a_side_must_be_read() {
        let (_dir, deck_path) = standard_deck();
        for name in ["nowhere", "../deck", "", "a/b"] {
            assert!(layout_draft_texts(&deck_path, name, None, Some(String::new())).is_err(), "{name:?}");
        }
    }

    #[test]
    fn given_a_layout_without_css_when_its_css_is_saved_then_the_file_appears() {
        let (dir, deck_path) = standard_deck();
        std::fs::remove_file(dir.path().join("css/title-body.css")).unwrap();
        save_deck_file(&deck_path, PINNED, "css/title-body.css", ".a { color: red; }", Some("")).unwrap();
        assert_eq!(read(dir.path(), "css/title-body.css"), ".a { color: red; }");
    }
}
