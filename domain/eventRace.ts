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
