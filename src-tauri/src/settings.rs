//! App-wide settings: one `settings.json` under the app's config directory,
//! shared by every window (not per window, unlike `peitho::PeithoSession`).
//!
//! Persisted as a plain JSON file, read and written on every access, the
//! same way `peitho::read_recent_decks` handles the recent-deck list —
//! no `tauri-plugin-store` dependency, and no in-memory copy to keep in a
//! `Mutex`: the file is the only state. Commands are synchronous, so they
//! run one at a time on the main thread and a read-modify-write in
//! `update_settings` can't interleave with another window's.
//!
//! The file is read leniently (`overlay`): a missing file, broken JSON, a
//! value of the wrong type or a key this build doesn't know all fall back
//! to the default for just the affected field, so a bad file never keeps
//! the app from starting. `domain/settings.ts` mirrors the same shape and
//! rules on the frontend.

use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::i18n::{self, Language, LanguageSetting};

/// Broadcast to every window after a change is saved, carrying the new
/// `Settings`, so a change made in one window shows up in all of them.
pub(crate) const SETTINGS_CHANGED_EVENT: &str = "settings:changed";

/// The app menu's "Settings…" item.
pub(crate) const MENU_ID: &str = "open_settings";

/// Sent to the focused window when "Settings…" is chosen: the settings
/// panel is an in-app modal, so only the window the user is looking at
/// should open it.
pub(crate) const MENU_EVENT: &str = "menu:settings";

const FILE_NAME: &str = "settings.json";

/// Every setting the app has. Adding one is a field here with a
/// `Default`, plus the matching field in `domain/settings.ts`.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// The UI's language; `System` (the default) follows the OS.
    pub ui_language: LanguageSetting,
    /// Vim key bindings in the slide body and notes editors. Off by
    /// default.
    pub vim_mode: bool,
}

/// `base` with each of its fields replaced by `input`'s value for that
/// field, when that value deserializes; fields whose value doesn't keep
/// `base`'s. Keys `T` doesn't have are dropped, and an `input` that isn't a
/// JSON object changes nothing.
fn overlay<T: Serialize + DeserializeOwned + Default>(base: &T, input: &Value) -> T {
    let Ok(Value::Object(mut merged)) = serde_json::to_value(base) else {
        return T::default();
    };
    if let Value::Object(given) = input {
        let keys: Vec<String> = merged.keys().cloned().collect();
        for key in keys {
            let Some(value) = given.get(&key) else { continue };
            let mut candidate = merged.clone();
            candidate.insert(key.clone(), value.clone());
            if serde_json::from_value::<T>(Value::Object(candidate)).is_ok() {
                merged.insert(key, value.clone());
            }
        }
    }
    serde_json::from_value(Value::Object(merged)).unwrap_or_default()
}

/// Settings read from a file's text: the default for broken JSON or
/// anything but an object, and otherwise each field from the file when
/// valid, its default when missing or invalid (see `overlay`).
fn settings_from_json<T: Serialize + DeserializeOwned + Default>(json: &str) -> T {
    serde_json::from_str::<Value>(json).map(|value| overlay(&T::default(), &value)).unwrap_or_default()
}

/// `current` with the fields in `patch` replaced, each only when its new
/// value is valid (see `overlay`). Patching rather than replacing the
/// whole value keeps one window's change from reverting a field another
/// window changed a moment earlier.
fn apply_patch<T: Serialize + DeserializeOwned + Default>(current: &T, patch: &Map<String, Value>) -> T {
    overlay(current, &Value::Object(patch.clone()))
}

fn read_settings_file<T: Serialize + DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read_to_string(path).map(|json| settings_from_json(&json)).unwrap_or_default()
}

/// Writes through a temporary file and a rename, so a crash mid-write
/// leaves the previous file intact rather than a truncated one.
fn write_settings_file<T: Serialize>(path: &Path, settings: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|err| format!("failed to write {}: {err}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|err| format!("failed to replace {}: {err}", path.display()))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("failed to create {}: {err}", dir.display()))?;
    Ok(dir.join(FILE_NAME))
}

pub(crate) fn read_settings(app: &AppHandle) -> Settings {
    settings_path(app).map(|path| read_settings_file(&path)).unwrap_or_default()
}

/// The OS's preferred locales, most preferred first.
pub(crate) fn system_locales() -> Vec<String> {
    sys_locale::get_locales().collect()
}

/// The language the UI is shown in right now: the saved choice, or the
/// OS's. What the native menu bar is built in.
pub(crate) fn ui_language(app: &AppHandle) -> Language {
    i18n::resolve_language(read_settings(app).ui_language, &system_locales())
}

pub(crate) fn menu_item<R: Runtime>(app: &AppHandle<R>, label: &str) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, MENU_ID, label, true, Some("CmdOrCtrl+,"))
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    read_settings(&app)
}

