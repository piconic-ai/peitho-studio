// Pairs peitho-core's manifest (which never mentions a draft slide — it's
// dropped before the manifest is built) back up with the deck's full
// source (which still has every slide, drafts included) into one ordered
// list the slide list actually iterates. This is the fix for two
// entangled bugs recorded in todo/slide-status-badges.md: a draft slide
// used to vanish from the thumbnail list entirely (instead of showing with
// a DRAFT badge, as the feature requires), and — since the thumbnail row
// index was the manifest's index, not the deck's own — any slide *after*
// a draft one had every click/right-click/skip-toggle land one slide
// early. Building this list from the source, not the manifest, makes the
// row index equal `domain/slides.ts`'s `splitSlides` index (the same index
// `Studio.tsx`'s `editor.slideRanges()`/`currentSlideText`/`selectSlide`
// already key everything else by), so that mismatch can't recur.
import { type ManifestSection, type ManifestSlide } from './render'
import { splitSlides, extractPageComment, extractHeadingText } from './slides'

/** A slide the manifest actually rendered — peitho-core has real fragment
 * HTML for it, and `slide.index` is this entry's position within
 * `manifest.slides` (`manifestIndex` again, kept alongside for callers
 * that only have the entry, not the whole list, to hand). */
export interface RenderedSlideEntry {
  kind: 'rendered'
  sourceIndex: number
  manifestIndex: number
  slide: ManifestSlide
}

/** A slide the manifest has nothing current to say about: either it's
 * marked draft (peitho-core excludes it from the build on purpose), or the
 * manifest simply hasn't caught up with the source yet (a `render_draft`
 * in flight after an edit added a slide) — `draft` tells the slide list
 * which of the two it is, since only the first one wears a DRAFT badge.
 * `title` is pulled directly out of the raw Markdown (no build required).
 *
 * `key` is this row's `.map()` key: always `placeholder:<sourceIndex>`,
 * deliberately *never* the slide's own PageComment `key` (even when it set
 * one) — a slide commonly keeps the *same* explicit key across a draft
 * toggle, which would otherwise hand this row the exact key its `rendered`
 * counterpart used right before (or will use right after). BarefootJS's
 * keyed `.map()` doesn't correctly re-run a row's canvas `ref` when a key
 * *returns* to the `rendered` branch after a stint as `placeholder` on
 * that same key (confirmed by direct browser reproduction, not just
 * `bf debug graph`'s static analysis — see CLAUDE.md's BarefootJS
 * pitfalls): the canvas host element exists in the DOM but never gets
 * `mountSlideCanvas` run against it, leaving the thumbnail permanently
 * blank until the whole deck is reopened. A key that can never coincide
 * with any real slide's key — before, during, or after the toggle — makes
 * every `rendered` <-> `placeholder` transition a fresh key as far as the
 * `.map()` is concerned, which mounts correctly (the already-working,
 * exercised-everywhere case). Losing DOM-node reuse for this rare,
 * short-lived state isn't a concern.
 *
 * `lastRenderedKey` is a *different* key: the slide's own explicit
 * PageComment `key`, when it set one (`null` otherwise). It exists purely
 * so `components/SlideList.tsx` can look up whatever fragment HTML
 * `state/renderStore.ts` still has cached under that key from the render
 * *before* this slide became a placeholder — that cache is never cleared
 * just because a later render dropped the key, only ever overwritten by a
 * fresher render under the same key — and show it as-is instead of a
 * generic title-only box, so marking a slide draft doesn't visibly replace
 * its thumbnail, only overlays a DRAFT badge (matching how SKIP already
 * behaves). `null` when the slide never had an explicit key (an
 * older/imported deck whose key peitho-core would derive from its title
 * instead) — there's no way to know that derived key without re-deriving
 * peitho-core's own slugging algorithm, so that case falls back to the
 * generic placeholder instead of guessing at a key that might be wrong. */
export interface PlaceholderSlideEntry {
  kind: 'placeholder'
  sourceIndex: number
  title: string
  draft: boolean
  key: string
  lastRenderedKey: string | null
}

export type SlideListEntry = RenderedSlideEntry | PlaceholderSlideEntry

