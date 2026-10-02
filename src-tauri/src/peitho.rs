// Session/process management + Tauri commands. Rendering itself is
// in-process now (see `crate::engine`) — this module owns each open
// window's deck file path, its external-edit watcher, the in-process asset
// server, and the `peitho present` subprocess (Present still shells out to
// the real CLI; it's a one-shot fullscreen launch, not on any hot path).
//
// Sessions are keyed by window label rather than being a single global
// slot: opening a deck in a new window (see `open_deck_window_impl`) must not
// disturb whichever deck another already-open window is showing — a user
// comparing two decks side by side is the whole point of that feature.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::menu::Menu;
use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};

use crate::crit::{self, CritCli, CritWatch, WatchSignal};
use crate::deck_menu::{self, DeckSettings, DeckSettingsRegistry, SettingKey};
use crate::deck_trust;
use crate::deck_variants;
use crate::edit_menu;
use crate::i18n::{self, Language, MenuLabels};
use crate::engine::builtin;
use crate::engine::crit::{self as crit_shapes, DeckSession, FinishedRound, NewReviewComment, NewReviewReply, ReviewComment, ReviewUpdate};
use crate::engine::image_layout;
use crate::engine::images;
use crate::engine::layout_fit::{self, LayoutVerdict};
use crate::engine::layout_preview;
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

/// Event the frontend listens for when the `peitho present` subprocess
/// exits (or is never heard from) without ever printing the readiness
/// line — carries the subprocess's captured stderr as the payload. Without
/// this, a startup failure (e.g. `--rehearsal` on a deck with no
/// `{"section":...}` comments, which `peitho present` rejects immediately)
/// was silently swallowed: stderr was discarded entirely, and the frontend
/// waited out its own timeout before showing a "Presenting…" status
/// message anyway — as if it had worked.
const PRESENT_FAILED_EVENT: &str = "present-failed";

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
/// lines. `None` (stdout wasn't piped) is a silent no-op. Returns a flag
/// `watch_present_failure` reads once stderr hits EOF — shared rather than
/// each watcher keeping its own, so the failure watcher can tell "the
/// process ended after we already know it succeeded" (nothing to report)
/// from "the process ended and never told us it was ready" (a real
/// failure).
fn watch_present_readiness(stdout: Option<ChildStdout>, window: WebviewWindow) -> Arc<AtomicBool> {
    let emitted = Arc::new(AtomicBool::new(false));
    let Some(stdout) = stdout else { return emitted };
    let emitted_for_reader = emitted.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if !emitted_for_reader.load(Ordering::SeqCst) && is_present_ready_line(&line) {
                let _ = window.emit(PRESENT_READY_EVENT, ());
                emitted_for_reader.store(true, Ordering::SeqCst);
            }
        }
    });
    emitted
}

/// Captures stderr until the subprocess closes it (it exits, or something
/// else kills it — e.g. a superseding present click, or the window/app
/// closing while it was still starting up) and, only if `emitted` is still
/// false at that point, reports it as a failure. A child that already
/// signaled readiness, or one killed intentionally before ever doing so,
/// both close stderr the same way — the `emitted` flag is what tells
/// this apart from an actual startup error (see `PRESENT_FAILED_EVENT`).
/// `None` (stderr wasn't piped) is a silent no-op.
fn watch_present_failure(stderr: Option<ChildStderr>, emitted: Arc<AtomicBool>, window: WebviewWindow) {
    let Some(mut stderr) = stderr else { return };
    std::thread::spawn(move || {
        let mut captured = String::new();
        let _ = stderr.read_to_string(&mut captured);
        if emitted.load(Ordering::SeqCst) {
            return;
        }
        let message = if captured.trim().is_empty() {
            "peitho present exited without starting the presentation".to_string()
        } else {
            captured.trim().to_string()
        };
        let _ = window.emit(PRESENT_FAILED_EVENT, message);
    });
}

/// What a window knows about its deck's crit review beyond what crit
/// reports.
#[derive(Default)]
struct CritReviewState {
    /// Set while `crit_start_session` starts a session, so a second call
    /// can't start another one beside it.
    starting: bool,
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
    /// The deck's crit session's event stream, followed since
    /// `crit_session_status` last found one. Dropped with the session.
    crit_watch: Option<CritWatch>,
    crit_review: CritReviewState,
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

    /// Whether `label`'s window already has a deck open — `open_deck`
    /// checks this before paying for a render it would refuse anyway.
    fn has_session(&self, label: &str) -> bool {
        self.0.lock().map(|guard| guard.contains_key(label)).unwrap_or(false)
    }

    /// Whether no window anywhere has a deck open yet — `finder_open_target`
    /// uses this to tell "the app just launched, nothing open but the
    /// welcome screen" from "some window already has a deck, opening
    /// another must not disturb it." A poisoned lock reports `false`
    /// (as if something were open) rather than `true`, since a false
    /// negative here only costs an extra window (`open_deck_window_impl`'s
    /// normal behavior), while a false positive would hand a Finder file to
    /// a window that may already be mid-render.
    fn is_empty(&self) -> bool {
        self.0.lock().map(|guard| guard.is_empty()).unwrap_or(false)
    }

    /// The label of a window that already has `target` open, if any — see
    /// `matching_window_label`. `open_deck_window_impl` uses this to bring an
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

/// The folder `deck_path` lives in. A bare file name (`deck.md`, e.g. from
/// `PEITHO_STUDIO_DEV_DECK`) has an empty parent rather than none, which
/// would leave the folder's trust unsaveable and `read_dir` failing — it's
/// the current directory, `.`, instead.
fn deck_dir_of(deck_path: &Path) -> PathBuf {
    match deck_path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    }
}

/// Registers `state` as `label`'s session, refusing if that window already
/// has one. A window's session is set exactly once: the app itself never
/// re-opens a deck in a window that has one (`domain/deckLifecycle.ts`
/// opens it in a new window instead), and a deck's own layout `<script>`
/// runs in this window's document with the same `invoke` access as the
/// app. Letting a second `open_deck` swap the session would let that
/// script point `read_deck_source`/`save_deck_source` — and the editor's
/// own autosave — at any file on disk (see
/// `todo/archive/deck-script-tauri-access.md`). A page reload clears the session
/// first (`lib.rs`'s `on_page_load`), which also discards the script.
/// Generic over the session value so it's testable without a real
/// `SessionState`.
fn insert_first_session<S>(sessions: &mut HashMap<String, S>, label: &str, state: S) -> Result<(), String> {
    if sessions.contains_key(label) {
        return Err(ALREADY_OPEN_ERROR.to_string());
    }
    sessions.insert(label.to_string(), state);
    Ok(())
}

