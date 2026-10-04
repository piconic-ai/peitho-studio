import { batch, createMemo, createSignal } from '@barefootjs/client'
import type { CritDeckSession, ReviewComment } from '../domain/critReview'
import { awaitingAgentCount, liveReplies, rewriteUnsent, sendAvailability, unsentBody, type CommentBox, type CommentTarget, type LayoutCommentTarget, type PendingComment, type PendingLayoutComment, type PendingReply, type PinSpot, type SentPins } from '../domain/reviewComment'

/** The review round trip with the Coding Agent as the comment UI shows it
 * (todo/archive/review-comment-ui.md): what crit last reported (the session and its
 * comments — crit is the source of truth for everything already sent), the
 * comments and replies written but not sent yet, the comment box, and
 * what's in flight. Talking to crit (`ipc/critIpc.ts`) and deciding when to
 * stays in `Studio.tsx`; this store only holds and transitions state. */
/** `now`: the time stamped on each comment and reply written. */
// Whether two values read back from crit are the same: plain JSON data.
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function createReviewStore(now: () => string = () => new Date().toISOString()) {
  const [session, setSessionSignal] = createSignal<CritDeckSession | null>(null)
  // The session (its id and daemon port) an agent was last seen waiting in.
  // Not waiting later, that agent is at work on what it was sent — not a
  // missing agent to connect (`showsConnectGuide`).
  const [seenAgentIn, setSeenAgentIn] = createSignal<string | null>(null)
  const sessionKey = (found: { id: string; port: number }) => `${found.id}:${String(found.port)}`
  function setSession(next: CritDeckSession | null): void {
    batch(() => {
      // A poll that finds nothing new leaves the signal alone, so nothing
      // downstream reruns every few seconds.
      if (!sameJson(session(), next)) setSessionSignal(next)
      if (next?.kind === 'found' && next.agentWaiting) setSeenAgentIn(sessionKey(next))
    })
  }
  /** The agent is taken to be gone (closed, or silent too long): the
   * connect card comes back until one is seen waiting again. */
  function forgetAgent(): void {
    setSeenAgentIn(null)
  }
  const agentSeen = createMemo(() => {
    const current = session()
    return current?.kind === 'found' && seenAgentIn() === sessionKey(current)
  })
  const [comments, setCommentsSignal] = createSignal<ReviewComment[]>([])
  /** Takes crit's comments, unless they're the same as already held. */
  function setComments(next: ReviewComment[]): void {
    if (!sameJson(comments(), next)) setCommentsSignal(next)
  }
  const [pending, setPending] = createSignal<PendingComment[]>([])
  // Comments written on the layout screen, not sent yet.
  const [layoutPending, setLayoutPending] = createSignal<PendingLayoutComment[]>([])
  const [pendingReplies, setPendingReplies] = createSignal<PendingReply[]>([])
  const [box, setBox] = createSignal<CommentBox>({ kind: 'closed' })
  const [boxDraft, setBoxDraft] = createSignal('')
  /** The reply being written, under which comment. */
  const [replyDraft, setReplyDraft] = createSignal<{ commentId: string; text: string } | null>(null)
  // The unsent comment or reply being rewritten in place, and its new text.
  const [unsentEdit, setUnsentEdit] = createSignal<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = createSignal<'idle' | 'starting' | 'sending'>('idle')
  // Resolved threads are left out of the panel unless asked for.
  const [showResolved, setShowResolved] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  // Where the pins of comments sent in this window sat (`SentPins`).
  const [sentPins, setSentPins] = createSignal<SentPins>({})
  let nextId = 1

  // The unsent replies that can still be sent (`liveReplies`).
  const sendableReplies = createMemo(() => liveReplies(pendingReplies(), comments()))
  const unsentCount = createMemo(() => pending().length + layoutPending().length + sendableReplies().length)
  // What a send hands the agent: everything unsent, plus open threads still
  // waiting on it (`awaitingAgentCount`) — sending again redelivers those.
  const sendCount = createMemo(() => unsentCount() + awaitingAgentCount(comments(), new Set(sendableReplies().map(reply => reply.commentId))))
  const availability = createMemo(() => sendAvailability(session(), sendCount(), busy() === 'sending'))

  function openBox(slideKey: string, target: CommentTarget, pin: PinSpot | null, at: { x: number; y: number }): void {
    batch(() => {
      setBox({ kind: 'open', slideKey, target, pin, at })
      setBoxDraft('')
    })
  }

  /** Opens the box on a layout (or every layout), at `at` on screen. */
  function openLayoutBox(target: LayoutCommentTarget, at: { x: number; y: number }): void {
    batch(() => {
      setBox({ kind: 'open-layout', target, at })
      setBoxDraft('')
    })
  }

  function closeBox(): void {
    setBox({ kind: 'closed' })
  }

  /** Files the open box's comment as unsent and closes the box. `null`
   * (nothing filed, the box stays open) for a blank comment, or no box
   * open on the preview. */
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

  /** `commitBox` for the box open on a layout (`openLayoutBox`). */
  function commitLayoutBox(): PendingLayoutComment | null {
    const current = box()
    const body = boxDraft().trim()
    if (current.kind !== 'open-layout' || body === '') return null
    const comment: PendingLayoutComment = { id: `pending-${String(nextId++)}`, target: current.target, body, createdAt: now() }
    batch(() => {
      setLayoutPending([...layoutPending(), comment])
      setBox({ kind: 'closed' })
    })
    return comment
  }

  /** Drops the unsent comment or reply with `id`. */
  function discard(id: string): void {
    batch(() => {
      setPending(pending().filter(comment => comment.id !== id))
      setLayoutPending(layoutPending().filter(comment => comment.id !== id))
      setPendingReplies(pendingReplies().filter(reply => reply.id !== id))
      if (unsentEdit()?.id === id) setUnsentEdit(null)
    })
  }

  /** Starts rewriting the unsent comment or reply `id` from its text. */
  function startEdit(id: string): void {
    const body = unsentBody([...pending(), ...layoutPending()], pendingReplies(), id)
    if (body !== null) setUnsentEdit({ id, text: body })
  }

  /** Updates the text being rewritten (nothing when nothing is). */
  function setEditText(text: string): void {
    const current = unsentEdit()
    if (current !== null) setUnsentEdit({ id: current.id, text })
  }

  function cancelEdit(): void {
    setUnsentEdit(null)
  }

  /** Puts the rewritten text in place. A blank one changes nothing and
   * keeps the editor open; one whose comment was sent meanwhile just
   * closes it. */
  function commitEdit(): void {
    const current = unsentEdit()
    if (current === null || current.text.trim() === '') return
    const next = rewriteUnsent(pending(), pendingReplies(), current.id, current.text)
    const nextLayout = rewriteUnsent(layoutPending(), [], current.id, current.text)
    batch(() => {
      if (next !== null) {
        setPending(next.pending)
        setPendingReplies(next.replies)
      }
      if (nextLayout !== null) setLayoutPending(nextLayout.pending)
      setUnsentEdit(null)
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

  /** `sent`, `sentReplies` and `sentLayout` reached crit: forget them,
   * keeping each comment's pin under the body it was sent with
   * (`sentBodies[i]` for `sent[i]`). Anything written while the send ran
   * stays unsent. */
  function markSent(sent: readonly PendingComment[], sentBodies: readonly string[], sentReplies: readonly PendingReply[], sentLayout: readonly PendingLayoutComment[] = []): void {
    const pins: Record<string, SentPins[string]> = { ...sentPins() }
    sent.forEach((comment, i) => {
      const body = sentBodies[i]
      // Filed even without a pin, so a later comment with the same body
      // still lines up with its own place in crit's order.
      if (body !== undefined) pins[body] = [...(Object.hasOwn(pins, body) ? pins[body] : []), { slideKey: comment.slideKey, pin: comment.pin }]
    })
    const sentIds = new Set([...sent.map(comment => comment.id), ...sentReplies.map(reply => reply.id), ...sentLayout.map(comment => comment.id)])
    batch(() => {
      setSentPins(pins)
      setPending(pending().filter(comment => !sentIds.has(comment.id)))
      setLayoutPending(layoutPending().filter(comment => !sentIds.has(comment.id)))
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
      setSeenAgentIn(null)
      setComments([])
      setPending([])
      setLayoutPending([])
      setPendingReplies([])
      setBox({ kind: 'closed' })
      setReplyDraft(null)
      setUnsentEdit(null)
      setBusy('idle')
      setError(null)
      setSentPins({})
    })
  }

  return {
    session, setSession, agentSeen, forgetAgent, comments, setComments, pending, layoutPending, pendingReplies, sendableReplies, unsentCount, sendCount, availability,
    box, boxDraft, setBoxDraft, openBox, openLayoutBox, closeBox, commitBox, commitLayoutBox, discard,
    unsentEdit, startEdit, setEditText, cancelEdit, commitEdit,
    replyDraft, editReply, setReplyText, cancelReply, commitReply, markSent, sentPins,
    busy, setBusy, error, setError, showResolved, toggleShowResolved: () => setShowResolved(!showResolved()),
    commentCountOf, syncCommentCounts, reset,
  }
}
