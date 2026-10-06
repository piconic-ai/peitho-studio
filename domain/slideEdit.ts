import { annotatedSpan, type CharSpan } from './reviewComment'
import type { TextInsertion } from './editorText'

export type SlideEditTarget =
  | { kind: 'text'; byteSpan: CharSpan; quote: string; text: string; heading?: boolean; slot?: string; listItems?: { byteSpan: CharSpan; quote: string }[] }
  | { kind: 'slot'; slot: string; accepts: string }

export interface SlideTextEdit {
  body: string
  from: number
  to: number
  value: string
  prefix: string
  suffix: string
  heading: boolean
}

/** Locate only inside the selected slide's body; stale/expanded-source
 * annotations must never replace text elsewhere in a deck. */
export function textEditFor(target: Extract<SlideEditTarget, { kind: 'text' }>, renderedSource: string, body: string, bodyStart: number, rawBody?: string): SlideTextEdit | null {
  if (target.listItems?.length) {
    const items = target.listItems.map(item => textEditFor({ ...target, ...item, listItems: undefined }, renderedSource, body, bodyStart, rawBody))
    if (items.some(item => item === null)) return null
    const first = Math.min(...items.map(item => item!.from))
    const from = body.lastIndexOf('\n', first - 1) + 1
    const to = Math.max(...items.map(item => item!.to))
    const value = body.slice(from, to)
    if (!/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(value)) return null
    const suffix = /\n+$/.exec(value)?.[0] ?? ''
    return { body, from, to, value: value.slice(0, value.length - suffix.length), prefix: '', suffix, heading: false }
  }
  const span = annotatedSpan(renderedSource, target.byteSpan, target.quote)
  if (span === null) return null
  let local = { start: span.start - bodyStart, end: span.end - bodyStart }
  if (rawBody !== undefined) {
    if (local.start < 0 || local.end > rawBody.length || renderedSource.slice(bodyStart, bodyStart + rawBody.length) !== rawBody || rawBody.replace(/\n{3,}/g, '\n\n') !== body.trim() || rawBody.slice(local.start, local.end) !== target.quote) return null
    const leading = body.length - body.trimStart().length
    local = { start: leading + rawBody.slice(0, local.start).replace(/\n{3,}/g, '\n\n').length, end: leading + rawBody.slice(0, local.end).replace(/\n{3,}/g, '\n\n').length }
  }
  if (local.start < 0 || body.slice(local.start, local.end) !== target.quote) return null
  const prefix = /^(?:#{1,6}\s+|\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/.exec(target.quote)?.[0] ?? ''
  const suffix = /\n+$/.exec(target.quote)?.[0] ?? ''
  return { body, from: local.start, to: local.end, value: target.quote.slice(prefix.length, target.quote.length - suffix.length), prefix, suffix, heading: target.heading ?? prefix.startsWith('#') }
}

export function textEditInsertion(edit: SlideTextEdit, currentBody: string, value: string): TextInsertion | null {
  if (currentBody !== edit.body) return null
  if (edit.heading) value = slideHeadingText(value)
  if (edit.heading && value === '') value = '\u00a0'
  const insert = edit.prefix + value.replace(/\r\n?/g, '\n') + edit.suffix
  return { from: edit.from, to: edit.to, insert, cursor: edit.from + insert.length }
}

/** Empty non-conventional slots use explicit fences; callers don't have
 * to know the two-column layout's left/right names or Markdown syntax. */
export function slotTextInsertion(body: string, slot: string, accepts: string, value: string): TextInsertion | null {
  if (!/^[a-z][a-z0-9-]*$/.test(slot) || !['inline', 'blocks', 'list'].includes(accepts) || value.trim() === '') return null
  let content = value.trim().replace(/\r\n?/g, '\n')
  if (accepts === 'inline') content = `## ${content.replace(/\n/g, ' ')}`
  if (accepts === 'list' && !/^\s*(?:[-+*]|\d+[.)])\s/.test(content)) content = content.split('\n').map(line => `- ${line}`).join('\n')
  if (slot === 'title') content = `# ${value.trim().replace(/\n/g, ' ')}`
  else content = `::: {slot=${slot}}\n\n${content}\n\n:::`
  if (slot === 'title') {
    const heading = /^(?:[ \t]*\r?\n)*[ \t]{0,3}#(?:[ \t]+([^\r\n]*)|(?=\r?\n|$))/.exec(body)
    if (heading) {
      const previous = heading[1] ?? ''
      if (previous.trim() !== '') return null
      const from = heading[0].length - previous.length
      const insert = (heading[1] === undefined ? ' ' : '') + value.trim().replace(/\n/g, ' ')
      return { from, to: heading[0].length, insert, cursor: from + insert.length }
    }
  }
  const insert = (body.trim() === '' ? '' : '\n\n') + content + '\n'
  return { from: body.length, to: body.length, insert, cursor: body.length + insert.length }
}