const ALREADY_OPEN_ERROR: &str = "a deck is already open in this window";

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
    /// The layout each slide was built on, per slide key — what the
    /// manifest leaves out (see `RenderOutput::slide_layouts`).
    slide_layouts: std::collections::HashMap<String, String>,
    /// The deck's layouts a heading-only slide builds on (see
    /// `RenderOutput::heading_layouts`) — the ones New Slide may name.
    heading_layouts: Vec<String>,
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
    Ok(RenderPayload {
        manifest,
        fragments: output.fragments,
        slide_layouts: output.slide_layouts,
        heading_layouts: output.heading_layouts,
        asset_base_url,
        css: output.css,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckSessionInfo {
    deck_path: String,
    deck_dir: String,
    /// Whether the deck's folder is trusted to run scripts — decided once
    /// here; afterwards only `trust_open_deck` changes it.
    trusted: bool,
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
/// a window opened via `open_deck_window_impl` always wins that race with its
/// own explicit path.
#[tauri::command]
pub fn dev_default_deck() -> Option<String> {
    std::env::var("PEITHO_STUDIO_DEV_DECK").ok()
}

/// The starter `deck.md` after its frontmatter (see `starter_deck`): one
/// slide on the standard `title-slide` layout, named explicitly — with
/// every standard layout in the deck, a slide that doesn't name one
/// matches several (see `builtin::STANDARD_LAYOUTS`). Its line under the
/// title is the layout's one-paragraph body, shown as a subtitle.
const STARTER_BODY: &str = "<!-- {\"key\":\"cover\",\"layout\":\"title-slide\",\"section\":\"Intro\",\"time\":\"1m\"} -->\n\
# New Presentation\n\n\
Start writing your slides here.\n";

/// The deck settings the New Deck dialog picks, each one of its key's
/// choices in `deck_menu::SettingKey`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct NewDeckSettings {
    aspect_ratio: &'static str,
    lang: &'static str,
}

impl NewDeckSettings {
    /// Reads `create_deck`'s arguments: an absent one is its key's default,
    /// and anything that isn't one of the key's choices, spelled exactly,
    /// is an error — the same values the Edit menu offers.
    fn parse(aspect_ratio: Option<&str>, lang: Option<&str>) -> Result<Self, String> {
        Ok(Self {
            aspect_ratio: parse_new_deck_choice(SettingKey::AspectRatio, aspect_ratio)?,
            lang: parse_new_deck_choice(SettingKey::Lang, lang)?,
        })
    }
}

/// `value` as one of `key`'s choices, the default when absent.
fn parse_new_deck_choice(key: SettingKey, value: Option<&str>) -> Result<&'static str, String> {
    let Some(value) = value else { return Ok(key.default_choice()) };
    key.choice_of(value)
        .ok_or_else(|| format!("unknown {} '{value}'; use one of: {}", key.as_str(), key.choices().join(", ")))
}

/// The frontmatter line setting `key` to `choice`, or `None` for the
/// default, which is left to peitho-core by not writing the key — as the
/// Edit menu does when the default is picked.
fn frontmatter_line(key: SettingKey, choice: &str) -> Option<String> {
    (choice != key.default_choice()).then(|| format!("{}: {choice}", key.as_str()))
}

/// The starter `deck.md`: a frontmatter holding `time: 1m` and each
/// setting that isn't its default, then the one-slide body.
fn starter_deck(settings: NewDeckSettings) -> String {
    let lines: Vec<String> = std::iter::once("time: 1m".to_string())
        .chain(frontmatter_line(SettingKey::AspectRatio, settings.aspect_ratio))
        .chain(frontmatter_line(SettingKey::Lang, settings.lang))
        .collect();
    format!("---\n{}\n---\n{STARTER_BODY}", lines.join("\n"))
}

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
/// directory — the shape of `peitho new`'s default scaffold (light theme):
/// a starter `deck.md` plus its own `layouts/`/`css/base.css` to customize
/// instead of silently depending on peitho-core's built-in fallback, and a
/// `.gitignore` for the directories `peitho build`/`preview`/`present`
/// write into. Its layouts are Studio's own, though: every standard layout
/// (`builtin::STANDARD_LAYOUTS`, each with its CSS) in place of `peitho
/// new`'s lone `title-body-code` — `title-body` takes the same content —
/// and a layout for a slide holding an image, so an image dropped or
/// pasted into the new deck has somewhere to go (see
/// `builtin::IMAGE_LAYOUT_HTML`). Split out of `create_deck` as its own
/// pure function so the scaffold's shape is unit-testable without
/// touching the filesystem.
fn scaffold_deck_files(settings: NewDeckSettings) -> Vec<(&'static str, String)> {
    let standard = builtin::STANDARD_LAYOUTS;
    std::iter::once(("deck.md", starter_deck(settings)))
        .chain(standard.iter().map(|layout| (layout.html_path, layout.html.to_string())))
        .chain([("layouts/title-body-image.html", builtin::IMAGE_LAYOUT_HTML.to_string()), ("css/base.css", builtin::scaffolded_base_css())])
        .chain(standard.iter().map(|layout| (layout.css_path, layout.css.to_string())))
        .chain([("css/title-body-image.css", builtin::IMAGE_LAYOUT_CSS.to_string()), (".gitignore", builtin::GITIGNORE.to_string())])
        .collect()
}

/// Creates `<parent_dir>/<name>` scaffolded the way `peitho new` would
/// (see `scaffold_deck_files`) and returns the new `deck.md`'s path (for
/// the frontend to hand straight to `open_deck_window`). `aspect_ratio`
/// and `lang` are the New Deck dialog's picks: an absent one is its key's
/// default, and a value that isn't one of the key's choices creates
/// nothing. The new folder is trusted to run scripts from the start: the
/// app wrote every file in it. It never overwrites an existing folder, so
/// this can't be used to trust one somebody else wrote. Failing to record
/// that trust doesn't fail the command: the deck is already on disk (a
/// retry would hit "already exists"), and it just opens untrusted, with
/// the banner to trust it.
#[tauri::command]
pub fn create_deck(app: AppHandle, parent_dir: String, name: String, aspect_ratio: Option<String>, lang: Option<String>) -> Result<String, String> {
    crate::updates::ensure_can_open_deck(&app)?;
    let settings = NewDeckSettings::parse(aspect_ratio.as_deref(), lang.as_deref())?;
    let deck_path = scaffold_deck(&parent_dir, &name, settings)?;
    if let Some(dir) = deck_path.parent() {
        let _ = trust_deck_dir(&app, dir);
    }
    Ok(deck_path.display().to_string())
}

/// `create_deck`'s filesystem half, without trusting the result — split
/// out so it's testable without an `AppHandle`.
fn scaffold_deck(parent_dir: &str, name: &str, settings: NewDeckSettings) -> Result<PathBuf, String> {
    let trimmed = validate_deck_name(name)?;
    let dir = PathBuf::from(&parent_dir).join(trimmed);
    if dir.exists() {
        return Err(format!("{} already exists", dir.display()));
    }
    std::fs::create_dir_all(&dir).map_err(|err| format!("failed to create {}: {err}", dir.display()))?;

    for (relative_path, content) in scaffold_deck_files(settings) {
        let path = dir.join(relative_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| format!("failed to create {}: {err}", parent.display()))?;
        }
        std::fs::write(&path, content).map_err(|err| format!("failed to write {}: {err}", path.display()))?;
    }

    Ok(dir.join("deck.md"))
}

/// Windows spawned by `open_deck_window_impl`, keyed by their (not-yet-loaded)
/// label, holding the deck path that window should open once its frontend
/// mounts and calls `take_pending_deck` — the hand-off that lets a brand
/// new webview know which deck it's for without a URL query string.
#[derive(Default)]
pub struct PendingDecks(Mutex<HashMap<String, String>>);

impl PendingDecks {
    /// Whether `label` already has an unconsumed path waiting — a peek,
    /// unlike `take_pending_deck`, which removes it. `finder_open_target`
    /// uses this (for `MAIN_WINDOW_LABEL`) so a second, independently
    /// arriving `RunEvent::Opened` (e.g. two Finder double-clicks in quick
    /// succession, well within the ~0.6s a cold `open_deck` can take — see
    /// `todo/archive/open-deck-cold-start-latency.md`) can't silently
    /// overwrite a still-pending assignment to `main` before its frontend
    /// has had a chance to consume it — `PeithoSession` alone can't catch
    /// this, since it only gains an entry once that consumption's own
    /// `open_deck` round-trip finishes. This same check also covers the
    /// in-batch case (a second URL in one `RunEvent::Opened` call): the
    /// first URL's own call to `set` already wrote to this map by the time
    /// the second is decided. A poisoned lock reports `true`
    /// (as if occupied) rather than `false`, for the same reason
    /// `PeithoSession::is_empty` prefers a false negative: it costs an
    /// extra window at worst, never a silently dropped file.
    fn has_pending(&self, label: &str) -> bool {
        self.0.lock().map(|guard| guard.contains_key(label)).unwrap_or(true)
    }

    /// Registers `path` as `label`'s pending deck, overwriting whatever was
    /// there — used by `open_deck_window_impl` (a freshly counter-named
    /// `deck-N` label) and `open_finder_urls` (always `MAIN_WINDOW_LABEL`).
    fn set(&self, label: &str, path: String) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|_| "pending-decks lock poisoned".to_string())?;
        guard.insert(label.to_string(), path);
        Ok(())
    }
}

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Each new window cascades a step further than the last (wrapping after
/// `WINDOW_CASCADE_STEPS`), so a freshly opened window is visibly offset
/// from whichever one was already on top of it — otherwise a second deck
/// opening exactly on top of the first looks like nothing happened at
/// all. Not specific to the deck-language-variant switcher this constant
/// was added for — it's every caller of `open_deck_window_impl` (native "Open
/// Deck…"/"Open Recent" too), since they all funnel through the same
/// `open_deck_window_impl`.
const WINDOW_CASCADE_STEP_PX: f64 = 32.0;
const WINDOW_CASCADE_STEPS: u32 = 8;
const WINDOW_BASE_POSITION: (f64, f64) = (120.0, 120.0);

/// Opens one of the calling window's deck variants (`deck.md` ->
/// `deck.ja.md`, see `list_deck_variants`) in a new window. The only way
/// the frontend opens a deck in a new window — and it takes no arbitrary
/// path, since a deck's layout `<script>` can call it too: `path` must be
/// one of the variants listed next to this window's own deck (see
/// `variant_to_open`). Native "Open Deck…"/"Open Recent" call
/// `open_deck_window_impl` directly, Rust-side.
#[tauri::command]
pub fn open_deck_variant(
    app: AppHandle,
    window: WebviewWindow,
    pending: State<PendingDecks>,
    session: State<PeithoSession>,
    path: String,
) -> Result<(), String> {
    let deck_path = session_deck_path(&session, window.label())?;
    let variant = variant_to_open(&deck_variants_on_disk(&deck_path)?, &path)?;
    open_deck_window_impl(&app, &pending, &session, variant)
}

/// `requested` if it's exactly one of `variants`' paths other than the
/// current deck's own, else an error — `open_deck_variant`'s whole check,
/// split out so it's testable without a window or session.
fn variant_to_open(variants: &[DeckVariantPayload], requested: &str) -> Result<String, String> {
    variants
        .iter()
        .find(|variant| !variant.is_current && variant.path == requested)
        .map(|variant| variant.path.clone())
        .ok_or_else(|| format!("not a variant of the open deck: {requested}"))
}

/// Opens `path` in a brand new window, leaving whichever window this was
/// called from untouched — comparing two decks side by side means neither
/// one can be silently replaced by the other. If that deck is already
/// open in some other window, that window is brought to the front
/// instead of opening a redundant second copy of it, matching how
/// re-opening a file already open elsewhere is expected to behave.
pub(crate) fn open_deck_window_impl(app: &AppHandle, pending: &PendingDecks, session: &PeithoSession, path: String) -> Result<(), String> {
    crate::updates::ensure_can_open_deck(app)?;
    if let Some(label) = session.window_label_for(&deck_path_for_comparison(&path)) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            let _ = window.set_focus();
            return Ok(());
        }
    }

    let counter = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("deck-{counter}");
    pending.set(&label, path)?;
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

/// The default label Tauri gives `tauri.conf.json`'s `app.windows` entry
/// (it declares no `label` of its own), i.e. the window that shows the
/// welcome screen at launch. `open_finder_urls` targets this window
/// specifically when handing it a Finder-opened file (see
/// `finder_open_target`).
const MAIN_WINDOW_LABEL: &str = "main";

