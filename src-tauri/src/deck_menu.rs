//! Deck-wide frontmatter settings (page numbers, aspect ratio, line breaks,
//! language) in the native Edit menu, below Cut/Copy/Paste/Select All:
//!
//! ```text
//! Page Numbers: 1/N   ▸  Off / 1 / 1/N
//! Aspect Ratio: 16:9  ▸  16:9 / 4:3
//! Line Breaks as Written      (a check item)
//! Language: English   ▸  English / 日本語
//! ```
//!
//! Each parent shows the current value in its own label, so it reads at a
//! glance; opening it lists the choices, the current one checked. There is
//! only ever one level of submenu.
//!
//! The frontend owns the deck, so it reads each window's current values
//! from the frontmatter and reports them (`report_deck_settings` in
//! `peitho.rs`, which keeps them per window label). This module decides,
//! from the front window's values, each item's label, check mark and
//! enabled state, and what a click asks the front window to write. A click
//! is sent as the `menu:deck-setting` event to the focused window alone,
//! like Edit > Undo (see `edit_menu`): each window writes to its own deck.
//!
//! The keys and choices mirror `domain/deckSettings.ts`'s
//! `DECK_SETTING_CHOICES`, whose first choice per key is peitho-core's
//! default.
//!
//! On macOS, muda toggles a check item's own mark before the click reaches
//! the app, so the items are re-applied from the reported values right
//! after every click (`apply`): the mark then only moves once the frontend
//! has written the change and reported it back. `set_checked`, `set_enabled`
//! and a submenu's `set_text` all write straight to the live `NSMenuItem`s
//! (muda 0.19), so no rebuild of the menu is needed.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItemKind, Submenu};
use tauri::{AppHandle, Runtime};

use crate::i18n::MenuLabels;

/// The event a deck-setting click is forwarded to the focused window as.
pub(crate) const MENU_EVENT: &str = "menu:deck-setting";

/// The Edit menu's id, so `apply` can find the deck-setting items in it.
pub(crate) const EDIT_MENU_ID: &str = "edit";

const ID_PREFIX: &str = "deck:";

/// How many characters of a value the menu doesn't offer are shown in its
/// setting's label before it is cut short with `…`.
const MAX_RAW_LABEL_CHARS: usize = 32;

/// One deck setting: a top-level frontmatter key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SettingKey {
    PageNumbers,
    AspectRatio,
    Breaks,
    Lang,
}

impl SettingKey {
    pub(crate) const ALL: [SettingKey; 4] = [Self::PageNumbers, Self::AspectRatio, Self::Breaks, Self::Lang];

    /// The frontmatter key, as the frontend names it.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::PageNumbers => "page_numbers",
            Self::AspectRatio => "aspect_ratio",
            Self::Breaks => "breaks",
            Self::Lang => "lang",
        }
    }

    fn from_str(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|candidate| candidate.as_str() == key)
    }

    /// Every choice the menu offers, the default first.
    pub(crate) fn choices(self) -> &'static [&'static str] {
        match self {
            Self::PageNumbers => &["none", "current", "current_of_total"],
            Self::AspectRatio => &["16:9", "4:3"],
            Self::Breaks => &["false", "true"],
            Self::Lang => &["en", "ja"],
        }
    }

    /// The choice peitho-core uses when the key is absent.
    pub(crate) fn default_choice(self) -> &'static str {
        self.choices()[0]
    }

    /// `value` as one of the choices, spelled exactly, or `None`.
    pub(crate) fn choice_of(self, value: &str) -> Option<&'static str> {
        self.choices().iter().copied().find(|choice| *choice == value)
    }

    /// The choices that get an item of their own. Line breaks is a single
    /// on/off item standing for `true`; a click on it sends a toggle
    /// (`pick_for_click`).
    fn item_choices(self) -> &'static [&'static str] {
        match self {
            Self::Breaks => &["true"],
            _ => self.choices(),
        }
    }

    /// The setting's name in the menu.
    fn title(self, labels: &MenuLabels) -> &'static str {
        match self {
            Self::PageNumbers => labels.page_numbers,
            Self::AspectRatio => labels.aspect_ratio,
            Self::Breaks => labels.line_breaks,
            Self::Lang => labels.deck_language,
        }
    }
}

