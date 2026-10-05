// The preview's comment UI (todo/archive/review-comment-ui.md): what a click on the
// preview points at in deck.md, how that target is shown ("Slide 2 ›
// heading …"), and how a comment still waiting to be sent finds its spot
// again after the deck was edited. The round trip itself goes through crit
// (`domain/critReview.ts`, `ipc/critIpc.ts`).
//
// Where the positions come from: the preview renders with peitho-core's
// `EditAnnotations::On` (`src-tauri/src/engine/pipeline.rs`), which puts
// `data-peitho-src="<start>-<end>"` — the element's UTF-8 byte span in the
// source that was rendered — and `data-peitho-md` — that Markdown — on
// paragraphs, headings, list items and table cells. `getAttribute` already
// decodes `data-peitho-md` back to the exact Markdown (peitho-core encodes
// only `&`, `"`, `<`, CR and LF, all as entities the HTML parser resolves),
// so no decoding happens here.

import type { CritDeckSession, LineRange, NewLayoutComment, NewReviewComment, ReviewComment } from './critReview'
import type { Messages } from './messages'
import { isPointInRect, type Point, type Rect } from './geometry'
import type { ManifestSlide } from './render'
import { buildSlideList, type SlideListEntry } from './slideList'
import { slideFieldStarts, splitSlides } from './slides'
import type { PageConfig } from './pageConfig'

/** A half-open `[start, end)` range of UTF-16 indices into a string. */
export interface CharSpan {
  start: number
  end: number
}

/** What a click on the preview landed on. `slide` is anything without an
 * annotation (an image, a code block, what a layout draws itself). `lines`
 * is never clicked: it's lines picked in the slide's body or notes editor
 * (`editorLinesTarget`). */
export type TargetKind = 'heading' | 'paragraph' | 'listItem' | 'tableCell' | 'slide' | 'lines'

export interface CommentTarget {
  kind: TargetKind
  /** The element's text as shown, whitespace collapsed ('' for a slide). */
  text: string
  /** The Markdown commented on ('' for a slide). */
  quote: string
  /** Where `quote` started, counted from the start of its slide's text —
   * the tie-breaker when the same Markdown appears more than once. */
  offsetInSlide: number
}

/** Where a pin sits: `x`/`y` as fractions (0-1) of the slide's width and
 * height, and, for a comment on an element, that element and where in it
 * (`anchor`: its Markdown, as `data-peitho-md` carries it, and fractions of
 * its own box). The element is found again wherever the slide lays it out
 * (a phone-shaped preview reflows it), `x`/`y` being the fallback. */
export interface PinSpot {
  x: number
  y: number
  anchor: PinAnchor | null
}

export interface PinAnchor {
  quote: string
  x: number
  y: number
}

/** A comment written on the preview and not yet sent to the agent. */
export interface PendingComment {
  id: string
  slideKey: string
  target: CommentTarget
  /** Where the pin sits (`PinSpot`) — `null` when the click position
   * isn't known. */
  pin: PinSpot | null
  body: string
  /** When it was written (RFC 3339). */
  createdAt: string
}

/** The box a comment is written in: closed, open on a target on the
 * preview — with where the pin goes and where on screen the box sits — or
 * open on a layout (or every layout) from the layout screen's menu. */
export type CommentBox =
  | { kind: 'closed' }
  | { kind: 'open'; slideKey: string; target: CommentTarget; pin: PinSpot | null; at: { x: number; y: number } }
  | { kind: 'open-layout'; target: LayoutCommentTarget; at: { x: number; y: number } }

/** What a comment written on the layout screen is on: one layout, or every
 * layout (the deck's look as a whole). A comment from a click on a
 * layout's thumbnail also says where it was clicked (`part`); one from the
 * layout menu doesn't. The comment still goes on the layout's files as a
 * whole: the part is in its label, for the agent to read. One written in
 * the screen's editor is on lines of a file (`file`): `quote` is their
 * text. */
export type LayoutCommentTarget =
  | { kind: 'layout'; name: string; part?: LayoutPart }
  | { kind: 'all-layouts' }
  | { kind: 'file'; path: string; lines: LineRange; quote: string }

/** Where on a layout's thumbnail a click landed: inside a slot's content,
 * or on nothing a slot holds (the whole layout). */
export type LayoutPart = { kind: 'slot'; slot: string } | { kind: 'whole' }

/** The target of a click on layout `name`'s thumbnail that landed in
 * `slot` (`null` for none). */
export function layoutClickTarget(name: string, slot: string | null): LayoutCommentTarget {
  return { kind: 'layout', name, part: slot === null ? { kind: 'whole' } : { kind: 'slot', slot } }
}