/// Where a single Finder-opened file (see `open_finder_urls`) should go:
/// the still-on-the-welcome-screen `main` window, or a fresh one exactly
/// like "Open Deck…"/"Open Recent" already open into. Pure decision, split
/// out so the rule is unit-testable without a real `AppHandle`/session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FinderOpenTarget {
    MainWindow,
    NewWindow,
}

/// `session_is_empty` is `PeithoSession::is_empty()`'s own answer and
/// `main_has_pending` is `PendingDecks::has_pending(MAIN_WINDOW_LABEL)`'s —
/// both passed straight through (never negated) so the call site can't
/// invert either by accident. `main_has_pending` guards against a second,
/// independently-decided Finder file overwriting a `main` assignment that's
/// still sitting unconsumed — whether that's a second URL in the very same
/// `RunEvent::Opened` batch, or a second `RunEvent::Opened` firing before
/// the first one's own `main` window has consumed it (see
/// `PendingDecks::has_pending`); `session_is_empty` alone can't tell either
/// case apart from "nothing's happened yet".
pub(crate) fn finder_open_target(session_is_empty: bool, main_has_pending: bool) -> FinderOpenTarget {
    if session_is_empty && !main_has_pending {
        FinderOpenTarget::MainWindow
    } else {
        FinderOpenTarget::NewWindow
    }
}

/// `url`'s local file path, or `None` for anything that isn't a `file://`
/// URL. Finder is the only real source of `RunEvent::Opened` on this
/// macOS-only app and always hands file URLs, but nothing about the type
/// guarantees that, so a URL that doesn't convert is dropped rather than
/// unwrapped.
fn finder_url_to_path(url: &tauri::Url) -> Option<PathBuf> {
    url.to_file_path().ok()
}

/// Called from `lib.rs`'s `RunEvent::Opened` — Finder's `.md` double-click
/// or "Open With" (see `bundle.fileAssociations` in `tauri.conf.json`).
/// Loops because macOS can hand several URLs in one `Opened` event (e.g.
/// multi-selecting files before "Open With"); each is decided independently
/// via `finder_open_target`, re-reading `pending`'s live state every
/// iteration so only the first ever reuses `main` and every other one gets
/// its own new window via `open_deck_window_impl`, same as "Open Recent"
/// would for it. A URL that isn't a local file is logged and skipped rather
/// than surfaced as an error nobody would see.
pub(crate) fn open_finder_urls(app: &AppHandle, pending: &PendingDecks, session: &PeithoSession, urls: Vec<tauri::Url>) {
    for url in urls {
        let Some(path) = finder_url_to_path(&url) else {
            log::warn!("ignoring a non-file URL from Finder: {url}");
            continue;
        };
        let path = path.display().to_string();
        let result = if finder_open_target(session.is_empty(), pending.has_pending(MAIN_WINDOW_LABEL)) == FinderOpenTarget::MainWindow {
            pending.set(MAIN_WINDOW_LABEL, path)
        } else {
            open_deck_window_impl(app, pending, session, path)
        };
        if let Err(err) = result {
            log::error!("failed to open a Finder-opened deck: {err}");
        }
    }
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

/// `file_name` inside the app data dir, which is created if missing.
fn app_data_file(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("failed to create {}: {err}", dir.display()))?;
    Ok(dir.join(file_name))
}

/// The rounds Studio finished in each crit session, which tell whether an
/// agent waits again (`crit_shapes::with_finished_round`). Saved to a file,
/// not kept per window: a session outlives Studio, and after a restart one
/// Studio had finished a round in would otherwise read as having its agent
/// waiting.
fn finished_rounds_path(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, "crit_finished_rounds.json")
}

/// Serializes read-modify-write of the finished rounds across windows.
static FINISHED_ROUNDS_LOCK: Mutex<()> = Mutex::new(());

fn load_finished_rounds(app: &AppHandle) -> Vec<FinishedRound> {
    finished_rounds_path(app)
        .and_then(|path| std::fs::read_to_string(path).map_err(|err| err.to_string()))
        .map(|json| crit_shapes::parse_finished_rounds(&json))
        .unwrap_or_default()
}

fn save_finished_round(app: &AppHandle, finished: FinishedRound) -> Result<(), String> {
    let _guard = FINISHED_ROUNDS_LOCK.lock().map_err(|_| "finished rounds lock poisoned".to_string())?;
    let rounds = crit_shapes::record_finished_round(&load_finished_rounds(app), finished);
    let path = finished_rounds_path(app)?;
    std::fs::write(&path, crit_shapes::finished_rounds_json(&rounds)).map_err(|err| format!("failed to write {}: {err}", path.display()))
}

fn recent_decks_path(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, "recent_decks.json")
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

/// Serializes the read-modify-write of `trusted_deck_dirs.json` across
/// windows trusting their decks at the same moment.
static TRUSTED_DECK_DIRS_LOCK: Mutex<()> = Mutex::new(());

fn trusted_deck_dirs_path(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, "trusted_deck_dirs.json")
}

fn is_deck_dir_trusted(app: &AppHandle, deck_dir: &Path) -> bool {
    let Ok(file) = trusted_deck_dirs_path(app) else { return false };
    let _guard = TRUSTED_DECK_DIRS_LOCK.lock();
    deck_trust::is_trusted(&deck_trust::read_trusted_dirs(&file), deck_dir)
}

fn trust_deck_dir(app: &AppHandle, deck_dir: &Path) -> Result<(), String> {
    let file = trusted_deck_dirs_path(app)?;
    let _guard = TRUSTED_DECK_DIRS_LOCK.lock().map_err(|_| "trusted-decks lock poisoned".to_string())?;
    deck_trust::add_trusted_dir(&file, deck_dir)
}

/// Trusts the calling window's open deck folder to run scripts — the
/// banner's "Trust and Run" button. Takes no path: it can only ever trust
/// the folder this window already has open. Until then that deck's scripts
/// never run, so no deck can call this to trust itself.
#[tauri::command]
pub fn trust_open_deck(app: AppHandle, window: WebviewWindow, session: State<PeithoSession>) -> Result<(), String> {
    let deck_dir = {
        let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
        guard.get(window.label()).ok_or_else(|| "no deck is open".to_string())?.deck_dir.clone()
    };
    trust_deck_dir(&app, &deck_dir)
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
    crate::updates::ensure_can_open_deck(&app)?;
    if session.has_session(window.label()) {
        return Err(ALREADY_OPEN_ERROR.to_string());
    }
    let deck_path = resolve_deck_path(&path)?;
    let deck_dir = deck_dir_of(&deck_path);

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
        trusted: is_deck_dir_trusted(&app, &deck_dir),
        render,
    };

    {
        // Checked again under the lock: `open_deck` is async, so two calls
        // can race past the early check above.
        let mut guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
        crate::updates::ensure_can_open_deck(&app)?;
        insert_first_session(
            &mut *guard,
            window.label(),
            SessionState { deck_path, deck_dir, asset_server, present_child: None, crit_watch: None, crit_review: CritReviewState::default(), _watcher: watcher },
        )?;
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
    /// Full path, ready to hand to `open_deck_variant`.
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
    deck_variants_on_disk(&session_deck_path(&session, window.label())?)
}

fn session_deck_path(session: &PeithoSession, label: &str) -> Result<PathBuf, String> {
    let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
    let state = guard.get(label).ok_or_else(|| "no deck is open".to_string())?;
    Ok(state.deck_path.clone())
}

fn session_deck_dir(session: &PeithoSession, label: &str) -> Result<PathBuf, String> {
    let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
    let state = guard.get(label).ok_or_else(|| "no deck is open".to_string())?;
    Ok(state.deck_dir.clone())
}

/// Copies an image file dropped on the body editor into this window's
/// deck, under `img/`, and returns its deck-relative path for the Markdown
/// (see `engine::images`). Only a PNG, JPEG, GIF or WebP file is ever read.
/// `async`: the file can be large, or on a slow volume.
#[tauri::command(async)]
pub fn import_deck_image_file(path: String, window: WebviewWindow, session: State<PeithoSession>) -> Result<String, String> {
    images::import_image_file(&session_deck_dir(&session, window.label())?, Path::new(&path))
}

/// The header naming a pasted image (`screenshot-20260925-143012.png`).
const IMAGE_NAME_HEADER: &str = "x-image-name";

/// Saves an image pasted into the body editor into this window's deck,
/// under `img/`, and returns its deck-relative path for the Markdown (see
/// `engine::images`). The image's bytes come as the raw request body, not
/// base64 in JSON, and its name in the `x-image-name` header.
#[tauri::command(async)]
pub fn import_deck_image_bytes(request: tauri::ipc::Request<'_>, window: WebviewWindow, session: State<PeithoSession>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("the image must be sent as raw bytes".to_string());
    };
    let name = request
        .headers()
        .get(IMAGE_NAME_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| format!("the image has no {IMAGE_NAME_HEADER} header"))?;
    images::import_image(&session_deck_dir(&session, window.label())?, name, bytes)
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
/// its own `layouts/` directory) with placeholder content written from its
/// slots (`layout_preview::placeholder_source`), for the
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
    for layout in resolved.layouts.iter() {
        let synthetic = layout_preview::placeholder_source(layout);
        let fragment = pipeline::render_source(&deck_path, &synthetic)
            .ok()
            .and_then(|output| {
                if css.is_empty() {
                    css = output.css.clone();
                }
                output.fragments.get(layout_preview::PREVIEW_KEY).cloned()
            })
            .unwrap_or_default();
        previews.push(LayoutPreview { name: layout.name().to_string(), fragment });
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

/// Adds Studio's built-in image layout to this window's deck, for the slide
/// at `slide_index` of `content` (the deck source as the frontend has it,
/// the slide already re-pinned to the new layout if it was pinned to
/// another) — the fix the error bar offers when no layout of the deck fits
/// a slide holding an image. Returns the deck-relative paths written;
/// writes nothing when any of them exists or the addition would change how
/// another slide builds. See `engine::image_layout`. `async` like
/// `check_slide_layouts`: it parses the whole deck and touches no shared
/// state.
#[tauri::command(async)]
pub fn add_image_layout(
    content: String,
    slide_index: usize,
    window: WebviewWindow,
    session: State<PeithoSession>,
) -> Result<Vec<&'static str>, String> {
    image_layout::add_image_layout(&session_deck_path(&session, window.label())?, &content, slide_index)
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
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to launch `peitho present`: {err}"))?;

    // This command returning `Ok` only means the OS accepted the `spawn()`
    // call — near-instant regardless of deck size, well before the child
    // has actually rendered anything. Watching for its own readiness line
    // instead (see `watch_present_readiness`) gives the frontend a signal
    // that tracks the part that's actually slow for a heavy deck. If it
    // instead exits having never printed that line (e.g. `--rehearsal` on
    // a deck with no agenda sections, which `peitho present` rejects
    // immediately), `watch_present_failure` reports why.
    let emitted = watch_present_readiness(child.stdout.take(), window.clone());
    watch_present_failure(child.stderr.take(), emitted, window);

    state.present_child = Some(child);
    Ok(())
}

