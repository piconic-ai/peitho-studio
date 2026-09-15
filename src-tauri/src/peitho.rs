// Session/process management + Tauri commands. Rendering itself is
// in-process now (see `crate::engine`) — this module owns each open
// window's deck file path, its external-edit watcher, the in-process asset
// server, and the `peitho present` subprocess (Present still shells out to
// the real CLI; it's a one-shot fullscreen launch, not on any hot path).
//
// Sessions are keyed by window label rather than being a single global
// slot: opening a deck in a new window (see `open_deck_window`) must not
// disturb whichever deck another already-open window is showing — a user
// comparing two decks side by side is the whole point of that feature.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::deck_variants;
use crate::engine::builtin;
use crate::engine::layout_fit::{self, LayoutVerdict};
use crate::engine::pipeline::{self, RenderOutput};
use crate::engine::serve::AssetServer;

/// Event name the frontend listens for (see Studio.tsx) to reload the deck
/// after it changes on disk — from an external editor, an AI agent, `git
/// checkout`, anything other than this app's own `save_deck_source`.
const DECK_FILE_CHANGED_EVENT: &str = "deck-file-changed";

/// Event name the frontend listens for (see Studio.tsx's `handlePresent`)
/// once the `peitho present` subprocess has actually rendered the deck and
/// started serving it — see `watch_present_readiness` for where this fires.
const PRESENT_READY_EVENT: &str = "present-ready";

/// The line `peitho present` (see `crates/peitho/src/main.rs` in the
/// `peitho` repo) prints to stdout right after the deck finishes rendering
/// and its local server starts, just before it launches the presentation
/// browser windows — the closest thing this process has to "the click
/// actually did something," since `present_deck` returning only means
/// `spawn()` succeeded, well before rendering even starts. Exact prefix
/// match rather than a full line comparison since the line also carries the
/// server URL.
fn is_present_ready_line(line: &str) -> bool {
    line.starts_with("serving presentation at ")
}

/// Runs for the child's whole lifetime (not just until the readiness line
/// appears) so a full stdout pipe buffer can never block the child from
/// writing further output once we've stopped caring about individual
/// lines. `None` (stdout wasn't piped) is a silent no-op.
fn watch_present_readiness(stdout: Option<ChildStdout>, window: WebviewWindow) {
    let Some(stdout) = stdout else { return };
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut emitted = false;
        for line in reader.lines().map_while(Result::ok) {
            if !emitted && is_present_ready_line(&line) {
                let _ = window.emit(PRESENT_READY_EVENT, ());
                emitted = true;
            }
        }
    });
}

/// Live session state for every open window with a deck loaded, keyed by
/// that window's label. Absent entries mean "no deck open in this window"
/// (the welcome screen).
#[derive(Default)]
pub struct PeithoSession(Mutex<HashMap<String, SessionState>>);

struct SessionState {
    deck_path: PathBuf,
    deck_dir: PathBuf,
    asset_server: AssetServer,
    present_child: Option<Child>,
    // Held only to keep the watch alive — dropping it (e.g. when a window
    // closes and its whole session entry is removed) stops the background
    // thread below.
    _watcher: RecommendedWatcher,
}

impl PeithoSession {
    /// Kills every subprocess every session owns. Called on app exit so a
    /// quit doesn't leave `peitho present` running headless.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.0.lock() {
            for (_, mut session) in guard.drain() {
                if let Some(mut present) = session.present_child.take() {
                    let _ = present.kill();
                }
            }
        }
    }

    /// Drops one window's session (its watcher thread and asset server
    /// stop with it). Called when that window closes.
    pub fn remove(&self, label: &str) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut session) = guard.remove(label) {
                if let Some(mut present) = session.present_child.take() {
                    let _ = present.kill();
                }
            }
        }
    }

    /// The label of a window that already has `target` open, if any — see
    /// `matching_window_label`. `open_deck_window` uses this to bring an
    /// already-open deck's window to the front instead of opening a
    /// redundant second copy of it.
    pub fn window_label_for(&self, target: &Path) -> Option<String> {
        let guard = self.0.lock().ok()?;
        matching_window_label(guard.iter().map(|(label, state)| (label.as_str(), state.deck_path.as_path())), target)
    }
}

/// The label paired with `target`'s path, if any of `open_decks` matches
/// it — compared by canonical path (falling back to the path as given
/// when canonicalizing fails, e.g. it no longer exists) so a relative
/// argument, a differently-cased mount point, or a symlink doesn't hide a
/// deck that actually is already open, and a path that merely looks
/// similar as text doesn't falsely match one that isn't. State-
/// independent (plain label/path pairs, no `PeithoSession` lock) so it's
/// unit-testable on its own — see `PeithoSession::window_label_for` for
/// the version that actually reads live sessions.
fn matching_window_label<'a>(mut open_decks: impl Iterator<Item = (&'a str, &'a Path)>, target: &Path) -> Option<String> {
    let canonical_target = std::fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());
    open_decks
        .find(|(_, path)| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()) == canonical_target)
        .map(|(label, _)| label.to_string())
}

