const MIN_COLUMN_WIDTH = 180
const MAX_COLUMN_WIDTH = 640

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
