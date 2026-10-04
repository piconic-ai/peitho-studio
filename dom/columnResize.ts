const MIN_COLUMN_WIDTH = 180
const MAX_COLUMN_WIDTH = 640

/** The range a dragged column is kept in, for a width worked out
 * elsewhere to stay in it too. */
export const COLUMN_WIDTH_BOUNDS = { min: MIN_COLUMN_WIDTH, max: MAX_COLUMN_WIDTH }

/** Calls `then` on the next frame with the summed widths of the elements
 * `selectors` match — once they're laid out, after a screen was just shown.
 * Skipped when one isn't there. */
export function measureWidthsNextFrame(selectors: readonly string[], then: (width: number) => void): void {
  requestAnimationFrame(() => {
    let width = 0
    for (const selector of selectors) {
      const el = document.querySelector(selector)
      if (el === null) return
      width += el.getBoundingClientRect().width
    }
    then(width)
  })
}

/** Returns a `mousedown` handler that drags a column divider, clamped to
 * [MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH]. `direction` flips which way growing
 * the column corresponds to (the slide-list divider grows it as the cursor
 * moves right; the editor/preview divider grows the editor as the cursor
 * moves left). */
export function startColumnResize(
  getWidth: () => number,
  setWidth: (next: number) => void,
  direction: 1 | -1,
) {
  return (event: MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = getWidth()
    const onMove = (moveEvent: MouseEvent) => {
      const delta = (moveEvent.clientX - startX) * direction
      const next = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, startWidth + delta))
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
}