/// The OS's preferred locales, for the page to pick the same language as
/// the menu bar while nothing is chosen (`domain/language.ts`). Read here
/// rather than from the webview's `navigator.languages`, which WKWebView
/// may not report the same way.
#[tauri::command]
pub fn get_system_locales() -> Vec<String> {
    system_locales()
}

/// Saves `patch` over the stored settings and tells every window. Resolves
/// to the settings as saved, invalid fields in `patch` left out.
#[tauri::command]
pub fn update_settings(app: AppHandle, patch: Map<String, Value>) -> Result<Settings, String> {
    let path = settings_path(&app)?;
    let next: Settings = apply_patch(&read_settings_file::<Settings>(&path), &patch);
    write_settings_file(&path, &next)?;
    // The menu bar's labels follow the UI language; rebuilt whole, as after
    // a Recent-list change (see `build_menu` in lib.rs).
    if let Ok(menu) = crate::build_menu(&app) {
        let _ = app.set_menu(menu);
    }
    let _ = app.emit(SETTINGS_CHANGED_EVENT, &next);
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // A stand-in with more fields than `Settings` itself, so the per-field
    // reading every future field relies on is exercised now.
    #[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct Sample {
        vim_mode: bool,
        ui_language: Language,
        font_size: u8,
    }

    #[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
    #[serde(rename_all = "lowercase")]
    enum Language {
        En,
        Ja,
    }

    impl Default for Sample {
        fn default() -> Self {
            Sample { vim_mode: false, ui_language: Language::En, font_size: 14 }
        }
    }

    fn patch(value: Value) -> Map<String, Value> {
        value.as_object().cloned().expect("patch must be an object")
    }

    #[test]
    fn given_a_complete_valid_file_when_read_then_every_field_comes_from_it() {
        let read: Sample = settings_from_json(r#"{"vimMode":true,"uiLanguage":"ja","fontSize":18}"#);
        assert_eq!(read, Sample { vim_mode: true, ui_language: Language::Ja, font_size: 18 });
    }

    #[test]
    fn given_a_file_missing_some_keys_when_read_then_those_fields_are_defaults() {
        // An older file, written before a field existed.
        let read: Sample = settings_from_json(r#"{"vimMode":true}"#);
        assert_eq!(read, Sample { vim_mode: true, ..Sample::default() });
    }

    #[test]
    fn given_one_field_of_the_wrong_type_when_read_then_only_that_field_is_the_default() {
        let read: Sample = settings_from_json(r#"{"vimMode":"yes","uiLanguage":"ja","fontSize":300}"#);
        assert_eq!(read, Sample { ui_language: Language::Ja, ..Sample::default() });
    }

    #[test]
    fn given_an_unknown_enum_value_when_read_then_that_field_is_the_default() {
        let read: Sample = settings_from_json(r#"{"uiLanguage":"fr"}"#);
        assert_eq!(read, Sample::default());
    }

    #[test]
    fn given_unknown_keys_when_read_then_they_are_ignored() {
        let read: Sample = settings_from_json(r#"{"fontSize":12,"theme":"dark","__proto__":{}}"#);
        assert_eq!(read, Sample { font_size: 12, ..Sample::default() });
    }

    #[test]
    fn given_broken_or_non_object_json_when_read_then_everything_is_the_default() {
        for json in ["", " ", "{", "not json", "null", "[]", "42", r#""text""#, "true", "{\"vimMode\":true"] {
            let read: Sample = settings_from_json(json);
            assert_eq!(read, Sample::default(), "{json:?}");
        }
    }

    #[test]
    fn given_valid_patch_when_applied_then_only_the_patched_field_changes() {
        let current = Sample { font_size: 20, ..Sample::default() };
        let next = apply_patch(&current, &patch(json!({ "vimMode": true })));
        assert_eq!(next, Sample { vim_mode: true, font_size: 20, ..Sample::default() });
    }

    #[test]
    fn given_an_invalid_value_in_a_patch_when_applied_then_the_current_value_is_kept() {
        // Not reset to the default: the field keeps what it had.
        let current = Sample { ui_language: Language::Ja, ..Sample::default() };
        let next = apply_patch(&current, &patch(json!({ "uiLanguage": "fr", "vimMode": 1 })));
        assert_eq!(next, current);
    }

    #[test]
    fn given_an_empty_or_unknown_key_patch_when_applied_then_nothing_changes() {
        let current = Sample { vim_mode: true, ..Sample::default() };
        assert_eq!(apply_patch(&current, &Map::new()), current);
        assert_eq!(apply_patch(&current, &patch(json!({ "unknown": 1, "": null }))), current);
    }

    #[test]
    fn given_no_saved_language_when_the_real_settings_are_read_then_the_ui_follows_the_os() {
        for json in ["", "{}", r#"{"vimMode":true}"#, "[]", r#"{"uiLanguage":"fr"}"#, r#"{"uiLanguage":null}"#] {
            assert_eq!(settings_from_json::<Settings>(json).ui_language, LanguageSetting::System, "{json:?}");
        }
        assert_eq!(Settings::default().ui_language, LanguageSetting::System);
    }

    #[test]
    fn given_a_saved_language_when_the_real_settings_are_read_then_it_is_kept() {
        let read: Settings = settings_from_json(r#"{"uiLanguage":"ja"}"#);
        assert_eq!(read.ui_language, LanguageSetting::Ja);
    }

    #[test]
    fn given_a_language_patch_when_applied_to_the_real_settings_then_only_a_valid_one_lands() {
        let next = apply_patch(&Settings::default(), &patch(json!({ "uiLanguage": "en" })));
        assert_eq!(next.ui_language, LanguageSetting::En);
        let kept = apply_patch(&next, &patch(json!({ "uiLanguage": "english" })));
        assert_eq!(kept.ui_language, LanguageSetting::En);
    }

    #[test]
    fn given_the_real_settings_with_vim_mode_on_when_read_then_vim_mode_is_on() {
        let read: Settings = settings_from_json(r#"{"vimMode":true}"#);
        assert_eq!(read, Settings { vim_mode: true, ..Settings::default() });
    }

    #[test]
    fn given_the_real_settings_without_a_valid_vim_mode_when_read_then_vim_mode_is_off() {
        for json in ["", "{}", "[]", r#"{"vimMode":"true"}"#, r#"{"vimMode":1}"#, r#"{"vimMode":null}"#] {
            assert_eq!(settings_from_json::<Settings>(json), Settings::default(), "{json:?}");
        }
        assert!(!Settings::default().vim_mode);
    }

    #[test]
    fn given_the_real_settings_when_serialized_then_the_frontend_field_names_are_used() {
        // `domain/settings.ts` reads `uiLanguage` and `vimMode`; a rename
        // here would silently turn every saved choice back into the default.
        assert_eq!(
            serde_json::to_string(&Settings::default()).unwrap(),
            r#"{"uiLanguage":"system","vimMode":false}"#
        );
    }

    #[test]
    fn given_no_settings_file_when_read_then_it_is_the_default() {
        let dir = tempfile::tempdir().unwrap();
        let read: Sample = read_settings_file(&dir.path().join(FILE_NAME));
        assert_eq!(read, Sample::default());
    }

    #[test]
    fn given_settings_written_when_read_back_then_they_round_trip() {
        // What a restart relies on: the next launch reads what the last
        // change wrote.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let saved = Sample { vim_mode: true, ui_language: Language::Ja, font_size: 16 };
        write_settings_file(&path, &saved).unwrap();
        assert_eq!(read_settings_file::<Sample>(&path), saved);
    }

    #[test]
    fn given_an_existing_file_when_written_then_it_is_replaced_and_no_temp_file_is_left() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, "{ broken").unwrap();
        write_settings_file(&path, &Sample::default()).unwrap();
        assert_eq!(read_settings_file::<Sample>(&path), Sample::default());
        let names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![FILE_NAME.to_string()]);
    }

    #[test]
    fn given_a_directory_that_does_not_exist_when_written_then_it_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join(FILE_NAME);
        assert!(write_settings_file(&path, &Sample::default()).is_err());
    }
}
