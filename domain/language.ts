// Which language the Studio UI itself is shown in. Unrelated to a deck's
// own content language (peitho-core's `DeckLang`). Mirrors
// `src-tauri/src/i18n.rs`, which makes the same choice for the native menu
// bar, so the menus and the page never disagree.

/** A language the UI has every message for. */
export type Language = 'en' | 'ja'

export const LANGUAGES: readonly Language[] = ['en', 'ja']

/** The saved choice: a language, or `system` (nothing chosen yet) to
 * follow the OS's preferred language. */
export type LanguageSetting = 'system' | Language

export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ['system', ...LANGUAGES]

/** Whether a BCP 47-ish locale tag (`ja`, `ja-JP`, `ja_JP`, `JA-jp`,
 * `ja-Jpan-JP`) is Japanese: only its primary subtag counts, so `jam`
 * (Jamaican Patois) is not. */
export function isJapaneseLocale(tag: string): boolean {
  const primary = tag.trim().split(/[-_]/)[0]
  return primary.toLowerCase() === 'ja'
}

/** The UI language for the OS's preferred locales, most preferred first:
 * Japanese when the first one is, English otherwise (including when the OS
 * reports none). Later locales are ignored — a Japanese fallback behind an
 * English first choice still means the user reads English first. */
export function systemLanguage(locales: readonly string[]): Language {
  const first = locales[0]
  return first !== undefined && isJapaneseLocale(first) ? 'ja' : 'en'
}

/** The language the UI is shown in: the saved choice, or the OS's when
 * nothing is chosen yet. */
export function resolveLanguage(setting: LanguageSetting, systemLocales: readonly string[]): Language {
  return setting === 'system' ? systemLanguage(systemLocales) : setting
}
