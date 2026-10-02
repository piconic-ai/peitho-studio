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

/** The title slide: a deck has one, so a slide added after it takes
 * `DEFAULT_LAYOUT` instead (what follows a title is its content). */
const TITLE_SLIDE = 'title-slide'

/** What the UI calls layout `name`: a standard layout's label in
 * `language`, or the name itself for any other (a deck's own layout). */
export function layoutDisplayName(name: string, language: Language): string {
  return STANDARD_LAYOUTS.find(layout => layout.name === name)?.label[language] ?? name
}

/** The layout a new slide — which holds only a heading — added after a
 * slide on layout `previous` (or after none, `null`), is written with,
 * `headingLayouts` being the deck's layouts a heading-only slide builds on
 * (`RenderPayload.headingLayouts`); `null` to write none:
 * - the previous slide's layout, so a run of slides stays on one layout,
 *   as long as the new slide builds on it — not, say, the image layout
 *   (its image is required) or `blank` (it has no title),
 * - otherwise `DEFAULT_LAYOUT`, also in place of the title slide, as long
 *   as the deck has it,
 * - otherwise none, leaving the slide to peitho-core's own matching, as
 *   before Studio named layouts — in a deck without the standard layouts
 *   that's what still finds one (`title-body-code` next to an image
 *   layout).
 * An empty name counts as none. An empty `headingLayouts` means nothing is
 * known yet (no render has succeeded since the deck opened): `previous` is
 * kept as is, as Studio always did before it knew the deck's layouts. */
export function newSlideLayout(previous: string | null, headingLayouts: readonly string[]): string | null {
  if (headingLayouts.length === 0) return previous === '' ? null : previous
  const hasDefault = headingLayouts.includes(DEFAULT_LAYOUT)
  const carried = previous !== null && previous !== '' && headingLayouts.includes(previous) && !(hasDefault && previous === TITLE_SLIDE)
  if (carried) return previous
  return hasDefault ? DEFAULT_LAYOUT : null
}
