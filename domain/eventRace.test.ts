import { describe, expect, test } from 'bun:test'
import { racePresentOutcome, waitForEventOrTimeout } from './eventRace'

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

describe('racePresentOutcome', () => {
  test('spec: resolves ready when the ready event fires first, and tears down both listeners', async () => {
    let fireReady: (() => void) | undefined
    let unlistenReadyCalls = 0
    let unlistenFailedCalls = 0
    const promise = racePresentOutcome(
      callback => { fireReady = callback; return () => { unlistenReadyCalls++ } },
      () => () => { unlistenFailedCalls++ },
      10_000,
    )
    fireReady?.()
    expect(await promise).toEqual({ kind: 'ready' })
    expect(unlistenReadyCalls).toBe(1)
    expect(unlistenFailedCalls).toBe(1)
  })

  test('spec: resolves failed with the message when the failed event fires first', async () => {
    let fireFailed: ((message: string) => void) | undefined
    const promise = racePresentOutcome(
      () => () => {},
      callback => { fireFailed = callback; return () => {} },
      10_000,
    )
    fireFailed?.('--rehearsal requires agenda sections')
    expect(await promise).toEqual({ kind: 'failed', message: '--rehearsal requires agenda sections' })
  })

  test('spec: resolves timeout when neither event fires in time', async () => {
    const outcome = await racePresentOutcome(() => () => {}, () => () => {}, 5)
    expect(outcome).toEqual({ kind: 'timeout' })
  })

  test('adversarial: a ready subscribe that fires synchronously still resolves ready and unlistens both exactly once', async () => {
    let unlistenFailedCalls = 0
    const outcome = await racePresentOutcome(
      callback => { callback(); return () => {} },
      () => () => { unlistenFailedCalls++ },
      10_000,
    )
    expect(outcome).toEqual({ kind: 'ready' })
    expect(unlistenFailedCalls).toBe(1)
  })

  test('adversarial: a late ready fire after failed already won is a no-op, not a double resolve', async () => {
    let fireReady: (() => void) | undefined
    const outcome = await racePresentOutcome(
      callback => { fireReady = callback; return () => {} },
      callback => { callback('boom'); return () => {} },
      10_000,
    )
    expect(outcome).toEqual({ kind: 'failed', message: 'boom' })
    expect(() => fireReady?.()).not.toThrow()
  })
})
