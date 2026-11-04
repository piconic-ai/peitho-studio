import { type RowVisibility } from '../domain/sectionCollapse'

interface SlideRowAppearance {
  index: number
  draggedIndex: number | null
  dragOverGap: number | null
  entryCount: number
  lastVisibleRow: number | null
  visibility: RowVisibility | undefined
}

export function slideRowClass(row: SlideRowAppearance): string {
  return (
    // `relative z-10` lifts the dragged row above its
    // siblings while the row's inline `translateY` carries
    // it past them — without a stacking order bump it
    // would slide *under* whichever row it's currently
    // overlapping instead of visibly floating over it.
    (row.draggedIndex === row.index ? 'relative z-10 opacity-60 shadow-lg rounded-md ' : '')
    + (row.draggedIndex !== null && row.dragOverGap === row.index ? 'border-t-2 border-t-primary ' : '')
    // The gap after the whole list is marked on the last row
    // that shows at all: the very last row may sit inside a
    // collapsed section.
    + (row.draggedIndex !== null && row.dragOverGap === row.entryCount && row.index === row.lastVisibleRow ? 'border-b-2 border-b-primary ' : '')
    // Keep collapsed rows' canvases mounted. A hidden row has an all-zero
    // bounding box, so `dom/dragGesture.ts`'s `gapUnderCursor` skips it.
    + (row.visibility === 'hidden' ? 'hidden ' : '')
    + 'cursor-grab'
  )
}
