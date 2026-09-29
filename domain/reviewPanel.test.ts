import { describe, expect, test } from 'bun:test'
import type { ReviewComment } from './critReview'
import type { PendingReply } from './reviewComment'
import { formatReviewTime, resolvedCount, reviewRows, splitCommentLabel, type ReviewRowsInput, type UnsentRowSource } from './reviewPanel'

const comment = (id: string, createdAt: string | null, options: Partial<ReviewComment> = {}): ReviewComment => ({
  id, lines: { start: 3, end: 3 }, body: `[Slide 1 › heading "Hello"] ${id} text`, quote: null, author: 'Peitho Studio',
  resolved: false, replies: [], createdAt, ...options,
})
const unsent = (id: string, createdAt: string): UnsentRowSource => ({ id, label: 'Slide 2', body: ` ${id} body `, createdAt, slideIndex: 1 })
const reply = (id: string, commentId: string): PendingReply => ({ id, commentId, body: `${id} reply`, createdAt: '2026-09-29T09:00:00Z' })

function input(overrides: Partial<ReviewRowsInput>): ReviewRowsInput {
  return { comments: [], unsentReplies: [], unsent: [], showResolved: false, replyingTo: null, slideOfLine: () => 0, ...overrides }
}

describe('splitCommentLabel', () => {
  test('spec: Given a comment Studio sent, Then its label and text come apart', () => {
    expect(splitCommentLabel('[Slide 2 › heading "Hi"] Make it bigger')).toEqual({ target: 'Slide 2 › heading "Hi"', text: 'Make it bigger' })
    expect(splitCommentLabel('[Slide 3] Line one\nline two')).toEqual({ target: 'Slide 3', text: 'Line one\nline two' })
  })

  test('adversarial: Given text with no label, a bracket that is not a slide label, or an empty string, Then the text stays whole', () => {
    expect(splitCommentLabel('Make it bigger')).toEqual({ target: null, text: 'Make it bigger' })
    expect(splitCommentLabel('[note] fix')).toEqual({ target: null, text: '[note] fix' })
    expect(splitCommentLabel('')).toEqual({ target: null, text: '' })
  })
})