export function removeImageSlot(body: string, slot: string): string | null {
  if (!/^studio-(?:image|text)-\d+$/.test(slot)) return null
  const fence = new RegExp(`(^|\\n)::: \\{slot=${slot}\\}\\n[\\s\\S]*?\\n:::(?=\\n|$)`)
  return fence.test(body) ? body.replace(fence, '').trim() : null
}

/** Recover simple unrouted prose/list content after a heading. Used only
 * for a missing-body error, when the user explicitly picks its destination
 * on the canvas. No fenced slot content is moved implicitly. */
export function looseBodyEdit(body: string, slot: string, accepts: string): SlideTextEdit | null {
  if (accepts !== 'blocks' || !/^[a-z][a-z0-9-]*$/.test(slot) || slot === 'title' || slot === 'body' || /^\s*:::.*$/m.test(body)) return null
  const heading = /^# [^\n]*(?:\n|$)/.exec(body)
  if (!heading) return null
  const value = body.slice(heading[0].length).trim()
  if (value === '') return null
  return { body, from: heading[0].length, to: body.length, value, prefix: `\n::: {slot=${slot}}\n\n`, suffix: '\n\n:::\n', heading: false }
}


export interface SlideEditSession {
  value: string
  commit: (value: string) => boolean
  cancel: () => boolean
  finish: () => void
}


/** Plain canvas text stays literal when written back as Markdown. */
export function literalSlideText(text: string): string {
  return text.replace(/[\\`*_[\]<>#]/g, char => `\\${char}`)
}

/** A canvas text element remains one paragraph, including its empty lines.
 * A non-breaking space keeps an empty visual line from becoming a Markdown
 * paragraph boundary (and consuming another layout slot item). */
export function slideTextLines(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => /^[ \t]*$/.test(line) ? '\u00a0' : line).join('  \n')
}

/** An ATX heading ends at its first line break, so any break the canvas
 * produced (a trailing BR, a hard break, an NBSP-held empty line) would push
 * the rest into another body block. Join the lines with one space instead. */
export function slideHeadingText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]*\n[\s\u00a0]*/g, ' ').replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '')
}

export function slideInlineCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

/** Delete the annotated text object, preserving required heading slots as
 * an empty, editable heading and removing a now-empty explicit slot fence. */
export function removeSlideText(edit: SlideTextEdit): string {
  if (edit.heading) return edit.body.slice(0, edit.from) + edit.prefix + '\u00a0' + edit.suffix + edit.body.slice(edit.to)
  const lineStart = edit.body.lastIndexOf('\n', edit.from - 1) + 1
  const prefix = edit.body.slice(lineStart, edit.from)
  const from = /^(?:#{1,6}\s+|[ \t]*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|[ \t]*)$/.test(prefix) ? lineStart : edit.from
  const before = edit.body.slice(0, from)
  const after = edit.body.slice(edit.to)
  const opening = /(?:^|\n)::: \{slot=[a-z][a-z0-9-]*\}\n[\s\u00a0]*$/.exec(before)
  const closing = /^[\s\u00a0]*\n:::(?=\n|$)/.exec(after)
  return (opening && closing ? before.slice(0, opening.index) + after.slice(closing[0].length) : before + after).trim()
}

/** A canvas text element cleared to nothing is removed, not kept as an NBSP
 * paragraph: that placeholder still counts as a slot item, so typing into
 * the now visually empty slot overflowed it (title-slide's 0..1 body).
 * Headings keep their editable placeholder; lists clear item by item. */
export function clearedSlideText(target: Extract<SlideEditTarget, { kind: 'text' }>, edit: SlideTextEdit, value: string): string | null {
  const freeText = target.slot?.startsWith('studio-text-') ?? false
  if (value.trim() !== '' || (!freeText && (edit.heading || Boolean(target.listItems?.length)))) return null
  return removeSlideText({ ...edit, heading: false })
}

export function imageSlotContent(body: string, slot: string): string | null {
  if (!/^studio-image-\d+$/.test(slot)) return null
  return new RegExp(`(?:^|\\n)::: \\{slot=${slot}\\}\\n([\\s\\S]*?)\\n:::(?=\\n|$)`).exec(body)?.[1].trim() ?? null
}
