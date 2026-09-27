//! The native Deck menu: deck-wide frontmatter settings (page numbers,
//! aspect ratio, line breaks, language), each a closed list of choices.
//!
//! The frontend owns the deck, so it reads each window's current values
//! from the frontmatter and reports them (`report_deck_settings` in
//! `peitho.rs`, which keeps them per window label). This module decides,
//! from the front window's values, which items are checked and enabled,
//! and what a click asks the front window to write. A click is sent as the
//! `menu:deck-setting` event to the focused window alone, like Edit > Undo
//! (see `edit_menu`): each window writes to its own deck.
//!
//! The keys and choices mirror `domain/deckSettings.ts`'s
//! `DECK_SETTING_CHOICES`, whose first choice per key is peitho-core's
//! default.
//!
//! On macOS, muda toggles a check item's own mark before the click reaches
//! the app, so the whole menu is re-applied from the reported values right
//! after every click (`apply`): the mark then only moves once the frontend
//! has written the change and reported it back.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItemKind, Submenu};
use tauri::{AppHandle, Runtime};

use crate::i18n::MenuLabels;

/// The event a Deck menu click is forwarded to the focused window as.
pub(crate) const MENU_EVENT: &str = "menu:deck-setting";

const DECK_MENU_ID: &str = "deck";
const ID_PREFIX: &str = "deck:";

/// One Deck menu setting: a top-level frontmatter key.
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

    /// The choices that get an item of their own. Line breaks is a single
    /// on/off item standing for `true`; a click on it sends a toggle
    /// (`pick_for_click`).
    fn item_choices(self) -> &'static [&'static str] {
        match self {
            Self::Breaks => &["true"],
            _ => self.choices(),
        }
    }
}

/// A window's settings as its frontend reported them: each key's current
/// choice, or `None` when the deck holds a value the menu doesn't offer
/// (nothing is checked then).
#[derive(Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct DeckSettings {
    pub page_numbers: Option<String>,
    pub aspect_ratio: Option<String>,
    pub breaks: Option<String>,
    pub lang: Option<String>,
}

