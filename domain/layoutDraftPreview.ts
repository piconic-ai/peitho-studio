// The layout editor's live preview: the shown layout's placeholder slide
// rendered from its unsaved HTML/CSS (`preview_layout_draft`) while the
// user types. Pure — the store holds one `DraftPreview`, `Studio.tsx`
// debounces the typing and makes the calls.
import { absolutizeCssUrls, fontFaceRules } from './slideCss'
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

/** The `@font-face` rules the drawn draft (`previewToDraw`) brings that the
 * saved deck's (`savedFontFaces`, already registered) doesn't have — for
 * `dom/slideCanvas.ts` to register beside the deck's while the draft is
 * drawn. `''` when the saved preview is drawn (`css: null`), so a reset,
 * a save or another layout drops the draft's faces. Compared with
 * whitespace collapsed, so a face the deck already has isn't added twice. */
export function draftFontFaces(drawn: { css: string | null }, savedFontFaces: string): string {
  if (drawn.css === null) return ''
  const normalize = (rule: string) => rule.replace(/\s+/g, ' ').trim()
  const saved = new Set(fontFaceRules(savedFontFaces).map(normalize))
  return fontFaceRules(drawn.css).filter(rule => !saved.has(normalize(rule))).join('\n')
}

/** The error to show under the preview of layout `name`, `''` for none. */
export function draftPreviewError(state: DraftPreview, name: string | null): string {
  return name !== null && state.name === name ? state.error ?? '' : ''
}
