// The preview's comment UI (todo/review-comment-ui.md): what a click on the
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

import type { CritDeckSession, LineRange, NewReviewComment, ReviewComment } from './critReview'
import type { ManifestSlide } from './render'
import { buildSlideList } from './slideList'
import { splitSlides } from './slides'

/** A half-open `[start, end)` range of UTF-16 indices into a string. */
export interface CharSpan {
  start: number
  end: number
}

/** What a click on the preview landed on. `slide` is anything without an
 * annotation (an image, a code block, what a layout draws itself). */
export type TargetKind = 'heading' | 'paragraph' | 'listItem' | 'tableCell' | 'slide'

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

/** A comment written on the preview and not yet sent to the agent. */
export interface PendingComment {
  id: string
  slideKey: string
  target: CommentTarget
  /** Where the pin sits, as fractions (0-1) of the slide's width and
   * height — `null` when the click position isn't known. */
  pin: { x: number; y: number } | null
  body: string
}

/** A reply written under a comment already in crit, not yet sent. */
export interface PendingReply {
  commentId: string
  body: string
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
 * nearest where it was, else anywhere in `source` — the slide may have
 * moved around it. `null` when the quote is gone, or for a whole-slide
 * target. */
export function relocateTarget(source: string, slideSpan: CharSpan | null, target: CommentTarget): CharSpan | null {
  const whole = { start: 0, end: source.length }
  const near = (slideSpan?.start ?? 0) + target.offsetInSlide
  return (slideSpan && locateQuote(source, target.quote, slideSpan, near)) ?? locateQuote(source, target.quote, whole, near)
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

const KIND_WORDS: Record<Exclude<TargetKind, 'slide'>, string> = {
  heading: 'heading',
  paragraph: 'paragraph',
  listItem: 'list item',
  tableCell: 'table cell',
}

/** `Slide 2 › heading "Markdown is the source"`, or `Slide 2` for the
 * whole slide. English on purpose: it also heads the comment the agent
 * reads. */
export function targetLabel(slideNumber: number, target: Pick<CommentTarget, 'kind' | 'text'>): string {
  const slide = `Slide ${String(slideNumber)}`
  if (target.kind === 'slide') return slide
  return `${slide} › ${KIND_WORDS[target.kind]} "${excerpt(target.text)}"`
}

/** The comment as the agent reads it: the target, then what was written. */
export function agentCommentBody(label: string, body: string): string {
  return `[${label}] ${body.trim()}`
}

/** `pending` as crit takes it, against the deck file as saved (`source`).
 * `slideSpan` is where its slide is now (`null` when the slide is gone)
 * and `slideNumber` which slide that is. A target whose Markdown was
 * edited away becomes a comment on its slide; one whose slide is gone too
 * lands on line 1 — the label still says what it was about. */
export function newReviewComment(pending: PendingComment, source: string, slideSpan: CharSpan | null, slideNumber: number): NewReviewComment {
  const found = pending.target.kind === 'slide' ? null : relocateTarget(source, slideSpan, pending.target)
  const lines = lineRangeOf(source, found ?? slideSpan ?? { start: 0, end: 0 })
  return {
    startLine: lines.start,
    endLine: lines.end,
    body: agentCommentBody(targetLabel(slideNumber, pending.target), pending.body),
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
    key: entry.kind === 'rendered' ? entry.slide.key : entry.lastRenderedKey ?? entry.key,
    span: { start: ranges[i].start, end: ranges[i].end },
  }))
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

/** How many comments each slide has, by slide key: the unsent ones, plus
 * the unresolved ones in crit, placed by their first line. `slides` lists
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
  const spans = slides.map(slide => slide.span)
  for (const comment of sent) {
    if (comment.resolved || comment.lines === null) continue
    const index = slideIndexOfLine(source, spans, comment.lines.start)
    if (index !== null) bump(slides[index].key)
  }
  return counts
}