/// One setting as the frontend reported it (`DeckSettingState` in
/// `domain/deckSettings.ts`): one of the menu's choices, or a value on disk
/// that is none of them.
#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReportedSetting {
    Known { choice: String },
    Unknown { raw: String },
}

/// A window's settings as its frontend reported them.
#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct DeckSettings {
    pub page_numbers: ReportedSetting,
    pub aspect_ratio: ReportedSetting,
    pub breaks: ReportedSetting,
    pub lang: ReportedSetting,
}

impl DeckSettings {
    fn setting(&self, key: SettingKey) -> &ReportedSetting {
        match key {
            SettingKey::PageNumbers => &self.page_numbers,
            SettingKey::AspectRatio => &self.aspect_ratio,
            SettingKey::Breaks => &self.breaks,
            SettingKey::Lang => &self.lang,
        }
    }

    /// `key`'s choice, or `None` for a value the menu doesn't offer.
    fn choice(&self, key: SettingKey) -> Option<&str> {
        match self.setting(key) {
            ReportedSetting::Known { choice } => Some(choice),
            ReportedSetting::Unknown { .. } => None,
        }
    }
}

/// The `menu:deck-setting` payload: the choice to write for `key`. What
/// that writes (the default removes the key) is up to the frontend.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DeckSettingPick {
    pub key: &'static str,
    pub choice: &'static str,
}

/// The id of `key`'s item for `choice`, e.g. `deck:aspect_ratio:4:3`.
pub(crate) fn menu_id(key: SettingKey, choice: &str) -> String {
    format!("{ID_PREFIX}{}:{choice}", key.as_str())
}

/// The key and choice behind a deck-setting item id, or `None` for any
/// other id. Only the ids `menu_id` gives the menu's own items are read.
pub(crate) fn parse_menu_id(id: &str) -> Option<(SettingKey, &'static str)> {
    let (key, choice) = id.strip_prefix(ID_PREFIX)?.split_once(':')?;
    let key = SettingKey::from_str(key)?;
    let choice = key.item_choices().iter().find(|candidate| **candidate == choice)?;
    Some((key, choice))
}

/// The choice the Line Breaks item sends: the frontend flips whatever the
/// deck holds when the pick runs (`resolveDeckSettingPick` in
/// `domain/deckSettings.ts`). Deciding it here, from the last report,
/// would turn two quick clicks into on-and-on.
const BREAKS_TOGGLE: &str = "toggle";

/// What a click on `key`'s item for `choice` asks the front window to
/// write. `None` with no deck in front (the items are disabled then
/// anyway).
pub(crate) fn pick_for_click(key: SettingKey, choice: &'static str, front: Option<&DeckSettings>) -> Option<DeckSettingPick> {
    front?;
    let choice = if key == SettingKey::Breaks { BREAKS_TOGGLE } else { choice };
    Some(DeckSettingPick { key: key.as_str(), choice })
}

/// How one check item should look.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ItemState {
    pub id: String,
    pub checked: bool,
}

/// Every deck-setting check item's state for the front window's settings.
/// With no deck in front, nothing is checked. A key whose value is none of
/// the choices checks no item.
pub(crate) fn item_states(front: Option<&DeckSettings>) -> Vec<ItemState> {
    SettingKey::ALL
        .into_iter()
        .flat_map(|key| {
            key.item_choices().iter().map(move |choice| ItemState {
                id: menu_id(key, choice),
                checked: front.is_some_and(|settings| settings.choice(key) == Some(*choice)),
            })
        })
        .collect()
}

/// How one choice reads, both as an item of its own and as a setting's
/// current value. Numbers and ratios read the same in every language; the
/// languages are named in their own.
fn choice_label(key: SettingKey, choice: &str, labels: &MenuLabels) -> String {
    match (key, choice) {
        (SettingKey::PageNumbers, "none") => labels.page_numbers_off.to_string(),
        (SettingKey::PageNumbers, "current") => "1".to_string(),
        (SettingKey::PageNumbers, "current_of_total") => "1/N".to_string(),
        (SettingKey::Breaks, _) => labels.line_breaks.to_string(),
        (SettingKey::Lang, "en") => "English".to_string(),
        (SettingKey::Lang, "ja") => "日本語".to_string(),
        _ => choice.to_string(),
    }
}

