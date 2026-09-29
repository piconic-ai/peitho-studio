import { batch, createMemo, createSignal } from '@barefootjs/client'
import type { CritDeckSession, ReviewComment } from '../domain/critReview'
import { awaitingAgentCount, liveReplies, sendAvailability, type CommentBox, type CommentTarget, type PendingComment, type PendingReply, type SentPins } from '../domain/reviewComment'

/** The review round trip with the Coding Agent as the comment UI shows it
 * (todo/review-comment-ui.md): what crit last reported (the session and its
 * comments — crit is the source of truth for everything already sent), the
 * comments and replies written but not sent yet, the comment box, and
 * what's in flight. Talking to crit (`ipc/critIpc.ts`) and deciding when to
 * stays in `Studio.tsx`; this store only holds and transitions state. */
/** `now`: the time stamped on each comment and reply written. */
export function createReviewStore(now: () => string = () => new Date().toISOString()) {
  const [session, setSession] = createSignal<CritDeckSession | null>(null)
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [pending, setPending] = createSignal<PendingComment[]>([])
  const [pendingReplies, setPendingReplies] = createSignal<PendingReply[]>([])
  const [box, setBox] = createSignal<CommentBox>({ kind: 'closed' })
  const [boxDraft, setBoxDraft] = createSignal('')
  /** The reply being written, under which comment. */
  const [replyDraft, setReplyDraft] = createSignal<{ commentId: string; text: string } | null>(null)
  const [busy, setBusy] = createSignal<'idle' | 'starting' | 'sending'>('idle')
  // Resolved threads are left out of the panel unless asked for.
  const [showResolved, setShowResolved] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  // Where the pins of comments sent in this window sat (`SentPins`).
  const [sentPins, setSentPins] = createSignal<SentPins>({})
  let nextId = 1

  // The unsent replies that can still be sent (`liveReplies`).
  const sendableReplies = createMemo(() => liveReplies(pendingReplies(), comments()))
  const unsentCount = createMemo(() => pending().length + sendableReplies().length)
  // What a send hands the agent: everything unsent, plus open threads still
  // waiting on it (`awaitingAgentCount`) — sending again redelivers those.
  const sendCount = createMemo(() => unsentCount() + awaitingAgentCount(comments()))
  const availability = createMemo(() => sendAvailability(session(), sendCount(), busy() === 'sending'))

  function openBox(slideKey: string, target: CommentTarget, pin: { x: number; y: number } | null, at: { x: number; y: number }): void {
    batch(() => {
      setBox({ kind: 'open', slideKey, target, pin, at })
      setBoxDraft('')
    })
  }

  function closeBox(): void {
    setBox({ kind: 'closed' })
  }

  /** Files the open box's comment as unsent and closes the box. `null`
   * (nothing filed, the box stays open) for a blank comment or no box. */
  function commitBox(): PendingComment | null {
    const current = box()
    const body = boxDraft().trim()
    if (current.kind !== 'open' || body === '') return null
    const comment: PendingComment = { id: `pending-${String(nextId++)}`, slideKey: current.slideKey, target: current.target, pin: current.pin, body, createdAt: now() }
    batch(() => {
      setPending([...pending(), comment])
      setBox({ kind: 'closed' })
    })
    return comment
  }

  /** Drops the unsent comment or reply with `id`. */
  function discard(id: string): void {
    batch(() => {
      setPending(pending().filter(comment => comment.id !== id))
      setPendingReplies(pendingReplies().filter(reply => reply.id !== id))
    })
  }

  function editReply(commentId: string, text: string): void {
    setReplyDraft({ commentId, text })
  }

  /** Updates the text of the reply being written (nothing when none is). */
  function setReplyText(text: string): void {
    const draft = replyDraft()
    if (draft !== null) setReplyDraft({ commentId: draft.commentId, text })
  }

  function cancelReply(): void {
    setReplyDraft(null)
  }

  /** Files the reply being written as unsent. Nothing for a blank one. */
  function commitReply(): void {
    const draft = replyDraft()
    if (draft === null || draft.text.trim() === '') return
    batch(() => {
      setPendingReplies([...pendingReplies(), { id: `reply-${String(nextId++)}`, commentId: draft.commentId, body: draft.text.trim(), createdAt: now() }])
      setReplyDraft(null)
    })
  }

  /** `sent` and `sentReplies` reached crit: forget them, keeping each
   * comment's pin under the body it was sent with (`sentBodies[i]` for
   * `sent[i]`). Anything written while the send ran stays unsent. */
  function markSent(sent: readonly PendingComment[], sentBodies: readonly string[], sentReplies: readonly PendingReply[]): void {
    const pins: Record<string, SentPins[string]> = { ...sentPins() }
    sent.forEach((comment, i) => {
      const body = sentBodies[i]
      // Filed even without a pin, so a later comment with the same body
      // still lines up with its own place in crit's order.
      if (body !== undefined) pins[body] = [...(Object.hasOwn(pins, body) ? pins[body] : []), { slideKey: comment.slideKey, pin: comment.pin }]
    })
    const sentIds = new Set([...sent.map(comment => comment.id), ...sentReplies.map(reply => reply.id)])
    batch(() => {
      setSentPins(pins)
      setPending(pending().filter(comment => !sentIds.has(comment.id)))
      setPendingReplies(pendingReplies().filter(reply => !sentIds.has(reply.id)))
    })
  }

  // One count signal per slide key, set only when that slide's count
  // changes — every thumbnail row reads its own (see CLAUDE.md's
  // "Don't hold an entire Map/Record in a single signal/memo").
  const countSignals = new Map<string, [() => number, (value: number) => void]>()
  function countSignal(key: string): [() => number, (value: number) => void] {
    let entry = countSignals.get(key)
    if (!entry) {
      entry = createSignal(0)
      countSignals.set(key, entry)
    }
    return entry
  }
  function commentCountOf(key: string): number {
    return countSignal(key)[0]()
  }
  function syncCommentCounts(counts: Readonly<Record<string, number>>): void {
    batch(() => {
      for (const [key, [get, set]] of countSignals) {
        const next = counts[key] ?? 0
        if (get() !== next) set(next)
      }
      for (const [key, count] of Object.entries(counts)) {
        const [get, set] = countSignal(key)
        if (get() !== count) set(count)
      }
    })
  }

  /** The deck closed or changed: nothing of its review carries over. */
  function reset(): void {
    batch(() => {
      setSession(null)
      setComments([])
      setPending([])
      setPendingReplies([])
      setBox({ kind: 'closed' })
      setReplyDraft(null)
      setBusy('idle')
      setError(null)
      setSentPins({})
    })
  }

  return {
    session, setSession, comments, setComments, pending, pendingReplies, sendableReplies, unsentCount, sendCount, availability,
    box, boxDraft, setBoxDraft, openBox, closeBox, commitBox, discard,
    replyDraft, editReply, setReplyText, cancelReply, commitReply, markSent, sentPins,
    busy, setBusy, error, setError, showResolved, toggleShowResolved: () => setShowResolved(!showResolved()),
    commentCountOf, syncCommentCounts, reset,
  }
}