impl DeckSettings {
    fn choice(&self, key: SettingKey) -> Option<&str> {
        match key {
            SettingKey::PageNumbers => self.page_numbers.as_deref(),
            SettingKey::AspectRatio => self.aspect_ratio.as_deref(),
            SettingKey::Breaks => self.breaks.as_deref(),
            SettingKey::Lang => self.lang.as_deref(),
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

/// The key and choice behind a Deck menu item id, or `None` for any other
/// id. Only the ids `menu_id` gives the menu's own items are read.
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

/// What a click on item `id` asks the front window to write. `None` for an
/// id that isn't a Deck item, or with no deck in front (the items are
/// disabled then anyway).
pub(crate) fn pick_for_click(id: &str, front: Option<&DeckSettings>) -> Option<DeckSettingPick> {
    let (key, choice) = parse_menu_id(id)?;
    front?;
    let choice = if key == SettingKey::Breaks { BREAKS_TOGGLE } else { choice };
    Some(DeckSettingPick { key: key.as_str(), choice })
}

/// How one check item should look.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ItemState {
    pub id: String,
    pub checked: bool,
    pub enabled: bool,
}

/// Every Deck menu item's state for the front window's settings. With no
/// deck in front, every item is disabled and unchecked. A key whose value
/// is none of the choices checks no item.
pub(crate) fn item_states(front: Option<&DeckSettings>) -> Vec<ItemState> {
    SettingKey::ALL
        .into_iter()
        .flat_map(|key| {
            key.item_choices().iter().map(move |choice| ItemState {
                id: menu_id(key, choice),
                checked: front.is_some_and(|settings| settings.choice(key) == Some(*choice)),
                enabled: front.is_some(),
            })
        })
        .collect()
}

/// The label shown for `key`'s item for `choice`. Numbers and ratios read
/// the same in every language; the languages are named in their own.
fn item_label(key: SettingKey, choice: &str, labels: &MenuLabels) -> String {
    match (key, choice) {
        (SettingKey::PageNumbers, "none") => labels.page_numbers_off.to_string(),
        (SettingKey::PageNumbers, "current") => "1".to_string(),
        (SettingKey::PageNumbers, "current_of_total") => "1/N".to_string(),
        (SettingKey::Breaks, _) => labels.line_breaks.to_string(),
        (SettingKey::Lang, "en") => "English (en)".to_string(),
        (SettingKey::Lang, "ja") => "日本語 (ja)".to_string(),
        _ => choice.to_string(),
    }
}

fn submenu_id(key: SettingKey) -> String {
    format!("{ID_PREFIX}{}", key.as_str())
}

fn check_items<R: Runtime>(app: &AppHandle<R>, key: SettingKey, labels: &MenuLabels) -> tauri::Result<Vec<CheckMenuItem<R>>> {
    key.item_choices()
        .iter()
        .map(|choice| CheckMenuItem::with_id(app, menu_id(key, choice), item_label(key, choice, labels), false, false, None::<&str>))
        .collect()
}

fn setting_submenu<R: Runtime>(app: &AppHandle<R>, key: SettingKey, title: &str, labels: &MenuLabels) -> tauri::Result<Submenu<R>> {
    let items = check_items(app, key, labels)?;
    let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|item| item as &dyn IsMenuItem<R>).collect();
    Submenu::with_id_and_items(app, submenu_id(key), title, false, &refs)
}

/// Builds the Deck menu with every item disabled and unchecked; `apply`
/// then shows the front window's settings.
pub(crate) fn build<R: Runtime>(app: &AppHandle<R>, labels: &MenuLabels) -> tauri::Result<Submenu<R>> {
    let page_numbers = setting_submenu(app, SettingKey::PageNumbers, labels.page_numbers, labels)?;
    let aspect_ratio = setting_submenu(app, SettingKey::AspectRatio, labels.aspect_ratio, labels)?;
    let breaks = check_items(app, SettingKey::Breaks, labels)?;
    let lang = setting_submenu(app, SettingKey::Lang, labels.deck_language, labels)?;
    let mut items: Vec<&dyn IsMenuItem<R>> = vec![&page_numbers, &aspect_ratio];
    items.extend(breaks.iter().map(|item| item as &dyn IsMenuItem<R>));
    items.push(&lang);
    Submenu::with_id_and_items(app, DECK_MENU_ID, labels.deck, true, &items)
}

/// Collects every check item and submenu under `items`, by id.
fn collect<R: Runtime>(items: Vec<MenuItemKind<R>>, checks: &mut HashMap<String, CheckMenuItem<R>>, submenus: &mut Vec<Submenu<R>>) {
    for item in items {
        match item {
            MenuItemKind::Check(check) => {
                checks.insert(check.id().as_ref().to_string(), check);
            }
            MenuItemKind::Submenu(submenu) => {
                if let Ok(children) = submenu.items() {
                    collect(children, checks, submenus);
                }
                submenus.push(submenu);
            }
            _ => {}
        }
    }
}

/// Shows the front window's settings (`None`: no deck in front) in
/// `menu`'s Deck menu. A menu without one is left alone.
pub(crate) fn apply<R: Runtime>(menu: &Menu<R>, front: Option<&DeckSettings>) {
    let Some(deck_menu) = menu.get(DECK_MENU_ID).and_then(|item| item.as_submenu().cloned()) else { return };
    let mut checks = HashMap::new();
    let mut submenus = Vec::new();
    if let Ok(items) = deck_menu.items() {
        collect(items, &mut checks, &mut submenus);
    }
    for state in item_states(front) {
        if let Some(item) = checks.get(&state.id) {
            let _ = item.set_checked(state.checked);
            let _ = item.set_enabled(state.enabled);
        }
    }
    for submenu in submenus {
        let _ = submenu.set_enabled(front.is_some());
    }
}

/// Which window's settings the Deck menu shows, and every window's
/// reported settings. Pure bookkeeping; the `Mutex` holding it lives in
/// `peitho.rs` with the rest of the per-window state.
#[derive(Default, Debug)]
pub(crate) struct DeckSettingsRegistry {
    by_window: HashMap<String, DeckSettings>,
    front: Option<String>,
}

impl DeckSettingsRegistry {
    /// Records `label`'s settings. A window reporting while focused is the
    /// front one from now on — so the first window, or a new one, counts
    /// even before any focus event has named it.
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
    /// its window was minimized — so the menu goes disabled rather than
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

