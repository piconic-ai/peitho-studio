import { describe, expect, test } from 'bun:test'
import { waitForEventOrTimeout } from './eventRace'

describe('waitForEventOrTimeout', () => {
  test('spec: resolves once the event fires, and tears down the listener', async () => {
    let fire: (() => void) | undefined
    let unlistenCalls = 0
    const promise = waitForEventOrTimeout(callback => {
      fire = callback
      return () => { unlistenCalls++ }
    }, 10_000)
    fire?.()
    await promise
    expect(unlistenCalls).toBe(1)
  })

  test('spec: resolves via the timeout when the event never fires, and still tears down the listener', async () => {
    let unlistenCalls = 0
    await waitForEventOrTimeout(() => () => { unlistenCalls++ }, 5)
    expect(unlistenCalls).toBe(1)
  })

  test('adversarial: a subscribe that fires its callback synchronously (before returning Unsubscribe) still resolves and unlistens exactly once', async () => {
    let unlistenCalls = 0
    await waitForEventOrTimeout(callback => {
      callback()
      return () => { unlistenCalls++ }
    }, 10_000)
    expect(unlistenCalls).toBe(1)
  })

  test('adversarial: a late event fire after the timeout already won is a no-op, not a double resolve or double unlisten', async () => {
    let fire: (() => void) | undefined
    let unlistenCalls = 0
    await waitForEventOrTimeout(callback => {
      fire = callback
      return () => { unlistenCalls++ }
    }, 5)
    expect(unlistenCalls).toBe(1)
    expect(() => fire?.()).not.toThrow()
    expect(unlistenCalls).toBe(1)
  })

  test('adversarial: timeoutMs of 0 still resolves without the event ever firing', async () => {
    let unlistenCalls = 0
    await waitForEventOrTimeout(() => () => { unlistenCalls++ }, 0)
    expect(unlistenCalls).toBe(1)
  })
})
