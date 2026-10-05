// Pure text logic for the slide body/note editors (`dom/codeEditor.ts`):
// how a draft pushed in from outside (a slide switch, a save response, an
// external-file merge) becomes an edit to the text already on screen.

/** `text` with every line break as `\n`. CodeMirror splits its document on
 * `\r\n`, `\r` and `\n` alike and joins it back with `\n`, the same way a
 * `<textarea>`'s `.value` does, so this is the text an editor would hold
 * for `text`. */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** One replacement of `current[from, to)` with `insert`. */
export interface TextChange {
  from: number
  to: number
  insert: string
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

/** The smallest single replacement that turns `current` (the editor's text)
 * into `next` (the draft, line breaks normalized first), or `null` when the
 * editor already shows it.
 *
 * Replacing only the part that differs, rather than the whole text, leaves
 * the cursor where it was when a save response re-syncs the slide the user
 * is still typing in. The boundaries never split a surrogate pair, so an
 * emoji is replaced whole. */
export function editorTextChange(current: string, next: string): TextChange | null {
  const target = normalizeLineBreaks(next)
  if (current === target) return null
  const limit = Math.min(current.length, target.length)
  let prefix = 0
  while (prefix < limit && current.charCodeAt(prefix) === target.charCodeAt(prefix)) prefix++
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) prefix--
  let suffix = 0
  while (
    suffix < limit - prefix &&
    current.charCodeAt(current.length - 1 - suffix) === target.charCodeAt(target.length - 1 - suffix)
  ) suffix++
  if (suffix > 0 && isLowSurrogate(current.charCodeAt(current.length - suffix))) suffix--
  return { from: prefix, to: current.length - suffix, insert: target.slice(prefix, target.length - suffix) }
}

/** `text` with `change` applied. */
export function applyTextChange(text: string, change: TextChange): string {
  return text.slice(0, change.from) + change.insert + text.slice(change.to)
}

/** A `TextChange` plus where the cursor goes once it is applied. */
export interface TextInsertion extends TextChange {
  cursor: number
}

/** `doc`'s text from `from` to `to` (either way round, clamped to it) —
 * what Cut and Copy take. */
export function textBetween(doc: string, from: number, to: number): string {
  const clamp = (at: number) => Math.max(0, Math.min(doc.length, Number.isFinite(at) ? Math.floor(at) : 0))
  return doc.slice(Math.min(clamp(from), clamp(to)), Math.max(clamp(from), clamp(to)))
}

/** `text` put in place of `doc`'s `from`–`to` (either way round, clamped
 * to it; a caret when equal), line breaks normalized, the cursor after it
 * — a Paste, or with `''` a Cut. */
export function replacementInsertion(doc: string, from: number, to: number, text: string): TextInsertion {
  const clamp = (at: number) => Math.max(0, Math.min(doc.length, Number.isFinite(at) ? Math.floor(at) : 0))
  const start = Math.min(clamp(from), clamp(to))
  const insert = normalizeLineBreaks(text)
  return { from: start, to: Math.max(clamp(from), clamp(to)), insert, cursor: start + insert.length }
}

/** The Markdown for an image at `relativePath` (deck-relative, as
 * `import_deck_image_*` returns it). No alt text. */
export function imageMarkdown(relativePath: string): string {
  return `![](${relativePath})`
}

// Line breaks at the end of `text` (`\r\n` counts as one), up to 2.
function trailingBreaks(text: string): number {
  const match = /(?:\r\n|\r|\n){0,2}$/.exec(text)
  return match === null ? 0 : (match[0].match(/\r\n|\r|\n/g) ?? []).length
}

// Line breaks at the start of `text`, up to 2.
function leadingBreaks(text: string): number {
  const match = /^(?:\r\n|\r|\n){0,2}/.exec(text)
  return match === null ? 0 : (match[0].match(/\r\n|\r|\n/g) ?? []).length
}

/** Replaces `doc[from, to)` (the selection, or a caret where `from ===
 * to`) with an image paragraph for each of `relativePaths`, each its own
 * paragraph: peitho-core refuses an image sharing a paragraph with text
 * (`![](a.png) text`). A blank line is added before and after only where
 * one isn't already there, and none at the very start or end of `doc`.
 * The cursor lands right after the last image. Positions past either end
 * are clamped, and a reversed range is put in order. `null` when there is
 * no image to insert. */
export function imageParagraphInsertion(doc: string, from: number, to: number, relativePaths: readonly string[]): TextInsertion | null {
  if (relativePaths.length === 0) return null
  const clamp = (n: number) => Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n) : 0, 0), doc.length)
  let start = Math.min(clamp(from), clamp(to))
  let end = Math.max(clamp(from), clamp(to))
  // Never between the two halves of a `\r\n` or of a surrogate pair:
  // such a position moves back to before the pair, which stays whole.
  const splitsPair = (at: number) => at > 0 && at < doc.length && (
    (doc[at - 1] === '\r' && doc[at] === '\n') ||
    (isHighSurrogate(doc.charCodeAt(at - 1)) && isLowSurrogate(doc.charCodeAt(at)))
  )
  if (splitsPair(start)) start--
  if (splitsPair(end)) end--
  const before = doc.slice(0, start)
  const after = doc.slice(end)
  const images = relativePaths.map(imageMarkdown).join('\n\n')
  const lead = before === '' ? '' : '\n'.repeat(2 - trailingBreaks(before))
  const trail = after === '' ? '' : '\n'.repeat(2 - leadingBreaks(after))
  const insert = lead + images + trail
  return { from: start, to: end, insert, cursor: start + lead.length + images.length }
}

/** Where to insert once an image import that started at `saved` (the text
 * and selection then) has finished: the same place if the text is still
 * the same, or else the selection as it is `now` — the user typed, or the
 * text was replaced, meanwhile, and a position in the old text no longer
 * means anything. */
export function insertionRangeAfterWait(
  saved: { doc: string; from: number; to: number },
  now: { doc: string; from: number; to: number },
): { from: number; to: number } {
  return saved.doc === now.doc ? { from: saved.from, to: saved.to } : { from: now.from, to: now.to }
}
