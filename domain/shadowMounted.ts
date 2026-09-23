// The slide-mount contract peitho's own viewers expose to a layout's
// `<script>` (mizzy/peitho#530, `packages/peitho-present/src/scripts.ts`):
// each mounted slide is announced with a `peitho:shadow-mounted` event
// carrying `{ root, key, index }`, and the same detail is kept in a
// global `__peithoShadowRoots` backlog so a module script that loads after
// the first mounts can still drain them. Studio follows the same contract
// so a layout written once works here, in `peitho present`, and in
// `peitho build`'s distribution viewer alike.

export const SHADOW_MOUNTED_EVENT = 'peitho:shadow-mounted'

export interface ShadowMountedDetail<Root> {
  root: Root
  key: string
  index: number
}

/** A slide's identity for the event detail: `key` as peitho writes it on
 * `.peitho-slide` (`data-slide-key`), `index` its position in the
 * manifest's slide list — the same value peitho's shell puts on each host
 * (`data-slide-index`), which the fragment itself doesn't carry. A key the
 * manifest doesn't list (a draft, or a layout-picker preview that isn't a
 * real slide) still yields the documented shape — index `-1` — rather than
 * `undefined` leaking into a layout script. */
export function slideIdentity(slideKey: string | undefined, manifestKeys: readonly string[]): { key: string; index: number } {
  const key = slideKey ?? ''
  return { key, index: slideKey === undefined ? -1 : manifestKeys.indexOf(key) }
}

/** The backlog after announcing `detail`: entries whose root is no longer
 * connected are dropped (Studio remounts canvases far more often than
 * peitho's shell does), and an earlier entry for the same root is
 * replaced rather than duplicated (`patchSlideCanvas` re-announces the
 * same shadow root on every edit), so the backlog stays bounded by the
 * number of live canvases. */
export function nextShadowMountedBacklog<Root>(
  backlog: readonly ShadowMountedDetail<Root>[],
  detail: ShadowMountedDetail<Root>,
  isConnected: (root: Root) => boolean,
): ShadowMountedDetail<Root>[] {
  return [...backlog.filter(entry => entry.root !== detail.root && isConnected(entry.root)), detail]
}
