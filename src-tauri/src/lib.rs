mod deck_variants;
mod edit_menu;
mod engine;
mod peitho;
mod settings;

use peitho::{PeithoSession, PendingDecks};
use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// How many of the most recent decks `engine::warm_up` renders at launch.
const WARM_UP_RECENT_DECKS: usize = 3;

/// Builds the native menu bar. Starts from the same shape Tauri's own
/// `Menu::default()` produces (App/Edit/View/Window/Help, with all the
/// platform-standard items — Quit, Cut/Copy/Paste, About, etc. — wired
/// automatically) and adds "New Deck…"/"Open Deck…"/"Open Recent" at the
/// top of File, "Settings…" (Cmd+,) to the app menu, with Edit's Undo/Redo
/// swapped for `edit_menu`'s own items.
/// Kept as an explicit rebuild rather than mutating
/// `Menu::default()`'s output, since that method doesn't hand back the
/// File submenu separately to prepend into.
///
/// Called again (replacing the whole menu via `app.set_menu`) every time
/// the recent-decks list changes, since "Open Recent" is built from
/// whatever that list holds at build time — there's no incremental way to
/// patch just one submenu's items in place.
///
/// Reads the persisted recent-decks list itself (via `peitho::read_recent_decks`,
/// which touches `app.path()`), so this must only be called once Tauri's
/// own internal state is up — i.e. from `setup()` or later, never as the
/// `Builder::menu()` factory itself (that factory runs before Tauri
/// manages its own `PathResolver` state, and calling `app.path()` that
/// early panics). The initial menu bar is instead built by
/// `build_menu_with_recents(app, Vec::new())` and immediately replaced
/// with the real thing from inside `setup()`.
pub(crate) fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    build_menu_with_recents(app, peitho::read_recent_decks(app))
}

fn build_menu_with_recents(app: &tauri::AppHandle, recents: Vec<String>) -> tauri::Result<Menu<tauri::Wry>> {
    let pkg_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let new_deck = MenuItem::with_id(app, "new_deck", "New Deck…", true, Some("CmdOrCtrl+N"))?;
    let open_deck = MenuItem::with_id(app, "open_deck", "Open Deck…", true, Some("CmdOrCtrl+O"))?;
    let recent_menu = build_recent_menu(app, &recents)?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_deck,
            &open_deck,
            &recent_menu,
            &PredefinedMenuItem::separator(app)?,
            // macOS has it in the app menu instead, where its users look.
            #[cfg(not(target_os = "macos"))]
            &settings::menu_item(app)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            // Not `PredefinedMenuItem::undo`/`redo`: those run only the
            // webview's text undo, never the slide operations' (see
            // `edit_menu`).
            &edit_menu::undo_item(app)?,
            &edit_menu::redo_item(app)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app, None, Some(about_metadata.clone()))?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app)?,
                    &settings::menu_item(app)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &file_menu,
            &edit_menu,
            #[cfg(target_os = "macos")]
            &Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?,
            &window_menu,
            &help_menu,
        ],
    )
}

