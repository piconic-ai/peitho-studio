//! The "Check for Updates…" window: the app menu's item (Help menu's last
//! item off macOS) opens `update.html` in a small window of its own, which
//! starts a check as soon as it loads.
//!
//! Only the window lives here. Checking, downloading and installing stay in
//! `updates`; the page drives them through the same commands and
//! `updates:changed` event the settings panel uses.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{i18n, settings};

/// The menu item's id.
pub(crate) const MENU_ID: &str = "check_updates";

/// The window's label. There's only ever one.
pub(crate) const WINDOW_LABEL: &str = "updates";

/// Sent to the window, and only it, when the menu item is chosen while the
/// window is already open: the page checks again.
const CHECK_AGAIN_EVENT: &str = "update-window:check";

const WINDOW_WIDTH: f64 = 420.0;
const WINDOW_HEIGHT: f64 = 360.0;

/// Opens the window, which checks once it loads. If it's already open,
/// brings it to the front and has it check again.
pub(crate) fn open_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.unminimize()?;
        window.set_focus()?;
        return app.emit_to(WINDOW_LABEL, CHECK_AGAIN_EVENT, ());
    }
    let labels = i18n::menu_labels(settings::ui_language(app));
    WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("update.html".into()))
        .title(labels.updates_window_title)
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .build()?;
    Ok(())
}