/// A frontmatter value the menu doesn't offer, as its setting's label shows
/// it: on one line, cut short past `MAX_RAW_LABEL_CHARS` characters, an
/// empty one as `""`, and each `&` doubled so muda doesn't read it as a
/// mnemonic marker and drop it.
fn raw_value_label(raw: &str) -> String {
    let one_line: String = raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let trimmed = one_line.trim();
    if trimmed.is_empty() {
        return "\"\"".to_string();
    }
    let shown: String = if trimmed.chars().count() > MAX_RAW_LABEL_CHARS {
        trimmed.chars().take(MAX_RAW_LABEL_CHARS).chain(['…']).collect()
    } else {
        trimmed.to_string()
    };
    shown.replace('&', "&&")
}

/// The label of `key`'s item: its name and the front window's current
/// value (`Page Numbers: 1/N`), a value the menu doesn't offer shown as
/// written. With no deck in front, just the name. Line breaks, a single
/// check item, shows its value by its check mark, so its label adds one
/// only for a value the menu doesn't offer (`Line Breaks as Written: True`).
pub(crate) fn setting_label(key: SettingKey, front: Option<&DeckSettings>, labels: &MenuLabels) -> String {
    let title = key.title(labels);
    let Some(settings) = front else { return title.to_string() };
    let value = match settings.setting(key) {
        ReportedSetting::Known { .. } if key == SettingKey::Breaks => return title.to_string(),
        ReportedSetting::Known { choice } => choice_label(key, choice, labels),
        ReportedSetting::Unknown { raw } => raw_value_label(raw),
    };
    format!("{title}: {value}")
}

fn submenu_id(key: SettingKey) -> String {
    format!("{ID_PREFIX}{}", key.as_str())
}

fn check_items<R: Runtime>(app: &AppHandle<R>, key: SettingKey, labels: &MenuLabels) -> tauri::Result<Vec<CheckMenuItem<R>>> {
    key.item_choices()
        .iter()
        .map(|choice| CheckMenuItem::with_id(app, menu_id(key, choice), choice_label(key, choice, labels), false, false, None::<&str>))
        .collect()
}

fn setting_submenu<R: Runtime>(app: &AppHandle<R>, key: SettingKey, labels: &MenuLabels) -> tauri::Result<Submenu<R>> {
    let items = check_items(app, key, labels)?;
    let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|item| item as &dyn IsMenuItem<R>).collect();
    Submenu::with_id_and_items(app, submenu_id(key), setting_label(key, None, labels), false, &refs)
}

/// The deck-setting items the Edit menu ends with, in their menu order.
pub(crate) struct DeckItems<R: Runtime> {
    page_numbers: Submenu<R>,
    aspect_ratio: Submenu<R>,
    breaks: Vec<CheckMenuItem<R>>,
    lang: Submenu<R>,
}

impl<R: Runtime> DeckItems<R> {
    pub(crate) fn refs(&self) -> Vec<&dyn IsMenuItem<R>> {
        let mut items: Vec<&dyn IsMenuItem<R>> = vec![&self.page_numbers, &self.aspect_ratio];
        items.extend(self.breaks.iter().map(|item| item as &dyn IsMenuItem<R>));
        items.push(&self.lang);
        items
    }
}

/// Builds the deck-setting items disabled, unchecked, and without values;
/// `apply` then shows the front window's settings.
pub(crate) fn build<R: Runtime>(app: &AppHandle<R>, labels: &MenuLabels) -> tauri::Result<DeckItems<R>> {
    Ok(DeckItems {
        page_numbers: setting_submenu(app, SettingKey::PageNumbers, labels)?,
        aspect_ratio: setting_submenu(app, SettingKey::AspectRatio, labels)?,
        breaks: check_items(app, SettingKey::Breaks, labels)?,
        lang: setting_submenu(app, SettingKey::Lang, labels)?,
    })
}

