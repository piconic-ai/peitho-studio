import { describe, expect, test } from 'bun:test'
import { createEffect, createRoot } from '@barefootjs/client'
import type { CritDeckSession, ReviewComment } from '../domain/critReview'
import type { CommentTarget } from '../domain/reviewComment'
import { createReviewStore } from './reviewStore'

const heading: CommentTarget = { kind: 'heading', text: 'Hello', quote: 'Hello', offsetInSlide: 2 }
const waiting: CritDeckSession = { kind: 'found', id: 's', port: 1, file: 'deck.md', reviewRound: 2, agentWaiting: true }
const thread = (id: string): ReviewComment => ({ id, lines: { start: 1, end: 1 }, body: 'b', quote: null, author: 'Peitho Studio', resolved: false, replies: [], createdAt: null })

describe('the comment box', () => {
  test('Given a click opened the box on a heading, When a comment is written and added, Then it is filed unsent and the box closes', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.openBox('hello', heading, { x: 0.2, y: 0.1 }, { x: 100, y: 50 })
      store.setBoxDraft('  Make it bigger ')
      const filed = store.commitBox()
      expect(filed).toMatchObject({ slideKey: 'hello', target: heading, pin: { x: 0.2, y: 0.1 }, body: 'Make it bigger' })
      expect(store.pending()).toEqual([filed!])
      expect(store.box()).toEqual({ kind: 'closed' })
    })
  })

  test('Given a blank comment, When it is added, Then nothing is filed and the box stays open', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.openBox('hello', heading, null, { x: 0, y: 0 })
      store.setBoxDraft(' \n ')
      expect(store.commitBox()).toBeNull()
      expect(store.pending()).toEqual([])
      expect(store.box().kind).toBe('open')
    })
  })

  test('Given the box is closed, When a comment is added, Then nothing is filed', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.setBoxDraft('text')
      expect(store.commitBox()).toBeNull()
    })
  })

  test('Given text left in a box, When another click opens it again, Then it starts empty', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.openBox('a', heading, null, { x: 0, y: 0 })
      store.setBoxDraft('half-written')
      store.openBox('b', heading, null, { x: 0, y: 0 })
      expect(store.boxDraft()).toBe('')
    })
  })

  test('Given two unsent comments, When one is discarded, Then only the other is left', () => {
    createRoot(() => {
      const store = createReviewStore()
      for (const body of ['one', 'two']) {
        store.openBox('a', heading, null, { x: 0, y: 0 })
        store.setBoxDraft(body)
        store.commitBox()
      }
      store.discard(store.pending()[0].id)
      expect(store.pending().map(c => c.body)).toEqual(['two'])
    })
  })
})