// A slot's name as peitho-core allows it (`SlotName::new`): lowercase
// ASCII, digits and '-'.
const SLOT = '[a-z0-9-]+'
const SLOT_CLASS = new RegExp(`^slot-(${SLOT})$`)

/** The slot an element holds the content of, from its classes: peitho-core
 * wraps each filled slot's content in an element classed `slot-<name>`
 * (`SlotName::class_name`). `null` for none; of several, the first. */
export function slotNameOfClasses(classes: readonly string[]): string | null {
  for (const name of classes) {
    const match = SLOT_CLASS.exec(name)
    if (match !== null) return match[1]
  }
  return null
}

/** The slot whose box holds `point` — the smallest such, as a slot can sit
 * inside another's box; of equal ones, the first listed. A box with no
 * area (an empty slot, or one not laid out) holds nothing. `null` when no
 * slot holds the point. */
export function slotAtPoint(point: Point, slots: readonly { slot: string; rect: Rect }[]): string | null {
  let best: { slot: string; area: number } | null = null
  for (const { slot, rect } of slots) {
    const area = (rect.right - rect.left) * (rect.bottom - rect.top)
    if (!(area > 0) || !isPointInRect(point, rect)) continue
    if (best === null || area < best.area) best = { slot, area }
  }
  return best?.slot ?? null
}

/** A comment written on the layout screen and not yet sent. */
export interface PendingLayoutComment {
  id: string
  target: LayoutCommentTarget
  body: string
  /** When it was written (RFC 3339). */
  createdAt: string
}

// A layout's name, as a pattern to build the others from.
const NAME = '[A-Za-z0-9][A-Za-z0-9_-]*'
const LAYOUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Layout `name`'s HTML file, relative to the deck's folder — or `null`
 * for a name no layout can have (a path separator, a dot, a space: see
 * `engine::layout_files::validate_layout_name`), so a name never points
 * outside `layouts/`. */
export function layoutHtmlFile(name: string): string | null {
  return LAYOUT_NAME.test(name) ? `layouts/${name}.html` : null
}

/** `Layout cover`, `All layouts`, or for lines of a file
 * `css/base.css L3-L5 "h1 { color: red; }"` — what the comment box and
 * the panel say a layout comment is on. */
export function layoutTargetLabel(target: LayoutCommentTarget): string {
  if (target.kind === 'all-layouts') return 'All layouts'
  if (target.kind === 'file') return fileLinesLabel(target.path, target.lines, target.quote)
  return `Layout ${target.name}${target.part === undefined ? '' : ` › ${layoutPartLabel(target.part)}`}`
}

function layoutPartLabel(part: LayoutPart): string {
  return part.kind === 'slot' ? `slot "${part.slot}"` : 'whole layout'
}

/** `L3` for one line, `L3-L5` for several. */
function linesLabel(lines: LineRange): string {
  return lines.end === lines.start ? `L${String(lines.start)}` : `L${String(lines.start)}-L${String(lines.end)}`
}

/** `layouts/title-body.html L3-L5 "<h1>…"`: the file, its lines, and the
 * start of their text (`excerpt`) — left out when they're blank. English
 * on purpose, like `targetLabel`: it also heads the comment the agent
 * reads. */
export function fileLinesLabel(path: string, lines: LineRange, quote: string): string {
  const text = excerpt(quote)
  return `${path} ${linesLabel(lines)}${text === '' ? '' : ` "${text}"`}`
}

/** The label heading a layout comment as the agent reads it: what it's
 * on, and the files that means — a layout is its HTML and the CSS file of
 * the same name; every layout is both folders; lines of a file name it
 * already. A name no layout can have is named without files. English on
 * purpose, like `targetLabel`. */
export function layoutAgentLabel(target: LayoutCommentTarget): string {
  if (target.kind === 'all-layouts') return 'All layouts (layouts/, css/)'
  if (target.kind === 'file') return layoutTargetLabel(target)
  const html = layoutHtmlFile(target.name)
  return html === null ? layoutTargetLabel(target) : `${layoutTargetLabel(target)} (${html}, css/${target.name}.css)`
}

/** `pending` as crit takes it: the layout it's on (`null` for every
 * layout, or for lines of a file, which carry their own place), headed by
 * `layoutAgentLabel`. */
export function newLayoutComment(pending: PendingLayoutComment): NewLayoutComment {
  const { target } = pending
  const comment: NewLayoutComment = {
    layout: target.kind === 'layout' ? target.name : null,
    body: agentCommentBody(layoutAgentLabel(target), pending.body),
    author: REVIEW_AUTHOR,
  }
  if (target.kind === 'file') comment.lines = { path: target.path, startLine: target.lines.start, endLine: target.lines.end, quote: target.quote }
  return comment
}