/// Collects the deck-setting check items and submenus under `items`, by id.
fn collect<R: Runtime>(items: Vec<MenuItemKind<R>>, checks: &mut HashMap<String, CheckMenuItem<R>>, submenus: &mut HashMap<String, Submenu<R>>) {
    for item in items {
        let id = item.id().as_ref().to_string();
        if !id.starts_with(ID_PREFIX) {
            continue;
        }
        match item {
            MenuItemKind::Check(check) => {
                checks.insert(id, check);
            }
            MenuItemKind::Submenu(submenu) => {
                if let Ok(children) = submenu.items() {
                    collect(children, checks, submenus);
                }
                submenus.insert(id, submenu);
            }
            _ => {}
        }
    }
}

/// Shows the front window's settings (`None`: no deck in front, every item
/// disabled) in `menu`'s Edit menu. A menu without one is left alone.
pub(crate) fn apply<R: Runtime>(menu: &Menu<R>, front: Option<&DeckSettings>, labels: &MenuLabels) {
    let Some(edit_menu) = menu.get(EDIT_MENU_ID).and_then(|item| item.as_submenu().cloned()) else { return };
    let mut checks = HashMap::new();
    let mut submenus = HashMap::new();
    if let Ok(items) = edit_menu.items() {
        collect(items, &mut checks, &mut submenus);
    }
    let enabled = front.is_some();
    for state in item_states(front) {
        if let Some(item) = checks.get(&state.id) {
            let _ = item.set_checked(state.checked);
            let _ = item.set_enabled(enabled);
        }
    }
    for key in SettingKey::ALL {
        let text = setting_label(key, front, labels);
        if key == SettingKey::Breaks {
            // Its one check item carries the label.
            if let Some(item) = checks.get(&menu_id(key, "true")) {
                let _ = item.set_text(&text);
            }
        } else if let Some(submenu) = submenus.get(&submenu_id(key)) {
            let _ = submenu.set_text(&text);
            let _ = submenu.set_enabled(enabled);
        }
    }
}

/// Which window's settings the menu shows, and every window's reported
/// settings. Pure bookkeeping; the `Mutex` holding it lives in `peitho.rs`
/// with the rest of the per-window state.
#[derive(Default, Debug)]
pub(crate) struct DeckSettingsRegistry {
    by_window: HashMap<String, DeckSettings>,
    front: Option<String>,
}

impl DeckSettingsRegistry {
    /// Records `label`'s settings. A window reporting while focused is the
    /// front one from now on — so the first window, or a new one, counts
    /// even before any focus event has named it.
    ///
    /// Returns whether `label` is the front window now, i.e. whether the
    /// menu has anything new to show.
    pub(crate) fn report(&mut self, label: &str, settings: DeckSettings, focused: bool) -> bool {
        self.by_window.insert(label.to_string(), settings);
        if focused {
            self.front = Some(label.to_string());
        }
        self.front.as_deref() == Some(label)
    }

    /// `label`'s window came to the front.
    pub(crate) fn focus(&mut self, label: &str) {
        self.front = Some(label.to_string());
    }

    /// `label`'s window lost focus. If it was the front one, no window is
    /// in front until another gains focus — the app went to the back, or
    /// its window was minimized — so the items go disabled rather than
    /// offering picks no focused window would receive.
    pub(crate) fn blur(&mut self, label: &str) {
        if self.front.as_deref() == Some(label) {
            self.front = None;
        }
    }

    /// Forgets `label`'s settings: its window closed, or its page reloaded
    /// back to the welcome screen. It stays the front window if it was, so
    /// the menu shows no deck until another window comes to the front.
    pub(crate) fn remove(&mut self, label: &str) {
        self.by_window.remove(label);
    }

    /// The front window's settings, or `None` when it has no deck open.
    pub(crate) fn front_settings(&self) -> Option<&DeckSettings> {
        self.by_window.get(self.front.as_deref()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{menu_labels, Language};

    /// A reported setting: `raw:<text>` for a value the menu doesn't offer,
    /// anything else a choice.
    fn reported(value: &str) -> ReportedSetting {
        match value.strip_prefix("raw:") {
            Some(raw) => ReportedSetting::Unknown { raw: raw.to_string() },
            None => ReportedSetting::Known { choice: value.to_string() },
        }
    }

    fn settings(page_numbers: &str, aspect_ratio: &str, breaks: &str, lang: &str) -> DeckSettings {
        DeckSettings {
            page_numbers: reported(page_numbers),
            aspect_ratio: reported(aspect_ratio),
            breaks: reported(breaks),
            lang: reported(lang),
        }
    }

    fn defaults() -> DeckSettings {
        settings("none", "16:9", "false", "en")
    }

    fn en() -> &'static MenuLabels {
        menu_labels(Language::En)
    }

    fn ja() -> &'static MenuLabels {
        menu_labels(Language::Ja)
    }

