// The review round trip with a Coding Agent through crit (see
// src-tauri/src/engine/crit.rs for the Rust side of these shapes, and
// ipc/critIpc.ts for the commands that carry them). Shared with the
// preview's comment UI (todo/archive/review-comment-ui.md).

/** Whether an agent is waiting in a crit session on the open deck. */
export type CritDeckSession =
  | { kind: 'none' }
  /** `agentWaiting`: whether an agent's `crit` waits for the next round —
   * finishing one while it doesn't never reaches the agent. */
  | { kind: 'found'; id: string; port: number; file: string; reviewRound: number; agentWaiting: boolean }
  /** More than one session reviews the deck; Studio won't guess which. */
  | { kind: 'ambiguous'; ids: string[] }

/** A 1-based, inclusive line range in the deck file. */
export interface LineRange {
  start: number
  end: number
}

export interface ReviewReply {
  id: string
  body: string
  author: string
  /** When it was written, as crit recorded it (RFC 3339); `null` if unknown. */
  createdAt: string | null
}

/** A comment in the crit session, with its thread. crit renumbers ids
 * between rounds, so follow a comment by `lines` and `quote`, not `id`. */
export interface ReviewComment {
  id: string
  /** `null` for a comment on the whole file. */
  lines: LineRange | null
  body: string
  quote: string | null
  author: string
  resolved: boolean
  replies: ReviewReply[]
  /** When it was written, as crit recorded it (RFC 3339); `null` if unknown. */
  createdAt: string | null
}

/** A line comment to add to the session. */
export interface NewReviewComment {
  startLine: number
  endLine: number
  body: string
  /** The Markdown commented on, so the agent can find it after lines move. */
  quote: string
  author: string
}

/** A reply to add under comment `commentId` in the session. */
export interface NewReviewReply {
  commentId: string
  body: string
  author: string
}

/** What the `crit-review` event reports: read the comments again, the round
 * reached the agent, or the session went away (ask for it again). */
export type CritReviewEvent = 'commentsChanged' | 'finished' | 'ended'

const CRIT_REVIEW_EVENTS: readonly CritReviewEvent[] = ['commentsChanged', 'finished', 'ended']

/** The `crit-review` event's payload, or `null` for one this version of
 * Studio doesn't know. */
export function parseCritReviewEvent(payload: unknown): CritReviewEvent | null {
  return CRIT_REVIEW_EVENTS.find(event => event === payload) ?? null
}