/// A `path` argument normalized just enough to compare against an open
/// window's own (already-resolved) `deck_path` — the same directory-to-
/// `deck.md` join `resolve_deck_path` does, but this never fails when the
/// result doesn't exist (unlike that function): a path that doesn't
/// exist can't be the same file as anything already open either, so
/// there's nothing to gain by rejecting it before the comparison — a
/// genuinely new window still goes through the real, failing
/// `resolve_deck_path` once it mounts and calls `open_deck`, exactly as
/// before this comparison was added.
fn deck_path_for_comparison(input: &str) -> PathBuf {
    let path = PathBuf::from(input);
    if path.is_dir() { path.join("deck.md") } else { path }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPayload {
    /// Exactly `peitho_core::manifest_json`'s output, parsed — the frontend's
    /// `Manifest`/`ManifestSlide`/`ManifestSection` types are unchanged from
    /// when this was fetched over HTTP from `peitho preview`.
    manifest: serde_json::Value,
    /// Rendered fragment HTML per slide key.
    fragments: std::collections::HashMap<String, String>,
    /// Base URL for the in-process asset server (peitho.css, fonts, images)
    /// — resolves relative `url(...)`/`src="assets/..."` references inside
    /// `css`/`fragments`.
    asset_base_url: String,
    /// Duplicates the `peitho.css` the asset server already serves —
    /// carried in the payload so a slide can be rendered into a scoped
    /// style sheet (Shadow DOM) without a second round trip to fetch it.
    css: String,
}

fn to_payload(output: RenderOutput, asset_base_url: String) -> Result<RenderPayload, String> {
    let manifest = serde_json::from_str(&output.manifest_json).map_err(|err| err.to_string())?;
    Ok(RenderPayload { manifest, fragments: output.fragments, asset_base_url, css: output.css })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckSessionInfo {
    deck_path: String,
    deck_dir: String,
    render: RenderPayload,
}

/// Resolve the `peitho` binary — still needed for `present_deck`. GUI apps
/// launched from Finder (as opposed to a dev shell) often start with a PATH
/// that omits Homebrew's prefix, so PATH lookup is tried first and a couple
/// of known install locations are tried as a fallback rather than failing
/// outright.
fn peitho_binary() -> PathBuf {
    for candidate in ["peitho", "/opt/homebrew/bin/peitho", "/usr/local/bin/peitho"] {
        let path = Path::new(candidate);
        let found = if path.is_absolute() {
            path.exists()
        } else {
            Command::new(candidate)
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
        };
        if found {
            return PathBuf::from(candidate);
        }
    }
    PathBuf::from("peitho")
}

/// A directory argument is resolved to `<dir>/deck.md`; a file argument is
/// used as-is. This mirrors what a user picking a folder in the "Open"
/// dialog expects, while still allowing a direct deck.md pick.
fn resolve_deck_path(input: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(input);
    let resolved = if path.is_dir() { path.join("deck.md") } else { path };
    if !resolved.is_file() {
        return Err(format!("deck file not found: {}", resolved.display()));
    }
    Ok(resolved)
}

/// Dev convenience: when `PEITHO_STUDIO_DEV_DECK` is set, the frontend
/// auto-opens that deck on launch instead of waiting for a folder pick — no
/// native dialog interaction required. No effect when unset. Only consulted
/// by a window with no pending deck of its own (see `take_pending_deck`) —
/// a window opened via `open_deck_window` always wins that race with its
/// own explicit path.
#[tauri::command]
pub fn dev_default_deck() -> Option<String> {
    std::env::var("PEITHO_STUDIO_DEV_DECK").ok()
}

const STARTER_DECK: &str = "---\ntime: 1m\n---\n\
<!-- {\"key\":\"cover\",\"section\":\"Intro\",\"time\":\"1m\"} -->\n\
# New Presentation\n\n\
Start writing your slides here.\n";

/// Mirrors the header `peitho new` prepends to its scaffolded
/// `css/base.css` (see `crates/peitho/src/new_cmd.rs::BASE_CSS_HEADER` in
/// the peitho repo) — explains why the file exists before the copied
/// built-in rules.
const BASE_CSS_HEADER: &str = "/*\n  This file replaces peitho's embedded themes/base.css for this deck.\n  Edit it as your deck's complete theme.\n*/\n\n";

/// `name` becomes a directory name picked by the user in a plain text
/// field, not a path — rejected outright if it could act like one, rather
/// than trying to sanitize it into something safe. Split out of
/// `create_deck` as its own pure function so the validation rules are
/// unit-testable without touching the filesystem.
fn validate_deck_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("deck name cannot be empty".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed == "." || trimmed == ".." {
        return Err("deck name can't contain a path separator".to_string());
    }
    Ok(trimmed)
}

/// The file set `create_deck` writes into a freshly created deck
/// directory — the same shape as `peitho new`'s default scaffold
/// (default layout, light theme): a starter `deck.md` plus its own
/// `layouts/`/`css/base.css` to customize instead of silently depending
/// on peitho-core's built-in fallback, and a `.gitignore` for the
/// directories `peitho build`/`preview`/`present` write into. Split out
/// of `create_deck` as its own pure function so the scaffold's shape is
/// unit-testable without touching the filesystem.
fn scaffold_deck_files() -> Vec<(&'static str, String)> {
    vec![
        ("deck.md", STARTER_DECK.to_string()),
        ("layouts/title-body-code.html", builtin::LAYOUT_HTML.to_string()),
        ("css/base.css", format!("{BASE_CSS_HEADER}{}", builtin::BASE_CSS)),
        (".gitignore", builtin::GITIGNORE.to_string()),
    ]
}

/// Creates `<parent_dir>/<name>` scaffolded the way `peitho new` would
/// (see `scaffold_deck_files`) and returns the new `deck.md`'s path (for
/// the frontend to hand straight to `open_deck_window`).
#[tauri::command]
pub fn create_deck(parent_dir: String, name: String) -> Result<String, String> {
    let trimmed = validate_deck_name(&name)?;
    let dir = PathBuf::from(&parent_dir).join(trimmed);
    if dir.exists() {
        return Err(format!("{} already exists", dir.display()));
    }
    std::fs::create_dir_all(&dir).map_err(|err| format!("failed to create {}: {err}", dir.display()))?;

    for (relative_path, content) in scaffold_deck_files() {
        let path = dir.join(relative_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| format!("failed to create {}: {err}", parent.display()))?;
        }
        std::fs::write(&path, content).map_err(|err| format!("failed to write {}: {err}", path.display()))?;
    }

    Ok(dir.join("deck.md").display().to_string())
}

/// Windows spawned by `open_deck_window`, keyed by their (not-yet-loaded)
/// label, holding the deck path that window should open once its frontend
/// mounts and calls `take_pending_deck` — the hand-off that lets a brand
/// new webview know which deck it's for without a URL query string.
#[derive(Default)]
pub struct PendingDecks(Mutex<HashMap<String, String>>);

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Each new window cascades a step further than the last (wrapping after
/// `WINDOW_CASCADE_STEPS`), so a freshly opened window is visibly offset
/// from whichever one was already on top of it — otherwise a second deck
/// opening exactly on top of the first looks like nothing happened at
/// all. Not specific to the deck-language-variant switcher this constant
/// was added for — it's every caller of `open_deck_window` (native "Open
/// Deck…"/"Open Recent" too), since they all funnel through the same
/// `open_deck_window_impl`.
const WINDOW_CASCADE_STEP_PX: f64 = 32.0;
const WINDOW_CASCADE_STEPS: u32 = 8;
const WINDOW_BASE_POSITION: (f64, f64) = (120.0, 120.0);

/// Opens `path` in a brand new window, leaving whichever window this was
/// called from untouched — comparing two decks side by side means neither
/// one can be silently replaced by the other. If that deck is already
/// open in some other window, that window is brought to the front
/// instead of opening a redundant second copy of it, matching how
/// re-opening a file already open elsewhere is expected to behave.
#[tauri::command]
pub fn open_deck_window(app: AppHandle, pending: State<PendingDecks>, session: State<PeithoSession>, path: String) -> Result<(), String> {
    open_deck_window_impl(&app, &pending, &session, path)
}

pub(crate) fn open_deck_window_impl(app: &AppHandle, pending: &PendingDecks, session: &PeithoSession, path: String) -> Result<(), String> {
    if let Some(label) = session.window_label_for(&deck_path_for_comparison(&path)) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            let _ = window.set_focus();
            return Ok(());
        }
    }

    let counter = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("deck-{counter}");
    {
        let mut guard = pending.0.lock().map_err(|_| "pending-decks lock poisoned".to_string())?;
        guard.insert(label.clone(), path);
    }
    let step = f64::from(counter % WINDOW_CASCADE_STEPS);
    let (base_x, base_y) = WINDOW_BASE_POSITION;
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .title("Peitho Studio")
        .inner_size(1440.0, 900.0)
        .position(base_x + step * WINDOW_CASCADE_STEP_PX, base_y + step * WINDOW_CASCADE_STEP_PX)
        .resizable(true)
        .build()
        .map_err(|err| err.to_string())?;
    Ok(())
}