    fn checked_ids(states: &[ItemState]) -> Vec<&str> {
        states.iter().filter(|state| state.checked).map(|state| state.id.as_str()).collect()
    }

    fn click(id: &str, front: Option<&DeckSettings>) -> Option<DeckSettingPick> {
        let (key, choice) = parse_menu_id(id)?;
        pick_for_click(key, choice, front)
    }

    #[test]
    fn given_each_key_when_asked_for_its_default_then_it_is_peitho_cores_default() {
        let defaults: Vec<&str> = SettingKey::ALL.into_iter().map(SettingKey::default_choice).collect();
        assert_eq!(defaults, ["none", "16:9", "false", "en"]);
    }

    #[test]
    fn given_each_choice_when_looked_up_then_it_is_found_as_itself() {
        for key in SettingKey::ALL {
            for choice in key.choices() {
                assert_eq!(key.choice_of(choice), Some(*choice), "{key:?} {choice}");
            }
        }
    }

    #[test]
    fn given_a_value_that_is_not_spelled_exactly_as_a_choice_when_looked_up_then_it_is_none() {
        for value in ["", " ", "16:9 ", " 16:9", "16：9", "4/3", "EN", "Ja", "fr", "true", "16:9\n"] {
            assert_eq!(SettingKey::AspectRatio.choice_of(value), None, "{value:?}");
            assert_eq!(SettingKey::Lang.choice_of(value), None, "{value:?}");
        }
    }

    #[test]
    fn given_another_keys_choice_when_looked_up_then_it_is_none() {
        assert_eq!(SettingKey::Lang.choice_of("4:3"), None);
        assert_eq!(SettingKey::AspectRatio.choice_of("ja"), None);
    }

    #[test]
    fn given_every_item_id_when_parsed_then_it_round_trips_to_its_key_and_choice() {
        for key in SettingKey::ALL {
            for choice in key.item_choices() {
                assert_eq!(parse_menu_id(&menu_id(key, choice)), Some((key, *choice)), "{key:?} {choice}");
            }
        }
    }

    /// Every setting's label, in menu order.
    fn labels_of(front: Option<&DeckSettings>, labels: &MenuLabels) -> Vec<String> {
        SettingKey::ALL.into_iter().map(|key| setting_label(key, front, labels)).collect()
    }