/// Event a window's frontend listens for (`ipc/critIpc.ts`) while its
/// deck's crit session is followed — see `crit_session_status`. The
/// payload says what happened (`crit_event_payload`).
const CRIT_REVIEW_EVENT: &str = "crit-review";

/// `CRIT_REVIEW_EVENT`'s payload for `signal`: `commentsChanged` (read the
/// comments again), `finished` (the round reached the agent) or `ended`
/// (the session's daemon went away — ask for the session again).
fn crit_event_payload(signal: WatchSignal) -> &'static str {
    match signal {
        WatchSignal::Update(ReviewUpdate::CommentsChanged) => "commentsChanged",
        WatchSignal::Update(ReviewUpdate::Finished) => "finished",
        WatchSignal::Ended => "ended",
    }
}

/// The session a crit command talks to.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CritTarget {
    id: String,
    port: u16,
    /// The deck's path as the session knows it.
    file: String,
    review_round: u32,
}

/// The session a crit command should talk to, or why there's none to talk
/// to.
fn found_crit_session(session: DeckSession) -> Result<CritTarget, String> {
    match session {
        DeckSession::Found { id, port, file, review_round, .. } => Ok(CritTarget { id, port, file, review_round }),
        DeckSession::None => Err("no crit review session is waiting on this deck".to_string()),
        DeckSession::Ambiguous { ids } => {
            Err(format!("several crit review sessions are waiting on this deck ({}); stop all but one", ids.join(", ")))
        }
    }
}

/// What a window's crit watch should do once `crit_session_status` found
/// `found`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CritWatchAction {
    Keep,
    Stop,
    Follow(u16),
}

/// `current` is the watch the window has: the port it reads, and whether
/// that stream is still open.
fn crit_watch_action(current: Option<(u16, bool)>, found: &DeckSession) -> CritWatchAction {
    match found {
        DeckSession::Found { port, .. } if current == Some((*port, true)) => CritWatchAction::Keep,
        DeckSession::Found { port, .. } => CritWatchAction::Follow(*port),
        DeckSession::None | DeckSession::Ambiguous { .. } => CritWatchAction::Stop,
    }
}

/// Starts or stops following the window's crit session to match `found`.
fn sync_crit_watch(session: &PeithoSession, window: &WebviewWindow, found: &DeckSession) -> Result<(), String> {
    let label = window.label().to_string();
    let current = {
        let guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
        let state = guard.get(&label).ok_or_else(|| "no deck is open".to_string())?;
        state.crit_watch.as_ref().map(|watch| (watch.port, watch.is_open()))
    };
    // Opening the stream connects to the daemon, so it runs without the
    // lock every window shares; the lock is taken again only to store it.
    let watch = match crit_watch_action(current, found) {
        CritWatchAction::Keep => return Ok(()),
        CritWatchAction::Stop => None,
        CritWatchAction::Follow(port) => {
            let window = window.clone();
            let target = label.clone();
            Some(crit::watch_events(port, move |signal| {
                let _ = window.emit_to(EventTarget::webview_window(&target), CRIT_REVIEW_EVENT, crit_event_payload(signal));
            })?)
        }
    };
    let mut guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
    // The window may have closed meanwhile; then the new watch just drops.
    if let Some(state) = guard.get_mut(&label) {
        state.crit_watch = watch;
    }
    Ok(())
}

/// Where the crit bundled with Studio is, for the command Studio asks the
/// Coding Agent to run (`domain/agentConnect.ts`): named by its full path,
/// nothing has to be installed first, and whichever crit the agent runs
/// joins the session Studio started.
#[tauri::command]
pub fn crit_bundled_path() -> Result<String, String> {
    Ok(CritCli::bundled()?.path().display().to_string())
}

/// The crit session a Coding Agent is waiting in on this window's deck
/// (`crit --no-open deck.md` in the deck's folder), and starts following
/// its events (`CRIT_REVIEW_EVENT`). `async`: it runs the bundled crit and
/// asks each running session's daemon what it reviews.
#[tauri::command(async)]
pub fn crit_session_status(window: WebviewWindow, session: State<PeithoSession>) -> Result<DeckSession, String> {
    let found = session_deck_path(&session, window.label())
        .and_then(|deck_path| crit::find_deck_session(&CritCli::bundled()?, &deck_path))
        .map(|found| crit_shapes::with_finished_round(found, &load_finished_rounds(window.app_handle())));
    follow_found_session(&session, &window, found)
}

/// Follows `found`'s events, or stops following any when no session could
/// be resolved (as for `DeckSession::None`).
fn follow_found_session(session: &PeithoSession, window: &WebviewWindow, found: Result<DeckSession, String>) -> Result<DeckSession, String> {
    match found {
        Ok(found) => {
            sync_crit_watch(session, window, &found)?;
            Ok(found)
        }
        Err(err) => {
            let _ = sync_crit_watch(session, window, &DeckSession::None);
            Err(err)
        }
    }
}

/// Runs `f` on the window's crit review state.
fn with_crit_review<T>(session: &PeithoSession, label: &str, f: impl FnOnce(&mut CritReviewState) -> T) -> Result<T, String> {
    let mut guard = session.0.lock().map_err(|_| "session lock poisoned".to_string())?;
    let state = guard.get_mut(label).ok_or_else(|| "no deck is open".to_string())?;
    Ok(f(&mut state.crit_review))
}

/// Starts a review session on this window's deck with the bundled crit —
/// unless one already reviews it — and returns it, followed like
/// `crit_session_status`'s. An agent that then runs `crit --no-open
/// deck.md` in the deck's folder, with whichever crit it has, connects to
/// this session's daemon, so Studio always talks to the bundled version
/// (option (c) in todo/archive/crit-review-bridge.md). See
/// `crit::start_deck_session` for how a new session is opened.
#[tauri::command(async)]
pub fn crit_start_session(window: WebviewWindow, session: State<PeithoSession>) -> Result<DeckSession, String> {
    let label = window.label();
    let already_starting = with_crit_review(&session, label, |review| std::mem::replace(&mut review.starting, true))?;
    if already_starting {
        return Err("a crit review session is already starting for this deck".to_string());
    }
    let started = start_or_find_session(&session, window.app_handle(), label);
    let _ = with_crit_review(&session, label, |review| review.starting = false);
    follow_found_session(&session, &window, started)
}

fn start_or_find_session(session: &PeithoSession, app: &AppHandle, label: &str) -> Result<DeckSession, String> {
    let cli = CritCli::bundled()?;
    let deck_path = session_deck_path(session, label)?;
    let existing = crit::find_deck_session(&cli, &deck_path)?;
    if existing != DeckSession::None {
        return Ok(crit_shapes::with_finished_round(existing, &load_finished_rounds(app)));
    }
    let (started, finished) = crit::start_deck_session(&cli, &deck_path)?;
    save_finished_round(app, finished)?;
    Ok(started)
}

/// This window's deck's crit session, as `found_crit_session` has it.
fn deck_crit_session(session: &PeithoSession, label: &str) -> Result<CritTarget, String> {
    found_crit_session(crit::find_deck_session(&CritCli::bundled()?, &session_deck_path(session, label)?)?)
}

/// Adds `comments` to the deck's crit session and returns every comment in
/// it afterwards. All of them are checked before the first is sent, so a
/// bad one doesn't leave the others half-sent. Ones already in the session
/// (`crit_shapes::unsent_comments`) are skipped, so after a send that failed
/// partway — the daemon gone, a timeout — retrying the whole batch doesn't
/// hand the agent its first comments twice.
#[tauri::command(async)]
pub fn crit_add_comments(
    comments: Vec<NewReviewComment>,
    window: WebviewWindow,
    session: State<PeithoSession>,
) -> Result<Vec<ReviewComment>, String> {
    for comment in &comments {
        crit_shapes::new_comment_body(comment)?;
    }
    let target = deck_crit_session(&session, window.label())?;
    let existing = crit::list_comments(target.port, &target.file)?;
    for comment in crit_shapes::unsent_comments(&comments, &existing) {
        crit::add_comment(target.port, &target.file, comment)?;
    }
    crit::list_comments(target.port, &target.file)
}

