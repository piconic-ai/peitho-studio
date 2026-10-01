/** Tracks actual render-and-persist outcomes, including commits that do not
 * dirty the text editor. Every commit remains pending through its cleanup.
 * A failed source must be successfully retried before update-exit is safe;
 * an unrelated successful commit does not silently dismiss that failure. */
export function createSaveTracker() {
  const pending = new Map<symbol, Promise<void>>()
  const failedSources = new Set<string>()
  return {
    begin(source: string): (saved: boolean) => void {
      const token = Symbol('save')
      let resolve!: () => void
      pending.set(token, new Promise<void>(done => { resolve = done }))
      return saved => {
        if (!pending.delete(token)) return
        if (saved) failedSources.delete(source)
        else failedSources.add(source)
        resolve()
      }
    },
    pendingCount: () => pending.size,
    async drain(): Promise<boolean> {
      // A queued commit may start while an earlier batch settles.
      while (pending.size) await Promise.all(pending.values())
      return failedSources.size === 0
    },
  }
}
