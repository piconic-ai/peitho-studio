export type Unsubscribe = () => void

/** Resolves as soon as `subscribe`'s callback fires once, or `timeoutMs`
 * elapses — whichever comes first — and always tears down both the timer
 * and the listener exactly once, regardless of which one won (a `subscribe`
 * that calls its callback synchronously, before returning its own
 * `Unsubscribe`, is handled too — real IPC-backed subscriptions never do
 * this, but nothing here assumes otherwise). Generic over what "the event"
 * actually is — the caller supplies `subscribe` (e.g. `deckIpc.onPresentReady`)
 * rather than this function knowing about IPC. */
export function waitForEventOrTimeout(subscribe: (callback: () => void) => Unsubscribe, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    // Declared (as `undefined`) before `finish` can possibly run — a
    // synchronous `subscribe` call below would otherwise have `finish`
    // read this variable mid-declaration, hitting the temporal dead zone.
    let unlisten: Unsubscribe | undefined
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unlisten?.()
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    unlisten = subscribe(finish)
    if (settled) unlisten()
  })
}

export type PresentOutcome = { kind: 'ready' } | { kind: 'failed'; message: string } | { kind: 'timeout' }

/** Same three-way race `waitForEventOrTimeout` can't express (it only
 * knows one success event): a `peitho present` launch either signals
 * readiness, reports why it never will, or neither happens within
 * `timeoutMs` (kept as a silent, no-error outcome — the existing
 * fallback for a `peitho` binary old enough to print neither line, e.g. a
 * version mismatch). Whichever fires first tears down both listeners and
 * the timer; a listener whose subscribe call resolves synchronously
 * before returning its own `Unsubscribe` is handled the same way
 * `waitForEventOrTimeout` handles it. */
export function racePresentOutcome(
  onReady: (callback: () => void) => Unsubscribe,
  onFailed: (callback: (message: string) => void) => Unsubscribe,
  timeoutMs: number,
): Promise<PresentOutcome> {
  return new Promise(resolve => {
    let settled = false
    let unlistenReady: Unsubscribe | undefined
    let unlistenFailed: Unsubscribe | undefined
    const finish = (outcome: PresentOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unlistenReady?.()
      unlistenFailed?.()
      resolve(outcome)
    }
    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs)
    unlistenReady = onReady(() => finish({ kind: 'ready' }))
    if (settled) unlistenReady()
    unlistenFailed = onFailed(message => finish({ kind: 'failed', message }))
    if (settled) unlistenFailed()
  })
}
