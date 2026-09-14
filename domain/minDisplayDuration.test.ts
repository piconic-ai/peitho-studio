import { describe, expect, test } from 'bun:test'
import { remainingMinDisplayMs } from './minDisplayDuration'

describe('remainingMinDisplayMs', () => {
  test('spec: work finished well before the floor leaves most of the floor remaining', () => {
    expect(remainingMinDisplayMs(1000, 1010, 400)).toBe(390)
  })

  test('spec: no time elapsed yet leaves the full floor remaining', () => {
    expect(remainingMinDisplayMs(1000, 1000, 400)).toBe(400)
  })

  test('adversarial: elapsed time already meets or exceeds the floor returns 0, not negative', () => {
    expect(remainingMinDisplayMs(1000, 1400, 400)).toBe(0)
    expect(remainingMinDisplayMs(1000, 5000, 400)).toBe(0)
  })

  test('adversarial: now before busyStartedAt (clock skew) is clamped to the full floor, not a value above it', () => {
    expect(remainingMinDisplayMs(1000, 900, 400)).toBe(400)
  })

  test('adversarial: a zero floor always returns 0 regardless of timing', () => {
    expect(remainingMinDisplayMs(1000, 1000, 0)).toBe(0)
    expect(remainingMinDisplayMs(1000, 900, 0)).toBe(0)
  })
})