/** The lines a selection from `from` to `to` (offsets into `doc`, either
 * way round; a caret when equal) covers, 1-based and inclusive, and their
 * whole text — what a comment from the editor is on. A selection ending at
 * the very start of a line (a whole line picked with the mouse or `V` up to
 * its line break) doesn't take that next line in. Offsets out of range are
 * clamped to the text. */
export function lineSelectionOf(doc: string, from: number, to: number): { lines: LineRange; quote: string } {
  const clamp = (at: number) => Math.max(0, Math.min(doc.length, Number.isFinite(at) ? Math.floor(at) : 0))
  const start = Math.min(clamp(from), clamp(to))
  let end = Math.max(clamp(from), clamp(to))
  if (end > start && doc[end - 1] === '\n') end -= 1
  const lineAt = (offset: number) => doc.slice(0, offset).split('\n').length
  const lines = { start: lineAt(start), end: lineAt(end) }
  const quote = doc.split('\n').slice(lines.start - 1, lines.end).join('\n')
  return { lines, quote }
}

const LAYOUT_LABEL = new RegExp(`^\\[(?:Layout (${NAME})(?: › (?:slot "(${SLOT})"|(whole layout)))?|(All layouts))(?: \\([^\\]\\n]*\\))?\\] ([\\s\\S]*)$`)
const FILE_LINES_LABEL = new RegExp(`^\\[((?:layouts/${NAME}\\.html|css/${NAME}\\.css)) L(\\d+)(?:-L(\\d+))?(?: "([^\\n]*?)")?\\] ([\\s\\S]*)$`)

/** A sent comment's text split back into the layout target its label
 * names (`layoutAgentLabel`) and the text itself — `null` for a comment
 * with no such label. A file's lines come back with the label's excerpt as
 * their quote. */
export function splitLayoutLabel(body: string): { target: LayoutCommentTarget; text: string } | null {
  const lines = FILE_LINES_LABEL.exec(body)
  if (lines !== null) {
    const [, path, start, end, quote, text] = lines
    const range = { start: Number(start), end: Number(end ?? start) }
    return { target: { kind: 'file', path, lines: range, quote: quote ?? '' }, text }
  }
  const match = LAYOUT_LABEL.exec(body)
  if (match === null) return null
  const [, name, slot, whole, , text] = match
  if (name === undefined) return { target: { kind: 'all-layouts' }, text }
  const part: LayoutPart | undefined = slot !== undefined ? { kind: 'slot', slot } : whole !== undefined ? { kind: 'whole' } : undefined
  return { target: part === undefined ? { kind: 'layout', name } : { kind: 'layout', name, part }, text }
}

const LAYOUT_FILE = new RegExp(`^(?:layouts/(${NAME})\\.html|css/(${NAME})\\.css)$`)

/** Which layout a sent comment is about: for one on lines of a layout or
 * CSS file (written in the editor), those lines; else the layout whose
 * file it's on, else — for one on the review as a whole — the layout its
 * label names. `null` for a comment on the deck, or one no layout label
 * heads. */
export function layoutTargetOfComment(comment: Pick<ReviewComment, 'place' | 'body'> & Partial<Pick<ReviewComment, 'lines' | 'quote'>>): LayoutCommentTarget | null {
  switch (comment.place.kind) {
    case 'deck': return null
    case 'file': {
      if (comment.lines && LAYOUT_FILE.test(comment.place.path)) {
        return { kind: 'file', path: comment.place.path, lines: comment.lines, quote: comment.quote ?? '' }
      }
      const match = LAYOUT_FILE.exec(comment.place.path)
      const name = match?.[1] ?? match?.[2]
      return name === undefined ? splitLayoutLabel(comment.body)?.target ?? null : { kind: 'layout', name }
    }
    case 'review': return splitLayoutLabel(comment.body)?.target ?? null
    default: {
      const exhaustive: never = comment.place
      return exhaustive
    }
  }
}

/** A reply written under a comment already in crit, not yet sent. */
export interface PendingReply {
  id: string
  commentId: string
  body: string
  /** When it was written (RFC 3339). */
  createdAt: string
}

/** Those of `replies` whose comment crit still has open. A reply to a
 * comment that's gone (its session ended and a new one began) or was
 * resolved meanwhile isn't sent: it stays listed, to be discarded, but
 * isn't counted or sent. */
export function liveReplies(replies: readonly PendingReply[], comments: readonly ReviewComment[]): PendingReply[] {
  const open = new Set(comments.filter(comment => !comment.resolved).map(comment => comment.id))
  return replies.filter(reply => open.has(reply.commentId))
}