/// Adds `replies` under their comments in the deck's crit session and
/// returns every comment afterwards. All of them are checked before the
/// first is sent.
#[tauri::command(async)]
pub fn crit_add_replies(
    replies: Vec<NewReviewReply>,
    window: WebviewWindow,
    session: State<PeithoSession>,
) -> Result<Vec<ReviewComment>, String> {
    for reply in &replies {
        crit_shapes::new_reply_body(reply)?;
    }
    let target = deck_crit_session(&session, window.label())?;
    // Replies already there (`crit_shapes::unsent_replies`) are skipped, so
    // retrying a send whose finish failed doesn't post them twice.
    let existing = crit::list_comments(target.port, &target.file)?;
    for reply in crit_shapes::unsent_replies(&replies, &existing) {
        crit::add_reply(target.port, &target.file, reply)?;
    }
    crit::list_comments(target.port, &target.file)
}

/// Marks comment `id` resolved and returns every comment afterwards. crit
/// hands the agent only unresolved comments, so a resolved one stops coming
/// back to it each round.
#[tauri::command(async)]
pub fn crit_resolve_comment(id: String, window: WebviewWindow, session: State<PeithoSession>) -> Result<Vec<ReviewComment>, String> {
    let target = deck_crit_session(&session, window.label())?;
    crit::resolve_comment(target.port, &target.file, &id)?;
    crit::list_comments(target.port, &target.file)
}

/// Finishes the review round: the agent waiting in crit gets the comments.
/// Only an agent's crit that is waiting at that moment gets them — crit
/// doesn't hold a finished round for one that connects later — so
/// `crit_session_status` reports no agent waiting from here until the
/// agent's next round starts.
#[tauri::command(async)]
pub fn crit_finish(window: WebviewWindow, session: State<PeithoSession>) -> Result<(), String> {
    let target = deck_crit_session(&session, window.label())?;
    crit::finish(target.port)?;
    save_finished_round(window.app_handle(), FinishedRound { session_id: target.id, port: target.port, review_round: target.review_round })
}

/// The comments in the deck's crit session, with their replies.
#[tauri::command(async)]
pub fn crit_list_comments(window: WebviewWindow, session: State<PeithoSession>) -> Result<Vec<ReviewComment>, String> {
    let target = deck_crit_session(&session, window.label())?;
    crit::list_comments(target.port, &target.file)
}

/// Every window's deck settings, and which window the Edit menu's
/// deck-setting items follow (see `deck_menu::DeckSettingsRegistry`).
/// Keyed by window label, like `PeithoSession`: each window reports its own
/// deck's values. Also the labels the menu was last built with (in the UI
/// language), which their labels are worded in — kept here rather than
/// re-read from the settings file on every focus change.
pub struct DeckMenuState {
    registry: Mutex<DeckSettingsRegistry>,
    labels: Mutex<&'static MenuLabels>,
}

impl Default for DeckMenuState {
    fn default() -> Self {
        Self { registry: Mutex::default(), labels: Mutex::new(i18n::menu_labels(Language::En)) }
    }
}

impl DeckMenuState {
    fn labels(&self) -> &'static MenuLabels {
        self.labels.lock().map(|labels| *labels).unwrap_or_else(|_| i18n::menu_labels(Language::En))
    }

    /// `label`'s window gained or lost focus (`WindowEvent::Focused`).
    pub fn set_focused(&self, label: &str, focused: bool) {
        if let Ok(mut registry) = self.registry.lock() {
            if focused {
                registry.focus(label);
            } else {
                registry.blur(label);
            }
        }
    }

    fn remove(&self, label: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.remove(label);
        }
    }

    /// Whether `label` is the front window after the report.
    fn report(&self, label: &str, settings: DeckSettings, focused: bool) -> bool {
        self.registry.lock().is_ok_and(|mut registry| registry.report(label, settings, focused))
    }

    /// The front window's settings, copied out so the lock isn't held
    /// while the menu is updated.
    fn front_settings(&self) -> Option<DeckSettings> {
        self.registry.lock().ok()?.front_settings().cloned()
    }
}

/// Shows the front window's settings in `menu`'s deck-setting items,
/// worded in `language` — for a menu just built in it (`build_menu`),
/// before it replaces the old one. Later refreshes keep that language.
pub(crate) fn apply_deck_menu(app: &AppHandle, menu: &Menu<tauri::Wry>, language: Language) {
    let state = app.state::<DeckMenuState>();
    let labels = i18n::menu_labels(language);
    if let Ok(mut current) = state.labels.lock() {
        *current = labels;
    }
    deck_menu::apply(menu, state.front_settings().as_ref(), labels);
}

/// Shows the front window's settings in the menu bar's deck-setting items.
/// Called whenever they may have changed: a report, a focus change, a
/// window closing or reloading, and every deck-setting click.
pub(crate) fn refresh_deck_menu(app: &AppHandle) {
    if let Some(menu) = app.menu() {
        let state = app.state::<DeckMenuState>();
        deck_menu::apply(&menu, state.front_settings().as_ref(), state.labels());
    }
}

/// Forwards a deck-setting click to the focused window as the choice to
/// write. Returns `false` when `id` isn't a deck-setting item, so the
/// caller can keep matching other ids. The items are re-applied either
/// way, since muda has already flipped the clicked item's own check mark;
/// the mark moves once the window writes the change and reports it back.
pub(crate) fn forward_deck_menu(app: &AppHandle, id: &str) -> bool {
    let Some((key, choice)) = deck_menu::parse_menu_id(id) else { return false };
    let front = app.state::<DeckMenuState>().front_settings();
    if let Some(pick) = deck_menu::pick_for_click(key, choice, front.as_ref()) {
        edit_menu::emit_to_focused(app, deck_menu::MENU_EVENT, pick);
    }
    refresh_deck_menu(app);
    true
}

/// The calling window's deck settings, as its frontend read them from the
/// open deck's frontmatter (see `domain/deckSettings.ts`). Sent on open and
/// after every change. Carries only what the menu shows (check marks and
/// the current values in the labels), so a deck's own layout script
/// calling it can do no more than mislabel the menu.
#[tauri::command]
pub fn report_deck_settings(settings: DeckSettings, window: WebviewWindow, state: State<DeckMenuState>) {
    if state.report(window.label(), settings, window.is_focused().unwrap_or(false)) {
        refresh_deck_menu(window.app_handle());
    }
}

