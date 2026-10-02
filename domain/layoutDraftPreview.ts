// The layout editor's live preview: the shown layout's placeholder slide
// rendered from its unsaved HTML/CSS (`preview_layout_draft`) while the
// user types. Pure — the store holds one `DraftPreview`, `Studio.tsx`
// debounces the typing and makes the calls.
import { absolutizeCssUrls, fontFaceRules, splitFontFaceRules } from './slideCss'
import { absolutizeFragmentUrls } from './slideFragment'

/** One rendered draft: the slide's fragment and the CSS it's drawn with. */
export interface RenderedDraft {
  fragment: string
  css: string
}

/** The live preview's state. `seq` numbers the latest request: an answer
 * carrying any other number is for older text (or a layout no longer
 * shown) and is dropped, so answers arriving out of order can't show a
 * stale draft. `shown` is the last draft that rendered — kept while a
 * later one fails, with that failure in `error` — or `null` to show the
 * saved files' preview. */
export interface DraftPreview {
  seq: number
  name: string | null
  shown: RenderedDraft | null
  error: string | null
}

export const NO_DRAFT_PREVIEW: DraftPreview = { seq: 0, name: null, shown: null, error: null }

/** A request to render layout `name`'s draft: its number, and the state
 * waiting on it. A request for another layout than the last forgets that
 * one's draft. */
export function requestDraftPreview(state: DraftPreview, name: string): { state: DraftPreview; seq: number } {
  const seq = state.seq + 1
  const sameLayout = state.name === name
  return { seq, state: { seq, name, shown: sameLayout ? state.shown : null, error: sameLayout ? state.error : null } }
}

/** The answer to request `seq`: shown, clearing any earlier failure. */
export function draftPreviewRendered(state: DraftPreview, seq: number, rendered: RenderedDraft): DraftPreview {
  return seq === state.seq ? { ...state, shown: rendered, error: null } : state
}

/** Request `seq` failed with `message`: the last good draft stays shown. */
export function draftPreviewFailed(state: DraftPreview, seq: number, message: string): DraftPreview {
  return seq === state.seq ? { ...state, error: message } : state
}

/** Back to the saved files' preview — another layout shown, the draft
 * reverted or saved. Any request still in flight is dropped. */
export function resetDraftPreview(state: DraftPreview): DraftPreview {
  return { seq: state.seq + 1, name: null, shown: null, error: null }
}

/** What the preview of layout `name` draws: its rendered draft when there
 * is one for it, else `saved` (the saved files' preview, drawn with the
 * deck's preview CSS — `css: null`). */
export function previewToDraw(state: DraftPreview, name: string | null, saved: string): { fragment: string; css: string | null } {
  if (name !== null && state.name === name && state.shown !== null) return state.shown
  return { fragment: saved, css: null }
}

/** `rendered` with its relative `assets/…`/`url(…)` references made
 * absolute under the deck's asset server (`baseUrl`), as the deck's own
 * slides are: a shadow root has no `<base href>` to resolve them against.
 * The command has the server serve the files the draft names. */
export function absolutizedDraft(rendered: RenderedDraft, baseUrl: string): RenderedDraft {
  return { fragment: absolutizeFragmentUrls(rendered.fragment, baseUrl), css: absolutizeCssUrls(rendered.css, baseUrl) }
}

/** What a preview-only font family is called: a family the saved deck
 * defines but the draft redefines (`previewDraftCss`). */
export const DRAFT_FAMILY_SUFFIX = ' (Peitho draft)'

function normalizeRule(rule: string): string {
  return rule.replace(/\s+/g, ' ').trim()
}

/** The family an `@font-face` rule defines, lower-cased; `null` for none. */
export function fontFaceFamily(rule: string): string | null {
  const match = /font-family\s*:\s*(["']?)([^;"'}]+?)\1\s*(?:;|\})/i.exec(rule)
  return match ? match[2].trim().toLowerCase() : null
}

/** `css` with every mention of a family in `families` (lower-cased) —
 * in `@font-face` rules and in `font-family`/`font` declarations — renamed
 * to its preview-only name (`DRAFT_FAMILY_SUFFIX`). Quoted or bare, any
 * case; a `font` shorthand's family is the end of its first part. */
export function aliasFontFamilies(css: string, families: ReadonlySet<string>): string {
  if (families.size === 0) return css
  const alias = (name: string) => `"${name}${DRAFT_FAMILY_SUFFIX}"`
  const renamePart = (part: string): string => {
    const quoted = /^(\s*)(["'])(.+?)\2(\s*)$/.exec(part)
    if (quoted && families.has(quoted[3].trim().toLowerCase())) return `${quoted[1]}${alias(quoted[3].trim())}${quoted[4]}`
    const bare = /^(\s*)(.*?)(\s*)$/.exec(part)!
    if (families.has(bare[2].toLowerCase())) return `${bare[1]}${alias(bare[2])}${bare[3]}`
    // A `font` shorthand's first part: "italic 2rem Family" / '... "Family"'.
    const tail = /^(.*\s)(["']?)([^\s"']+(?: [^\s"']+)*)\2(\s*)$/.exec(part)
    if (tail && families.has(tail[3].toLowerCase())) return `${tail[1]}${alias(tail[3])}${tail[4]}`
    return part
  }
  return css.replace(/(font-family|font)(\s*:\s*)([^;}]*)/gi, (_match, property: string, colon: string, value: string) =>
    `${property}${colon}${value.split(',').map(renamePart).join(',')}`)
}

/** The drawn draft's CSS (`previewToDraw`) made safe to register beside the
 * saved deck's (`savedFontFaces`, already registered page-wide):
 * - a family the deck defines and the draft redefines (any of its faces
 *   differing, whitespace aside) is renamed to a preview-only name in the
 *   whole draft CSS (`aliasFontFamilies`), so the draft's faces can't
 *   change how the deck's slides draw;
 * - `fontFaces` are the draft's faces the deck doesn't have as they are —
 *   to register page-wide (`dom/slideCanvas.ts` `setDraftFontFaces`);
 * - `rest` is everything else, for the preview's own sheet.
 * Nothing for the saved preview (`css: null`). */
export function previewDraftCss(drawn: { css: string | null }, savedFontFaces: string): { fontFaces: string; rest: string | null } {
  if (drawn.css === null) return { fontFaces: '', rest: null }
  const savedRules = fontFaceRules(savedFontFaces)
  const saved = new Set(savedRules.map(normalizeRule))
  const savedFamilies = new Set(savedRules.map(fontFaceFamily).filter((family): family is string => family !== null))
  const redefined = new Set(
    fontFaceRules(drawn.css)
      .filter(rule => !saved.has(normalizeRule(rule)))
      .map(fontFaceFamily)
      .filter((family): family is string => family !== null && savedFamilies.has(family)),
  )
  const css = aliasFontFamilies(drawn.css, redefined)
  return {
    fontFaces: fontFaceRules(css).filter(rule => !saved.has(normalizeRule(rule))).join('\n'),
    rest: splitFontFaceRules(css).rest,
  }
}

/** The error to show under the preview of layout `name`, `''` for none. */
export function draftPreviewError(state: DraftPreview, name: string | null): string {
  return name !== null && state.name === name ? state.error ?? '' : ''
}