/// Called once by a newly created window's frontend on mount. Consumes
/// (removes) this window's pending deck path so a later call — there
/// shouldn't be one, but nothing round-trips through this twice — doesn't
/// re-open it.
#[tauri::command]
pub fn take_pending_deck(window: WebviewWindow, pending: State<PendingDecks>) -> Option<String> {
    let mut guard = pending.0.lock().ok()?;
    guard.remove(window.label())
}

const MAX_RECENT_DECKS: usize = 8;

fn recent_decks_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("failed to create {}: {err}", dir.display()))?;
    Ok(dir.join("recent_decks.json"))
}

/// The persisted recent-deck list is the single source of truth for both
/// the welcome screen's "Recent" section and the native File > Recent
/// submenu — keeping it in one Rust-side file, rather than mirroring it
/// into each window's own `localStorage`, is what lets a deck opened from
/// the native menu (which never touches any window's webview) still show
/// up for every window's own UI.
///
/// Drops (and re-persists without) any entry whose file no longer exists —
/// moved or deleted since it was remembered. Without this, a stale entry
/// sits in both the welcome screen's Recent list and the native "Open
/// Recent" submenu until clicked, at which point `open_deck` fails with a
/// raw "deck file not found" error instead of the entry simply not being
/// offered. Every caller (the `get_recent_decks` command, `build_menu`'s
/// submenu, and `recent_deck:<index>` click resolution in `on_menu_event`)
/// goes through this, so the menu's items and their indices always match
/// what's actually left after pruning.
pub(crate) fn read_recent_decks(app: &AppHandle) -> Vec<String> {
    let Ok(path) = recent_decks_path(app) else { return Vec::new() };
    let Ok(content) = std::fs::read_to_string(&path) else { return Vec::new() };
    let recents: Vec<String> = serde_json::from_str(&content).unwrap_or_default();
    let pruned: Vec<String> = recents.iter().filter(|p| Path::new(p).is_file()).cloned().collect();
    if pruned.len() != recents.len() {
        if let Ok(json) = serde_json::to_string(&pruned) {
            let _ = std::fs::write(&path, json);
        }
    }
    pruned
}