/** The unsent comments and replies with the one `id` names now reading
 * `body` (trimmed). `null` when there's nothing to rewrite: a blank body,
 * or no unsent comment or reply by that id (it was sent or discarded). */
export function rewriteUnsent<P extends { id: string; body: string }>(
  pending: readonly P[],
  replies: readonly PendingReply[],
  id: string,
  body: string,
): { pending: P[]; replies: PendingReply[] } | null {
  const text = body.trim()
  if (text === '' || ![...pending, ...replies].some(item => item.id === id)) return null
  return {
    pending: pending.map(comment => (comment.id === id ? { ...comment, body: text } : comment)),
    replies: replies.map(reply => (reply.id === id ? { ...reply, body: text } : reply)),
  }
}

/** The text of the unsent comment or reply `id`, or `null` for none. */
export function unsentBody(pending: readonly { id: string; body: string }[], replies: readonly PendingReply[], id: string): string | null {
  return [...pending, ...replies].find(item => item.id === id)?.body ?? null
}

/** The name Studio's comments and replies carry in crit. */
export const REVIEW_AUTHOR = 'Peitho Studio'

/** `data-peitho-src`'s `<start>-<end>` byte span, or `null` for anything
 * else (missing, not two non-negative integers, end before start). */
export function parseSourceSpan(value: string | null | undefined): CharSpan | null {
  const match = /^(\d+)-(\d+)$/.exec(value ?? '')
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null
  return { start, end }
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/** The UTF-16 index where UTF-8 byte `byteOffset` of `source` falls, or
 * `null` when it's past the end or in the middle of a character. */
export function utf8OffsetToIndex(source: string, byteOffset: number): number | null {
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) return null
  let bytes = 0
  let index = 0
  while (bytes < byteOffset) {
    const codePoint = source.codePointAt(index)
    if (codePoint === undefined) return null
    bytes += utf8Length(codePoint)
    index += codePoint > 0xffff ? 2 : 1
  }
  return bytes === byteOffset ? index : null
}

/** `span` (UTF-8 bytes of `source`) as UTF-16 indices, or `null` when
 * either end doesn't land on a character of `source`. */
export function charSpanOfByteSpan(source: string, span: CharSpan): CharSpan | null {
  const start = utf8OffsetToIndex(source, span.start)
  const end = utf8OffsetToIndex(source, span.end)
  return start === null || end === null || end < start ? null : { start, end }
}

/** The annotated element's span in `renderedSource`, when its bytes there
 * are exactly `quote`. `null` otherwise — the deck uses `include` (the
 * bytes count in the expanded source), or the source has moved on. */
export function annotatedSpan(renderedSource: string, byteSpan: CharSpan, quote: string): CharSpan | null {
  const span = charSpanOfByteSpan(renderedSource, byteSpan)
  return span !== null && renderedSource.slice(span.start, span.end) === quote ? span : null
}

function newlinesBefore(source: string, index: number): number {
  let count = 0
  for (let i = source.indexOf('\n'); i !== -1 && i < index; i = source.indexOf('\n', i + 1)) count++
  return count
}

/** The 1-based, inclusive lines `span` covers. A span ending right after
 * a line break doesn't reach into the next line; an empty span is the one
 * line it sits on. Out-of-range indices are clamped to `source`. */
export function lineRangeOf(source: string, span: CharSpan): LineRange {
  const start = Math.min(Math.max(span.start, 0), source.length)
  let end = Math.min(Math.max(span.end, start), source.length)
  if (end > start && source[end - 1] === '\n') end--
  const last = Math.max(start, end - 1)
  return { start: newlinesBefore(source, start) + 1, end: newlinesBefore(source, last) + 1 }
}

/** Where `quote` occurs in `source` between `within`'s ends, choosing the
 * occurrence that starts nearest `near` (the earlier one on a tie).
 * `null` for an empty quote or none found. */
export function locateQuote(source: string, quote: string, within: CharSpan, near: number): CharSpan | null {
  if (quote === '') return null
  let best: number | null = null
  for (let at = source.indexOf(quote, within.start); at !== -1 && at + quote.length <= within.end; at = source.indexOf(quote, at + 1)) {
    if (best === null || Math.abs(at - near) < Math.abs(best - near)) best = at
  }
  return best === null ? null : { start: best, end: best + quote.length }
}

/** Where `target` is now in `source`: its quote in its slide (`slideSpan`)
 * nearest where it was. Never in another slide — the same Markdown there
 * is another element, and the comment's label names its own slide — so
 * only without a slide span is all of `source` searched. `null` when the
 * quote is gone from its slide, or for a whole-slide target. */
