// The standard layouts a new deck is created with — `STANDARD_LAYOUTS` in
// src-tauri's `engine/builtin.rs`, which writes their files — with the name
// each one goes by in the UI, and which layout Studio writes on a slide it
// creates (a slide in a deck holding them all has to name one: a heading
// alone fits several, and peitho-core won't guess between them).
import type { Language } from './language'

/** A standard layout: its file name (what a slide's `"layout"` names) and
 * what the UI calls it in each language. */
export interface StandardLayout {
  name: string
  label: Record<Language, string>
}

/** In the order of `engine/builtin.rs`'s `STANDARD_LAYOUTS`
 * (`standardLayouts.test.ts` checks the two agree). */
export const STANDARD_LAYOUTS: readonly StandardLayout[] = [
  { name: 'title-slide', label: { en: 'Title slide', ja: 'タイトルスライド' } },
  { name: 'section-header', label: { en: 'Section header', ja: 'セクションヘッダー' } },
  { name: 'title-body', label: { en: 'Title and body', ja: 'タイトルと本文' } },
  { name: 'two-column', label: { en: 'Title and two columns', ja: '2列(タイトルあり)' } },
  { name: 'title-only', label: { en: 'Title only', ja: 'タイトルのみ' } },
  { name: 'one-column-text', label: { en: 'One column text', ja: '1列のテキスト' } },
  { name: 'main-point', label: { en: 'Main point', ja: '要点' } },
  { name: 'section-title-description', label: { en: 'Section title and description', ja: 'セクションタイトルと説明' } },
  { name: 'caption', label: { en: 'Caption', ja: '説明' } },
  { name: 'big-number', label: { en: 'Big number', ja: '数字(大)' } },
  { name: 'blank', label: { en: 'Blank', ja: '空白' } },
]

/** The layout a new slide falls back to when nothing else says which. */
export const DEFAULT_LAYOUT = 'title-body'

/** The standard layouts with no title slot: a heading on one of them
 * doesn't build. */
const TITLELESS_LAYOUTS: readonly string[] = ['caption', 'blank']

/** Standard layouts a slide added after one of them doesn't take on:
 * the titleless ones (a new slide opens with a heading), and the title
 * slide (a deck has one; what follows is its content). */
const NOT_CARRIED_OVER: readonly string[] = ['title-slide', ...TITLELESS_LAYOUTS]

/** What the UI calls layout `name`: a standard layout's label in
 * `language`, or the name itself for any other (a deck's own layout). */
export function layoutDisplayName(name: string, language: Language): string {
  return STANDARD_LAYOUTS.find(layout => layout.name === name)?.label[language] ?? name
}

/** The layout a new slide, added after a slide on layout `previous` (or
 * after none, `null`), is written with in a deck whose layouts are
 * `deckLayouts` — `null` to write none:
 * - the previous slide's layout, so a run of slides stays on one layout,
 * - except `DEFAULT_LAYOUT` instead of one in `NOT_CARRIED_OVER`, or when
 *   there's no previous layout to go on,
 * - but never `DEFAULT_LAYOUT` when the deck doesn't have it: a deck
 *   without the standard layouts keeps what it had (a layout carried over,
 *   or none), as before they existed.
 * An empty name counts as none. */
export function newSlideLayout(previous: string | null, deckLayouts: readonly string[]): string | null {
  const known = previous === null || previous === '' ? null : previous
  const hasDefault = deckLayouts.includes(DEFAULT_LAYOUT)
  if (known !== null && !(hasDefault && NOT_CARRIED_OVER.includes(known))) return known
  return hasDefault ? DEFAULT_LAYOUT : null
}
