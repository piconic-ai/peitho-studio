//! Deck-adjacent asset resolution (layouts/css/syntaxes/fonts), mirroring
//! `peitho`'s own `asset_resolution.rs` + `load_highlighter`/`load_layouts`/
//! `load_css` (crates/peitho/src/main.rs): a deck's frontmatter can point at
//! an explicit path, otherwise a `<deck-dir>/{layouts,css,syntaxes,fonts}`
//! convention directory is used if present, otherwise the built-in
//! layout/theme. Frontmatter-explicit overrides are not implemented yet —
//! only the convention-directory and built-in cases (the common ones; every
//! `examples/*` deck in the peitho repo uses one of these two).

use std::path::{Path, PathBuf};

use peitho_core::highlight::Highlighter;
use peitho_core::{parse_layout, CssFile, Layouts};

use super::builtin;
use super::default_highlighter;

/// `Highlighter` has no `Clone` impl, so a deck with no custom `syntaxes/`
/// borrows the one shared, lazily-built-once instance (`default_highlighter`)
/// instead of paying for another `Highlighter::defaults()` call (itself
/// cheap once warm, but not free — it re-clones the cached `SyntaxSet`).
pub enum DeckHighlighter {
    Shared(&'static Highlighter),
    Custom(Highlighter),
}

impl DeckHighlighter {
    pub fn get(&self) -> &Highlighter {
        match self {
            Self::Shared(h) => h,
            Self::Custom(h) => h,
        }
    }
}

pub struct ResolvedAssets {
    pub layouts: Layouts,
    pub css: Vec<CssFile>,
    pub highlighter: DeckHighlighter,
    /// Present only when the deck has its own `fonts/` directory — served
    /// alongside the built-in theme/KaTeX fonts (see `engine::serve`).
    pub fonts_dir: Option<PathBuf>,
}

fn collect_files(dir: &Path, ext: &str) -> Result<Vec<PathBuf>, String> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|err| format!("failed to read {}: {err}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|e| e.to_str()) == Some(ext))
        .collect();
    files.sort();
    Ok(files)
}

pub fn resolve(deck_dir: &Path) -> Result<ResolvedAssets, String> {
    let layouts_dir = deck_dir.join("layouts");
    let layouts = if layouts_dir.is_dir() {
        let mut layouts = Vec::new();
        for file in collect_files(&layouts_dir, "html")? {
            let name = file
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("layout")
                .to_string();
            let html = std::fs::read_to_string(&file).map_err(|err| err.to_string())?;
            layouts.push(parse_layout(&name, &html).map_err(|err| err.to_string())?);
        }
        Layouts::new(layouts).map_err(|err| err.to_string())?
    } else {
        let layout = parse_layout("title-body-code", builtin::LAYOUT_HTML).map_err(|err| err.to_string())?;
        Layouts::new(vec![layout]).map_err(|err| err.to_string())?
    };

    let css_dir = deck_dir.join("css");
    let css = if css_dir.is_dir() {
        let mut files = Vec::new();
        for file in collect_files(&css_dir, "css")? {
            let name = file
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| file.display().to_string());
            files.push(CssFile { name, content: std::fs::read_to_string(&file).map_err(|err| err.to_string())? });
        }
        files
    } else {
        vec![CssFile { name: "base.css (built-in)".to_string(), content: builtin::BASE_CSS.to_string() }]
    };

    let syntaxes_dir = deck_dir.join("syntaxes");
    let highlighter = if syntaxes_dir.is_dir() {
        let files = collect_files(&syntaxes_dir, "sublime-syntax")?;
        DeckHighlighter::Custom(Highlighter::with_user_files(&files).map_err(|err| err.to_string())?)
    } else {
        DeckHighlighter::Shared(default_highlighter())
    };

    let fonts_dir = deck_dir.join("fonts");
    let fonts_dir = fonts_dir.is_dir().then_some(fonts_dir);

    Ok(ResolvedAssets { layouts, css, highlighter, fonts_dir })
}
