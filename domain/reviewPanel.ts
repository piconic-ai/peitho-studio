// The comments column's list as rows (todo/review-comment-ui.md): each
// comment with its thread, in the order they were written, resolved ones
// only when asked for, and what the panel shows of each — what it's on, the
// text, when, and which slide a click on it opens.
import type { ReviewComment } from './critReview'
import { REVIEW_AUTHOR, liveReplies, type PendingReply } from './reviewComment'

/** One line of the comments panel. `id`: the crit comment a `comment` or
 * `reply` row belongs to (what reply and resolve act on), or an unsent
 * comment's or reply's own id (what discarding it acts on). */
export interface ReviewRow {
  key: string
  kind: 'comment' | 'reply' | 'unsent-reply' | 'unsent-comment'
  id: string
  /** Written by the agent (anyone but Studio): shown with its name. */
  byAgent: boolean
  author: string
  /** What a comment is on (`Slide 2 › heading "Hi"`); `null` for replies
   * and for a comment whose text carries no such label. */
  target: string | null
  body: string
  /** RFC 3339, or `null` when unknown. */
  createdAt: string | null
  resolved: boolean
  /** The slide a click on the row opens (0-based), when known. */
  slideIndex: number | null
  /** The reply box opens right under this row: the thread's last row,
   * while a reply to it is being written. */
  replyBoxHere: boolean
  /** The first and the last row of its thread: the panel draws each
   * thread as one card, its first row carrying the card's header. */
  threadStart: boolean
  threadEnd: boolean
}

type RowDraft = Omit<ReviewRow, 'threadStart' | 'threadEnd'>

/** `threads`' rows in order, each marked with where in its thread it sits. */
function markThreads(threads: readonly (readonly RowDraft[])[]): ReviewRow[] {
  return threads.flatMap(rows => rows.map((row, i) => ({ ...row, threadStart: i === 0, threadEnd: i === rows.length - 1 })))
}

/** A row as the panel shows it: with its time worded (`formatReviewTime`). */
export interface PanelRow extends ReviewRow {
  time: string
}

/** A comment not sent yet, as the panel lists it. */
export interface UnsentRowSource {
  id: string
  label: string
  body: string
  createdAt: string
  slideIndex: number | null
}

export interface ReviewRowsInput {
  comments: readonly ReviewComment[]
  unsentReplies: readonly PendingReply[]
  unsent: readonly UnsentRowSource[]
  showResolved: boolean
  /** The crit comment a reply is being written under, if any. */
  replyingTo: string | null
  /** The slide (0-based) deck line `line` (1-based) is in, when known. */
  slideOfLine: (line: number) => number | null
}

/** A sent comment's text split back into the label Studio put in front of
 * it (`[Slide 2 › heading "Hi"] Make it bigger`) and the text itself. */
export function splitCommentLabel(body: string): { target: string | null; text: string } {
  const match = /^\[(Slide \d+[^\n]*?)\] ([\s\S]*)$/.exec(body)
  return match ? { target: match[1], text: match[2] } : { target: null, text: body }
}

function timeOf(createdAt: string | null): number {
  const time = createdAt === null ? Number.NaN : Date.parse(createdAt)
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

/** The panel's rows: every thread — the comments in crit and those not sent
 * yet — oldest first (one with no time keeps its place after the timed
 * ones), each followed by its replies; resolved threads only with
 * `showResolved`. Unsent replies that can't be sent — their comment is
 * gone or was resolved (`liveReplies`) — come last, to be discarded. */
export function reviewRows(input: ReviewRowsInput): ReviewRow[] {
  type Thread = { time: number; order: number; rows: RowDraft[] }
  const threads: Thread[] = []
  input.comments.forEach((comment, order) => {
    if (comment.resolved && !input.showResolved) return
    const { target, text } = splitCommentLabel(comment.body)
    const slideIndex = comment.lines === null ? null : input.slideOfLine(comment.lines.start)
    const rows: RowDraft[] = [{
      key: `comment:${comment.id}`, kind: 'comment', id: comment.id, byAgent: comment.author !== REVIEW_AUTHOR, author: comment.author,
      target, body: text, createdAt: comment.createdAt, resolved: comment.resolved, slideIndex, replyBoxHere: false,
    }]
    for (const reply of comment.replies) {
      rows.push({
        key: `reply:${comment.id}:${reply.id}`, kind: 'reply', id: comment.id, byAgent: reply.author !== REVIEW_AUTHOR, author: reply.author,
        target: null, body: reply.body, createdAt: reply.createdAt, resolved: comment.resolved, slideIndex, replyBoxHere: false,
      })
    }
    // Only an open thread holds its unsent replies; one resolved meanwhile
    // lists them last with the other replies that can't be sent.
    for (const reply of comment.resolved ? [] : input.unsentReplies) {
      if (reply.commentId !== comment.id) continue
      rows.push({
        key: `unsent-reply:${reply.id}`, kind: 'unsent-reply', id: reply.id, byAgent: false, author: REVIEW_AUTHOR,
        target: null, body: reply.body, createdAt: reply.createdAt, resolved: comment.resolved, slideIndex, replyBoxHere: false,
      })
    }
    if (input.replyingTo === comment.id) rows[rows.length - 1] = { ...rows[rows.length - 1], replyBoxHere: true }
    threads.push({ time: timeOf(comment.createdAt), order, rows })
  })
  input.unsent.forEach((comment, i) => {
    threads.push({
      time: timeOf(comment.createdAt),
      order: input.comments.length + i,
      rows: [{
        key: `unsent:${comment.id}`, kind: 'unsent-comment', id: comment.id, byAgent: false, author: REVIEW_AUTHOR,
        target: comment.label, body: comment.body.trim(), createdAt: comment.createdAt, resolved: false, slideIndex: comment.slideIndex, replyBoxHere: false,
      }],
    })
  })
  threads.sort((a, b) => (a.time === b.time ? a.order - b.order : a.time < b.time ? -1 : 1))
  const groups: RowDraft[][] = threads.map(thread => thread.rows)
  const live = new Set(liveReplies(input.unsentReplies, input.comments))
  for (const reply of input.unsentReplies) {
    if (live.has(reply)) continue
    // Each on its own: its thread is gone or closed.
    groups.push([{
      key: `unsent-reply:${reply.id}`, kind: 'unsent-reply', id: reply.id, byAgent: false, author: REVIEW_AUTHOR,
      target: null, body: reply.body, createdAt: reply.createdAt, resolved: false, slideIndex: null, replyBoxHere: false,
    }])
  }
  return markThreads(groups)
}

/** How many resolved threads `showResolved` would add. */
export function resolvedCount(comments: readonly ReviewComment[]): number {
  return comments.filter(comment => comment.resolved).length
}

const pad = (n: number) => String(n).padStart(2, '0')

/** When a comment was written, in the viewer's local time: `14:05` today,
 * `9/28 14:05` earlier this year, `2025/12/31 14:05` before that. Nothing
 * for no time or one that doesn't parse. */
export function formatReviewTime(createdAt: string | null, now: Date): string {
  if (createdAt === null) return ''
  const time = Date.parse(createdAt)
  if (Number.isNaN(time)) return ''
  const at = new Date(time)
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (at.getFullYear() !== now.getFullYear()) return `${String(at.getFullYear())}/${String(at.getMonth() + 1)}/${String(at.getDate())} ${clock}`
  if (at.getMonth() !== now.getMonth() || at.getDate() !== now.getDate()) return `${String(at.getMonth() + 1)}/${String(at.getDate())} ${clock}`
  return clock
}
