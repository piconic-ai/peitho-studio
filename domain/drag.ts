import { gapToIndex } from './slides'

/** Below this many pixels of movement, a mousedown is still just a click —
 * not yet a drag. Matches Studio.tsx's original `startSlideDrag` threshold. */
const DRAG_THRESHOLD_PX = 4

/** A slide row's drag-to-reorder lifecycle. `armed` covers the ambiguous
 * window between mousedown and the first move past the threshold — a plain
 * click never leaves this state — so a caller can tell "not dragging yet"
 * apart from "not dragging at all" (`idle`) if it ever needs to. */
export type DragState =
  | { kind: 'idle' }
  | { kind: 'armed'; index: number; startX: number; startY: number }
  | { kind: 'dragging'; index: number; startY: number; gap: number; deltaY: number }

export function arm(index: number, x: number, y: number): DragState {
  return { kind: 'armed', index, startX: x, startY: y }
}

/** Advances the state on mousemove. `gapUnderCursor` is the
 * `data-slide-row` boundary index the cursor is over right now (a DOM
 * concern the caller resolves — see `dom/dragGesture.ts` — this function
 * only reacts to it). `idle` ignores every move; `armed` promotes to
 * `dragging` once the cursor clears the threshold from its start point;
 * `dragging` just refreshes its gap/deltaY. */
export function move(state: DragState, x: number, y: number, gapUnderCursor: number): DragState {
  switch (state.kind) {
    case 'idle':
      return state
    case 'armed': {
      const distance = Math.hypot(x - state.startX, y - state.startY)
      if (distance < DRAG_THRESHOLD_PX) return state
      return { kind: 'dragging', index: state.index, startY: state.startY, gap: gapUnderCursor, deltaY: y - state.startY }
    }
    case 'dragging':
      return { kind: 'dragging', index: state.index, startY: state.startY, gap: gapUnderCursor, deltaY: y - state.startY }
    default: {
      const _exhaustive: never = state
      throw new Error(`Unhandled DragState: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** The reorder a mouseup should commit, or `null` if nothing should happen
 * — either the drag never cleared the threshold (`armed`, a plain click)
 * or there was no drag to begin with (`idle`). Doesn't filter out a
 * no-op `from === to` itself; the caller does, before ever calling
 * `reorderSlides` (see Studio.tsx's `onUp` handler). */
export function dropTarget(state: DragState): { from: number; to: number } | null {
  if (state.kind !== 'dragging') return null
  return { from: state.index, to: gapToIndex(state.gap, state.index) }
}

export function cancel(): DragState {
  return { kind: 'idle' }
}
