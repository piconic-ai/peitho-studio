//! The Edit menu's Undo/Redo items.
//!
//! They replace `PredefinedMenuItem::undo`/`redo`, which only ever ran the
//! webview's native text undo. What an Undo should do is up to the page (a
//! plain text field's own undo, or the app's one timeline of slide
//! operations and typing in the slide editors — see `onMenuUndo` in
//! `ipc/deckIpc.ts`), which only the frontend knows, so a click (or the
//! Cmd+Z / Cmd+Shift+Z accelerator) is forwarded there as an event.
//!
//! The event goes to the focused window alone. Each window keeps its own
//! history, and a broadcast `emit` would undo the last operation in every
//! open deck at once.

use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};

pub(crate) const UNDO_ID: &str = "edit_undo";
pub(crate) const REDO_ID: &str = "edit_redo";

pub(crate) fn undo_item<R: Runtime>(app: &AppHandle<R>, label: &str) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, UNDO_ID, label, true, Some("CmdOrCtrl+Z"))
}

pub(crate) fn redo_item<R: Runtime>(app: &AppHandle<R>, label: &str) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, REDO_ID, label, true, Some("CmdOrCtrl+Shift+Z"))
}

/// The frontend event a menu item id is forwarded as, or `None` for an id
/// that isn't one of the Edit menu's Undo/Redo items.
pub(crate) fn event_for_menu_id(id: &str) -> Option<&'static str> {
    match id {
        UNDO_ID => Some("menu:undo"),
        REDO_ID => Some("menu:redo"),
        _ => None,
    }
}

/// The label of the window a menu action applies to: the first focused one
/// among `(label, is_focused)` pairs, or `None` when no window has focus.
pub(crate) fn focused_label<'a>(windows: impl IntoIterator<Item = (&'a str, bool)>) -> Option<&'a str> {
    windows.into_iter().find(|(_, focused)| *focused).map(|(label, _)| label)
}

/// Forwards the menu item `id` to the focused window's frontend. Returns
/// `false` when `id` isn't an Undo/Redo item, so the caller can keep
/// matching other ids. With no focused window, the event is dropped.
pub(crate) fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) -> bool {
    let Some(event) = event_for_menu_id(id) else { return false };
    emit_to_focused(app, event);
    true
}

/// Sends `event` to the focused window's frontend alone, or drops it when
/// no window has focus. Also used by the app menu's "Settings…" (see
/// `settings::MENU_EVENT`).
pub(crate) fn emit_to_focused<R: Runtime>(app: &AppHandle<R>, event: &str) {
    let windows = app.webview_windows();
    let focused = focused_label(
        windows
            .iter()
            .map(|(label, window)| (label.as_str(), window.is_focused().unwrap_or(false))),
    );
    if let Some(label) = focused {
        let _ = app.emit_to(EventTarget::webview_window(label), event, ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn given_the_undo_item_id_when_mapped_then_it_is_the_menu_undo_event() {
        assert_eq!(event_for_menu_id(UNDO_ID), Some("menu:undo"));
    }

    #[test]
    fn given_the_redo_item_id_when_mapped_then_it_is_the_menu_redo_event() {
        assert_eq!(event_for_menu_id(REDO_ID), Some("menu:redo"));
    }

    #[test]
    fn given_another_menu_id_when_mapped_then_nothing_is_forwarded() {
        for id in ["new_deck", "open_deck", "recent_deck:0", "", "undo", "redo", "EDIT_UNDO", " edit_undo"] {
            assert_eq!(event_for_menu_id(id), None, "{id:?}");
        }
    }

    #[test]
    fn given_one_focused_window_among_several_when_picked_then_it_is_that_window() {
        let windows = [("main", false), ("deck-2", true), ("deck-3", false)];
        assert_eq!(focused_label(windows), Some("deck-2"));
    }

    #[test]
    fn given_no_focused_window_when_picked_then_there_is_none() {
        assert_eq!(focused_label([("main", false), ("deck-2", false)]), None);
    }

    #[test]
    fn given_no_windows_when_picked_then_there_is_none() {
        assert_eq!(focused_label(std::iter::empty()), None);
    }

    #[test]
    fn given_two_windows_reporting_focus_when_picked_then_only_the_first_gets_it() {
        // Focus reports can briefly overlap while it moves between windows;
        // the event must still reach just one of them.
        assert_eq!(focused_label([("main", true), ("deck-2", true)]), Some("main"));
    }
}
