import { annotatedSpan, type CharSpan } from './reviewComment'
import type { TextInsertion } from './editorText'

export type SlideEditTarget =
  | { kind: 'text'; byteSpan: CharSpan; quote: string; text: string; heading?: boolean }
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
export function textEditFor(target: Extract<SlideEditTarget, { kind: 'text' }>, renderedSource: string, body: string, bodyStart: number): SlideTextEdit | null {
  const span = annotatedSpan(renderedSource, target.byteSpan, target.quote)
  if (span === null) return null
  const local = { start: span.start - bodyStart, end: span.end - bodyStart }
  if (local.start < 0 || body.slice(local.start, local.end) !== target.quote) return null
  const prefix = /^(?:#{1,6}\s+|\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/.exec(target.quote)?.[0] ?? ''
  const suffix = /\n+$/.exec(target.quote)?.[0] ?? ''
  return { body, from: local.start, to: local.end, value: target.quote.slice(prefix.length, target.quote.length - suffix.length), prefix, suffix, heading: target.heading ?? prefix.startsWith('#') }
}

export function textEditInsertion(edit: SlideTextEdit, currentBody: string, value: string): TextInsertion | null {
  if (currentBody !== edit.body || (edit.heading && value.trim() === '')) return null
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
  const insert = (body.trim() === '' ? '' : '\n\n') + content + '\n'
  return { from: body.length, to: body.length, insert, cursor: body.length + insert.length }
}

export function removeImageSlot(body: string, slot: string): string | null {
  if (!/^studio-image-\d+$/.test(slot)) return null
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

export function slideInlineCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}
