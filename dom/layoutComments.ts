// Turns a left-click on a layout's thumbnail into a comment on that layout,
// as `dom/previewComments.ts` does for a click on the slide preview — with
// the same rules for what isn't a comment: a drag (the mouse moved between
// press and release) or a click that leaves text selected.
//
// A thumbnail's canvas is `pointer-events: none` (`dom/slideCanvas.ts`'s
// thumbnail mode: the row is the click target, not the deck's markup), so
// the click never lands on the slide's own elements. Which slot it was in
// is found by position instead: peitho-core wraps each filled slot's
// content in an element classed `slot-<name>`, and the slot whose box holds
// the click is the one named. The reading itself is pure
// (`domain/reviewComment.ts`); this is not unit-tested (a real DOM), covered
// by `e2e/layout-review-comments.e2e.ts`.

import { isDrag, type Point } from '../domain/geometry'
import { slotAtPoint, slotNameOfClasses } from '../domain/reviewComment'

export interface LayoutThumbnailClick {
  /** The slot clicked, or `null` for none (the whole layout). */
  slot: string | null
  /** Where on screen, for placing the comment box. */
  at: Point
}

/** How far (CSS px) the mouse may move between press and release for it to
 * still be a click — the slide preview's allowance. */
const CLICK_SLOP = 4

let pressedAt: Point | null = null

/** Notes where a row was pressed, for `layoutThumbnailClickOf` to tell a
 * click from a drag. */
export function noteLayoutRowPress(event: MouseEvent): void {
  pressedAt = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
}

/** What a click on a layout row means as a comment: a left-click on its
 * thumbnail that was neither a drag nor a text selection — or `null`. */
export function layoutThumbnailClickOf(event: MouseEvent): LayoutThumbnailClick | null {
  const from = pressedAt
  pressedAt = null
  if (event.button !== 0) return null
  const target = event.target instanceof Element ? event.target : null
  const thumbnail = target?.closest('[data-layout-thumbnail]') ?? null
  if (thumbnail === null) return null
  const at = { x: event.clientX, y: event.clientY }
  if (isDrag(from, at, CLICK_SLOP)) return null
  if (!(document.getSelection()?.isCollapsed ?? true)) return null
  const root = thumbnail.querySelector('[data-layout-canvas],[data-layout-selected-canvas]')?.shadowRoot ?? null
  const slots = root === null ? [] : Array.from(root.querySelectorAll('[class*="slot-"]')).flatMap(element => {
    const slot = slotNameOfClasses(Array.from(element.classList))
    return slot === null ? [] : [{ slot, rect: element.getBoundingClientRect() }]
  })
  return { slot: slotAtPoint(at, slots), at }
}
