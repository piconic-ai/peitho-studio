// The deck settings the New Deck dialog lets you pick before the deck
// exists: its aspect ratio and language. They offer the same choices as the
// Edit menu (`DECK_SETTING_CHOICES`), which can change them later, and
// `create_deck` (`src-tauri/src/peitho.rs`) writes only the ones that
// aren't peitho-core's default into the starter deck's frontmatter.
import { DECK_SETTING_CHOICES, type DeckSettingChoice, type DeckSettingPick, defaultChoiceOf } from './deckSettings'
import { LANGUAGE_NAMES } from './messages'

/** The settings the dialog offers, in its order. */
export const NEW_DECK_SETTING_KEYS = ['aspect_ratio', 'lang'] as const

export type NewDeckSettingKey = (typeof NEW_DECK_SETTING_KEYS)[number]

/** One choice for each setting the dialog offers. */
export type NewDeckSettings = { [K in NewDeckSettingKey]: DeckSettingChoice<K> }

/** A choice picked in the dialog: an Edit menu pick of one of its keys. */
export type NewDeckSettingPick = Extract<DeckSettingPick, { key: NewDeckSettingKey }>

/** What the dialog opens with: every setting at peitho-core's default. */
export function defaultNewDeckSettings(): NewDeckSettings {
  return { aspect_ratio: defaultChoiceOf('aspect_ratio'), lang: defaultChoiceOf('lang') }
}

/** `settings` with `pick` applied, the other settings kept. */
export function applyNewDeckSettingPick(settings: NewDeckSettings, pick: NewDeckSettingPick): NewDeckSettings {
  return { ...settings, [pick.key]: pick.choice }
}

/** A deck language named in itself, as the Edit menu names it. Typed so a
 * deck language the UI has no name for stops compiling here. */
const DECK_LANGUAGE_NAMES: Readonly<Record<DeckSettingChoice<'lang'>, string>> = LANGUAGE_NAMES

/** Every choice the dialog offers for `key`, as picks, in the Edit menu's
 * order. */
export function newDeckSettingPicks(key: NewDeckSettingKey): NewDeckSettingPick[] {
  return DECK_SETTING_CHOICES[key].map(choice => ({ key, choice }) as NewDeckSettingPick)
}

/** How a choice reads in the dialog, in every UI language: a ratio as
 * written, a language in its own name. */
export function newDeckChoiceLabel(pick: NewDeckSettingPick): string {
  return pick.key === 'lang' ? DECK_LANGUAGE_NAMES[pick.choice] : pick.choice
}