export function relocateTarget(source: string, slideSpan: CharSpan | null, target: CommentTarget): CharSpan | null {
  const within = slideSpan ?? { start: 0, end: source.length }
  return locateQuote(source, target.quote, within, within.start + target.offsetInSlide)
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

/** The kind of an annotated element from its tag. peitho-core annotates a
 * heading through a `<span>` inside it, so `parentTagName` is its
 * heading's. Tags are compared case-insensitively. */
export function targetKindOf(tagName: string, parentTagName: string | null): TargetKind {
  const tag = tagName.toUpperCase()
  const parent = (parentTagName ?? '').toUpperCase()
  if (HEADING_TAGS.has(tag) || (tag === 'SPAN' && HEADING_TAGS.has(parent))) return 'heading'
  if (tag === 'LI') return 'listItem'
  if (tag === 'TD' || tag === 'TH') return 'tableCell'
  if (tag === 'P') return 'paragraph'
  return 'slide'
}

/** `text` on one line, cut to `max` characters (counting an emoji as one)
 * with an ellipsis. */
export function excerpt(text: string, max = 30): string {
  const flat = Array.from(text.replace(/\s+/g, ' ').trim())
  return flat.length <= max ? flat.join('') : `${flat.slice(0, Math.max(max - 1, 0)).join('')}…`
}

const KIND_WORDS: Record<Exclude<TargetKind, 'slide' | 'lines'>, string> = {
  heading: 'heading',
  paragraph: 'paragraph',
  listItem: 'list item',
  tableCell: 'table cell',
}

/** `Slide 2 › heading "Markdown is the source"`, or `Slide 2` for the
 * whole slide; with `slideKey`, `Slide 2 (key: intro) › …`. Lines picked
 * in the editor read `Slide 2 › lines L5-L7 "…"`, with deck.md's line
 * numbers when they're known (`lines`; left out otherwise), and their text
 * left out when it's blank. English on purpose: it also heads the comment
 * the agent reads. */
export function targetLabel(slideNumber: number, target: Pick<CommentTarget, 'kind' | 'text'>, slideKey: string | null = null, lines: LineRange | null = null): string {
  const slide = `Slide ${String(slideNumber)}${slideKey === null ? '' : ` (key: ${slideKey})`}`
  if (target.kind === 'slide') return slide
  if (target.kind === 'lines') {
    const text = excerpt(target.text)
    return `${slide} › lines${lines === null ? '' : ` ${linesLabel(lines)}`}${text === '' ? '' : ` "${text}"`}`
  }
  return `${slide} › ${KIND_WORDS[target.kind]} "${excerpt(target.text)}"`
}

/** The comment target for lines `from`–`to` (offsets either way round; a
 * caret when equal) of field `field` of a slide whose config, body and
 * notes are `fields` (the editor's drafts) — on the slide as it's saved
 * (`buildSlideText`). Like a click on an element, it's found again by its
 * text (`quote`, the lines whole) nearest where it sits in the slide
 * (`offsetInSlide`, from where the serialization puts the field,
 * `slideFieldStarts` — never by searching it, as the same text may be in
 * the PageComment), so a comment written before the draft is saved still
 * lands on deck.md's lines. Blank lines quote nothing: the comment is then
 * on the slide's lines as a whole, as a click on no element is. */
export function editorLinesTarget(fields: { config: PageConfig; body: string; note: string }, field: 'body' | 'note', from: number, to: number): CommentTarget {
  const fieldText = fields[field]
  const { quote } = lineSelectionOf(fieldText, from, to)
  const starts = slideFieldStarts(fields.config, fields.body, fields.note)
  const fieldAt = field === 'body' ? starts.body : starts.note
  const start = Number.isFinite(Math.min(from, to)) ? Math.max(0, Math.min(from, to)) : 0
  const firstLine = fieldText.slice(0, start).lastIndexOf('\n') + 1
  const leading = fieldText.length - fieldText.trimStart().length
  const offsetInSlide = fieldAt === null ? 0 : fieldAt + Math.max(0, firstLine - leading)
  const blank = quote.trim() === ''
  return { kind: 'lines', text: blank ? '' : quote, quote: blank ? '' : quote, offsetInSlide }
}

/** deck.md's lines `target` is on now in `source` (its quote nearest
 * where it was in its slide, `slideSpan`), or `null` when it isn't found
 * (edited away, not saved yet) or is on the whole slide. */
export function targetLines(source: string, slideSpan: CharSpan | null, target: CommentTarget): LineRange | null {
  if (target.kind === 'slide') return null
  const found = relocateTarget(source, slideSpan, target)
  return found === null ? null : lineRangeOf(source, found)
}

/** The comment as the agent reads it: the target, then what was written. */
export function agentCommentBody(label: string, body: string): string {
  return `[${label}] ${body.trim()}`
}

const SLIDE_KEY = /^[A-Za-z0-9_-]+$/

/** `key` when the slide's own text (`span` of `source`) sets it — the key
 * a comment's label names, so its slide can be found again however crit
 * moves its lines. `null` for a key the slide doesn't set (the agent
 * couldn't find it) or one that couldn't be read back out of a label. */
export function explicitSlideKey(source: string, span: CharSpan | null, key: string): string | null {
  if (span === null || !SLIDE_KEY.test(key)) return null
  const set = /"key"\s*:\s*"([^"\\]*)"/.exec(source.slice(span.start, span.end))
  return set?.[1] === key ? key : null
}