fn remember_recent_deck(app: &AppHandle, deck_path: &str) {
    let mut recents = read_recent_decks(app);
    recents.retain(|p| p != deck_path);
    recents.insert(0, deck_path.to_string());
    recents.truncate(MAX_RECENT_DECKS);
    if let Ok(path) = recent_decks_path(app) {
        if let Ok(json) = serde_json::to_string(&recents) {
            let _ = std::fs::write(&path, json);
        }
    }
    // The native menu's Recent submenu is only ever rebuilt here — the one
    // place the list actually changes.
    if let Ok(menu) = crate::build_menu(app) {
        let _ = app.set_menu(menu);
    }
}

#[tauri::command]
pub fn get_recent_decks(app: AppHandle) -> Vec<String> {
    read_recent_decks(&app)
}

/// Watches `deck_path` for changes and emits `DECK_FILE_CHANGED_EVENT`
/// (to this window only — each window watches only its own deck) once per
/// burst of filesystem activity. Editors commonly touch a file more than
/// once for a single logical save (e.g. write-to-temp-then-rename), so raw
/// events are drained through a short quiet window on a background thread
/// rather than forwarded one-for-one.
fn watch_deck_file(window: WebviewWindow, deck_path: &Path) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })?;
    watcher.watch(deck_path, RecursiveMode::NonRecursive)?;

    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(Duration::from_millis(250)).is_ok() {}
            let _ = window.emit(DECK_FILE_CHANGED_EVENT, ());
        }
    });

    Ok(watcher)
}

// `async`: a plain command runs on the UI thread, and the first render after
// launch takes seconds, during which the window can't repaint at all.
// `render_draft` stays sync on purpose — it updates the shared `AssetServer`,
// so concurrent runs could leave an older render being served.
#[tauri::command(async)]
pub fn open_deck(
    path: String,
    app: AppHandle,
    window: WebviewWindow,
    session: State<PeithoSession>,
) -> Result<DeckSessionInfo, String> {
    let deck_path = resolve_deck_path(&path)?;
    let deck_dir = deck_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let source = std::fs::read_to_string(&deck_path).map_err(|err| err.to_string())?;
    let output = pipeline::render_source(&deck_path, &source)?;

    let asset_server = AssetServer::start().map_err(|err| err.to_string())?;
    asset_server.update(&output);
    let asset_base_url = asset_server.base_url.clone();
    let render = to_payload(output, asset_base_url)?;

    let watcher = watch_deck_file(window.clone(), &deck_path)
        .map_err(|err| format!("failed to watch {}: {err}", deck_path.display()))?;

    let info = DeckSessionInfo {
        deck_path: deck_path.display().to_string(),
        deck_dir: deck_dir.display().to_string(),
        render,
    };

    {
        let mut guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
        if let Some(mut previous) = guard.remove(window.label()) {
            if let Some(mut present) = previous.present_child.take() {
                let _ = present.kill();
            }
        }
        guard.insert(
            window.label().to_string(),
            SessionState { deck_path, deck_dir, asset_server, present_child: None, _watcher: watcher },
        );
    }

    remember_recent_deck(&app, &info.deck_path);

    Ok(info)
}

