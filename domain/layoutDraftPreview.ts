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

// A `font-family`/`font` declaration: the property (not a longer one such
// as `font-size`, or a custom `--font`), and its value up to `;`/`}`
// outside quoted strings.
const FONT_DECLARATION = /(?<![\w-])(font-family|font)(\s*:)((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^;}"'])*)/gi
const IMPORTANT = /^([\s\S]*?)(\s*!\s*important\s*)$/i
const SIZE_KEYWORDS = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'smaller', 'larger'])
const SIZE_LENGTH = /^(?:\d+\.?\d*|\.\d+)(?:px|em|rem|%|pt|pc|in|cm|mm|q|ex|ch|vw|vh|vmin|vmax|vi|vb|lh|rlh|cap|ic|svh|lvh|dvh|svw|lvw|dvw)$/i
const VALUE_TOKEN = /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[^\s"']+/g
const IDENTIFIERS = /^-?[A-Za-z_\u0080-￿][\w\-\u0080-￿]*(?:\s+-?[A-Za-z_\u0080-￿][\w\-\u0080-￿]*)*$/

/** One family as written in a family list, read the way CSS reads it: a
 * quoted string (escapes undone), or identifiers joined by single spaces.
 * `null` for anything else (a `var()`, an empty part, a stray token). */
function readFamily(part: string): string | null {
  const text = part.trim()
  const quote = text[0]
  if (quote === '"' || quote === "'") {
    let name = ''
    let i = 1
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === '\\') {
        i++
        if (i < text.length) name += text[i]
        continue
      }
      if (c === quote) break
      name += c
    }
    return i === text.length - 1 ? name : null
  }
  return IDENTIFIERS.test(text) ? text.split(/\s+/).join(' ') : null
}

/** `list` split on its top-level commas (not inside quotes or brackets),
 * each part as written. */
function splitFamilyList(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (quote !== null) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      parts.push(list.slice(start, i))
      start = i + 1
    }
  }
  parts.push(list.slice(start))
  return parts
}

/** Where a `font` shorthand's family list starts in `value` (after its size
 * and any `/line-height`), or `null` when it has none to find: a system
 * font (`caption`), a `var()`/`calc()`, or no size before a quoted name. */
function shorthandFamilyStart(value: string): number | null {
  if (value.includes('(')) return null
  for (const token of value.matchAll(VALUE_TOKEN)) {
    const text = token[0]
    if (text.startsWith('"') || text.startsWith("'")) return null
    const [size, lineHeight] = text.split('/', 2) as [string, string | undefined]
    if (!SIZE_KEYWORDS.has(size.toLowerCase()) && !SIZE_LENGTH.test(size)) continue
    let end = (token.index ?? 0) + text.length
    const rest = value.slice(end)
    if (lineHeight === undefined) {
      const slash = /^\s*\/\s*[^\s,]+/.exec(rest)
      if (slash) end += slash[0].length
    } else if (lineHeight === '') {
      const after = /^\s*[^\s,]+/.exec(rest)
      if (after) end += after[0].length
    }
    return end
  }
  return null
}

function quotedFamily(name: string): string {
  return `"${name.replace(/[\\"]/g, c => `\\${c}`)}"`
}

/** `list` (a family list) with each family in `families` (lower-cased)
 * re-emitted quoted under its preview-only name; every other part, and the
 * whitespace around each, as written. */
function renameInFamilyList(list: string, families: ReadonlySet<string>): string {
  return splitFamilyList(list).map(part => {
    const name = readFamily(part)
    if (name === null || !families.has(name.toLowerCase())) return part
    const [, before, , after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(part)!
    return `${before}${quotedFamily(`${name}${DRAFT_FAMILY_SUFFIX}`)}${after}`
  }).join(',')
}

/** The family an `@font-face` rule defines, lower-cased; `null` for none. */
export function fontFaceFamily(rule: string): string | null {
  for (const match of rule.matchAll(FONT_DECLARATION)) {
    if (match[1].toLowerCase() !== 'font-family') continue
    const core = IMPORTANT.exec(match[3])?.[1] ?? match[3]
    const name = readFamily(splitFamilyList(core)[0])
    return name === null ? null : name.toLowerCase()
  }
  return null
}

/** `css` with every family in `families` (lower-cased) renamed to its
 * preview-only name (`DRAFT_FAMILY_SUFFIX`) wherever a `font-family` or
 * `font` declaration names it — `@font-face` rules included. Each value is
 * read as CSS reads it: a trailing `!important` kept, a `font` shorthand's
 * families taken after its size (and `/line-height`), the list split on
 * commas outside quotes, a family quoted or made of identifiers, compared
 * case-insensitively. Only matching families change (re-emitted quoted);
 * everything else stays byte for byte, including system fonts, generic
 * families and `var()`, which isn't followed. */
export function aliasFontFamilies(css: string, families: ReadonlySet<string>): string {
  if (families.size === 0) return css
  return css.replace(FONT_DECLARATION, (whole: string, property: string, colon: string, value: string) => {
    const important = IMPORTANT.exec(value)
    const core = important ? important[1] : value
    const suffix = important ? important[2] : ''
    const start = property.toLowerCase() === 'font' ? shorthandFamilyStart(core) : 0
    if (start === null) return whole
    return `${property}${colon}${core.slice(0, start)}${renameInFamilyList(core.slice(start), families)}${suffix}`
  })
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

/** The layout whose list thumbnail draws its draft rather than its saved
 * files — the one with a rendered draft — or `null` when every thumbnail
 * draws the saved files. A later draft that fails keeps the last good one
 * drawn, as `previewToDraw` does. */
export function draftedLayout(state: DraftPreview): string | null {
  return state.shown === null ? null : state.name
}

/** The error to show for the draft of layout `name`, `''` for none. */
export function draftPreviewError(state: DraftPreview, name: string | null): string {
  return name !== null && state.name === name ? state.error ?? '' : ''
}
