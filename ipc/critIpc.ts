// Typed boundary around the crit review commands (`crit_session_status`,
// `crit_start_session`, `crit_add_comments`, `crit_add_replies`,
// `crit_resolve_comment`, `crit_finish`, `crit_list_comments` in
// src-tauri/src/peitho.rs) and the `crit-review` event they emit to this
// window. Every command acts on this window's open deck; the Rust side finds
// the crit session again on each call. `fakeCritIpc.ts` implements the same
// interface for tests.
import { invoke } from '@tauri-apps/api/core'
import { parseCritReviewEvent } from '../domain/critReview'
import type { CritDeckSession, CritReviewEvent, NewReviewComment, NewReviewReply, ReviewComment } from '../domain/critReview'
import { subscribeToThisWindowWithPayload, type Unsubscribe } from './deckIpc'

export type { CritDeckSession, CritReviewEvent, NewReviewComment, NewReviewReply, ReviewComment } from '../domain/critReview'

export interface CritIpc {
  /** The session an agent waits in on the deck. While one is found, this
   * window gets `onReviewEvent` callbacks for it. */
  sessionStatus(): Promise<CritDeckSession>
  /** Starts a session on the deck with the bundled crit, unless one is
   * already there, and resolves with it like `sessionStatus`. A new
   * session has no agent waiting until one runs `crit` on the deck. */
  startSession(): Promise<CritDeckSession>
  /** Adds the comments and resolves with every comment in the session.
   * Rejects, having sent none, when one is malformed (no body, bad lines),
   * and rejects when no single session waits on the deck. A send that
   * fails partway may have sent some; retrying the same batch sends only
   * the rest. */
  addComments(comments: NewReviewComment[]): Promise<ReviewComment[]>
  /** Adds the replies and resolves with every comment in the session.
   * Rejects, having sent none, when one is malformed. */
  addReplies(replies: NewReviewReply[]): Promise<ReviewComment[]>
  /** Marks a comment resolved (crit stops handing it to the agent) and
   * resolves with every comment in the session. */
  resolveComment(id: string): Promise<ReviewComment[]>
  /** Hands the round to the agent waiting in crit. */
  finish(): Promise<void>
  listComments(): Promise<ReviewComment[]>
  /** Events of unknown kinds are dropped. */
  onReviewEvent(callback: (event: CritReviewEvent) => void): Unsubscribe
}

export function createTauriCritIpc(): CritIpc {
  return {
    sessionStatus: () => invoke('crit_session_status'),
    startSession: () => invoke('crit_start_session'),
    addComments: comments => invoke('crit_add_comments', { comments }),
    addReplies: replies => invoke('crit_add_replies', { replies }),
    resolveComment: id => invoke('crit_resolve_comment', { id }),
    finish: () => invoke('crit_finish'),
    listComments: () => invoke('crit_list_comments'),
    onReviewEvent: callback => subscribeToThisWindowWithPayload<unknown>('crit-review', payload => {
      const event = parseCritReviewEvent(payload)
      if (event !== null) callback(event)
    }),
  }
}
