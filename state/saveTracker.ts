export type SaveKind = 'draft' | 'structural'

/** Tracks actual render-and-persist outcomes, including commits that do not
 * dirty the text editor. Full-deck commits supersede older body snapshots;
 * an unrelated body save does not dismiss a failed structural operation. */
export function createSaveTracker() {
  const pending = new Map<number, Promise<void>>()
  const failedStructuralSources = new Set<string>()
  let revision = 0
  let savedDraftThrough = 0
  let failedDraftRevision = 0
  return {
    begin(source: string, kind: SaveKind = 'structural'): (saved: boolean) => void {
      const token = ++revision
      let resolve!: () => void
      pending.set(token, new Promise<void>(done => { resolve = done }))
      return saved => {
        if (!pending.delete(token)) return
        if (saved) {
          // Every commit contains the live body draft captured when it was
          // requested. It covers earlier body snapshots, but not a later
          // failed request that happened to finish before this one.
          savedDraftThrough = Math.max(savedDraftThrough, token)
          if (failedDraftRevision <= savedDraftThrough) failedDraftRevision = 0
          failedStructuralSources.delete(source)
        } else if (kind === 'draft') {
          if (token > savedDraftThrough) failedDraftRevision = Math.max(failedDraftRevision, token)
        } else {
          failedStructuralSources.add(source)
        }
        resolve()
      }
    },
    pendingCount: () => pending.size,
    async drain(): Promise<boolean> {
      // A queued commit may start while an earlier batch settles.
      while (pending.size) await Promise.all(pending.values())
      return failedDraftRevision === 0 && failedStructuralSources.size === 0
    },
  }
}
