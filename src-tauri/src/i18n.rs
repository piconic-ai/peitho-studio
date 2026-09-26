//! The UI language, for the parts of the UI built Rust-side: the native menu
//! bar and the "Open Deck" folder picker's title. Mirrors
//! `domain/language.ts` (which language) and `domain/messages.ts` (the
//! page's own messages), so the menus and the page never disagree.
//!
//! Pure: which language comes from the saved setting plus the OS locales
//! handed in, never read here.

use serde::{Deserialize, Serialize};

/// A language the UI has every label for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language {
    En,
    Ja,
}

/// The saved choice (`Settings::ui_language`): a language, or `System`
/// (nothing chosen yet) to follow the OS's preferred language.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LanguageSetting {
    #[default]
    System,
    En,
    Ja,
}

/// Whether a locale tag (`ja`, `ja-JP`, `ja_JP`, `JA-jp`, `ja-Jpan-JP`) is
/// Japanese: only its primary subtag counts, so `jam` is not.
pub fn is_japanese_locale(tag: &str) -> bool {
    tag.trim().split(['-', '_']).next().is_some_and(|primary| primary.eq_ignore_ascii_case("ja"))
}

/// Japanese when the OS's most preferred locale is, English otherwise
/// (including when there is none).
pub fn system_language<S: AsRef<str>>(locales: &[S]) -> Language {
    match locales.first() {
        Some(first) if is_japanese_locale(first.as_ref()) => Language::Ja,
        _ => Language::En,
    }
}

/// The language the UI is shown in: the saved choice, or the OS's when
/// nothing is chosen yet.
pub fn resolve_language<S: AsRef<str>>(setting: LanguageSetting, system_locales: &[S]) -> Language {
    match setting {
        LanguageSetting::System => system_language(system_locales),
        LanguageSetting::En => Language::En,
        LanguageSetting::Ja => Language::Ja,
    }
}

/// Every label the native menu bar shows. Predefined items (Cut, Quit, ...)
/// get their text from here too: left to Tauri, they'd be English whatever
/// the language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuLabels {
    pub file: &'static str,
    pub edit: &'static str,
    pub view: &'static str,
    pub window: &'static str,
    pub help: &'static str,
    pub new_deck: &'static str,
    pub open_deck: &'static str,
    pub open_recent: &'static str,
    pub no_recent_decks: &'static str,
    pub settings: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub close_window: &'static str,
    pub minimize: &'static str,
    pub zoom: &'static str,
    pub enter_full_screen: &'static str,
    pub services: &'static str,
    pub hide_others: &'static str,
    pub help_repository: &'static str,
    pub help_report_issue: &'static str,
    pub help_releases: &'static str,
    /// The folder picker "Open Deck…" shows.
    pub open_deck_dialog_title: &'static str,
    about_template: &'static str,
    hide_template: &'static str,
    quit_template: &'static str,
}

const APP_NAME_SLOT: &str = "{app}";

impl MenuLabels {
    /// "About <app>".
    pub fn about(&self, app_name: &str) -> String {
        self.about_template.replace(APP_NAME_SLOT, app_name)
    }

    /// "Hide <app>".
    pub fn hide(&self, app_name: &str) -> String {
        self.hide_template.replace(APP_NAME_SLOT, app_name)
    }

    /// "Quit <app>".
    pub fn quit(&self, app_name: &str) -> String {
        self.quit_template.replace(APP_NAME_SLOT, app_name)
    }
}

const EN: MenuLabels = MenuLabels {
    file: "File",
    edit: "Edit",
    view: "View",
    window: "Window",
    help: "Help",
    new_deck: "New Deck…",
    open_deck: "Open Deck…",
    open_recent: "Open Recent",
    no_recent_decks: "No Recent Decks",
    settings: "Settings…",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    close_window: "Close Window",
    minimize: "Minimize",
    zoom: "Zoom",
    enter_full_screen: "Enter Full Screen",
    services: "Services",
    hide_others: "Hide Others",
    help_repository: "Peitho Studio on GitHub",
    help_report_issue: "Report an Issue",
    help_releases: "Releases",
    open_deck_dialog_title: "Open Deck",
    about_template: "About {app}",
    hide_template: "Hide {app}",
    quit_template: "Quit {app}",
};