    #[test]
    fn given_the_ids_of_the_items_and_submenus_when_listed_then_each_is_distinct() {
        let mut ids: Vec<String> = item_states(Some(&defaults())).into_iter().map(|state| state.id).collect();
        ids.extend(SettingKey::ALL.into_iter().filter(|key| *key != SettingKey::Breaks).map(submenu_id));
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total);
        assert_eq!(total, (3 + 2 + 1 + 2) + 3);
    }

    #[test]
    fn given_ids_that_are_not_deck_items_when_parsed_then_none_is_read() {
        for id in [
            "",
            "deck",
            "deck:",
            "deck:lang",
            "deck:lang:",
            "deck:lang:fr",
            "deck:lang:JA",
            "deck:pointer_color:red",
            "deck:breaks:false",
            "deck:aspect_ratio:16:10",
            "DECK:lang:ja",
            " deck:lang:ja",
            "deck:lang:ja ",
            "edit_undo",
            "edit",
            "recent_deck:0",
            "deck:page_numbers",
        ] {
            assert_eq!(parse_menu_id(id), None, "{id:?}");
        }
    }

    #[test]
    fn given_a_ratio_choice_containing_a_colon_when_parsed_then_the_whole_ratio_is_the_choice() {
        assert_eq!(parse_menu_id("deck:aspect_ratio:4:3"), Some((SettingKey::AspectRatio, "4:3")));
    }

    #[test]
    fn given_a_deck_at_its_defaults_when_shown_then_off_16_9_and_english_are_checked() {
        let states = item_states(Some(&defaults()));
        assert_eq!(checked_ids(&states), ["deck:page_numbers:none", "deck:aspect_ratio:16:9", "deck:lang:en"]);
    }

    #[test]
    fn given_every_setting_changed_when_shown_then_the_deck_values_are_checked() {
        let states = item_states(Some(&settings("current_of_total", "4:3", "true", "ja")));
        assert_eq!(
            checked_ids(&states),
            ["deck:page_numbers:current_of_total", "deck:aspect_ratio:4:3", "deck:breaks:true", "deck:lang:ja"]
        );
    }

    #[test]
    fn given_values_the_menu_does_not_offer_when_shown_then_those_keys_check_nothing() {
        // An unknown value, or a "known" choice the menu doesn't have (a
        // frontend and menu out of step), checks nothing.
        let states = item_states(Some(&settings("raw:both", "16:10", "raw:yes", "raw:fr")));
        assert!(checked_ids(&states).is_empty());
    }

    #[test]
    fn given_no_deck_in_front_when_shown_then_every_item_is_unchecked() {
        let states = item_states(None);
        assert!(!states.is_empty());
        assert!(states.iter().all(|state| !state.checked));
    }

    #[test]
    fn given_the_deck_values_when_labelled_then_each_setting_shows_its_name_and_value() {
        let front = settings("current_of_total", "4:3", "true", "ja");
        let texts = |labels| labels_of(Some(&front), labels);
        assert_eq!(texts(en()), ["Page Numbers: 1/N", "Aspect Ratio: 4:3", "Line Breaks as Written", "Language: 日本語"]);
        assert_eq!(texts(ja()), ["ページ番号: 1/N", "縦横比: 4:3", "改行をそのまま反映", "言語: 日本語"]);
    }

    #[test]
    fn given_an_unknown_line_breaks_value_when_labelled_then_the_check_item_shows_it() {
        // `breaks: True` is on for peitho-core but none of the menu's
        // choices, so the unchecked item says what the deck holds.
        let front = settings("none", "16:9", "raw:True", "en");
        assert_eq!(setting_label(SettingKey::Breaks, Some(&front), ja()), "改行をそのまま反映: True");
        assert_eq!(setting_label(SettingKey::Breaks, Some(&defaults()), ja()), "改行をそのまま反映");
        assert_eq!(setting_label(SettingKey::Breaks, None, en()), "Line Breaks as Written");
    }

    #[test]
    fn given_the_defaults_when_labelled_then_off_is_worded_in_the_ui_language() {
        assert_eq!(setting_label(SettingKey::PageNumbers, Some(&defaults()), en()), "Page Numbers: Off");
        assert_eq!(setting_label(SettingKey::PageNumbers, Some(&defaults()), ja()), "ページ番号: なし");
        assert_eq!(setting_label(SettingKey::Lang, Some(&defaults()), ja()), "言語: English");
    }

    #[test]
    fn given_no_deck_in_front_when_labelled_then_only_the_names_are_shown() {
        let texts = labels_of(None, ja());
        assert_eq!(texts, ["ページ番号", "縦横比", "改行をそのまま反映", "言語"]);
    }

    #[test]
    fn given_a_value_the_menu_does_not_offer_when_labelled_then_it_is_shown_as_written() {
        let front = settings("raw:both", "raw:16：9", "false", "raw:fr");
        assert_eq!(setting_label(SettingKey::PageNumbers, Some(&front), ja()), "ページ番号: both");
        assert_eq!(setting_label(SettingKey::AspectRatio, Some(&front), en()), "Aspect Ratio: 16：9");
        assert_eq!(setting_label(SettingKey::Lang, Some(&front), en()), "Language: fr");
    }

    #[test]
    fn given_an_empty_or_blank_unknown_value_when_labelled_then_it_shows_as_empty_quotes() {
        for raw in ["raw:", "raw:   ", "raw:\t\n"] {
            let front = settings(raw, "16:9", "false", "en");
            assert_eq!(setting_label(SettingKey::PageNumbers, Some(&front), en()), "Page Numbers: \"\"", "{raw:?}");
        }
    }

    #[test]
    fn given_a_very_long_unknown_value_when_labelled_then_it_is_cut_short_on_a_character_boundary() {
        let long = "日".repeat(100);
        let front = settings("none", "16:9", "false", &format!("raw:{long}"));
        let label = setting_label(SettingKey::Lang, Some(&front), en());
        assert_eq!(label, format!("Language: {}…", "日".repeat(MAX_RAW_LABEL_CHARS)));
        let exact = "a".repeat(MAX_RAW_LABEL_CHARS);
        let front = settings("none", "16:9", "false", &format!("raw:{exact}"));
        assert_eq!(setting_label(SettingKey::Lang, Some(&front), en()), format!("Language: {exact}"));
    }

    #[test]
    fn given_an_unknown_value_with_line_breaks_or_ampersands_when_labelled_then_it_stays_on_one_line_intact() {
        let front = settings("raw:a\nb\r\nc", "16:9", "false", "raw:en&ja");
        assert_eq!(setting_label(SettingKey::PageNumbers, Some(&front), en()), "Page Numbers: a b  c");
        // muda strips a single `&` as a mnemonic marker; `&&` shows as `&`.
        assert_eq!(setting_label(SettingKey::Lang, Some(&front), en()), "Language: en&&ja");
    }

    #[test]
    fn given_a_choice_item_when_clicked_then_that_choice_is_picked() {
        let front = defaults();
        assert_eq!(click("deck:aspect_ratio:4:3", Some(&front)), Some(DeckSettingPick { key: "aspect_ratio", choice: "4:3" }));
        assert_eq!(click("deck:page_numbers:none", Some(&front)), Some(DeckSettingPick { key: "page_numbers", choice: "none" }));
    }

    #[test]
    fn given_line_breaks_in_any_state_when_clicked_then_a_toggle_is_sent() {
        // The frontend resolves it against the deck when the pick runs, so
        // a second click before the first is reported back still flips.
        let toggle = Some(DeckSettingPick { key: "breaks", choice: "toggle" });
        assert_eq!(click("deck:breaks:true", Some(&defaults())), toggle);
        assert_eq!(click("deck:breaks:true", Some(&settings("none", "16:9", "true", "en"))), toggle);
        assert_eq!(click("deck:breaks:true", Some(&settings("none", "16:9", "raw:yes", "en"))), toggle);
    }

    #[test]
    fn given_no_deck_in_front_when_clicked_then_nothing_is_picked() {
        assert_eq!(click("deck:lang:ja", None), None);
    }

    #[test]
    fn given_the_pick_when_serialized_then_it_matches_the_frontend_payload() {
        // `parseDeckSettingPick` in domain/deckSettings.ts reads `{ key, choice }`.
        let json = serde_json::to_string(&DeckSettingPick { key: "lang", choice: "ja" }).unwrap();
        assert_eq!(json, r#"{"key":"lang","choice":"ja"}"#);
    }

    #[test]
    fn given_the_frontend_report_when_deserialized_then_known_and_unknown_values_are_read() {
        let report: DeckSettings = serde_json::from_str(
            r#"{"page_numbers":{"kind":"known","choice":"current"},"aspect_ratio":{"kind":"unknown","raw":"16:10"},
                "breaks":{"kind":"known","choice":"false"},"lang":{"kind":"unknown","raw":""}}"#,
        )
        .unwrap();
        assert_eq!(report, settings("current", "raw:16:10", "false", "raw:"));
    }

    #[test]
    fn given_a_malformed_report_when_deserialized_then_it_is_refused() {
        for json in [
            r#"{"page_numbers":"current","aspect_ratio":"16:9","breaks":"false","lang":"en"}"#,
            r#"{"page_numbers":{"kind":"maybe","choice":"current"},"aspect_ratio":{"kind":"known","choice":"16:9"},"breaks":{"kind":"known","choice":"false"},"lang":{"kind":"known","choice":"en"}}"#,
            r#"{"page_numbers":{"kind":"known"},"aspect_ratio":{"kind":"known","choice":"16:9"},"breaks":{"kind":"known","choice":"false"},"lang":{"kind":"known","choice":"en"}}"#,
            r#"{"page_numbers":{"kind":"known","choice":"none"}}"#,
            r#"null"#,
        ] {
            assert!(serde_json::from_str::<DeckSettings>(json).is_err(), "{json}");
        }
    }

    #[test]
    fn given_each_key_when_its_choices_are_listed_then_the_default_comes_first() {
        let defaults: Vec<&str> = SettingKey::ALL.into_iter().map(|key| key.choices()[0]).collect();
        assert_eq!(defaults, ["none", "16:9", "false", "en"]);
    }

    #[test]
    fn given_two_windows_when_one_is_focused_then_the_menu_follows_it() {
        let mut registry = DeckSettingsRegistry::default();
        let english = defaults();
        let japanese = settings("current", "4:3", "true", "ja");
        registry.report("main", english.clone(), true);
        registry.report("deck-2", japanese.clone(), false);
        assert_eq!(registry.front_settings(), Some(&english));
        registry.focus("deck-2");
        assert_eq!(registry.front_settings(), Some(&japanese));
        registry.focus("main");
        assert_eq!(registry.front_settings(), Some(&english));
    }

    #[test]
    fn given_the_front_window_reports_a_change_then_the_menu_shows_it() {
        let mut registry = DeckSettingsRegistry::default();
        registry.focus("main");
        registry.report("main", defaults(), true);
        let changed = settings("none", "4:3", "false", "en");
        registry.report("main", changed.clone(), true);
        assert_eq!(registry.front_settings(), Some(&changed));
    }

    #[test]
    fn given_a_window_in_the_back_reports_then_the_front_one_stays_shown() {
        let mut registry = DeckSettingsRegistry::default();
        assert!(registry.report("main", defaults(), true));
        // Nothing for the menu to show, so it needn't be refreshed.
        assert!(!registry.report("deck-2", settings("current", "4:3", "true", "ja"), false));
        assert_eq!(registry.front_settings(), Some(&defaults()));
        // The front window reporting while not focused (a focus event
        // already named it) still counts.
        assert!(registry.report("main", defaults(), false));
    }

    #[test]
    fn given_a_focused_window_without_a_deck_then_the_menu_shows_no_deck() {
        let mut registry = DeckSettingsRegistry::default();
        registry.report("main", defaults(), true);
        registry.focus("deck-2");
        assert_eq!(registry.front_settings(), None);
    }

    #[test]
    fn given_the_front_window_is_removed_then_the_menu_shows_no_deck_until_another_is_focused() {
        let mut registry = DeckSettingsRegistry::default();
        registry.report("main", defaults(), false);
        registry.report("deck-2", settings("current", "4:3", "true", "ja"), true);
        registry.remove("deck-2");
        assert_eq!(registry.front_settings(), None);
        registry.focus("main");
        assert_eq!(registry.front_settings(), Some(&defaults()));
    }

    #[test]
    fn given_the_front_window_loses_focus_then_the_menu_shows_no_deck_until_it_is_focused_again() {
        let mut registry = DeckSettingsRegistry::default();
        registry.report("main", defaults(), true);
        registry.blur("main");
        assert_eq!(registry.front_settings(), None);
        registry.focus("main");
        assert_eq!(registry.front_settings(), Some(&defaults()));
    }

    #[test]
    fn given_focus_moves_between_windows_when_the_old_one_blurs_last_then_the_new_one_stays_in_front() {
        // The order of the two events isn't guaranteed; either way, the
        // window that gained focus must be the one shown.
        let mut registry = DeckSettingsRegistry::default();
        let japanese = settings("current", "4:3", "true", "ja");
        registry.report("main", defaults(), true);
        registry.report("deck-2", japanese.clone(), false);
        registry.focus("deck-2");
        registry.blur("main");
        assert_eq!(registry.front_settings(), Some(&japanese));
        registry.blur("deck-2");
        registry.focus("main");
        assert_eq!(registry.front_settings(), Some(&defaults()));
    }

    #[test]
    fn given_nothing_reported_or_removing_an_unknown_window_then_nothing_breaks() {
        let mut registry = DeckSettingsRegistry::default();
        assert_eq!(registry.front_settings(), None);
        registry.remove("never-seen");
        registry.focus("");
        assert_eq!(registry.front_settings(), None);
    }
}
