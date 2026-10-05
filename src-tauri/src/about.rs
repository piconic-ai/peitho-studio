//! The About window: the app menu's "About Peitho Studio" (Help menu's last
//! item off macOS) opens `about.html` in a small window of its own.
//!
//! Replaces `PredefinedMenuItem::about`'s native panel, whose credits are
//! plain text with no clickable links.
//!
//! Links out follow `help_links`: the page names one of `AboutLink`'s
//! fixed links and the URL is built here, so the page can never have an
//! arbitrary URL opened. The commit link is built from the SHA embedded
//! at build time (`build.rs`), never from one the page sends.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use crate::help_links::REPOSITORY_URL;
use crate::{i18n, settings};

/// The menu item's id.
pub(crate) const MENU_ID: &str = "about";

/// The About window's label. There's only ever one.
pub(crate) const WINDOW_LABEL: &str = "about";

const WINDOW_WIDTH: f64 = 360.0;
const WINDOW_HEIGHT: f64 = 480.0;

const WEBSITE_URL: &str = "https://peitho-studio.piconic.ai/";

/// The CI run number, or `dev` (see `build_info::build_label`).
const BUILD: &str = env!("PEITHO_STUDIO_BUILD");
/// The commit this was built from, or empty outside a git checkout.
const COMMIT: &str = env!("PEITHO_STUDIO_COMMIT");

/// A link the About window can open.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AboutLink {
    Website,
    Github,
    License,
    Commit,
}

impl AboutLink {
    /// The URL this link opens, or `None` for `Commit` when there's no
    /// commit (`commit` empty or not a hex SHA).
    pub fn url(self, commit: &str) -> Option<String> {
        match self {
            AboutLink::Website => Some(WEBSITE_URL.to_string()),
            AboutLink::Github => Some(REPOSITORY_URL.to_string()),
            AboutLink::License => Some(format!("{REPOSITORY_URL}/blob/main/LICENSE")),
            AboutLink::Commit => {
                let is_sha = !commit.is_empty() && commit.bytes().all(|b| b.is_ascii_hexdigit());
                is_sha.then(|| format!("{REPOSITORY_URL}/commit/{commit}"))
            }
        }
    }
}

/// What the About window shows. `commit` is the full SHA, or empty when
/// the build has none; `copyright` is empty when `tauri.conf.json` sets
/// none.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AboutInfo {
    pub name: String,
    pub version: String,
    pub build: String,
    pub commit: String,
    pub copyright: String,
}

#[tauri::command]
pub fn get_about_info(app: AppHandle) -> AboutInfo {
    let package = app.package_info();
    AboutInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        build: BUILD.to_string(),
        commit: COMMIT.to_string(),
        copyright: app.config().bundle.copyright.clone().unwrap_or_default(),
    }
}

/// Opens `link` in the default browser.
#[tauri::command]
pub fn open_about_link(app: AppHandle, link: AboutLink) -> Result<(), String> {
    let url = link.url(COMMIT).ok_or_else(|| "this build has no commit to link to".to_string())?;
    app.opener().open_url(url, None::<&str>).map_err(|err| err.to_string())
}

/// Opens the About window, or brings it to the front if it's already open.
pub(crate) fn open_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.unminimize()?;
        return window.set_focus();
    }
    let labels = i18n::menu_labels(settings::ui_language(app));
    WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("about.html".into()))
        .title(labels.about(&app.package_info().name))
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "5995c42a1b2c3d4e5f60718293a4b5c6d7e8f901";

    #[test]
    fn given_each_fixed_link_when_resolved_then_its_own_url_comes_back() {
        assert_eq!(AboutLink::Website.url(SHA).as_deref(), Some("https://peitho-studio.piconic.ai/"));
        assert_eq!(AboutLink::Github.url(SHA).as_deref(), Some("https://github.com/piconic-ai/peitho-studio"));
        assert_eq!(AboutLink::License.url(SHA).as_deref(), Some("https://github.com/piconic-ai/peitho-studio/blob/main/LICENSE"));
    }

    #[test]
    fn given_a_commit_when_its_link_is_resolved_then_it_is_that_commits_github_page() {
        assert_eq!(
            AboutLink::Commit.url(SHA).as_deref(),
            Some("https://github.com/piconic-ai/peitho-studio/commit/5995c42a1b2c3d4e5f60718293a4b5c6d7e8f901")
        );
    }

    #[test]
    fn given_no_commit_when_its_link_is_resolved_then_there_is_no_url() {
        assert_eq!(AboutLink::Commit.url(""), None);
    }

    #[test]
    fn given_a_commit_that_is_not_a_sha_when_its_link_is_resolved_then_there_is_no_url() {
        for commit in ["../../evil", "https://example.com", "abc def", "abc/def", "g1234567", " "] {
            assert_eq!(AboutLink::Commit.url(commit), None, "{commit:?}");
        }
    }

    #[test]
    fn given_no_commit_when_the_fixed_links_are_resolved_then_they_still_open() {
        for link in [AboutLink::Website, AboutLink::Github, AboutLink::License] {
            assert!(link.url("").is_some(), "{link:?}");
        }
    }

    #[test]
    fn given_the_names_the_page_sends_when_deserialized_then_each_is_its_link() {
        for (name, link) in [("website", AboutLink::Website), ("github", AboutLink::Github), ("license", AboutLink::License), ("commit", AboutLink::Commit)] {
            assert_eq!(serde_json::from_value::<AboutLink>(serde_json::json!(name)).unwrap(), link);
        }
    }

    #[test]
    fn given_any_other_value_from_the_page_when_deserialized_then_it_is_rejected() {
        for value in [
            serde_json::json!(""),
            serde_json::json!("Website"),
            serde_json::json!("https://example.com"),
            serde_json::json!("website "),
            serde_json::json!(0),
            serde_json::json!(null),
            serde_json::json!({ "url": "https://example.com" }),
        ] {
            assert!(serde_json::from_value::<AboutLink>(value.clone()).is_err(), "{value}");
        }
    }

    #[test]
    fn given_this_build_when_embedded_then_build_is_set_and_commit_is_empty_or_linkable() {
        assert!(!BUILD.is_empty());
        assert!(COMMIT.is_empty() || AboutLink::Commit.url(COMMIT).is_some(), "{COMMIT:?}");
    }
}
