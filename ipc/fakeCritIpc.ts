// In-memory CritIpc for tests: behaves like one crit session with an agent
// waiting on the deck (or none, with `session: { kind: 'none' }`). Every
// call lands in `calls`; `emitReviewEvent` simulates the Rust side's
// `crit-review` event, and `reply` an agent answering a comment.
import type { CritDeckSession, CritIpc, CritReviewEvent, NewReviewComment, ReviewComment } from './critIpc'

export interface RecordedCritCall {
  method: keyof CritIpc
  args: readonly unknown[]
}

export interface FakeCritIpc extends CritIpc {
  calls: RecordedCritCall[]
  emitReviewEvent(event: CritReviewEvent): void
  /** Adds the agent's reply under comment `id` and emits `commentsChanged`. */
  reply(id: string, body: string, author?: string): void
}

export interface FakeCritOptions {
  session?: CritDeckSession
}

const FOUND: CritDeckSession = { kind: 'found', id: 'fake-session', port: 0, file: 'deck.md', reviewRound: 1 }

export function createFakeCritIpc(options: FakeCritOptions = {}): FakeCritIpc {
  const session = options.session ?? FOUND
  const calls: RecordedCritCall[] = []
  const comments: ReviewComment[] = []
  const listeners = new Set<(event: CritReviewEvent) => void>()
  let nextId = 1

  function requireSession(): void {
    if (session.kind !== 'found') throw new Error('no single crit review session is waiting on this deck')
  }

  function emit(event: CritReviewEvent): void {
    for (const listener of listeners) listener(event)
  }

  function toComment(comment: NewReviewComment): ReviewComment {
    return {
      id: `c_${nextId++}`,
      lines: { start: comment.startLine, end: comment.endLine },
      body: comment.body,
      quote: comment.quote === '' ? null : comment.quote,
      author: comment.author,
      resolved: false,
      replies: [],
    }
  }

  function isMalformed(comment: NewReviewComment): boolean {
    return comment.startLine < 1 || comment.endLine < comment.startLine || comment.body.trim() === '' || comment.author.trim() === ''
  }

  return {
    calls,
    sessionStatus: async () => {
      calls.push({ method: 'sessionStatus', args: [] })
      return session
    },
    addComments: async added => {
      calls.push({ method: 'addComments', args: [added] })
      if (added.some(isMalformed)) throw new Error('a comment is malformed')
      requireSession()
      comments.push(...added.map(toComment))
      return structuredClone(comments)
    },
    finish: async () => {
      calls.push({ method: 'finish', args: [] })
      requireSession()
      emit('finished')
    },
    listComments: async () => {
      calls.push({ method: 'listComments', args: [] })
      requireSession()
      return structuredClone(comments)
    },
    onReviewEvent: callback => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    emitReviewEvent: emit,
    reply: (id, body, author = 'Agent') => {
      const comment = comments.find(c => c.id === id)
      if (comment === undefined) throw new Error(`no comment ${id}`)
      comment.replies.push({ id: `rp_${nextId++}`, body, author })
      emit('commentsChanged')
    },
  }
}