describe('replies and sending', () => {
  test('Given an open thread still waiting on the agent and nothing unsent, Then Send hands it over again; once answered, nothing is left to send', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.setSession(waiting)
      store.setComments([thread('c_1')])
      expect(store.sendCount()).toBe(1)
      expect(store.availability()).toEqual({ kind: 'ready' })
      store.setComments([{ ...thread('c_1'), replies: [{ id: 'r', body: 'Done', author: 'Claude', createdAt: null }] }])
      expect(store.sendCount()).toBe(0)
      expect(store.availability()).toEqual({ kind: 'nothing-to-send' })
    })
  })

  test('Given an unsent reply to a comment crit no longer has, Then it is neither counted nor sendable, and it can be discarded', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.setSession(waiting)
      store.setComments([thread('c_1')])
      store.editReply('c_1', 'Still small')
      store.commitReply()
      // A new session's thread, already answered by the agent.
      store.setComments([{ ...thread('c_9'), replies: [{ id: 'r', body: 'Done', author: 'Claude', createdAt: null }] }])
      expect(store.unsentCount()).toBe(0)
      expect(store.sendableReplies()).toEqual([])
      expect(store.availability()).toEqual({ kind: 'nothing-to-send' })
      store.discard(store.pendingReplies()[0].id)
      expect(store.pendingReplies()).toEqual([])
    })
  })

  test('Given a reply is written under a comment, When it is filed, Then it counts as unsent', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.setSession(waiting)
      store.setComments([thread('c_1')])
      store.editReply('c_1', ' Still small ')
      store.commitReply()
      expect(store.pendingReplies()).toMatchObject([{ commentId: 'c_1', body: 'Still small' }])
      expect(store.replyDraft()).toBeNull()
      expect(store.availability()).toEqual({ kind: 'ready' })
    })
  })

  test('Given a reply is being written, When its text changes, Then it stays under the same comment; with none open, nothing starts', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.setReplyText('orphan')
      expect(store.replyDraft()).toBeNull()
      store.editReply('c_1', '')
      store.setReplyText('Still small')
      expect(store.replyDraft()).toEqual({ commentId: 'c_1', text: 'Still small' })
    })
  })

  test('Given a blank reply, When it is filed, Then nothing is queued', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.editReply('c_1', '   ')
      store.commitReply()
      store.commitReply()
      expect(store.pendingReplies()).toEqual([])
    })
  })

  test('Given comments were sent, When the send is recorded, Then they and the replies are no longer unsent and their pins are kept by body', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.openBox('hello', heading, { x: 0.5, y: 0.5 }, { x: 0, y: 0 })
      store.setBoxDraft('Bigger')
      const sent = store.commitBox()!
      store.openBox('hello', heading, null, { x: 0, y: 0 })
      store.setBoxDraft('Written while sending')
      const later = store.commitBox()!
      store.editReply('c_1', 'ok')
      store.commitReply()
      const sentReplies = store.pendingReplies()
      store.editReply('c_1', 'Written while sending too')
      store.commitReply()
      store.markSent([sent], ['[Slide 1 › heading "Hello"] Bigger'], sentReplies)
      expect(store.pending()).toEqual([later])
      expect(store.pendingReplies().map(reply => reply.body)).toEqual(['Written while sending too'])
      expect(store.sentPins()).toEqual({ '[Slide 1 › heading "Hello"] Bigger': [{ slideKey: 'hello', pin: { x: 0.5, y: 0.5 } }] })
    })
  })

  test('Given two comments with the same body are sent, Then both pins are kept in sending order', () => {
    createRoot(() => {
      const store = createReviewStore()
      const sent = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }].map(pin => {
        store.openBox('hello', heading, pin, { x: 0, y: 0 })
        store.setBoxDraft('Fix')
        return store.commitBox()!
      })
      store.markSent(sent, ['same', 'same'], [])
      expect(store.sentPins().same.map(entry => entry.pin)).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }])
    })
  })

  test('Given no agent waits, Then sending is not available whatever is unsent', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.openBox('a', heading, null, { x: 0, y: 0 })
      store.setBoxDraft('x')
      store.commitBox()
      store.setSession({ ...waiting, agentWaiting: false } as CritDeckSession)
      expect(store.availability()).toEqual({ kind: 'agent-not-waiting' })
      store.setSession(waiting)
      store.setBusy('sending')
      expect(store.availability()).toEqual({ kind: 'sending' })
    })
  })

  test('Given a deck closes, When the store resets, Then nothing of its review is left', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.setSession(waiting)
      store.openBox('a', heading, null, { x: 0, y: 0 })
      store.setBoxDraft('x')
      store.commitBox()
      store.setError('boom')
      store.reset()
      expect(store.session()).toBeNull()
      expect(store.pending()).toEqual([])
      expect(store.error()).toBeNull()
    })
  })
})

describe('comment counts per slide', () => {
  test('Given counts for two slides, When one slide\'s count changes, Then only that slide\'s reader is notified', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.syncCommentCounts({ a: 1, b: 2 })
      let aReads = 0
      let bReads = 0
      createEffect(() => { store.commentCountOf('a'); aReads++ })
      createEffect(() => { store.commentCountOf('b'); bReads++ })
      store.syncCommentCounts({ a: 1, b: 3 })
      expect(store.commentCountOf('b')).toBe(3)
      expect(aReads).toBe(1)
      expect(bReads).toBe(2)
    })
  })

  test('Given a slide drops out of the counts, Then its count reads zero', () => {
    createRoot(() => {
      const store = createReviewStore()
      store.syncCommentCounts({ a: 2 })
      store.syncCommentCounts({})
      expect(store.commentCountOf('a')).toBe(0)
      expect(store.commentCountOf('never-seen')).toBe(0)
    })
  })
})