/** The slide key a sent comment's label names (`[Slide 4 (key: intro) › …]`),
 * or `null`. */
export function commentSlideKey(body: string): string | null {
  return /^\[Slide \d+ \(key: ([A-Za-z0-9_-]+)\)/.exec(body)?.[1] ?? null
}

/** `span` without the whitespace (blank lines) at either end — a slide's
 * text runs from separator to separator, blank lines included. An
 * all-blank span shrinks to nothing at its start. */
export function trimSpan(source: string, span: CharSpan): CharSpan {
  let start = span.start
  let end = span.end
  while (start < end && /\s/.test(source[start])) start++
  while (end > start && /\s/.test(source[end - 1])) end--
  return { start, end }
}

/** `pending` as crit takes it, against the deck file as saved (`source`).
 * `slideSpan` is where its slide is now (`null` when the slide is gone)
 * and `slideNumber` which slide that is. A target whose Markdown was
 * edited away becomes a comment on its slide; one whose slide is gone too
 * lands on line 1 — the label still says what it was about. The label
 * names the slide's key when the slide sets one: crit moves a comment's
 * lines as the deck changes, and against a deck edited mid-round it can
 * move them onto another slide (`slideIndexOfComment`). */
export function newReviewComment(pending: PendingComment, source: string, slideSpan: CharSpan | null, slideNumber: number): NewReviewComment {
  const found = pending.target.kind === 'slide' ? null : relocateTarget(source, slideSpan, pending.target)
  const lines = lineRangeOf(source, found ?? (slideSpan && trimSpan(source, slideSpan)) ?? { start: 0, end: 0 })
  return {
    startLine: lines.start,
    endLine: lines.end,
    body: agentCommentBody(targetLabel(slideNumber, pending.target, explicitSlideKey(source, slideSpan, pending.slideKey), found === null ? null : lines), pending.body),
    quote: found === null ? '' : pending.target.quote,
    author: REVIEW_AUTHOR,
  }
}

/** Each slide of `source` (the deck's text) with the key its comments are
 * filed under and where its text is — the manifest's key for a rendered
 * slide; for one the manifest doesn't list (a draft), the key it last
 * rendered under, or its `placeholder:` key. In source order, so index + 1
 * is the slide's number in the slide list. `manifestSlides` must be the
 * manifest rendered from `source`. */
export function slideSpans(source: string, manifestSlides: readonly ManifestSlide[]): { key: string; span: CharSpan }[] {
  const ranges = splitSlides(source)
  return buildSlideList(source, manifestSlides).map((entry, i) => ({
    key: commentKeyOf(entry),
    span: { start: ranges[i].start, end: ranges[i].end },
  }))
}

/** The key a slide-list entry's comments are filed under (see
 * `slideSpans`). */
export function commentKeyOf(entry: SlideListEntry): string {
  return entry.kind === 'rendered' ? entry.slide.key : entry.lastRenderedKey ?? entry.key
}

/** What a click on the preview hit, as `dom/previewComments.ts` reads it:
 * an annotated element (`byteSpan`/`quote` from its `data-peitho-src`/
 * `data-peitho-md`) or `null` for anything else. */
export interface PreviewHit {
  kind: TargetKind
  text: string
  byteSpan: CharSpan | null
  quote: string
}

/** A click on the preview meant as a comment, as `dom/previewComments.ts`
 * reads it. */
export interface PreviewClick {
  /** The annotated element clicked, or `null` for the slide as a whole. */
  hit: PreviewHit | null
  /** Where on the slide (`PinSpot`: anchored to the element clicked, if
   * any). */
  pin: PinSpot | null
  /** Where on screen, for placing the comment box. */
  at: Point
}

/** The comment target for `hit` on the slide at `slideSpan` of
 * `renderedSource` (the source the preview was rendered from). An
 * element whose span can't be trusted (an `include`d deck) is located by
 * its Markdown instead; one that can't be found at all, or no element,
 * targets the whole slide. */
export function commentTargetOf(renderedSource: string, slideSpan: CharSpan | null, hit: PreviewHit | null): CommentTarget {
  const whole: CommentTarget = { kind: 'slide', text: '', quote: '', offsetInSlide: 0 }
  if (hit === null || hit.kind === 'slide' || hit.quote === '') return whole
  const slideStart = slideSpan?.start ?? 0
  const span = (hit.byteSpan && annotatedSpan(renderedSource, hit.byteSpan, hit.quote))
    ?? locateQuote(renderedSource, hit.quote, slideSpan ?? { start: 0, end: renderedSource.length }, slideStart)
  if (span === null) return whole
  return { kind: hit.kind, text: hit.text, quote: hit.quote, offsetInSlide: span.start - slideStart }
}

/** How many open threads wait on the agent: the last word in them is
 * Studio's (the comment itself, or a reply to the agent). One can end up
 * there without the agent ever seeing it — a round finished while no agent
 * was waiting is handed to nobody — and crit hands every open comment to
 * the agent on each finish, so sending again delivers it. `counted`:
 * threads already counted elsewhere (they have an unsent reply). */
export function awaitingAgentCount(comments: readonly ReviewComment[], counted: ReadonlySet<string> = new Set()): number {
  return comments.filter(comment => {
    // A thread already counted — it has an unsent reply going out — counts once.
    if (comment.resolved || counted.has(comment.id)) return false
    const last = comment.replies.length > 0 ? comment.replies[comment.replies.length - 1] : comment
    return last.author === REVIEW_AUTHOR
  }).length
}

/** Whether the unsent comments can go to the agent now, and if not why. */
export type SendAvailability =
  | { kind: 'ready' }
  | { kind: 'sending' }
  | { kind: 'nothing-to-send' }
  /** No session yet (Studio starts one with the first comment). */
  | { kind: 'no-session' }
  /** A session, but no agent waits in it — the agent must run `crit`. */
  | { kind: 'agent-not-waiting' }
  | { kind: 'several-sessions' }

/** `session` is `null` until Studio has asked crit. */
export function sendAvailability(session: CritDeckSession | null, unsent: number, sending: boolean): SendAvailability {
  if (sending) return { kind: 'sending' }
  if (session === null || session.kind === 'none') return { kind: 'no-session' }
  if (session.kind === 'ambiguous') return { kind: 'several-sessions' }
  if (!session.agentWaiting) return { kind: 'agent-not-waiting' }
  return unsent > 0 ? { kind: 'ready' } : { kind: 'nothing-to-send' }
}

/** Whether to keep re-reading crit's session. crit announces an agent's
 * `crit` connecting with an event, but the session read on that event can
 * still show the old round (crit advances it asynchronously, next to
 * merging the agent's own writes to the review file), and no further event
 * comes to correct it. With no session at all there's no event to hear:
 * an agent's own `crit` can start one. So until an agent is seen waiting
 * in exactly one session, Studio checks again every `REVIEW_POLL_MS`. */
export function pollsForAgent(availability: SendAvailability): boolean {
  return availability.kind === 'agent-not-waiting' || availability.kind === 'no-session' || availability.kind === 'several-sessions'
}

export const REVIEW_POLL_MS = 3000

/** What the panel says, in the agent's voice — empty when there's nothing
 * to say. `starting`: Studio is starting the session. `agentSeen`: an agent
 * has been seen waiting in this session, so one not waiting now is at work
 * on what it was sent — the Send button says so, and the connect card is
 * for one never seen. `threads`:
 * the panel lists some, so the how-to hint isn't needed. */
export function reviewStatusText(
  messages: Pick<Messages, 'startingReview' | 'sendingToAgent' | 'commentHint' | 'sendNeedsSession' | 'sendNeedsAgent' | 'sendNeedsOneSession'>,
  availability: SendAvailability,
  unsent: number,
  starting: boolean,
  agentSeen: boolean,
  threads: boolean,
): string {
  if (starting) return messages.startingReview
  const hint = threads ? '' : messages.commentHint
  switch (availability.kind) {
    // Nothing to say: the Send button being enabled says it.
    case 'ready': return ''
    case 'sending': return messages.sendingToAgent
    case 'nothing-to-send': return hint
    case 'no-session': return unsent > 0 ? messages.sendNeedsSession : hint
    // An agent at work shows on the Send button, not here.
    case 'agent-not-waiting': return agentSeen ? '' : messages.sendNeedsAgent
    case 'several-sessions': return messages.sendNeedsOneSession
    default: {
      const exhaustive: never = availability
      return exhaustive
    }
  }
}

/** A pin on the preview: where on the slide (`PinSpot`), the number
 * shown, and whether its comment reached crit yet. */
export interface PreviewPin extends PinSpot {
  id: string
  number: number
  sent: boolean
}

/** Where the pins of comments sent from this window sat. crit only reports
 * a comment's body back, so they are filed by the body crit got — a list,
 * in sending order, since two comments can end up with the same body. */
export type SentPins = Readonly<Record<string, readonly { slideKey: string; pin: PinSpot | null }[]>>

/** Where a sent comment's pin goes when where it was clicked isn't known
 * (it was sent before this window opened, or not from Studio): on the
 * top-left corner of the element its Markdown (`quote`) is, else of the
 * slide. */
export function pinOfQuote(quote: string | null): PinSpot {
  const corner = { x: 0.02, y: 0.06 }
  return quote === null || quote === '' ? { ...corner, anchor: null } : { ...corner, anchor: { quote, x: 0, y: 0 } }
}

/** The pins slide `slideKey` shows, numbered in order: the unresolved
 * comments in crit — where they were clicked when sent from this window
 * (`sentPins`; comments sharing a body take its pins in crit's order),
 * else by their Markdown on the slide `slideKeyOf` puts them on
 * (`pinOfQuote`) — the unsent ones, then the one being written. */
export function previewPinsOf(
  slideKey: string | null,
  comments: readonly ReviewComment[],
  sentPins: SentPins,
  pending: readonly PendingComment[],
  box: CommentBox,
  slideKeyOf: (comment: ReviewComment) => string | null = () => null,
): PreviewPin[] {
  if (slideKey === null) return []
  const pins: Omit<PreviewPin, 'number'>[] = []
  const taken = new Map<string, number>()
  for (const comment of comments) {
    const nth = taken.get(comment.body) ?? 0
    taken.set(comment.body, nth + 1)
    if (comment.resolved) continue
    const sent = Object.hasOwn(sentPins, comment.body) ? sentPins[comment.body][nth] : undefined
    if (sent?.pin != null) {
      if (sent.slideKey === slideKey) pins.push({ id: `sent:${comment.id}`, ...sent.pin, sent: true })
    } else if (slideKeyOf(comment) === slideKey) {
      pins.push({ id: `sent:${comment.id}`, ...pinOfQuote(comment.quote), sent: true })
    }
  }
  for (const comment of pending) {
    if (comment.slideKey === slideKey && comment.pin !== null) pins.push({ id: comment.id, ...comment.pin, sent: false })
  }
  if (box.kind === 'open' && box.slideKey === slideKey && box.pin !== null) pins.push({ id: 'writing', ...box.pin, sent: false })
  return pins.map((pin, i) => ({ ...pin, number: i + 1 }))
}

/** Which of `slides` (each with its span in `source`) line `line` of
 * `source` falls in, or `null`. */
export function slideIndexOfLine(source: string, slides: readonly CharSpan[], line: number): number | null {
  if (!Number.isSafeInteger(line) || line < 1) return null
  let offset = 0
  for (let n = 1; n < line; n++) {
    const next = source.indexOf('\n', offset)
    if (next === -1) return null
    offset = next + 1
  }
  const index = slides.findIndex(span => offset >= span.start && offset < span.end)
  return index === -1 ? null : index
}

/** Which of `slides` a sent comment is on: the slide its label names by key,
 * else the one its first line is in, else `null` — always `null` for a
 * comment that isn't on the deck file (its lines are another file's). */
export function slideIndexOfComment(source: string, slides: readonly { key: string; span: CharSpan }[], comment: Pick<ReviewComment, 'body' | 'lines' | 'place'>): number | null {
  if (comment.place.kind !== 'deck') return null
  const key = commentSlideKey(comment.body)
  const byKey = key === null ? -1 : slides.findIndex(slide => slide.key === key)
  if (byKey !== -1) return byKey
  return comment.lines === null ? null : slideIndexOfLine(source, slides.map(slide => slide.span), comment.lines.start)
}

/** How many comments each slide has, by slide key: the unsent ones, plus
 * the unresolved ones in crit, placed by `slideIndexOfComment`. `slides` lists
 * each slide's key and its span in `source` (the deck as saved). */
export function commentCountsBySlide(
  source: string,
  slides: readonly { key: string; span: CharSpan }[],
  pending: readonly Pick<PendingComment, 'slideKey'>[],
  sent: readonly ReviewComment[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  const bump = (key: string) => { counts[key] = (counts[key] ?? 0) + 1 }
  for (const comment of pending) bump(comment.slideKey)
  for (const comment of sent) {
    if (comment.resolved) continue
    const index = slideIndexOfComment(source, slides, comment)
    if (index !== null) bump(slides[index].key)
  }
  return counts
}
