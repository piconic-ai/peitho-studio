//! The app's log file, written in release builds too so a bug report can
//! attach it, and the panic hook that records a Rust panic there.
//!
//! What gets logged: failures and lifecycle events, with a deck referred to
//! by its file name at most. Never a deck's text, a slide's content or an
//! image path in full — the log is meant to be attached to a public issue.

use std::any::Any;
use std::panic::Location;
use std::path::{Path, PathBuf};

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_opener::OpenerExt;

/// The Help menu's "Show Log File in Finder" item.
pub(crate) const LOG_FILE_MENU_ID: &str = "show_log_file";

/// The current log file is `<this>.log` in the app log directory (rotated
/// ones get a timestamp suffix).
const LOG_FILE_NAME: &str = "Peitho Studio";

/// Once the current file reaches this size it is rotated, keeping only the
/// previous one, so the log directory holds at most about twice this.
const MAX_LOG_FILE_BYTES: u128 = 5 * 1024 * 1024;

/// The log plugin: the app log directory (`~/Library/Logs/<identifier>/`
/// on macOS) always, plus stdout in debug builds for `tauri dev`.
pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let mut targets = vec![Target::new(TargetKind::LogDir { file_name: Some(LOG_FILE_NAME.into()) })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::default()
        .clear_targets()
        .targets(targets)
        .level(log::LevelFilter::Info)
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepOne)
        .build()
}

/// Shows the current log file in Finder, selected in its folder — the file a
/// bug report attaches.
///
/// Not `open_path` on the folder: the log directory is named after the
/// bundle identifier (`studio.peitho.app`), and its `.app` suffix makes
/// macOS treat it as an application bundle, so `open` tries to launch it
/// ("its executable is missing") instead of showing it.
pub(crate) fn show_log_file<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    app.opener().reveal_item_in_dir(log_file_path(&dir)).map_err(|err| err.to_string())
}

/// Where the log plugin writes the current log file, given the log directory.
pub fn log_file_path(log_dir: &Path) -> PathBuf {
    log_dir.join(format!("{LOG_FILE_NAME}.log"))
}

/// Logs every panic before handing it on to the hook already installed
/// (Rust's default one prints it to stderr, which a bundled app has no
/// one reading).
pub(crate) fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("{}", format_panic(info.payload(), info.location()));
        previous(info);
    }));
}

/// One log line for a panic: where it happened and its message, with any
/// line breaks in the message escaped so the entry stays on one line.
pub fn format_panic(payload: &(dyn Any + Send), location: Option<&Location<'_>>) -> String {
    let message = panic_message(payload).replace("\r\n", "\\n").replace(['\n', '\r'], "\\n");
    match location {
        Some(location) => format!("panicked at {}:{}:{}: {message}", location.file(), location.line(), location.column()),
        None => format!("panicked: {message}"),
    }
}

/// `panic!("...")` carries a `&str`, `panic!("{x}")` a `String`; anything
/// else (`std::panic::panic_any`) has no text to show.
fn panic_message(payload: &(dyn Any + Send)) -> &str {
    if let Some(message) = payload.downcast_ref::<&str>() {
        message
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message
    } else {
        "<non-string panic payload>"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn here() -> &'static Location<'static> {
        Location::caller()
    }

    #[test]
    fn given_the_log_directory_when_the_log_file_is_located_then_it_is_the_app_named_log_inside_it() {
        let dir = Path::new("/Users/someone/Library/Logs/studio.peitho.app");
        assert_eq!(log_file_path(dir), dir.join("Peitho Studio.log"));
    }

    #[test]
    fn given_an_empty_or_relative_directory_when_the_log_file_is_located_then_only_the_file_name_is_joined() {
        assert_eq!(log_file_path(Path::new("")), PathBuf::from("Peitho Studio.log"));
        assert_eq!(log_file_path(Path::new("logs")), PathBuf::from("logs/Peitho Studio.log"));
    }

    #[test]
    fn given_a_str_message_and_a_location_when_formatted_then_both_are_on_the_line() {
        let location = here();
        let line = format_panic(&"index out of bounds", Some(location));
        assert_eq!(line, format!("panicked at {}:{}:{}: index out of bounds", location.file(), location.line(), location.column()));
    }

    #[test]
    fn given_a_string_message_when_formatted_then_its_text_is_used() {
        assert_eq!(format_panic(&String::from("bad state: 3"), None), "panicked: bad state: 3");
    }

    #[test]
    fn given_no_location_when_formatted_then_only_the_message_is_shown() {
        assert_eq!(format_panic(&"boom", None), "panicked: boom");
    }

    #[test]
    fn given_a_payload_that_is_not_a_string_when_formatted_then_a_placeholder_is_shown() {
        assert_eq!(format_panic(&42_i32, None), "panicked: <non-string panic payload>");
        assert_eq!(format_panic(&(), None), "panicked: <non-string panic payload>");
    }

    #[test]
    fn given_a_message_with_line_breaks_when_formatted_then_it_stays_on_one_line() {
        let line = format_panic(&"first\nsecond\r\nthird\rfourth", None);
        assert_eq!(line, "panicked: first\\nsecond\\nthird\\nfourth");
        assert!(!line.contains(['\n', '\r']));
    }

    #[test]
    fn given_an_empty_message_when_formatted_then_the_prefix_is_still_there() {
        assert_eq!(format_panic(&"", None), "panicked: ");
    }

    #[test]
    fn given_a_real_panic_when_the_hook_runs_then_it_formats_that_panic() {
        // The same payload/location a real `panic!` hands the hook. The hook
        // is process-wide, so a panic from a test running in parallel may
        // land here too: collect every line and look for this one, and pass
        // each one on so a parallel test's failure still gets reported.
        let caught = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = caught.clone();
        let previous = std::sync::Arc::new(std::panic::take_hook());
        let forward = previous.clone();
        std::panic::set_hook(Box::new(move |info| {
            let line = format_panic(info.payload(), info.location());
            let is_ours = line.contains("deck 7");
            sink.lock().unwrap().push(line);
            if !is_ours {
                forward(info);
            }
        }));
        let result = std::panic::catch_unwind(|| panic!("deck {} failed\nto render", 7));
        std::panic::set_hook(Box::new(move |info| previous(info)));
        assert!(result.is_err());
        let line = caught.lock().unwrap().iter().find(|line| line.contains("deck 7")).cloned().expect("hook ran");
        assert!(line.starts_with("panicked at src/logging.rs:"), "{line}");
        assert!(line.ends_with(": deck 7 failed\\nto render"), "{line}");
    }
}
