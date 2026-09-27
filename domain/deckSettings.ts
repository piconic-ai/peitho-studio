// The deck-wide settings the native Deck menu offers (see
// `src-tauri/src/deck_menu.rs`): which of each key's choices the deck's
// frontmatter holds now, and what picking a choice writes back.
//
// Each setting is a closed list of choices. A value on disk that isn't one
// of them (a typo, `lang: fr`, `page_numbers: both`) reads as `unknown`, so
// the menu checks none of the choices instead of guessing which was meant.
// A choice that is peitho-core's default is written by removing the key, so
// the frontmatter stays as small as the deck needs.
import { PAGE_NUMBERS_KEY, parsePageNumbersMode, readFrontmatterKey } from './frontmatter'

/** Every choice each setting offers, the default first. The choice is the
 * value written to the frontmatter — except `page_numbers`' `none` (and
 * every default), which is written by removing the key. */
export const DECK_SETTING_CHOICES = {
  page_numbers: ['none', 'current', 'current_of_total'],
  aspect_ratio: ['16:9', '4:3'],
  breaks: ['false', 'true'],
  lang: ['en', 'ja'],
} as const

export type DeckSettingKey = keyof typeof DECK_SETTING_CHOICES

export const DECK_SETTING_KEYS: readonly DeckSettingKey[] = ['page_numbers', 'aspect_ratio', 'breaks', 'lang']

export type DeckSettingChoice<K extends DeckSettingKey = DeckSettingKey> = (typeof DECK_SETTING_CHOICES)[K][number]

/** One setting as found in the frontmatter: one of its choices (an absent
 * key reads as the default), or a value that is none of them. */
export type DeckSettingState<K extends DeckSettingKey = DeckSettingKey> =
  | { kind: 'known'; choice: DeckSettingChoice<K> }
  | { kind: 'unknown'; raw: string }

export type DeckSettingsState = { [K in DeckSettingKey]: DeckSettingState<K> }

/** What the Deck menu checks, as `report_deck_settings` takes it: each
 * key's choice, or `null` for a value that is none of them (nothing is
 * checked). */
export type DeckSettingsReport = { [K in DeckSettingKey]: DeckSettingChoice<K> | null }

/** A Deck menu pick, as the `menu:deck-setting` event carries it. */
export type DeckSettingPick = { [K in DeckSettingKey]: { key: K; choice: DeckSettingChoice<K> } }[DeckSettingKey]

/** The choice peitho-core uses when the key is absent. */
export function defaultChoiceOf<K extends DeckSettingKey>(key: K): DeckSettingChoice<K> {
  return DECK_SETTING_CHOICES[key][0]
}

/** Whether `value` is one of `key`'s choices, spelled exactly. */
export function isChoiceOf<K extends DeckSettingKey>(key: K, value: unknown): value is DeckSettingChoice<K> {
  return (DECK_SETTING_CHOICES[key] as readonly unknown[]).includes(value)
}

/** Reads one setting from its raw frontmatter value (`readFrontmatterKey`'s
 * result, `null` for an absent key). Matching is exact, as in peitho-core:
 * `16：9`, `JA`, or an empty value are `unknown`. `page_numbers` goes
 * through `parsePageNumbersMode`, so the Deck menu and the slide context
 * menu's Hide Page Number never read it differently. */
export function parseDeckSetting<K extends DeckSettingKey>(key: K, raw: string | null): DeckSettingState<K> {
  if (key === PAGE_NUMBERS_KEY) {
    const mode = parsePageNumbersMode(raw)
    return (mode.kind === 'unknown' ? mode : { kind: 'known', choice: mode.kind }) as DeckSettingState<K>
  }
  if (raw === null) return { kind: 'known', choice: defaultChoiceOf(key) }
  return isChoiceOf(key, raw) ? { kind: 'known', choice: raw } : { kind: 'unknown', raw }
}

/** Every Deck menu setting of the deck `source`. A deck with no
 * frontmatter, or one whose block isn't closed, reads as all defaults. */
export function readDeckSettings(source: string): DeckSettingsState {
  return {
    page_numbers: parseDeckSetting('page_numbers', readFrontmatterKey(source, 'page_numbers')),
    aspect_ratio: parseDeckSetting('aspect_ratio', readFrontmatterKey(source, 'aspect_ratio')),
    breaks: parseDeckSetting('breaks', readFrontmatterKey(source, 'breaks')),
    lang: parseDeckSetting('lang', readFrontmatterKey(source, 'lang')),
  }
}

function reportedChoice<K extends DeckSettingKey>(state: DeckSettingState<K>): DeckSettingChoice<K> | null {
  return state.kind === 'known' ? state.choice : null
}

/** `state` as the Deck menu shows it. */
export function deckSettingsReport(state: DeckSettingsState): DeckSettingsReport {
  return {
    page_numbers: reportedChoice(state.page_numbers),
    aspect_ratio: reportedChoice(state.aspect_ratio),
    breaks: reportedChoice(state.breaks),
    lang: reportedChoice(state.lang),
  }
}

/** Whether two reports check the same items, so an unchanged one needn't
 * be sent again. */
export function sameDeckSettingsReport(a: DeckSettingsReport, b: DeckSettingsReport): boolean {
  return DECK_SETTING_KEYS.every(key => a[key] === b[key])
}

/** The frontmatter value that selects `choice`: `null` (remove the key)
 * for the default. */
export function frontmatterValueOf<K extends DeckSettingKey>(key: K, choice: DeckSettingChoice<K>): string | null {
  return choice === defaultChoiceOf(key) ? null : choice
}

/** Reads a `menu:deck-setting` event's payload, or `null` when it isn't a
 * pick of a known key's choice. It comes over IPC, so nothing about its
 * shape is taken on trust. */
export function parseDeckSettingPick(payload: unknown): DeckSettingPick | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { key, choice } = payload as { key?: unknown; choice?: unknown }
  if (typeof key !== 'string' || !(DECK_SETTING_KEYS as readonly string[]).includes(key)) return null
  const settingKey = key as DeckSettingKey
  return isChoiceOf(settingKey, choice) ? ({ key: settingKey, choice } as DeckSettingPick) : null
}

/** Whether `pick` would leave `state` as it is: the choice is already the
 * one the deck holds. An `unknown` value is always replaced. */
export function pickChangesNothing(state: DeckSettingsState, pick: DeckSettingPick): boolean {
  const current = state[pick.key]
  return current.kind === 'known' && current.choice === pick.choice
}