describe('reviewRows', () => {
  test('spec: Given comments in crit and unsent ones written at different times, Then the threads read oldest first, each with its replies', () => {
    const rows = reviewRows(input({
      comments: [
        comment('late', '2026-09-29T10:00:00Z', { replies: [{ id: 'r1', body: 'Done', author: 'Claude', createdAt: '2026-09-29T10:05:00Z' }] }),
        comment('early', '2026-09-29T08:00:00Z'),
      ],
      unsent: [unsent('p1', '2026-09-29T09:00:00Z')],
    }))
    expect(rows.map(row => [row.kind, row.body])).toEqual([
      ['comment', 'early text'],
      ['unsent-comment', 'p1 body'],
      ['comment', 'late text'],
      ['reply', 'Done'],
    ])
  })

  test('spec: Given a comment Studio sent and the agent\'s reply, Then the comment shows its target without the label, and only the reply is the agent\'s', () => {
    const [first, second] = reviewRows(input({
      comments: [comment('c1', null, { replies: [{ id: 'r1', body: 'Done', author: 'Claude', createdAt: null }] })],
    }))
    expect(first).toMatchObject({ target: 'Slide 1 › heading "Hello"', body: 'c1 text', byAgent: false })
    expect(second).toMatchObject({ target: null, body: 'Done', byAgent: true, author: 'Claude' })
  })

  test('spec: Given resolved threads, Then they are left out unless asked for, and counted', () => {
    const comments = [comment('open', '2026-09-29T08:00:00Z'), comment('done', '2026-09-29T07:00:00Z', { resolved: true })]
    expect(reviewRows(input({ comments })).map(row => row.id)).toEqual(['open'])
    expect(reviewRows(input({ comments, showResolved: true })).map(row => [row.id, row.resolved])).toEqual([['done', true], ['open', false]])
    expect(resolvedCount(comments)).toBe(1)
  })

  test('spec: Given two threads, Then each row knows whether it starts or ends its thread', () => {
    const rows = reviewRows(input({
      comments: [
        comment('c1', '2026-09-29T08:00:00Z', { replies: [{ id: 'r1', body: 'Done', author: 'Claude', createdAt: null }, { id: 'r2', body: 'More', author: 'Claude', createdAt: null }] }),
        comment('c2', '2026-09-29T09:00:00Z'),
      ],
    }))
    expect(rows.map(row => [row.key, row.threadStart, row.threadEnd])).toEqual([
      ['comment:c1', true, false], ['reply:c1:r1', false, false], ['reply:c1:r2', false, true], ['comment:c2', true, true],
    ])
  })

  test('adversarial: Given unsent replies that can\'t be sent, Then each stands as a thread of its own', () => {
    const rows = reviewRows(input({ unsentReplies: [reply('u1', 'gone'), reply('u2', 'gone')] }))
    expect(rows.map(row => [row.key, row.threadStart, row.threadEnd])).toEqual([['unsent-reply:u1', true, true], ['unsent-reply:u2', true, true]])
  })

  test('spec: Given a reply being written, Then the box opens under the last row of that thread only', () => {
    const rows = reviewRows(input({
      comments: [comment('c1', '2026-09-29T08:00:00Z', { replies: [{ id: 'r1', body: 'Done', author: 'Claude', createdAt: null }] }), comment('c2', '2026-09-29T09:00:00Z')],
      unsentReplies: [reply('u1', 'c1')],
      replyingTo: 'c1',
    }))
    expect(rows.map(row => [row.key, row.replyBoxHere])).toEqual([
      ['comment:c1', false], ['reply:c1:r1', false], ['unsent-reply:u1', true], ['comment:c2', false],
    ])
  })

  test('spec: Given a click target, Then a sent comment opens the slide its first line is in, an unsent one the slide it was written on', () => {
    const rows = reviewRows(input({
      comments: [comment('c1', null, { lines: { start: 12, end: 14 } })],
      unsent: [unsent('p1', '2026-09-29T09:00:00Z')],
      slideOfLine: line => (line >= 10 ? 2 : 0),
    }))
    expect(Object.fromEntries(rows.map(row => [row.id, row.slideIndex]))).toEqual({ c1: 2, p1: 1 })
  })

  test('adversarial: Given a comment on the whole file, no times or unparseable ones, Then it has no slide and keeps its place after the timed threads', () => {
    const rows = reviewRows(input({
      comments: [comment('whole', null, { lines: null }), comment('bad', 'yesterday'), comment('timed', '2026-09-29T08:00:00Z')],
    }))
    expect(rows.map(row => [row.id, row.slideIndex])).toEqual([['timed', 0], ['whole', null], ['bad', 0]])
  })

  test('adversarial: Given an unsent reply whose comment crit no longer has, Then it comes last, with no slide, to be discarded', () => {
    const rows = reviewRows(input({ comments: [comment('c1', null)], unsentReplies: [reply('u1', 'gone')], replyingTo: 'gone' }))
    expect(rows.map(row => [row.kind, row.id, row.slideIndex, row.replyBoxHere])).toEqual([
      ['comment', 'c1', 0, false], ['unsent-reply', 'u1', null, false],
    ])
  })

  test('adversarial: Given an unsent reply to a thread resolved meanwhile, Then it is listed last to be discarded, shown or not, and never twice', () => {
    const comments = [comment('c1', '2026-09-29T08:00:00Z', { resolved: true }), comment('c2', '2026-09-29T09:00:00Z')]
    const unsentReplies = [reply('u1', 'c1')]
    expect(reviewRows(input({ comments, unsentReplies })).map(row => row.key)).toEqual(['comment:c2', 'unsent-reply:u1'])
    expect(reviewRows(input({ comments, unsentReplies, showResolved: true })).map(row => row.key)).toEqual(['comment:c1', 'comment:c2', 'unsent-reply:u1'])
  })

  test('adversarial: Given nothing, Then there are no rows; given every kind, Then keys are distinct', () => {
    expect(reviewRows(input({}))).toEqual([])
    const rows = reviewRows(input({
      comments: [comment('c1', null, { replies: [{ id: 'r1', body: 'a', author: 'x', createdAt: null }] }), comment('c2', null, { replies: [{ id: 'r1', body: 'b', author: 'x', createdAt: null }] })],
      unsentReplies: [reply('u1', 'c1'), reply('u2', 'gone')],
      unsent: [unsent('p1', '2026-09-29T09:00:00Z')],
    }))
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length)
  })
})

describe('formatReviewTime', () => {
  const now = new Date(2026, 8, 29, 18, 30)

  test('spec: Given today, earlier this year and an earlier year, Then the clock, the date and clock, and the full date', () => {
    expect(formatReviewTime(new Date(2026, 8, 29, 9, 5).toISOString(), now)).toBe('09:05')
    expect(formatReviewTime(new Date(2026, 8, 28, 23, 59).toISOString(), now)).toBe('9/28 23:59')
    expect(formatReviewTime(new Date(2025, 11, 31, 14, 0).toISOString(), now)).toBe('2025/12/31 14:00')
  })

  test('adversarial: Given no time, an empty or unparseable one, Then nothing', () => {
    expect(formatReviewTime(null, now)).toBe('')
    expect(formatReviewTime('', now)).toBe('')
    expect(formatReviewTime('yesterday', now)).toBe('')
  })

  test('adversarial: Given the same day of another month, Then the date is still shown', () => {
    expect(formatReviewTime(new Date(2026, 7, 29, 9, 5).toISOString(), now)).toBe('8/29 09:05')
  })
})
