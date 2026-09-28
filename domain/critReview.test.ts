import { describe, expect, test } from 'bun:test'
import { parseCritReviewEvent } from './critReview'

describe('parseCritReviewEvent', () => {
  test.each(['commentsChanged', 'finished', 'ended'] as const)(
    'Given the Rust side reports %p, When the event arrives, Then Studio reads it as that update',
    payload => {
      expect(parseCritReviewEvent(payload)).toBe(payload)
    },
  )

  test.each([
    ['an unknown event name', 'roundStarted'],
    ['an empty string', ''],
    ['a differently cased name', 'Finished'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 1],
    ['an object wrapping a known name', { kind: 'finished' }],
  ])('Given %s, When the event arrives, Then it is ignored rather than guessed at', (_label, payload) => {
    expect(parseCritReviewEvent(payload)).toBeNull()
  })
})
