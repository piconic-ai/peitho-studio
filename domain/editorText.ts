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
