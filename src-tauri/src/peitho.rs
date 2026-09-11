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
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::engine::pipeline::{self, RenderOutput};
use crate::engine::serve::AssetServer;

/// Event name the frontend listens for (see Studio.tsx) to reload the deck
/// after it changes on disk — from an external editor, an AI agent, `git
/// checkout`, anything other than this app's own `save_deck_source`.
const DECK_FILE_CHANGED_EVENT: &str = "deck-file-changed";

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

/// Creates `<parent_dir>/<name>/deck.md` with a minimal starter deck and
/// returns its path (for the frontend to hand straight to
/// `open_deck_window`).
#[tauri::command]
pub fn create_deck(parent_dir: String, name: String) -> Result<String, String> {
    let trimmed = validate_deck_name(&name)?;
    let dir = PathBuf::from(&parent_dir).join(trimmed);
    if dir.exists() {
        return Err(format!("{} already exists", dir.display()));
    }
    std::fs::create_dir_all(&dir).map_err(|err| format!("failed to create {}: {err}", dir.display()))?;

    let deck_path = dir.join("deck.md");
    std::fs::write(&deck_path, STARTER_DECK)
        .map_err(|err| format!("failed to write {}: {err}", deck_path.display()))?;

    Ok(deck_path.display().to_string())
}

/// Windows spawned by `open_deck_window`, keyed by their (not-yet-loaded)
/// label, holding the deck path that window should open once its frontend
/// mounts and calls `take_pending_deck` — the hand-off that lets a brand
/// new webview know which deck it's for without a URL query string.
#[derive(Default)]
pub struct PendingDecks(Mutex<HashMap<String, String>>);

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Opens `path` in a brand new window, leaving whichever window this was
/// called from untouched — comparing two decks side by side means neither
/// one can be silently replaced by the other.
#[tauri::command]
pub fn open_deck_window(app: AppHandle, pending: State<PendingDecks>, path: String) -> Result<(), String> {
    open_deck_window_impl(&app, &pending, path)
}

pub(crate) fn open_deck_window_impl(app: &AppHandle, pending: &PendingDecks, path: String) -> Result<(), String> {
    let label = format!("deck-{}", WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed));
    {
        let mut guard = pending.0.lock().map_err(|_| "pending-decks lock poisoned".to_string())?;
        guard.insert(label.clone(), path);
    }
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .title("Peitho Studio")
        .inner_size(1440.0, 900.0)
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

#[tauri::command]
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

    let child = command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("failed to launch `peitho present`: {err}"))?;

    state.present_child = Some(child);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn render_output(manifest_json: &str, css: &str) -> RenderOutput {
        RenderOutput {
            manifest_json: manifest_json.to_string(),
            fragments: HashMap::from([("slide-1".to_string(), "<section>one</section>".to_string())]),
            css: css.to_string(),
            has_math: false,
            image_assets: HashMap::new(),
            fonts_dir: None,
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
