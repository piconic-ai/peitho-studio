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

/** A slide's identity as peitho writes it on `.peitho-slide`
 * (`data-slide-key`/`data-slide-index`). A fragment missing either
 * attribute (never produced by peitho-core itself) still yields a detail
 * of the documented shape — an empty key and index `-1` — rather than
 * `undefined`/`NaN` leaking into a layout script. */
export function slideIdentity(slideKey: string | undefined, slideIndex: string | undefined): { key: string; index: number } {
  const index = slideIndex !== undefined && /^\d+$/.test(slideIndex) ? Number(slideIndex) : -1
  return { key: slideKey ?? '', index }
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
