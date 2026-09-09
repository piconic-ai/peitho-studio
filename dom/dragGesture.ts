// DOM-dependent primitives for slide drag-and-drop — the parts of the
// original `startSlideDrag` that only make sense against a real DOM (row
// layout, global mouse listeners, body cursor). Kept out of
// domain/drag.ts, whose DragState/arm/move/dropTarget/cancel don't touch
// the DOM at all.

/** The `data-slide-row` gap boundary the cursor is over right now: the
 * gap right before the first row whose vertical center the cursor is
 * still above, or the gap after the last row if the cursor is below all
 * of them. */
export function gapUnderCursor(clientY: number): number {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-slide-row]'))
  for (const row of rows) {
    const rect = row.getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return Number(row.dataset.slideRow)
  }
  return rows.length
}

export interface DragGestureHandlers {
  onMove: (event: MouseEvent) => void
  onUp: () => void
  onBlur: () => void
}

/** Wires up the window-level mousemove/mouseup/blur listeners a drag
 * needs while it's in flight, tearing all three down before whichever of
 * `onUp`/`onBlur` fires first runs — mirrors `startSlideDrag`'s original
 * manual `addEventListener`/`removeEventListener` pairs (including the
 * blur-cancels-the-drag safety net for when a native dialog or app
 * switch steals focus mid-drag) so callers don't each re-derive it.
 * Returns the same teardown for a caller that needs to detach early. */
export function attachDragListeners(handlers: DragGestureHandlers): () => void {
  const onMove = handlers.onMove
  const onUp = (): void => {
    detach()
    handlers.onUp()
  }
  const onBlur = (): void => {
    detach()
    handlers.onBlur()
  }
  function detach(): void {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    window.removeEventListener('blur', onBlur)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  window.addEventListener('blur', onBlur)
  return detach
}

/** Toggles the whole-page drag affordance: `cursor: grabbing` overrides
 * whatever's under the pointer (a row's own `cursor-grab` only applies
 * while the pointer is over that specific row, which would otherwise
 * flicker grab/default/text as the drag crosses sibling rows), and
 * `user-select: none` stops the browser's native text-selection drag
 * from running alongside the custom one. */
export function setDragAffordance(active: boolean): void {
  document.body.style.userSelect = active ? 'none' : ''
  document.body.style.cursor = active ? 'grabbing' : ''
}