// macOS's own Japanese wording for the standard items, so they read the
// same as in every other Mac app.
const JA: MenuLabels = MenuLabels {
    file: "ファイル",
    edit: "編集",
    view: "表示",
    window: "ウインドウ",
    help: "ヘルプ",
    new_deck: "新規デッキ…",
    open_deck: "デッキを開く…",
    open_recent: "最近使ったデッキを開く",
    no_recent_decks: "最近使ったデッキはありません",
    settings: "設定…",
    undo: "取り消す",
    redo: "やり直す",
    cut: "カット",
    copy: "コピー",
    paste: "ペースト",
    select_all: "すべてを選択",
    close_window: "ウインドウを閉じる",
    minimize: "しまう",
    zoom: "拡大/縮小",
    enter_full_screen: "フルスクリーンにする",
    services: "サービス",
    hide_others: "ほかを隠す",
    help_repository: "GitHubのPeitho Studio",
    help_report_issue: "問題を報告",
    help_releases: "リリース一覧",
    open_deck_dialog_title: "デッキを開く",
    about_template: "{app}について",
    hide_template: "{app}を隠す",
    quit_template: "{app}を終了",
};

pub fn menu_labels(language: Language) -> &'static MenuLabels {
    match language {
        Language::En => &EN,
        Language::Ja => &JA,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NO_LOCALES: [&str; 0] = [];

    /// Every plain label, for the checks that apply to all of them.
    fn plain_labels(labels: &MenuLabels) -> Vec<(&'static str, &'static str)> {
        vec![
            ("file", labels.file),
            ("edit", labels.edit),
            ("view", labels.view),
            ("window", labels.window),
            ("help", labels.help),
            ("new_deck", labels.new_deck),
            ("open_deck", labels.open_deck),
            ("open_recent", labels.open_recent),
            ("no_recent_decks", labels.no_recent_decks),
            ("settings", labels.settings),
            ("undo", labels.undo),
            ("redo", labels.redo),
            ("cut", labels.cut),
            ("copy", labels.copy),
            ("paste", labels.paste),
            ("select_all", labels.select_all),
            ("close_window", labels.close_window),
            ("minimize", labels.minimize),
            ("zoom", labels.zoom),
            ("enter_full_screen", labels.enter_full_screen),
            ("services", labels.services),
            ("hide_others", labels.hide_others),
            ("help_repository", labels.help_repository),
            ("help_report_issue", labels.help_report_issue),
            ("help_releases", labels.help_releases),
            ("open_deck_dialog_title", labels.open_deck_dialog_title),
        ]
    }

    #[test]
    fn given_the_ways_an_os_spells_japanese_when_checked_then_each_is_japanese() {
        for tag in ["ja", "ja-JP", "ja_JP", "JA-jp", "ja-Jpan-JP", " ja-JP "] {
            assert!(is_japanese_locale(tag), "{tag:?}");
        }
    }

    #[test]
    fn given_other_or_malformed_tags_when_checked_then_none_is_japanese() {
        for tag in ["en", "en-US", "en-JP", "zh-Hans-JP", "", " ", "-", "_ja", "-ja", "jam", "j", "japanese", "日本語"] {
            assert!(!is_japanese_locale(tag), "{tag:?}");
        }
    }

    #[test]
    fn given_japanese_first_among_os_locales_when_resolved_then_the_ui_is_japanese() {
        assert_eq!(system_language(&["ja-JP", "en-US"]), Language::Ja);
    }

    #[test]
    fn given_english_or_nothing_first_when_resolved_then_the_ui_is_english() {
        assert_eq!(system_language(&["en-US", "ja-JP"]), Language::En);
        assert_eq!(system_language(&["fr-FR"]), Language::En);
        assert_eq!(system_language(&NO_LOCALES), Language::En);
        assert_eq!(system_language(&["", "ja"]), Language::En);
    }

    #[test]
    fn given_a_chosen_language_when_resolved_then_it_wins_over_the_os() {
        assert_eq!(resolve_language(LanguageSetting::En, &["ja-JP"]), Language::En);
        assert_eq!(resolve_language(LanguageSetting::Ja, &["en-US"]), Language::Ja);
        assert_eq!(resolve_language(LanguageSetting::Ja, &NO_LOCALES), Language::Ja);
    }

    #[test]
    fn given_nothing_chosen_when_resolved_then_the_os_language_is_used() {
        assert_eq!(resolve_language(LanguageSetting::System, &["ja"]), Language::Ja);
        assert_eq!(resolve_language(LanguageSetting::System, &["en"]), Language::En);
        assert_eq!(resolve_language(LanguageSetting::System, &NO_LOCALES), Language::En);
    }

    #[test]
    fn given_the_setting_when_serialized_then_it_matches_the_frontend_spelling() {
        // `domain/language.ts`'s `LanguageSetting`: 'system' | 'en' | 'ja'.
        assert_eq!(serde_json::to_string(&LanguageSetting::System).unwrap(), r#""system""#);
        assert_eq!(serde_json::to_string(&LanguageSetting::En).unwrap(), r#""en""#);
        assert_eq!(serde_json::to_string(&LanguageSetting::Ja).unwrap(), r#""ja""#);
        assert!(serde_json::from_str::<LanguageSetting>(r#""JA""#).is_err());
        assert!(serde_json::from_str::<LanguageSetting>(r#""fr""#).is_err());
    }

    #[test]
    fn given_each_language_when_the_menu_is_labelled_then_file_and_edit_read_in_that_language() {
        assert_eq!(menu_labels(Language::En).file, "File");
        assert_eq!(menu_labels(Language::Ja).file, "ファイル");
        assert_eq!(menu_labels(Language::En).settings, "Settings…");
        assert_eq!(menu_labels(Language::Ja).settings, "設定…");
    }

    #[test]
    fn given_the_app_name_when_about_hide_and_quit_are_labelled_then_it_is_inserted() {
        let en = menu_labels(Language::En);
        assert_eq!(en.about("Peitho Studio"), "About Peitho Studio");
        assert_eq!(en.hide("Peitho Studio"), "Hide Peitho Studio");
        assert_eq!(en.quit("Peitho Studio"), "Quit Peitho Studio");
        let ja = menu_labels(Language::Ja);
        assert_eq!(ja.about("Peitho Studio"), "Peitho Studioについて");
        assert_eq!(ja.quit("Peitho Studio"), "Peitho Studioを終了");
    }

    #[test]
    fn given_an_empty_or_odd_app_name_when_labelled_then_it_is_inserted_verbatim() {
        let ja = menu_labels(Language::Ja);
        assert_eq!(ja.quit(""), "を終了");
        assert_eq!(menu_labels(Language::En).about("{app}"), "About {app}");
    }

    #[test]
    fn given_every_language_when_labelled_then_no_label_is_blank_and_japanese_is_translated() {
        for language in [Language::En, Language::Ja] {
            for (name, label) in plain_labels(menu_labels(language)) {
                assert!(!label.trim().is_empty(), "{language:?} {name}");
            }
        }
        let en = plain_labels(menu_labels(Language::En));
        let ja = plain_labels(menu_labels(Language::Ja));
        for ((name, en_label), (_, ja_label)) in en.iter().zip(ja.iter()) {
            assert_ne!(en_label, ja_label, "{name} is left untranslated");
        }
    }
}