/// Renders `content` as if it were the deck at the currently open path,
/// without touching disk — the live-typing path. Same pipeline as
/// `open_deck`/a real `peitho build`, just fed an in-memory string, so a
/// draft too broken to build cleanly surfaces as an `Err` here rather than
/// ever reaching disk.
#[tauri::command]
pub fn render_draft(content: String, window: WebviewWindow, session: State<PeithoSession>) -> Result<RenderPayload, String> {
    let (deck_path, asset_base_url) = {
        let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
        let state = guard.get(window.label()).ok_or_else(|| "no deck is open".to_string())?;
        (state.deck_path.clone(), state.asset_server.base_url.clone())
    };
    let output = pipeline::render_source(&deck_path, &content)?;
    {
        let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
        if let Some(state) = guard.get(window.label()) {
            state.asset_server.update(&output);
        }
    }
    to_payload(output, asset_base_url)
}

#[tauri::command]
pub fn read_deck_source(window: WebviewWindow, session: State<PeithoSession>) -> Result<String, String> {
    let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
    let state = guard.get(window.label()).ok_or_else(|| "no deck is open".to_string())?;
    std::fs::read_to_string(&state.deck_path).map_err(|err| err.to_string())
}

/// Plain write — no waiting, no rebuild-on-write: `render_draft` already
/// rendered (and the frontend already reflected) this exact content before
/// this is called. Disk is now just where it's persisted, not a step on the
/// preview's critical path.
#[tauri::command]
pub fn save_deck_source(content: String, window: WebviewWindow, session: State<PeithoSession>) -> Result<(), String> {
    let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
    let state = guard.get(window.label()).ok_or_else(|| "no deck is open".to_string())?;
    std::fs::write(&state.deck_path, content).map_err(|err| err.to_string())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeckVariantPayload {
    /// Full path, ready to hand to `open_deck_window`.
    path: String,
    file_name: String,
    suffix: Option<String>,
    is_current: bool,
}

/// The on-disk half of `list_deck_variants`, split out so it's testable
/// against a temp directory without a Tauri window/session. Only regular
/// files (symlinks followed) count as siblings, and a name that isn't
/// valid UTF-8 is skipped rather than failing the whole listing. Names are
/// grouped first, so only the few same-base candidates get stat'ed — not
/// every image/asset sharing the deck's folder.
fn deck_variants_on_disk(deck_path: &Path) -> Result<Vec<DeckVariantPayload>, String> {
    let current = deck_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("deck path has no file name: {}", deck_path.display()))?;
    // `Path::new("deck.md").parent()` is `Some("")`, which `read_dir` rejects.
    let dir = deck_path.parent().filter(|dir| !dir.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let sibling_names: Vec<String> = std::fs::read_dir(dir)
        .map_err(|err| format!("failed to read {}: {err}", dir.display()))?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    Ok(deck_variants::group_deck_variants(current, &sibling_names)
        .into_iter()
        .map(|variant| (deck_path.with_file_name(&variant.file_name), variant))
        .filter(|(path, variant)| variant.is_current || path.is_file())
        .map(|(path, variant)| DeckVariantPayload {
            path: path.display().to_string(),
            file_name: variant.file_name,
            suffix: variant.suffix,
            is_current: variant.is_current,
        })
        .collect())
}

/// Sibling decks sharing the open deck's base name (`deck.md`,
/// `deck.ja.md`, ...) — see `crate::deck_variants` for the grouping rules.
/// Includes the open deck itself, so a result of one or fewer entries means
/// there's nothing to switch to. `async` since listing a directory (e.g. on
/// a network volume) isn't guaranteed fast, and nothing here touches shared
/// state beyond reading the session's path.
#[tauri::command(async)]
pub fn list_deck_variants(window: WebviewWindow, session: State<PeithoSession>) -> Result<Vec<DeckVariantPayload>, String> {
    let deck_path = {
        let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
        let state = guard.get(window.label()).ok_or_else(|| "no deck is open".to_string())?;
        state.deck_path.clone()
    };
    deck_variants_on_disk(&deck_path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPreview {
    name: String,
    /// Rendered HTML for that layout filled with placeholder content, or
    /// empty if it couldn't be rendered generically (still selectable —
    /// the frontend just shows a name-only card for it).
    fragment: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPreviewsPayload {
    previews: Vec<LayoutPreview>,
    css: String,
}

/// Renders every layout available to the currently open deck (built-in, or
/// its own `layouts/` directory) with generic placeholder content, for the
/// thumbnail context menu's "Change Layout" picker grid. Each layout is
/// rendered as its own tiny one-slide deck via the normal pipeline — same
/// as a real slide explicitly pinning `"layout"` in its PageComment, just
/// with throwaway content instead of the user's own.
///
/// Deliberately does *not* go through `render_draft`/its shared
/// `AssetServer`: that server holds the one currently-served `peitho.css`
/// and image set for the live deck, and overwriting it with this preview
/// render's own (built from throwaway content, and thus reflecting only
/// whichever CSS slot classes *that* content happens to use) would corrupt
/// the real deck's on-screen rendering until the next real edit. The CSS
/// returned here is only ever adopted directly by the picker's own
/// preview canvases, never served.
#[tauri::command]
pub fn preview_layouts(window: WebviewWindow, session: State<PeithoSession>) -> Result<LayoutPreviewsPayload, String> {
    let (deck_path, deck_dir) = {
        let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
        let state = guard.get(window.label()).ok_or_else(|| "no deck is open".to_string())?;
        (state.deck_path.clone(), state.deck_dir.clone())
    };
    let resolved = crate::engine::assets::resolve(&deck_dir)?;
    let mut previews = Vec::new();
    let mut css = String::new();
    for name in resolved.layouts.names() {
        let synthetic = format!(
            "<!-- {{\"key\":\"preview\",\"layout\":\"{name}\"}} -->\n# Placeholder title\n\nPlaceholder body copy.\n\n- First point\n- Second point"
        );
        let fragment = pipeline::render_source(&deck_path, &synthetic)
            .ok()
            .and_then(|output| {
                if css.is_empty() {
                    css = output.css.clone();
                }
                output.fragments.get("preview").cloned()
            })
            .unwrap_or_default();
        previews.push(LayoutPreview { name: name.to_string(), fragment });
    }
    Ok(LayoutPreviewsPayload { previews, css })
}

/// Which layouts the slide at `slide_index` of `content` (the deck source
/// as the frontend currently has it, unsaved edits included) fits — for the
/// "Change Layout" picker to mark the rest before one is chosen. See
/// `engine::layout_fit`. `async` like `open_deck`: it parses the whole deck,
/// highlighting every code block, and unlike `render_draft` it touches no
/// shared state, so it can run off the UI thread.
#[tauri::command(async)]
pub fn check_slide_layouts(
    content: String,
    slide_index: usize,
    window: WebviewWindow,
    session: State<PeithoSession>,
) -> Result<Option<Vec<LayoutVerdict>>, String> {
    let deck_path = {
        let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
        let state = guard.get(window.label()).ok_or_else(|| "no deck is open".to_string())?;
        state.deck_path.clone()
    };
    layout_fit::check_slide_layouts(&deck_path, &content, slide_index)
}

#[tauri::command]
pub fn present_deck(rehearsal: bool, window: WebviewWindow, session: State<PeithoSession>) -> Result<(), String> {
    let mut guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
    let state = guard.get_mut(window.label()).ok_or_else(|| "no deck is open".to_string())?;

    if let Some(mut previous) = state.present_child.take() {
        let _ = previous.kill();
    }

    let deck_file_name = state
        .deck_path
        .file_name()
        .ok_or_else(|| "deck path has no file name".to_string())?;

    let mut command = Command::new(peitho_binary());
    command.arg("present").arg(deck_file_name).current_dir(&state.deck_dir);
    if rehearsal {
        command.arg("--rehearsal");
    }

    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("failed to launch `peitho present`: {err}"))?;

    // This command returning `Ok` only means the OS accepted the `spawn()`
    // call — near-instant regardless of deck size, well before the child
    // has actually rendered anything. Watching for its own readiness line
    // instead (see `watch_present_readiness`) gives the frontend a signal
    // that tracks the part that's actually slow for a heavy deck.
    watch_present_readiness(child.stdout.take(), window);

    state.present_child = Some(child);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_present_ready_line_spec_matches_the_real_prefix_with_a_url_suffix() {
        assert!(is_present_ready_line("serving presentation at http://127.0.0.1:4317/present.html"));
    }

    #[test]
    fn is_present_ready_line_adversarial_rejects_unrelated_or_partial_lines() {
        assert!(!is_present_ready_line(""));
        assert!(!is_present_ready_line("generated present cache at .peitho-present-cache"));
        assert!(!is_present_ready_line("recording rehearsal to .peitho-rehearsals/"));
        // Case-sensitive, and no match on a mere substring occurring mid-line.
        assert!(!is_present_ready_line("Serving presentation at http://x"));
        assert!(!is_present_ready_line("now serving presentation at http://x"));
    }

    #[test]
    fn validate_deck_name_spec_trims_surrounding_whitespace() {
        assert_eq!(validate_deck_name("  my-talk  ").unwrap(), "my-talk");
    }

    #[test]
    fn validate_deck_name_adversarial_rejects_empty_and_whitespace_only() {
        assert!(validate_deck_name("").is_err());
        assert!(validate_deck_name("   ").is_err());
    }

    #[test]
    fn validate_deck_name_adversarial_rejects_path_separators() {
        assert!(validate_deck_name("a/b").is_err());
        assert!(validate_deck_name("a\\b").is_err());
    }

    #[test]
    fn validate_deck_name_adversarial_rejects_dot_and_dotdot() {
        assert!(validate_deck_name(".").is_err());
        assert!(validate_deck_name("..").is_err());
        assert!(validate_deck_name(" .. ").is_err());
    }

    #[test]
    fn validate_deck_name_spec_allows_dots_within_a_longer_name() {
        // Only a name that is *exactly* "." or ".." after trimming is
        // rejected — "v1.2" legitimately contains a dot.
        assert_eq!(validate_deck_name("v1.2").unwrap(), "v1.2");
    }

    #[test]
    fn scaffold_deck_files_spec_matches_peitho_news_default_scaffold_shape() {
        let files = scaffold_deck_files();
        let paths: Vec<&str> = files.iter().map(|(path, _)| *path).collect();
        assert_eq!(
            paths,
            vec!["deck.md", "layouts/title-body-code.html", "css/base.css", ".gitignore"]
        );

        let base_css = &files.iter().find(|(path, _)| *path == "css/base.css").unwrap().1;
        assert!(base_css.starts_with(BASE_CSS_HEADER));
        assert!(base_css.contains(builtin::BASE_CSS));

        let layout = &files.iter().find(|(path, _)| *path == "layouts/title-body-code.html").unwrap().1;
        assert_eq!(layout, builtin::LAYOUT_HTML);

        let gitignore = &files.iter().find(|(path, _)| *path == ".gitignore").unwrap().1;
        assert_eq!(gitignore, builtin::GITIGNORE);
    }

    #[test]
    fn scaffold_deck_files_adversarial_every_file_has_nonempty_content() {
        for (path, content) in scaffold_deck_files() {
            assert!(!content.is_empty(), "{path} scaffolded with empty content");
        }
    }

    #[test]
    fn create_deck_spec_writes_the_full_scaffold_and_returns_the_deck_md_path() {
        let parent = tempfile::tempdir().unwrap();
        let deck_path = create_deck(parent.path().to_str().unwrap().to_string(), "my-talk".to_string()).unwrap();

        let dir = parent.path().join("my-talk");
        assert_eq!(deck_path, dir.join("deck.md").display().to_string());
        assert!(dir.join("deck.md").is_file());
        assert!(dir.join("layouts/title-body-code.html").is_file());
        assert!(dir.join("css/base.css").is_file());
        assert!(dir.join(".gitignore").is_file());
    }

    #[test]
    fn create_deck_adversarial_refuses_to_overwrite_an_existing_directory() {
        let parent = tempfile::tempdir().unwrap();
        std::fs::create_dir(parent.path().join("my-talk")).unwrap();

        let err = create_deck(parent.path().to_str().unwrap().to_string(), "my-talk".to_string()).unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn resolve_deck_path_spec_appends_deck_md_for_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("deck.md"), "# Hi").unwrap();
        let resolved = resolve_deck_path(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(resolved, dir.path().join("deck.md"));
    }

    #[test]
    fn resolve_deck_path_spec_accepts_a_direct_file_path() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("custom-name.md");
        std::fs::write(&file, "# Hi").unwrap();
        let resolved = resolve_deck_path(file.to_str().unwrap()).unwrap();
        assert_eq!(resolved, file);
    }

    #[test]
    fn resolve_deck_path_adversarial_missing_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(resolve_deck_path(dir.path().to_str().unwrap()).is_err());
    }

    #[test]
    fn resolve_deck_path_adversarial_nonexistent_path_is_an_error() {
        assert!(resolve_deck_path("/definitely/does/not/exist/deck.md").is_err());
    }

    #[test]
    fn deck_path_for_comparison_spec_joins_deck_md_for_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(deck_path_for_comparison(dir.path().to_str().unwrap()), dir.path().join("deck.md"));
    }

    #[test]
    fn deck_path_for_comparison_spec_leaves_a_file_path_as_is() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("custom-name.md");
        std::fs::write(&file, "# Hi").unwrap();
        assert_eq!(deck_path_for_comparison(file.to_str().unwrap()), file);
    }

    #[test]
    fn deck_path_for_comparison_adversarial_a_path_that_does_not_exist_is_never_rejected() {
        // Unlike `resolve_deck_path`, this never fails — a nonexistent
        // path can't match anything already open, but it also can't
        // crash the comparison that's about to check that.
        assert_eq!(deck_path_for_comparison("/definitely/does/not/exist/deck.md"), PathBuf::from("/definitely/does/not/exist/deck.md"));
    }

    #[test]
    fn matching_window_label_spec_finds_the_label_whose_deck_path_is_the_same_file() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        std::fs::write(&deck_path, "# Hi").unwrap();
        let open_decks = [("deck-0", deck_path.as_path())];
        assert_eq!(matching_window_label(open_decks.into_iter(), &deck_path), Some("deck-0".to_string()));
    }

    #[test]
    fn matching_window_label_spec_matches_through_a_symlink_to_the_same_file() {
        let dir = tempfile::tempdir().unwrap();
        let real_path = dir.path().join("deck.md");
        std::fs::write(&real_path, "# Hi").unwrap();
        let symlink_path = dir.path().join("alias.md");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real_path, &symlink_path).unwrap();
        #[cfg(not(unix))]
        std::os::windows::fs::symlink_file(&real_path, &symlink_path).unwrap();
        let open_decks = [("deck-0", real_path.as_path())];
        assert_eq!(matching_window_label(open_decks.into_iter(), &symlink_path), Some("deck-0".to_string()));
    }

    #[test]
    fn matching_window_label_adversarial_no_open_decks_is_none() {
        assert_eq!(matching_window_label(std::iter::empty(), Path::new("/tmp/deck.md")), None);
    }

    #[test]
    fn matching_window_label_adversarial_similar_looking_but_different_files_do_not_match() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("deck.md");
        let b = dir.path().join("deck-old.md");
        std::fs::write(&a, "# A").unwrap();
        std::fs::write(&b, "# B").unwrap();
        let open_decks = [("deck-0", a.as_path())];
        assert_eq!(matching_window_label(open_decks.into_iter(), &b), None);
    }

    #[test]
    fn matching_window_label_adversarial_a_path_that_no_longer_exists_still_compares_by_text() {
        // Neither side can be canonicalized, so the fallback (compare the
        // path as given) still has to work rather than panic.
        let gone = Path::new("/definitely/does/not/exist/deck.md");
        let open_decks = [("deck-0", gone)];
        assert_eq!(matching_window_label(open_decks.into_iter(), gone), Some("deck-0".to_string()));
    }

    fn variant_file_names(variants: &[DeckVariantPayload]) -> Vec<&str> {
        variants.iter().map(|v| v.file_name.as_str()).collect()
    }

    #[test]
    fn deck_variants_on_disk_spec_lists_same_base_decks_with_full_paths() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["deck.md", "deck.ja.md", "deck-old.md", "notes.txt"] {
            std::fs::write(dir.path().join(name), "# Hi").unwrap();
        }
        let variants = deck_variants_on_disk(&dir.path().join("deck.ja.md")).unwrap();
        assert_eq!(
            variants,
            vec![
                DeckVariantPayload {
                    path: dir.path().join("deck.md").display().to_string(),
                    file_name: "deck.md".into(),
                    suffix: None,
                    is_current: false,
                },
                DeckVariantPayload {
                    path: dir.path().join("deck.ja.md").display().to_string(),
                    file_name: "deck.ja.md".into(),
                    suffix: Some("ja".into()),
                    is_current: true,
                },
            ]
        );
    }

    #[test]
    fn deck_variants_on_disk_adversarial_a_directory_named_like_a_variant_is_not_a_deck() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("deck.md"), "# Hi").unwrap();
        std::fs::create_dir(dir.path().join("deck.ja.md")).unwrap();
        let variants = deck_variants_on_disk(&dir.path().join("deck.md")).unwrap();
        assert_eq!(variant_file_names(&variants), vec!["deck.md"]);
    }

    #[test]
    fn deck_variants_on_disk_adversarial_missing_directory_is_an_error() {
        assert!(deck_variants_on_disk(Path::new("/definitely/does/not/exist/deck.md")).is_err());
    }

    #[test]
    fn deck_variants_on_disk_adversarial_path_without_a_file_name_is_an_error() {
        assert!(deck_variants_on_disk(Path::new("/")).is_err());
        assert!(deck_variants_on_disk(Path::new("")).is_err());
    }

    #[test]
    fn deck_variant_payload_spec_serializes_with_the_frontends_camel_case_field_names() {
        let payload = DeckVariantPayload {
            path: "/d/deck.ja.md".into(),
            file_name: "deck.ja.md".into(),
            suffix: Some("ja".into()),
            is_current: true,
        };
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            serde_json::json!({ "path": "/d/deck.ja.md", "fileName": "deck.ja.md", "suffix": "ja", "isCurrent": true })
        );
        let unsuffixed = DeckVariantPayload { suffix: None, ..payload };
        assert_eq!(serde_json::to_value(&unsuffixed).unwrap()["suffix"], serde_json::Value::Null);
    }

    fn render_output(manifest_json: &str, css: &str) -> RenderOutput {
        RenderOutput {
            manifest_json: manifest_json.to_string(),
            fragments: HashMap::from([("slide-1".to_string(), "<section>one</section>".to_string())]),
            css: css.to_string(),
            has_math: false,
            image_assets: HashMap::new(),
            fonts_dir: None,
            deck_dir: PathBuf::new(),
        }
    }

    #[test]
    fn to_payload_spec_carries_manifest_fragments_css_and_asset_base_url_through() {
        let output = render_output(
            r#"{"title":"Deck","slideCount":1,"canvasWidth":1280,"canvasHeight":720,"sections":[],"slides":[]}"#,
            ".peitho-slide { color: red; }",
        );
        let payload = to_payload(output, "http://127.0.0.1:1234/".to_string()).unwrap();
        assert_eq!(payload.manifest["title"], "Deck");
        assert_eq!(payload.fragments["slide-1"], "<section>one</section>");
        assert_eq!(payload.css, ".peitho-slide { color: red; }");
        assert_eq!(payload.asset_base_url, "http://127.0.0.1:1234/");
    }

    #[test]
    fn to_payload_adversarial_empty_css_stays_empty() {
        let payload = to_payload(render_output(r#"{"title":""}"#, ""), String::new()).unwrap();
        assert_eq!(payload.css, "");
    }

    #[test]
    fn to_payload_adversarial_rejects_invalid_manifest_json() {
        assert!(to_payload(render_output("not json", ""), String::new()).is_err());
    }
}