/// Forgets `label`'s deck settings — its window closed, or its page is
/// reloading back to the welcome screen — and shows the menu without them.
pub(crate) fn forget_deck_settings(app: &AppHandle, label: &str) {
    app.state::<DeckMenuState>().remove(label);
    refresh_deck_menu(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- crit ---

    #[test]
    fn crit_signals_become_the_frontends_event_payloads() {
        assert_eq!(crit_event_payload(WatchSignal::Update(ReviewUpdate::CommentsChanged)), "commentsChanged");
        assert_eq!(crit_event_payload(WatchSignal::Update(ReviewUpdate::Finished)), "finished");
        assert_eq!(crit_event_payload(WatchSignal::Ended), "ended");
    }

    fn found_session(port: u16) -> DeckSession {
        DeckSession::Found { id: "s".into(), port, file: "deck.md".into(), review_round: 1, agent_waiting: true }
    }

    #[test]
    fn a_found_session_is_talked_to_on_its_port_and_file() {
        assert_eq!(
            found_crit_session(found_session(5000)),
            Ok(CritTarget { id: "s".into(), port: 5000, file: "deck.md".into(), review_round: 1 })
        );
    }

    #[test]
    fn no_or_several_sessions_are_errors_that_say_why() {
        assert!(found_crit_session(DeckSession::None).unwrap_err().contains("no crit review session"));
        let err = found_crit_session(DeckSession::Ambiguous { ids: vec!["a".into(), "b".into()] }).unwrap_err();
        assert!(err.contains("a, b"), "{err}");
    }

    #[test]
    fn a_window_starts_following_a_newly_found_session() {
        // Given no watch yet, When a session is found, Then it is followed.
        assert_eq!(crit_watch_action(None, &found_session(5000)), CritWatchAction::Follow(5000));
    }

    #[test]
    fn a_window_already_following_the_session_keeps_its_watch() {
        assert_eq!(crit_watch_action(Some((5000, true)), &found_session(5000)), CritWatchAction::Keep);
    }

    #[test]
    fn a_closed_stream_or_a_new_port_restarts_the_watch() {
        assert_eq!(crit_watch_action(Some((5000, false)), &found_session(5000)), CritWatchAction::Follow(5000));
        assert_eq!(crit_watch_action(Some((5000, true)), &found_session(6000)), CritWatchAction::Follow(6000));
    }

    #[test]
    fn without_a_single_session_the_window_stops_following() {
        assert_eq!(crit_watch_action(Some((5000, true)), &DeckSession::None), CritWatchAction::Stop);
        assert_eq!(crit_watch_action(None, &DeckSession::None), CritWatchAction::Stop);
        assert_eq!(crit_watch_action(Some((5000, true)), &DeckSession::Ambiguous { ids: vec![] }), CritWatchAction::Stop);
    }

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
    fn deck_dir_of_spec_is_the_folder_holding_the_deck() {
        assert_eq!(deck_dir_of(Path::new("/decks/talk/deck.md")), PathBuf::from("/decks/talk"));
        assert_eq!(deck_dir_of(Path::new("talk/deck.md")), PathBuf::from("talk"));
    }

    #[test]
    fn deck_dir_of_adversarial_a_bare_file_name_is_the_current_directory() {
        assert_eq!(deck_dir_of(Path::new("deck.md")), PathBuf::from("."));
    }

    #[test]
    fn deck_dir_of_adversarial_a_path_with_no_parent_is_the_current_directory() {
        assert_eq!(deck_dir_of(Path::new("")), PathBuf::from("."));
        assert_eq!(deck_dir_of(Path::new("/")), PathBuf::from("."));
    }

    #[test]
    fn insert_first_session_spec_registers_a_window_with_no_session() {
        let mut sessions: HashMap<String, &str> = HashMap::new();
        sessions.insert("deck-0".to_string(), "other window's deck");

        assert!(insert_first_session(&mut sessions, "main", "deck.md").is_ok());
        assert_eq!(sessions.get("main"), Some(&"deck.md"));
        assert_eq!(sessions.get("deck-0"), Some(&"other window's deck"));
    }

    #[test]
    fn insert_first_session_adversarial_refuses_to_swap_an_existing_session() {
        let mut sessions: HashMap<String, &str> = HashMap::new();
        sessions.insert("main".to_string(), "deck.md");

        let err = insert_first_session(&mut sessions, "main", "/Users/me/.zshrc").unwrap_err();
        assert_eq!(err, ALREADY_OPEN_ERROR);
        assert_eq!(sessions.get("main"), Some(&"deck.md"));
        assert_eq!(sessions.len(), 1);
    }

    #[test]
    fn insert_first_session_adversarial_refuses_even_the_same_deck_again() {
        let mut sessions: HashMap<String, &str> = HashMap::new();
        sessions.insert("main".to_string(), "deck.md");

        assert!(insert_first_session(&mut sessions, "main", "deck.md").is_err());
    }

    #[test]
    fn insert_first_session_adversarial_empty_label_is_just_another_key() {
        let mut sessions: HashMap<String, &str> = HashMap::new();

        assert!(insert_first_session(&mut sessions, "", "deck.md").is_ok());
        assert!(insert_first_session(&mut sessions, "", "deck.md").is_err());
        assert!(insert_first_session(&mut sessions, "main", "deck.md").is_ok());
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

    fn default_new_deck_settings() -> NewDeckSettings {
        NewDeckSettings::parse(None, None).unwrap()
    }

    /// The frontmatter lines of a starter deck, between its `---` fences.
    fn starter_frontmatter(deck: &str) -> Vec<&str> {
        let rest = deck.strip_prefix("---\n").expect("opens with a frontmatter fence");
        let (frontmatter, _) = rest.split_once("\n---\n").expect("closes its frontmatter");
        frontmatter.lines().collect()
    }

    #[test]
    fn given_no_settings_when_parsed_then_each_is_peitho_cores_default() {
        assert_eq!(default_new_deck_settings(), NewDeckSettings { aspect_ratio: "16:9", lang: "en" });
    }

    #[test]
    fn given_each_choice_when_parsed_then_it_is_kept() {
        assert_eq!(NewDeckSettings::parse(Some("4:3"), Some("ja")), Ok(NewDeckSettings { aspect_ratio: "4:3", lang: "ja" }));
        assert_eq!(NewDeckSettings::parse(Some("16:9"), Some("en")), Ok(NewDeckSettings { aspect_ratio: "16:9", lang: "en" }));
    }

    #[test]
    fn given_a_value_that_is_not_a_choice_when_parsed_then_it_is_an_error_naming_the_key_and_its_choices() {
        let err = NewDeckSettings::parse(Some("21:9"), None).unwrap_err();
        assert_eq!(err, "unknown aspect_ratio '21:9'; use one of: 16:9, 4:3");
        let err = NewDeckSettings::parse(None, Some("fr")).unwrap_err();
        assert_eq!(err, "unknown lang 'fr'; use one of: en, ja");
    }

    #[test]
    fn given_an_empty_or_misspelled_value_when_parsed_then_it_is_an_error_not_the_default() {
        for value in ["", " ", "4:3 ", "4：3", "JA", "ja\n"] {
            assert!(NewDeckSettings::parse(Some(value), None).is_err(), "aspect_ratio {value:?}");
            assert!(NewDeckSettings::parse(None, Some(value)).is_err(), "lang {value:?}");
        }
    }

    #[test]
    fn given_each_combination_when_the_starter_deck_is_built_then_only_non_defaults_are_written() {
        let cases = [
            ("16:9", "en", vec!["time: 1m"]),
            ("4:3", "en", vec!["time: 1m", "aspect_ratio: 4:3"]),
            ("16:9", "ja", vec!["time: 1m", "lang: ja"]),
            ("4:3", "ja", vec!["time: 1m", "aspect_ratio: 4:3", "lang: ja"]),
        ];
        for (aspect_ratio, lang, expected) in cases {
            let deck = starter_deck(NewDeckSettings { aspect_ratio, lang });
            assert_eq!(starter_frontmatter(&deck), expected, "{aspect_ratio} {lang}");
            assert!(deck.ends_with(STARTER_BODY), "{aspect_ratio} {lang}");
        }
    }

    #[test]
    fn given_the_defaults_when_the_starter_deck_is_built_then_it_is_one_title_slide_naming_its_layout() {
        let expected = "---\ntime: 1m\n---\n\
<!-- {\"key\":\"cover\",\"layout\":\"title-slide\",\"section\":\"Intro\",\"time\":\"1m\"} -->\n\
# New Presentation\n\n\
Start writing your slides here.\n";
        assert_eq!(starter_deck(default_new_deck_settings()), expected);
    }

    #[test]
    fn scaffold_deck_files_spec_holds_every_standard_layout_with_its_css_and_the_image_layout() {
        let files = scaffold_deck_files(default_new_deck_settings());
        let paths: Vec<&str> = files.iter().map(|(path, _)| *path).collect();
        assert_eq!(
            paths,
            vec![
                "deck.md",
                "layouts/title-slide.html",
                "layouts/section-header.html",
                "layouts/title-body.html",
                "layouts/two-column.html",
                "layouts/title-only.html",
                "layouts/one-column-text.html",
                "layouts/main-point.html",
                "layouts/section-title-description.html",
                "layouts/caption.html",
                "layouts/big-number.html",
                "layouts/blank.html",
                "layouts/title-body-image.html",
                "css/base.css",
                "css/title-slide.css",
                "css/section-header.css",
                "css/title-body.css",
                "css/two-column.css",
                "css/title-only.css",
                "css/one-column-text.css",
                "css/main-point.css",
                "css/section-title-description.css",
                "css/caption.css",
                "css/big-number.css",
                "css/blank.css",
                "css/title-body-image.css",
                ".gitignore"
            ]
        );

        let content_of = |wanted: &str| &files.iter().find(|(path, _)| *path == wanted).unwrap().1;
        let base_css = content_of("css/base.css");
        assert!(base_css.starts_with(builtin::BASE_CSS_HEADER));
        assert!(base_css.contains(builtin::BASE_CSS));
        for layout in builtin::STANDARD_LAYOUTS {
            assert_eq!(content_of(layout.html_path), layout.html);
            assert_eq!(content_of(layout.css_path), layout.css);
        }
        assert_eq!(content_of(".gitignore"), builtin::GITIGNORE);
    }

    #[test]
    fn scaffold_deck_files_adversarial_peitho_news_title_body_code_is_not_among_them() {
        // `title-body` takes the same content; both in one deck would make
        // every heading-and-body slide without a "layout" ambiguous.
        let files = scaffold_deck_files(default_new_deck_settings());
        assert!(files.iter().all(|(path, _)| *path != "layouts/title-body-code.html"));
    }

    #[test]
    fn scaffold_deck_files_adversarial_no_path_is_written_twice() {
        let files = scaffold_deck_files(default_new_deck_settings());
        let unique: std::collections::BTreeSet<&str> = files.iter().map(|(path, _)| *path).collect();
        assert_eq!(unique.len(), files.len());
    }

    #[test]
    fn scaffold_deck_files_adversarial_every_file_has_nonempty_content() {
        for (path, content) in scaffold_deck_files(default_new_deck_settings()) {
            assert!(!content.is_empty(), "{path} scaffolded with empty content");
        }
    }

    #[test]
    fn scaffold_deck_spec_writes_the_full_scaffold_and_returns_the_deck_md_path() {
        let parent = tempfile::tempdir().unwrap();
        let deck_path = scaffold_deck(parent.path().to_str().unwrap(), "my-talk", NewDeckSettings::parse(None, None).unwrap()).unwrap();

        let dir = parent.path().join("my-talk");
        assert_eq!(deck_path, dir.join("deck.md"));
        assert!(dir.join("deck.md").is_file());
        for (relative_path, _) in scaffold_deck_files(NewDeckSettings::parse(None, None).unwrap()) {
            assert!(dir.join(relative_path).is_file(), "{relative_path}");
        }
    }

    #[test]
    fn scaffold_deck_adversarial_refuses_to_overwrite_an_existing_directory() {
        let parent = tempfile::tempdir().unwrap();
        std::fs::create_dir(parent.path().join("my-talk")).unwrap();

        let err = scaffold_deck(parent.path().to_str().unwrap(), "my-talk", NewDeckSettings::parse(None, None).unwrap()).unwrap_err();
        assert!(err.contains("already exists"));
    }

    fn create_deck_with(parent: &Path, aspect_ratio: &str, lang: &str) -> Result<String, String> {
        let settings = NewDeckSettings::parse(Some(aspect_ratio), Some(lang))?;
        scaffold_deck(parent.to_str().unwrap(), "my-talk", settings).map(|path| path.display().to_string())
    }

    #[test]
    fn given_4_3_and_ja_when_a_deck_is_created_then_its_deck_md_holds_both() {
        let parent = tempfile::tempdir().unwrap();
        let deck_path = create_deck_with(parent.path(), "4:3", "ja").unwrap();

        let deck = std::fs::read_to_string(deck_path).unwrap();
        assert_eq!(starter_frontmatter(&deck), ["time: 1m", "aspect_ratio: 4:3", "lang: ja"]);
    }

    #[test]
    fn given_an_unknown_setting_when_a_deck_is_created_then_nothing_is_written() {
        let parent = tempfile::tempdir().unwrap();
        let err = create_deck_with(parent.path(), "21:9", "en").unwrap_err();

        assert!(err.contains("aspect_ratio"), "{err}");
        assert!(!parent.path().join("my-talk").exists());
    }

    #[test]
    fn given_every_combination_when_a_created_deck_is_rendered_then_peitho_core_accepts_it_at_that_ratio() {
        for (aspect_ratio, lang) in [("16:9", "en"), ("4:3", "en"), ("16:9", "ja"), ("4:3", "ja")] {
            let parent = tempfile::tempdir().unwrap();
            let deck_path = PathBuf::from(create_deck_with(parent.path(), aspect_ratio, lang).unwrap());
            let source = std::fs::read_to_string(&deck_path).unwrap();

            let output = pipeline::render_source(&deck_path, &source)
                .unwrap_or_else(|err| panic!("{aspect_ratio} {lang}: {err}"));
            let manifest: serde_json::Value = serde_json::from_str(&output.manifest_json).unwrap();
            assert_eq!(manifest["aspectRatio"], aspect_ratio, "{aspect_ratio} {lang}");
            let (ratio_w, ratio_h) = aspect_ratio.split_once(':').unwrap();
            let (width, height) = (manifest["canvasWidth"].as_u64().unwrap(), manifest["canvasHeight"].as_u64().unwrap());
            assert_eq!(width * ratio_h.parse::<u64>().unwrap(), height * ratio_w.parse::<u64>().unwrap(), "{aspect_ratio}: {width}x{height}");
            assert_eq!(output.fragments.len(), 1, "{aspect_ratio} {lang}");
        }
    }

    const TINY_PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0xe9, 0xfa, 0xdc, 0xd8, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    /// A deck `create_deck` scaffolded, with an image imported the way a
    /// drop or paste does (`engine::images`) — its path and the image's
    /// deck-relative path.
    fn created_deck_with_image(parent: &Path) -> (PathBuf, String) {
        let deck_path = PathBuf::from(create_deck_with(parent, "16:9", "en").unwrap());
        let image = crate::engine::images::import_image(deck_path.parent().unwrap(), "screenshot.png", TINY_PNG).unwrap();
        (deck_path, image)
    }

    #[test]
    fn given_a_created_deck_when_a_slide_naming_no_layout_holds_an_image_then_it_renders_with_the_image_layout() {
        let parent = tempfile::tempdir().unwrap();
        let (deck_path, image) = created_deck_with_image(parent.path());
        let source = format!("{}\n---\n\n# Screenshot\n\n![]({image})\n", std::fs::read_to_string(&deck_path).unwrap());

        let output = pipeline::render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{err}"));
        let fragment = output.fragments.get("screenshot").unwrap();
        assert!(fragment.contains("<img"), "{fragment}");
        assert_eq!(output.slide_layouts["screenshot"], "title-body-image");
        assert!(output.image_assets.keys().any(|asset| asset.ends_with("-screenshot.png")), "{:?}", output.image_assets);
        assert!(output.css.contains("object-fit: contain"), "the image layout's own CSS is loaded");
    }

    #[test]
    fn given_a_created_deck_when_slides_with_and_without_an_image_sit_side_by_side_then_each_finds_exactly_one_layout() {
        let parent = tempfile::tempdir().unwrap();
        let (deck_path, image) = created_deck_with_image(parent.path());
        let source = format!(
            "{}\n---\n\n<!-- {{\"layout\":\"title-body\"}} -->\n# Just text\n\n- a point\n\n---\n\n# With code\n\n```rust\nfn main() {{}}\n```\n\n---\n\n# Only an image\n\n![]({image})\n",
            std::fs::read_to_string(&deck_path).unwrap()
        );

        let output = pipeline::render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(output.fragments.len(), 4);
        let layout_of = |key: &str| output.slide_layouts.get(key).map(String::as_str);
        assert_eq!(layout_of("cover"), Some("title-slide"));
        assert_eq!(layout_of("just-text"), Some("title-body"));
        // Only `title-body` has a code slot, so a code block alone picks it.
        assert_eq!(layout_of("with-code"), Some("title-body"));
        assert_eq!(layout_of("only-an-image"), Some("title-body-image"));
    }

    #[test]
    fn given_a_created_deck_when_an_image_goes_on_a_slide_naming_a_layout_without_an_image_slot_then_the_image_layout_is_offered() {
        // The path a drop or paste onto `+`-added slide takes: the build
        // fails with the error `domain/imageSlot.ts` recognizes, and since
        // the slide fits the deck's own image layout, the error bar offers
        // to pick it rather than to add one (`imageSlotFixFor`).
        let parent = tempfile::tempdir().unwrap();
        let (deck_path, image) = created_deck_with_image(parent.path());
        let source = format!(
            "{}\n---\n\n<!-- {{\"key\":\"new-slide\",\"layout\":\"title-body\"}} -->\n# New Slide\n\n![]({image})\n",
            std::fs::read_to_string(&deck_path).unwrap()
        );

        let err = pipeline::render_source(&deck_path, &source).err().expect("title-body has no image slot");
        assert!(err.contains("no slot accepts image in layout 'title-body'"), "{err}");
        let verdicts = crate::engine::layout_fit::check_slide_layouts(&deck_path, &source, 1).unwrap().unwrap();
        let fitting: Vec<&str> = verdicts
            .iter()
            .filter(|verdict| verdict.fit == crate::engine::layout_fit::LayoutFit::Fits)
            .map(|verdict| verdict.layout.as_str())
            .collect();
        assert_eq!(fitting, ["title-body-image"]);
    }

    #[test]
    fn given_a_created_deck_when_the_image_shares_its_paragraph_with_text_then_peitho_core_refuses_it() {
        let parent = tempfile::tempdir().unwrap();
        let (deck_path, image) = created_deck_with_image(parent.path());
        let source = format!("{}\n---\n\n# Screenshot\n\n![]({image}) and some text\n", std::fs::read_to_string(&deck_path).unwrap());

        assert!(pipeline::render_source(&deck_path, &source).is_err());
    }

    /// Content filling every slot of `name`'s standard layout, written the
    /// way a deck would: a heading for the title, plain paragraphs for the
    /// body, `::: {slot=...}` blocks for the rest.
    fn filled_standard_slide(name: &str) -> String {
        let fenced = |slot: &str| format!("::: {{slot={slot}}}\n\nSome {slot} text.\n\n:::\n");
        let content = match name {
            "title-slide" => "# A title\n\nA subtitle.\n".to_string(),
            "section-header" | "title-only" | "main-point" => "# A title\n".to_string(),
            "title-body" => "# A title\n\nA paragraph.\n\n- a point\n\n```rust\nfn main() {}\n```\n".to_string(),
            "two-column" => format!("# A title\n\n{}\n{}", fenced("left"), fenced("right")),
            "one-column-text" => "# A title\n\nA paragraph.\n".to_string(),
            "section-title-description" => format!("# A title\n\n{}\nA description.\n", fenced("subtitle")),
            "caption" | "blank" => "Just a line of text.\n".to_string(),
            "big-number" => "# 42%\n\nOf something.\n".to_string(),
            other => panic!("no filled content for '{other}'"),
        };
        format!("<!-- {{\"key\":\"{name}\",\"layout\":\"{name}\"}} -->\n{content}")
    }

    fn created_deck_source_with(parent: &Path, slides: &[String]) -> (PathBuf, String) {
        let deck_path = PathBuf::from(create_deck_with(parent, "16:9", "en").unwrap());
        let starter = std::fs::read_to_string(&deck_path).unwrap();
        (deck_path, std::iter::once(starter).chain(slides.iter().cloned()).collect::<Vec<_>>().join("\n---\n\n"))
    }

    #[test]
    fn given_a_created_deck_when_each_standard_layout_is_named_on_a_filled_slide_then_every_slide_builds_on_it() {
        let parent = tempfile::tempdir().unwrap();
        let slides: Vec<String> = builtin::STANDARD_LAYOUTS.iter().map(|layout| filled_standard_slide(layout.name)).collect();
        let (deck_path, source) = created_deck_source_with(parent.path(), &slides);

        let output = pipeline::render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{err}"));
        for layout in builtin::STANDARD_LAYOUTS {
            assert_eq!(output.slide_layouts.get(layout.name).map(String::as_str), Some(layout.name));
            let fragment = &output.fragments[layout.name];
            assert!(fragment.contains(&format!("layout-{}", layout.name)), "{}: {fragment}", layout.name);
        }
        for layout in builtin::STANDARD_LAYOUTS {
            assert!(output.css.contains(&format!(".layout-{}", layout.name)), "{}'s CSS is loaded", layout.name);
        }
    }

    #[test]
    fn given_a_created_deck_at_4_3_when_each_standard_layout_is_named_then_every_slide_still_builds() {
        let parent = tempfile::tempdir().unwrap();
        let deck_path = PathBuf::from(create_deck_with(parent.path(), "4:3", "ja").unwrap());
        let slides: Vec<String> = builtin::STANDARD_LAYOUTS.iter().map(|layout| filled_standard_slide(layout.name)).collect();
        let source = format!("{}\n---\n\n{}", std::fs::read_to_string(&deck_path).unwrap(), slides.join("\n---\n\n"));

        let output = pipeline::render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(output.fragments.len(), 1 + builtin::STANDARD_LAYOUTS.len());
    }

    #[test]
    fn given_a_created_deck_when_each_standard_layout_is_named_on_its_least_content_then_it_still_builds() {
        // What a slide holds right after `+` or "Change Layout": a heading
        // alone for a layout with a title, nothing at all for one without.
        let parent = tempfile::tempdir().unwrap();
        let slides: Vec<String> = builtin::STANDARD_LAYOUTS
            .iter()
            .map(|layout| {
                let content = if ["caption", "blank"].contains(&layout.name) { "" } else { "# New Slide\n" };
                format!("<!-- {{\"key\":\"{0}\",\"layout\":\"{0}\"}} -->\n{content}", layout.name)
            })
            .collect();
        let (deck_path, source) = created_deck_source_with(parent.path(), &slides);

        let output = pipeline::render_source(&deck_path, &source).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(output.fragments.len(), 1 + builtin::STANDARD_LAYOUTS.len());
    }

    #[test]
    fn adversarial_given_a_created_deck_when_a_heading_only_slide_names_no_layout_then_it_matches_several_and_fails() {
        // Why Studio names a layout on every slide it writes: with all the
        // standard layouts in a deck, a heading alone fits many of them.
        let parent = tempfile::tempdir().unwrap();
        let (deck_path, source) = created_deck_source_with(parent.path(), &["# Just a heading\n".to_string()]);

        let err = pipeline::render_source(&deck_path, &source).err().expect("ambiguous");
        assert!(err.contains("slide matches multiple layouts"), "{err}");
        for name in ["title-slide", "section-header", "title-only", "main-point"] {
            assert!(err.contains(name), "{name} is among the matches: {err}");
        }
    }

    #[test]
    fn adversarial_given_a_created_deck_when_a_titleless_layout_gets_a_heading_then_it_does_not_build() {
        // Why `+` never carries `caption`/`blank` over to a new slide that
        // opens with a heading (`domain/standardLayouts.ts`).
        let parent = tempfile::tempdir().unwrap();
        for name in ["caption", "blank"] {
            let slide = format!("<!-- {{\"key\":\"x\",\"layout\":\"{name}\"}} -->\n# New Slide\n");
            let (deck_path, source) = created_deck_source_with(parent.path().join(name).as_path(), &[slide]);
            let err = pipeline::render_source(&deck_path, &source).err().unwrap_or_else(|| panic!("{name} has no title slot"));
            assert!(err.contains("title"), "{name}: {err}");
        }
    }

    #[test]
    fn adversarial_given_a_created_deck_when_title_slide_gets_more_than_one_paragraph_then_it_does_not_build() {
        // Its subtitle is one block: a second one is more than it holds.
        let parent = tempfile::tempdir().unwrap();
        let slide = "<!-- {\"key\":\"x\",\"layout\":\"title-slide\"} -->\n# A title\n\nOne.\n\nTwo.\n".to_string();
        let (deck_path, source) = created_deck_source_with(parent.path(), &[slide]);

        let err = pipeline::render_source(&deck_path, &source).err().expect("two subtitle paragraphs");
        assert!(err.contains("body"), "{err}");
    }

    #[test]
    fn given_a_new_deck_when_an_image_is_dropped_on_its_untouched_starter_slide_then_the_image_layout_is_offered() {
        // The starter text stays as is; the error bar's "pick layout"
        // (`imageSlotFixFor`) has `title-body-image` to offer, since it
        // takes the starter's title and subtitle (body) as well as the image.
        let parent = tempfile::tempdir().unwrap();
        let (deck_path, image) = created_deck_with_image(parent.path());
        let source = format!("{}\n![]({image})\n", std::fs::read_to_string(&deck_path).unwrap());

        let err = pipeline::render_source(&deck_path, &source).err().expect("title-slide has no image slot");
        assert!(err.contains("no slot accepts image in layout 'title-slide'"), "{err}");
        let verdicts = crate::engine::layout_fit::check_slide_layouts(&deck_path, &source, 0).unwrap().unwrap();
        let fitting: Vec<&str> = verdicts
            .iter()
            .filter(|verdict| verdict.fit == crate::engine::layout_fit::LayoutFit::Fits)
            .map(|verdict| verdict.layout.as_str())
            .collect();
        assert_eq!(fitting, ["title-body-image"]);

        let repinned = source.replace("\"layout\":\"title-slide\"", "\"layout\":\"title-body-image\"");
        let output = pipeline::render_source(&deck_path, &repinned).unwrap_or_else(|err| panic!("{err}"));
        assert!(output.fragments["cover"].contains("Start writing your slides here."));
        assert!(output.fragments["cover"].contains("<img"));
    }

    #[test]
    fn given_a_deck_without_an_image_slot_when_an_image_is_added_then_the_error_names_the_missing_slot() {
        let dir = tempfile::tempdir().unwrap();
        let deck_path = dir.path().join("deck.md");
        let image = crate::engine::images::import_image(dir.path(), "photo.png", TINY_PNG).unwrap();
        let source = format!("# Old deck\n\n![]({image})\n");
        std::fs::write(&deck_path, &source).unwrap();

        let err = pipeline::render_source(&deck_path, &source).err().expect("the built-in layout has no image slot");
        assert!(err.contains("no slot accepts image"), "{err}");
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
    fn given_the_app_has_no_deck_open_anywhere_and_main_has_no_pending_path_when_a_finder_file_is_opened_then_it_targets_the_main_window() {
        assert_eq!(finder_open_target(true, false), FinderOpenTarget::MainWindow);
    }

    #[test]
    fn given_a_deck_is_already_open_somewhere_when_a_finder_file_is_opened_then_it_targets_a_new_window() {
        assert_eq!(finder_open_target(false, false), FinderOpenTarget::NewWindow);
    }

    #[test]
    fn given_main_already_has_an_unconsumed_pending_path_when_another_finder_file_is_opened_then_it_targets_a_new_window() {
        // Covers both a second URL in the same `RunEvent::Opened` batch
        // (the first already wrote to `PendingDecks`) and a second,
        // independently-arriving `RunEvent::Opened` before `main`'s
        // frontend has consumed the first one — `PeithoSession` still
        // reports empty in both cases (the frontend's own `open_deck` for
        // the first file hasn't finished yet), so only `PendingDecks`
        // itself can catch this.
        assert_eq!(finder_open_target(true, true), FinderOpenTarget::NewWindow);
    }

    #[test]
    fn finder_open_target_adversarial_a_deck_already_open_and_an_unconsumed_main_pending_path_is_still_a_new_window() {
        assert_eq!(finder_open_target(false, true), FinderOpenTarget::NewWindow);
    }

    #[test]
    fn finder_url_to_path_spec_converts_a_file_url_to_its_local_path() {
        let url = tauri::Url::parse("file:///Users/me/decks/talk/deck.md").unwrap();
        assert_eq!(finder_url_to_path(&url), Some(PathBuf::from("/Users/me/decks/talk/deck.md")));
    }

    #[test]
    fn finder_url_to_path_adversarial_a_non_file_url_is_ignored_not_panicked_on() {
        for url in ["https://example.com/deck.md", "mailto:me@example.com"] {
            assert_eq!(finder_url_to_path(&tauri::Url::parse(url).unwrap()), None, "{url}");
        }
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

    fn listed_variants() -> Vec<DeckVariantPayload> {
        ["deck.md", "deck.ja.md"]
            .iter()
            .map(|name| DeckVariantPayload {
                path: format!("/decks/talk/{name}"),
                file_name: name.to_string(),
                suffix: name.strip_prefix("deck.").and_then(|rest| rest.strip_suffix(".md")).map(str::to_string),
                is_current: *name == "deck.md",
            })
            .collect()
    }

    #[test]
    fn variant_to_open_spec_returns_a_listed_sibling() {
        assert_eq!(variant_to_open(&listed_variants(), "/decks/talk/deck.ja.md").unwrap(), "/decks/talk/deck.ja.md");
    }

    #[test]
    fn variant_to_open_adversarial_rejects_a_path_outside_the_list() {
        assert!(variant_to_open(&listed_variants(), "/Users/me/.zshrc").is_err());
        assert!(variant_to_open(&listed_variants(), "/decks/other/deck.ja.md").is_err());
    }

    #[test]
    fn variant_to_open_adversarial_rejects_the_current_deck_itself() {
        assert!(variant_to_open(&listed_variants(), "/decks/talk/deck.md").is_err());
    }

    #[test]
    fn variant_to_open_adversarial_rejects_a_bare_file_name_or_a_path_that_only_resolves_to_a_sibling() {
        assert!(variant_to_open(&listed_variants(), "deck.ja.md").is_err());
        assert!(variant_to_open(&listed_variants(), "/decks/talk/../talk/deck.ja.md").is_err());
    }

    #[test]
    fn variant_to_open_adversarial_empty_inputs_are_errors() {
        assert!(variant_to_open(&listed_variants(), "").is_err());
        assert!(variant_to_open(&[], "/decks/talk/deck.ja.md").is_err());
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
            slide_layouts: HashMap::from([("slide-1".to_string(), "title-body".to_string())]),
            heading_layouts: vec!["title-body".to_string(), "title-slide".to_string()],
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
        assert_eq!(payload.slide_layouts["slide-1"], "title-body");
        assert_eq!(payload.heading_layouts, ["title-body", "title-slide"]);
        assert_eq!(payload.css, ".peitho-slide { color: red; }");
        assert_eq!(payload.asset_base_url, "http://127.0.0.1:1234/");
    }

    #[test]
    fn given_a_payload_when_serialized_then_its_layouts_reach_the_frontend_in_camel_case() {
        let payload = to_payload(render_output(r#"{"title":""}"#, ""), String::new()).unwrap();
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["slideLayouts"]["slide-1"], "title-body");
        assert_eq!(json["headingLayouts"], serde_json::json!(["title-body", "title-slide"]));
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