/** Walks the deck's full source in order, pairing each non-draft slide
 * with the next unclaimed entry from `manifestSlides` (peitho-core never
 * reorders slides relative to the source, so pairing them in order is
 * exact, not a guess). A slide whose PageComment sets `"draft":true` never
 * claims one — it always becomes a placeholder — and a slide that *would*
 * claim one but the manifest has run out (fewer manifest slides than
 * non-draft source slides) becomes a non-draft placeholder instead of
 * throwing, since that's a real, if short-lived, state (see
 * `PlaceholderSlideEntry`). Only a strict JSON `true` counts as draft,
 * matching `domain/slideStatus.ts`'s own rule for the same PageComment
 * field. */
export function buildSlideList(fullSource: string, manifestSlides: readonly ManifestSlide[]): SlideListEntry[] {
  const ranges = splitSlides(fullSource)
  const entries: SlideListEntry[] = []
  let manifestIndex = 0
  for (let sourceIndex = 0; sourceIndex < ranges.length; sourceIndex++) {
    const { rest, config } = extractPageComment(ranges[sourceIndex].text)
    if (config.draft !== true) {
      const slide = manifestSlides[manifestIndex]
      if (slide) {
        entries.push({ kind: 'rendered', sourceIndex, manifestIndex, slide })
        manifestIndex++
        continue
      }
    }
    entries.push({
      kind: 'placeholder',
      sourceIndex,
      title: extractHeadingText(rest) ?? '',
      draft: config.draft === true,
      key: `placeholder:${String(sourceIndex)}`,
      lastRenderedKey: config.key ?? null,
    })
  }
  return entries
}

/** The manifest index the source slide at `sourceIndex` was rendered at,
 * or `null` when there isn't one (a placeholder, or `sourceIndex` itself
 * out of range) — the inverse of `manifestIndexToSourceIndex` for a single
 * lookup, e.g. converting a thumbnail's row index into the key
 * `state/renderStore.ts`'s section-draft records are still kept under. */
export function manifestIndexAt(entries: readonly SlideListEntry[], sourceIndex: number): number | null {
  const entry = entries[sourceIndex]
  return entry?.kind === 'rendered' ? entry.manifestIndex : null
}

/** `result[j]` is the `sourceIndex` of `entries`' `j`-th rendered slide —
 * i.e. `manifestSlides[j]`'s row in the slide list. Sparse only in the
 * degenerate case of a manifest index `buildSlideList` never assigned
 * (more manifest slides than source ever claimed one; shouldn't happen in
 * practice, since peitho-core never invents slides). */
export function manifestIndexToSourceIndex(entries: readonly SlideListEntry[]): number[] {
  const mapping: number[] = []
  for (const entry of entries) {
    if (entry.kind === 'rendered') mapping[entry.manifestIndex] = entry.sourceIndex
  }
  return mapping
}

/** Reindexes a record keyed by manifest index (e.g.
 * `state/renderStore.ts`'s own `sectionDrafts`) into one keyed by
 * sourceIndex — the row index the slide list and every callback it fires
 * actually use. An entry whose manifest index has no corresponding source
 * row (shouldn't happen: a draft slide can never be the one a manifest
 * index like this refers to) is silently dropped rather than guessed at. */
export function recordByManifestIndex<T>(
  byManifestIndex: Readonly<Record<number, T>>,
  entries: readonly SlideListEntry[],
): Record<number, T> {
  const mapping = manifestIndexToSourceIndex(entries)
  const bySourceIndex: Record<number, T> = {}
  for (const [manifestIndexKey, value] of Object.entries(byManifestIndex)) {
    const sourceIndex = mapping[Number(manifestIndexKey)]
    if (sourceIndex !== undefined) bySourceIndex[sourceIndex] = value
  }
  return bySourceIndex
}

/** `domain/render.ts`'s `sectionStartByIndex`, reindexed from "position in
 * `manifest.slides`" to "position in the slide list" — `recordByManifestIndex`
 * applied to a manifest section's own `startIndex` instead of a record's
 * keys directly, since a `ManifestSection[]` isn't already indexed by one. */
export function sectionStartBySourceIndex(
  sections: readonly ManifestSection[],
  entries: readonly SlideListEntry[],
): Record<number, ManifestSection> {
  const mapping = manifestIndexToSourceIndex(entries)
  const bySourceIndex: Record<number, ManifestSection> = {}
  for (const section of sections) {
    const sourceIndex = mapping[section.startIndex]
    if (sourceIndex !== undefined) bySourceIndex[sourceIndex] = section
  }
  return bySourceIndex
}
