mod deck_variants;
mod edit_menu;
mod engine;
mod help_links;
mod i18n;
mod input_source;
mod logging;
mod peitho;
mod settings;

use i18n::{Language, MenuLabels};
use peitho::{PeithoSession, PendingDecks};
use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// How many of the most recent decks `engine::warm_up` renders at launch.
const WARM_UP_RECENT_DECKS: usize = 3;

/// Builds the native menu bar. Starts from the same shape Tauri's own
/// `Menu::default()` produces (App/Edit/View/Window/Help, with all the
/// platform-standard items — Quit, Cut/Copy/Paste, About, etc. — wired
/// automatically) and adds "New Deck…"/"Open Deck…"/"Open Recent" at the
/// top of File, "Settings…" (Cmd+,) to the app menu, links to the
/// project's GitHub pages (`help_links`) to Help, with Edit's Undo/Redo
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
/// `build_menu_with_recents` with an empty Recent list and the OS's
/// language (the saved one needs `app.path()` too), and immediately
/// replaced with the real thing from inside `setup()`.
///
/// Labelled in the UI language (`settings::ui_language`), so it is also
/// rebuilt whenever that setting is saved (`settings::update_settings`).
pub(crate) fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    build_menu_with_recents(app, peitho::read_recent_decks(app), settings::ui_language(app))
}

fn build_menu_with_recents(app: &tauri::AppHandle, recents: Vec<String>, language: Language) -> tauri::Result<Menu<tauri::Wry>> {
    let labels = i18n::menu_labels(language);
    let pkg_info = app.package_info();
    let app_name = pkg_info.name.as_str();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let new_deck = MenuItem::with_id(app, "new_deck", labels.new_deck, true, Some("CmdOrCtrl+N"))?;
    let open_deck = MenuItem::with_id(app, "open_deck", labels.open_deck, true, Some("CmdOrCtrl+O"))?;
    let recent_menu = build_recent_menu(app, &recents, labels)?;

    let file_menu = Submenu::with_items(
        app,
        labels.file,
        true,
        &[
            &new_deck,
            &open_deck,
            &recent_menu,
            &PredefinedMenuItem::separator(app)?,
            // macOS has it in the app menu instead, where its users look.
            #[cfg(not(target_os = "macos"))]
            &settings::menu_item(app, labels.settings)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(labels.close_window))?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, Some(&labels.quit(app_name)))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        labels.edit,
        true,
        &[
            // Not `PredefinedMenuItem::undo`/`redo`: those run only the
            // webview's text undo, never the slide operations' (see
            // `edit_menu`).
            &edit_menu::undo_item(app, labels.undo)?,
            &edit_menu::redo_item(app, labels.redo)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(labels.cut))?,
            &PredefinedMenuItem::copy(app, Some(labels.copy))?,
            &PredefinedMenuItem::paste(app, Some(labels.paste))?,
            &PredefinedMenuItem::select_all(app, Some(labels.select_all))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        labels.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(labels.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(labels.zoom))?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(labels.close_window))?,
        ],
    )?;

    let help_link_items: Vec<MenuItem<tauri::Wry>> = help_links::HELP_LINKS
        .iter()
        .map(|link| MenuItem::with_id(app, link.menu_id(), link.label(labels), true, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    // macOS has About in the app menu instead.
    #[cfg(not(target_os = "macos"))]
    let about_items = [
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::about(app, Some(&labels.about(app_name)), Some(about_metadata.clone()))?,
    ];
    #[cfg(target_os = "macos")]
    let about_items: [PredefinedMenuItem<tauri::Wry>; 0] = [];
    let help_items: Vec<&dyn IsMenuItem<tauri::Wry>> = help_link_items
        .iter()
        .map(|item| item as &dyn IsMenuItem<tauri::Wry>)
        .chain(about_items.iter().map(|item| item as &dyn IsMenuItem<tauri::Wry>))
        .collect();
    let help_menu = Submenu::with_items(app, labels.help, true, &help_items)?;

    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                app_name,
                true,
                &[
                    &PredefinedMenuItem::about(app, Some(&labels.about(app_name)), Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app)?,
                    &settings::menu_item(app, labels.settings)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, Some(labels.services))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some(&labels.hide(app_name)))?,
                    &PredefinedMenuItem::hide_others(app, Some(labels.hide_others))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some(&labels.quit(app_name)))?,
                ],
            )?,
            &file_menu,
            &edit_menu,
            #[cfg(target_os = "macos")]
            &Submenu::with_items(app, labels.view, true, &[&PredefinedMenuItem::fullscreen(app, Some(labels.enter_full_screen))?])?,
            &window_menu,
            &help_menu,
        ],
    )
}

/// Item ids are `recent_deck:<index>` into the persisted list (see
/// `peitho::get_recent_decks`) — resolved back to a path in `on_menu_event`
/// at click time, not baked into the id itself, since paths can contain
/// characters menu ids would rather not carry.
fn build_recent_menu(app: &tauri::AppHandle, recents: &[String], labels: &MenuLabels) -> tauri::Result<Submenu<tauri::Wry>> {
    if recents.is_empty() {
        let placeholder = MenuItem::with_id(app, "recent_none", labels.no_recent_decks, false, None::<&str>)?;
        return Submenu::with_items(app, labels.open_recent, true, &[&placeholder]);
    }

    let items: Vec<MenuItem<tauri::Wry>> = recents
        .iter()
        .enumerate()
        .map(|(index, path)| MenuItem::with_id(app, format!("recent_deck:{index}"), path, true, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|item| item as &dyn IsMenuItem<tauri::Wry>).collect();
    Submenu::with_items(app, labels.open_recent, true, &refs)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Vim mode's yank/put share the OS clipboard through it
        // (`ipc/editorIpc.ts`). Read from Rust rather than with
        // `navigator.clipboard.readText()`, which WKWebView answers only
        // after the user clicks a "Paste" callout.
        .plugin(tauri_plugin_clipboard_manager::init())
        // Opens the Help menu's GitHub links in the default browser. Used
        // from Rust only, so no capability grants the frontend any of it.
        .plugin(tauri_plugin_opener::init());
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
        .menu(|app| build_menu_with_recents(app, Vec::new(), i18n::system_language(&settings::system_locales())))
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
                let title = i18n::menu_labels(settings::ui_language(&app_handle)).open_deck_dialog_title;
                app_handle
                    .dialog()
                    .file()
                    .set_title(title)
                    .pick_folder(move |folder| {
                        let Some(folder) = folder else { return };
                        let Ok(path) = folder.into_path() else { return };
                        let pending = app_handle.state::<PendingDecks>();
                        let session = app_handle.state::<PeithoSession>();
                        let _ = peitho::open_deck_window_impl(&app_handle, &pending, &session, path.display().to_string());
                    });
            } else if let Some(url) = help_links::url_for_menu_id(id) {
                if let Err(err) = app_handle.opener().open_url(url, None::<&str>) {
                    log::error!("failed to open a Help link: {err}");
                }
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
            app.handle().plugin(logging::plugin())?;
            logging::install_panic_hook();
            log::info!("Peitho Studio {} starting", app.package_info().version);
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
            settings::get_system_locales,
            input_source::select_ascii_input_source,
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
