// DOM helpers for a slide's row in `components/SlideList.tsx`.

/** Where to open the slide context menu for slide `index` when it isn't a
 * right-click that opens it: beside the slide's row, scrolled into view
 * first. `null` when the row isn't showing — not mounted yet, or folded
 * away inside a collapsed section (a hidden row has an all-zero box). */
export function slideRowMenuAnchor(index: number): { x: number; y: number } | null {
  const row = document.querySelector<HTMLElement>(`[data-slide-row="${String(index)}"]`)
  if (row === null) return null
  row.scrollIntoView({ block: 'nearest' })
  const rect = row.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { x: rect.right, y: rect.top }
}