/// Item ids are `recent_deck:<index>` into the persisted list (see
/// `peitho::get_recent_decks`) — resolved back to a path in `on_menu_event`
/// at click time, not baked into the id itself, since paths can contain
/// characters menu ids would rather not carry.
fn build_recent_menu(app: &tauri::AppHandle, recents: &[String]) -> tauri::Result<Submenu<tauri::Wry>> {
    if recents.is_empty() {
        let placeholder = MenuItem::with_id(app, "recent_none", "No Recent Decks", false, None::<&str>)?;
        return Submenu::with_items(app, "Open Recent", true, &[&placeholder]);
    }

    let items: Vec<MenuItem<tauri::Wry>> = recents
        .iter()
        .enumerate()
        .map(|(index, path)| MenuItem::with_id(app, format!("recent_deck:{index}"), path, true, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|item| item as &dyn IsMenuItem<tauri::Wry>).collect();
    Submenu::with_items(app, "Open Recent", true, &refs)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    // Only in an `--features e2e-testing` build (see
    // docs/tauri-playwright-spike.md): embeds a control server Playwright's
    // "tauri" mode connects to over a Unix socket to drive this real
    // WKWebView window — never in a normal build. Registered here rather
    // than inside `.setup()` (where `tauri_plugin_log` is, below) because
    // this plugin injects a `js_init_script` that only reaches a webview's
    // *first* page load — `setup()` runs after `tauri.conf.json`'s
    // declared windows already exist, which is too late for the main
    // window's init script to take effect (confirmed: the plugin's own
    // `window.__PW_ACTIVE__` readiness marker never appeared when this was
    // registered from `setup()` instead).
    #[cfg(feature = "e2e-testing")]
    let builder = builder.plugin(tauri_plugin_playwright::init());
    builder
        .manage(PeithoSession::default())
        .manage(PendingDecks::default())
        .menu(|app| build_menu_with_recents(app, Vec::new()))
        .on_menu_event(|app_handle, event| {
            let id = event.id().as_ref();
            if edit_menu::forward(app_handle, id) {
                // Undo/Redo: handled by the focused window's frontend.
            } else if id == settings::MENU_ID {
                // The settings panel is an in-app modal: open it in the
                // window the user is looking at.
                edit_menu::emit_to_focused(app_handle, settings::MENU_EVENT);
            } else if id == "new_deck" {
                // Needs the in-app name-entry modal, so it's routed back
                // through the frontend rather than handled here.
                let _ = app_handle.emit("menu:new-deck", ());
            } else if id == "open_deck" {
                let app_handle = app_handle.clone();
                app_handle
                    .dialog()
                    .file()
                    .set_title("Open Deck")
                    .pick_folder(move |folder| {
                        let Some(folder) = folder else { return };
                        let Ok(path) = folder.into_path() else { return };
                        let pending = app_handle.state::<PendingDecks>();
                        let session = app_handle.state::<PeithoSession>();
                        let _ = peitho::open_deck_window_impl(&app_handle, &pending, &session, path.display().to_string());
                    });
            } else if let Some(index) = id.strip_prefix("recent_deck:").and_then(|s| s.parse::<usize>().ok()) {
                let recents = peitho::read_recent_decks(app_handle);
                if let Some(path) = recents.get(index).cloned() {
                    let pending = app_handle.state::<PendingDecks>();
                    let session = app_handle.state::<PeithoSession>();
                    let _ = peitho::open_deck_window_impl(app_handle, &pending, &session, path);
                }
            }
        })
        .on_window_event(|window, event| {
            // Each window owns its own session (deck path, asset server,
            // file watcher) — once the window is gone, so is the point of
            // keeping that state around.
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<PeithoSession>().remove(window.label());
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Replaces the placeholder menu bar (built with an empty
            // Recent list, since `app.path()` isn't usable yet when
            // `Builder::menu()`'s factory runs) with the real one now that
            // the app's own state is fully initialized.
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            // Off the main thread so launch isn't held up: the first render
            // after launch pays one-time costs (~0.6s for three code-heavy
            // decks), which would otherwise land on the first deck opened.
            let recents: Vec<std::path::PathBuf> = peitho::read_recent_decks(app.handle())
                .into_iter()
                .take(WARM_UP_RECENT_DECKS)
                .map(std::path::PathBuf::from)
                .collect();
            std::thread::spawn(move || engine::warm_up(&recents));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            peitho::dev_default_deck,
            peitho::open_deck,
            peitho::open_deck_window,
            peitho::take_pending_deck,
            peitho::get_recent_decks,
            peitho::create_deck,
            peitho::render_draft,
            peitho::read_deck_source,
            peitho::save_deck_source,
            peitho::list_deck_variants,
            peitho::preview_layouts,
            peitho::check_slide_layouts,
            peitho::present_deck,
            settings::get_settings,
            settings::update_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // A quit shouldn't leave `peitho preview`/`peitho present`
            // running headless in the background.
            if let tauri::RunEvent::Exit = event {
                app_handle.state::<PeithoSession>().shutdown();
            }
        });
}
