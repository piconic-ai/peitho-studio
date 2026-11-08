use tauri::menu::PredefinedMenuItem;
use tauri::menu::Submenu;
use tauri::{AppHandle, Manager, Runtime};

use crate::i18n::MenuLabels;

struct ZoomAction {
    id: &'static str,
    key: &'static str,
    accelerator: &'static str,
}

// Tauri's legacy accelerator parser maps NumpadAdd to the native '+' key
// equivalent on macOS, where it also gives the menu its expected ⌘+ label.
const ZOOM_IN_ACCELERATOR: &str = "CmdOrCtrl+NumpadAdd";

const ZOOM_ACTIONS: [ZoomAction; 3] = [
    ZoomAction { id: "view_zoom_in", key: "+", accelerator: ZOOM_IN_ACCELERATOR },
    ZoomAction { id: "view_zoom_out", key: "-", accelerator: "CmdOrCtrl+Minus" },
    ZoomAction { id: "view_actual_size", key: "0", accelerator: "CmdOrCtrl+Digit0" },
];

pub(crate) fn build<R: Runtime>(app: &AppHandle<R>, labels: &MenuLabels) -> tauri::Result<Submenu<R>> {
    let items = ZOOM_ACTIONS
        .iter()
        .zip([labels.zoom_in, labels.zoom_out, labels.actual_size])
        .map(|(action, label)| tauri::menu::MenuItem::with_id(app, action.id, label, true, Some(action.accelerator)))
        .collect::<tauri::Result<Vec<_>>>()?;
    let menu = Submenu::with_id_and_items(app, "view", labels.view, true, &[&items[0], &items[1], &items[2]])?;
    menu.append_items(&[&PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::fullscreen(app, Some(labels.enter_full_screen))?])?;
    Ok(menu)
}

fn key_for_menu_id(id: &str) -> Option<&'static str> {
    ZOOM_ACTIONS.iter().find(|action| action.id == id).map(|action| action.key)
}

pub(crate) fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) -> bool {
    let Some(key) = key_for_menu_id(id) else { return false };
    let windows = app.webview_windows();
    if let Some(window) = windows.values().find(|window| window.is_focused().unwrap_or(false)) {
        // Reuse Tauri's per-webview zoom-hotkey closure, including the zoom
        // last set by keyboard or wheel. Separate native state would drift.
        let script = format!(
            "window.dispatchEvent(new KeyboardEvent('keydown', {{key: {}, metaKey: true, bubbles: true}}))",
            serde_json::to_string(key).unwrap(),
        );
        if let Err(error) = window.eval(&script) {
            log::error!("failed to apply zoom menu action: {error}");
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn given_zoom_menu_items_when_mapped_then_they_use_standard_zoom_keys() {
        assert_eq!(key_for_menu_id("view_zoom_in"), Some("+"));
        assert_eq!(key_for_menu_id("view_zoom_out"), Some("-"));
        assert_eq!(key_for_menu_id("view_actual_size"), Some("0"));
    }

    #[test]
    fn given_unrelated_or_malformed_ids_when_mapped_then_they_are_not_zoom_actions() {
        for id in ["", "zoom", "edit_undo", "view_zoom_in ", "VIEW_ZOOM_IN", "view_zoom_in;alert(1)"] {
            assert_eq!(key_for_menu_id(id), None, "{id:?}");
        }
    }
}

#[cfg(feature = "e2e-testing")]
pub(crate) fn test_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    #[tauri::command]
    fn activate(app: AppHandle, id: String) -> bool {
        forward(&app, &id)
    }

    #[tauri::command]
    fn items(app: AppHandle) -> Result<Vec<(String, String)>, String> {
        let menu = app.menu().and_then(|menu| menu.get("view")).and_then(|item| item.as_submenu().cloned())
            .ok_or("View menu is missing")?;
        menu.items().map_err(|error| error.to_string())?.into_iter()
            .filter_map(|item| item.as_menuitem().cloned())
            .map(|item| item.text().map(|text| (item.id().as_ref().to_owned(), text)).map_err(|error| error.to_string()))
            .collect()
    }

    tauri::plugin::Builder::new("view-menu-test")
        .invoke_handler(tauri::generate_handler![activate, items])
        .build()
}
