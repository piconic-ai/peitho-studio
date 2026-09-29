// In-memory CritIpc for tests: behaves like one crit session on the deck —
// with an agent waiting in it (the default), or none until `startSession`
// (`session: 'none'`). Every call lands in `calls`; `emitReviewEvent`
// simulates the Rust side's `crit-review` event, `agentConnects` an agent
// starting its next round, and `reply` an agent answering a comment. Also
// what the mocked e2e suite answers the crit commands with
// (`e2e/helpers/mockTauri.ts`).
import type { CritDeckSession, CritIpc, CritReviewEvent, NewReviewComment, NewReviewReply, ReviewComment } from './critIpc'

export interface RecordedCritCall {
  method: keyof CritIpc
  args: readonly unknown[]
}

export interface FakeCritIpc extends CritIpc {
  calls: RecordedCritCall[]
  emitReviewEvent(event: CritReviewEvent): void
  /** An agent runs `crit` on the deck: its next round starts and it waits
   * (emits `commentsChanged`, unless `silent` — as when Studio reads the
   * session before crit has advanced its round and no later event comes).
   * Throws without a session. */
  agentConnects(options?: { silent?: boolean }): void
  /** An agent's own `crit` starts a session on a deck that had none, and
   * waits in it. No event: Studio follows no session to hear one from. */
  agentStartsSession(): void
  /** Adds the agent's reply under comment `id` (emits `commentsChanged`). */
  reply(id: string, body: string, author?: string): void
  /** crit carries comment `id` forward to `lines`, as it does when the deck
   * changes between rounds (emits `commentsChanged`). */
  moveComment(id: string, lines: { start: number; end: number }): void
}

export interface FakeCritOptions {
  /** `'none'`: no session until `startSession`. `'waiting'` (default): a
   * session with an agent waiting in it. */
  session?: 'none' | 'waiting'
  /** What `bundledCritPath` answers; `null` rejects, as with no bundled
   * crit. Defaults to where a release build has it. */
  critPath?: string | null
  /** The time stamped on each comment and reply added. */
  now?: () => string
}

export const FAKE_CRIT_PATH = '/Applications/Peitho Studio.app/Contents/MacOS/crit'

export function createFakeCritIpc(options: FakeCritOptions = {}): FakeCritIpc {
  let session: CritDeckSession = options.session === 'none'
    ? { kind: 'none' }
    : { kind: 'found', id: 'fake-session', port: 0, file: 'deck.md', reviewRound: 1, agentWaiting: true }
  const calls: RecordedCritCall[] = []
  const comments: ReviewComment[] = []
  const listeners = new Set<(event: CritReviewEvent) => void>()
  let nextId = 1

  function found(): Extract<CritDeckSession, { kind: 'found' }> {
    if (session.kind !== 'found') throw new Error('no single crit review session is waiting on this deck')
    return session
  }

  function emit(event: CritReviewEvent): void {
    for (const listener of listeners) listener(event)
  }

  const now = options.now ?? (() => new Date().toISOString())

  function toComment(comment: NewReviewComment): ReviewComment {
    return {
      createdAt: now(),
      id: `c_${String(nextId++)}`,
      lines: { start: comment.startLine, end: comment.endLine },
      body: comment.body,
      quote: comment.quote === '' ? null : comment.quote,
      author: comment.author,
      resolved: false,
      replies: [],
    }
  }

  function commentById(id: string): ReviewComment {
    const comment = comments.find(c => c.id === id)
    if (comment === undefined) throw new Error(`no comment ${id}`)
    return comment
  }

  function isMalformed(comment: NewReviewComment): boolean {
    return comment.startLine < 1 || comment.endLine < comment.startLine || comment.body.trim() === '' || comment.author.trim() === ''
  }

  function isMalformedReply(reply: NewReviewReply): boolean {
    return reply.commentId.trim() === '' || reply.body.trim() === '' || reply.author.trim() === ''
  }

  function record(method: keyof CritIpc, ...args: unknown[]): void {
    calls.push({ method, args })
  }

  return {
    calls,
    bundledCritPath: async () => {
      record('bundledCritPath')
      const path = options.critPath === undefined ? FAKE_CRIT_PATH : options.critPath
      if (path === null) throw new Error('the bundled crit is missing')
      return path
    },
    sessionStatus: async () => {
      record('sessionStatus')
      return structuredClone(session)
    },
    startSession: async () => {
      record('startSession')
      if (session.kind === 'none') session = { kind: 'found', id: 'fake-session', port: 0, file: 'deck.md', reviewRound: 1, agentWaiting: false }
      return structuredClone(session)
    },
    addComments: async added => {
      record('addComments', added)
      if (added.some(isMalformed)) throw new Error('a comment is malformed')
      found()
      comments.push(...added.map(toComment))
      return structuredClone(comments)
    },
    addReplies: async replies => {
      record('addReplies', replies)
      if (replies.some(isMalformedReply)) throw new Error('a reply is malformed')
      found()
      for (const reply of replies) commentById(reply.commentId)
      for (const reply of replies) commentById(reply.commentId).replies.push({ id: `rp_${String(nextId++)}`, body: reply.body, author: reply.author, createdAt: now() })
      return structuredClone(comments)
    },
    resolveComment: async id => {
      record('resolveComment', id)
      found()
      commentById(id).resolved = true
      return structuredClone(comments)
    },
    finish: async () => {
      record('finish')
      found().agentWaiting = false
      emit('finished')
    },
    listComments: async () => {
      record('listComments')
      found()
      return structuredClone(comments)
    },
    onReviewEvent: callback => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    emitReviewEvent: emit,
    agentConnects: options => {
      const current = found()
      current.reviewRound++
      current.agentWaiting = true
      if (!options?.silent) emit('commentsChanged')
    },
    agentStartsSession: () => {
      session = { kind: 'found', id: 'agent-session', port: 1, file: 'deck.md', reviewRound: 1, agentWaiting: true }
    },
    reply: (id, body, author = 'Agent') => {
      commentById(id).replies.push({ id: `rp_${String(nextId++)}`, body, author, createdAt: now() })
      emit('commentsChanged')
    },
    moveComment: (id, lines) => {
      commentById(id).lines = lines
      emit('commentsChanged')
    },
  }
}
