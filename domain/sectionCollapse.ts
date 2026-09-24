// Which slide-list rows a collapsed section hides. A section header isn't a
// row of its own: it sits inside the row of the section's first slide
// (`components/SlideList.tsx`), so collapsing a section keeps that row's
// header and hides its thumbnail, and hides every later row of the section
// outright.
//
// Collapse state is remembered by the manifest key of the section's first
// slide, not by row index or section name: adding, deleting or reordering
// slides shifts row indexes (a row-index set would silently fold a different
// section), and section names can repeat or be renamed. A key that no longer
// starts a section is simply ignored, so the section it used to fold shows
// again — the safe direction.
import { type ManifestSection } from './render'
import { type SlideListEntry } from './slideList'

/** How one slide-list row is shown: in full, as its section header only
 * (the thumbnail hidden), or not at all. */
export type RowVisibility = 'full' | 'header-only' | 'hidden'

/** A section's rows in the slide list, `start` and `end` inclusive. */
export interface SectionSpan {
  start: number
  end: number
}

/** `collapsed` with `key` added if it was absent, removed if present.
 * Never mutates `collapsed`. */
export function toggleCollapsedKey(collapsed: readonly string[], key: string): string[] {
  return collapsed.includes(key) ? collapsed.filter(k => k !== key) : [...collapsed, key]
}

/** Each section's row range, given the rows its headers sit on. A section
 * runs until the row before the next section's header, or to the last row
 * (the same contiguous shape peitho-core gives sections by manifest index,
 * carried over to rows so a draft placeholder between two headers belongs
 * to the section above it). Starts outside `0..rowCount-1` are dropped, and
 * duplicates or an unsorted input are tolerated. */
export function sectionSpans(starts: readonly number[], rowCount: number): SectionSpan[] {
  const sorted = [...new Set(starts)]
    .filter(start => Number.isInteger(start) && start >= 0 && start < rowCount)
    .sort((a, b) => a - b)
  return sorted.map((start, i) => ({ start, end: i + 1 < sorted.length ? sorted[i + 1] - 1 : rowCount - 1 }))
}

/** The key that remembers whether the section whose header sits on row
 * `sourceIndex` is collapsed: that row's rendered slide key, or `null` when
 * the row isn't a rendered slide (a placeholder, or out of range) — such a
 * row never carries a section header. */
export function collapseKeyAt(entries: readonly SlideListEntry[], sourceIndex: number): string | null {
  const entry = entries[sourceIndex]
  return entry?.kind === 'rendered' ? entry.slide.key : null
}

/** The header rows (by `sourceIndex`) of the sections `collapsedKeys`
 * folds: a section is folded when the rendered slide its header sits on
 * has a key in `collapsedKeys`. Returned in ascending order. */
export function collapsedSectionStarts(
  entries: readonly SlideListEntry[],
  sectionStartByIndex: Readonly<Record<number, ManifestSection>>,
  collapsedKeys: readonly string[],
): number[] {
  return Object.keys(sectionStartByIndex)
    .map(Number)
    .filter(index => {
      const key = collapseKeyAt(entries, index)
      return key !== null && collapsedKeys.includes(key)
    })
    .sort((a, b) => a - b)
}

/** Every row's visibility. A collapsed section's header row becomes
 * `header-only` and the rest of its rows `hidden`; everything else is
 * `full`. A collapsed start that isn't among `spans`' starts is ignored. */
export function rowVisibilities(
  spans: readonly SectionSpan[],
  collapsedStarts: readonly number[],
  rowCount: number,
): RowVisibility[] {
  const visibility: RowVisibility[] = Array.from({ length: Math.max(0, rowCount) }, () => 'full')
  for (const span of spans) {
    if (!collapsedStarts.includes(span.start)) continue
    for (let row = span.start; row <= span.end && row < visibility.length; row++) {
      visibility[row] = row === span.start ? 'header-only' : 'hidden'
    }
  }
  return visibility
}

/** The header row of the collapsed section that hides row `row`'s
 * thumbnail, or `null` when that thumbnail isn't hidden (not in any
 * section, in an expanded one, or `row` is `null`/out of range). When a
 * slide becomes selected inside a collapsed section — New Slide from the
 * section's header, say — Studio expands this section so the selection
 * never lands out of sight. */
export function collapsedSectionContaining(
  spans: readonly SectionSpan[],
  collapsedStarts: readonly number[],
  row: number | null,
): number | null {
  if (row === null) return null
  const span = spans.find(s => s.start <= row && row <= s.end)
  return span !== undefined && collapsedStarts.includes(span.start) ? span.start : null
}

/** The last row that shows anything at all, or `null` when none do. The
 * slide list marks the drop gap after the whole list on this row, since the
 * very last row may be hidden. */
export function lastVisibleRow(visibility: readonly RowVisibility[]): number | null {
  for (let row = visibility.length - 1; row >= 0; row--) {
    if (visibility[row] !== 'hidden') return row
  }
  return null
}