    fn settings(page_numbers: &str, aspect_ratio: &str, breaks: &str, lang: &str) -> DeckSettings {
        let known = |value: &str| (!value.is_empty()).then(|| value.to_string());
        DeckSettings {
            page_numbers: known(page_numbers),
            aspect_ratio: known(aspect_ratio),
            breaks: known(breaks),
            lang: known(lang),
        }
    }

    fn defaults() -> DeckSettings {
        settings("none", "16:9", "false", "en")
    }

    fn checked_ids(states: &[ItemState]) -> Vec<&str> {
        states.iter().filter(|state| state.checked).map(|state| state.id.as_str()).collect()
    }

    #[test]
    fn given_every_item_id_when_parsed_then_it_round_trips_to_its_key_and_choice() {
        for key in SettingKey::ALL {
            for choice in key.item_choices() {
                assert_eq!(parse_menu_id(&menu_id(key, choice)), Some((key, *choice)), "{key:?} {choice}");
            }
        }
    }

    #[test]
    fn given_the_ids_of_the_items_when_listed_then_each_is_distinct() {
        let states = item_states(Some(&defaults()));
        let mut ids: Vec<&str> = states.iter().map(|state| state.id.as_str()).collect();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total);
        assert_eq!(total, 3 + 2 + 1 + 2);
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
        assert!(states.iter().all(|state| state.enabled));
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
        // `None` is the frontend's "unknown"; an unexpected string (a
        // frontend and menu out of step) checks nothing either.
        let states = item_states(Some(&settings("", "16:10", "", "fr")));
        assert!(checked_ids(&states).is_empty());
        assert!(states.iter().all(|state| state.enabled));
    }

    #[test]
    fn given_no_deck_in_front_when_shown_then_every_item_is_disabled_and_unchecked() {
        let states = item_states(None);
        assert!(!states.is_empty());
        assert!(states.iter().all(|state| !state.enabled && !state.checked));
    }

    #[test]
    fn given_a_choice_item_when_clicked_then_that_choice_is_picked() {
        let front = defaults();
        assert_eq!(
            pick_for_click("deck:aspect_ratio:4:3", Some(&front)),
            Some(DeckSettingPick { key: "aspect_ratio", choice: "4:3" })
        );
        assert_eq!(
            pick_for_click("deck:page_numbers:none", Some(&front)),
            Some(DeckSettingPick { key: "page_numbers", choice: "none" })
        );
    }

    #[test]
    fn given_line_breaks_in_any_state_when_clicked_then_a_toggle_is_sent() {
        // The frontend resolves it against the deck when the pick runs, so
        // a second click before the first is reported back still flips.
        let toggle = Some(DeckSettingPick { key: "breaks", choice: "toggle" });
        assert_eq!(pick_for_click("deck:breaks:true", Some(&defaults())), toggle);
        assert_eq!(pick_for_click("deck:breaks:true", Some(&settings("none", "16:9", "true", "en"))), toggle);
        assert_eq!(pick_for_click("deck:breaks:true", Some(&settings("none", "16:9", "", "en"))), toggle);
    }

    #[test]
    fn given_no_deck_in_front_or_another_id_when_clicked_then_nothing_is_picked() {
        assert_eq!(pick_for_click("deck:lang:ja", None), None);
        assert_eq!(pick_for_click("edit_undo", Some(&defaults())), None);
        assert_eq!(pick_for_click("deck:lang:fr", Some(&defaults())), None);
    }

    #[test]
    fn given_the_pick_when_serialized_then_it_matches_the_frontend_payload() {
        // `parseDeckSettingPick` in domain/deckSettings.ts reads `{ key, choice }`.
        let json = serde_json::to_string(&DeckSettingPick { key: "lang", choice: "ja" }).unwrap();
        assert_eq!(json, r#"{"key":"lang","choice":"ja"}"#);
    }

    #[test]
    fn given_the_frontend_report_when_deserialized_then_null_is_an_unknown_value() {
        let report: DeckSettings =
            serde_json::from_str(r#"{"page_numbers":"current","aspect_ratio":null,"breaks":"false","lang":"ja"}"#).unwrap();
        assert_eq!(report, settings("current", "", "false", "ja"));
        assert!(serde_json::from_str::<DeckSettings>(r#"{"lang":42}"#).is_err());
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
