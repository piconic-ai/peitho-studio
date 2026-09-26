//! The Help menu's links out to the project's GitHub pages.
//!
//! Pure: which links exist, their menu ids and URLs. `lib.rs` builds the
//! menu items from `help_links` and, on a click, opens whatever
//! `url_for_menu_id` resolves the id to. The URLs are fixed here, never
//! taken from the menu event, so a click can only ever open one of them.

use crate::i18n::MenuLabels;

const REPOSITORY_URL: &str = "https://github.com/piconic-ai/peitho-studio";

/// Which Help link a menu item is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HelpLink {
    Repository,
    ReportIssue,
    Releases,
}

/// In the order the Help menu lists them.
pub const HELP_LINKS: [HelpLink; 3] = [HelpLink::Repository, HelpLink::ReportIssue, HelpLink::Releases];

impl HelpLink {
    pub fn menu_id(self) -> &'static str {
        match self {
            HelpLink::Repository => "help_link:repository",
            HelpLink::ReportIssue => "help_link:report_issue",
            HelpLink::Releases => "help_link:releases",
        }
    }

    pub fn url(self) -> String {
        match self {
            HelpLink::Repository => REPOSITORY_URL.to_string(),
            HelpLink::ReportIssue => format!("{REPOSITORY_URL}/issues/new"),
            HelpLink::Releases => format!("{REPOSITORY_URL}/releases"),
        }
    }

    pub fn label(self, labels: &MenuLabels) -> &'static str {
        match self {
            HelpLink::Repository => labels.help_repository,
            HelpLink::ReportIssue => labels.help_report_issue,
            HelpLink::Releases => labels.help_releases,
        }
    }
}

/// The URL a Help menu item opens, or `None` for any other menu id.
pub fn url_for_menu_id(id: &str) -> Option<String> {
    HELP_LINKS.iter().find(|link| link.menu_id() == id).map(|link| link.url())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{menu_labels, Language};

    #[test]
    fn given_each_help_link_when_its_menu_id_is_resolved_then_its_own_url_comes_back() {
        assert_eq!(url_for_menu_id("help_link:repository").as_deref(), Some("https://github.com/piconic-ai/peitho-studio"));
        assert_eq!(url_for_menu_id("help_link:report_issue").as_deref(), Some("https://github.com/piconic-ai/peitho-studio/issues/new"));
        assert_eq!(url_for_menu_id("help_link:releases").as_deref(), Some("https://github.com/piconic-ai/peitho-studio/releases"));
    }

    #[test]
    fn given_every_help_link_when_listed_then_ids_are_distinct_and_urls_are_https_github() {
        for (i, a) in HELP_LINKS.iter().enumerate() {
            assert!(a.url().starts_with("https://github.com/piconic-ai/peitho-studio"), "{a:?}");
            for b in &HELP_LINKS[i + 1..] {
                assert_ne!(a.menu_id(), b.menu_id());
                assert_ne!(a.url(), b.url());
            }
        }
    }

    #[test]
    fn given_other_or_malformed_menu_ids_when_resolved_then_no_url_comes_back() {
        for id in ["", "help_link:", "help_link:Repository", "help_link:repository ", "help_link:https://example.com", "open_settings", "recent_deck:0"] {
            assert_eq!(url_for_menu_id(id), None, "{id:?}");
        }
    }

    #[test]
    fn given_every_language_when_labelled_then_each_help_link_has_a_distinct_label() {
        for language in [Language::En, Language::Ja] {
            let labels = menu_labels(language);
            for (i, a) in HELP_LINKS.iter().enumerate() {
                assert!(!a.label(labels).trim().is_empty(), "{language:?} {a:?}");
                for b in &HELP_LINKS[i + 1..] {
                    assert_ne!(a.label(labels), b.label(labels), "{language:?}");
                }
            }
        }
    }
}
