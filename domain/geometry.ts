export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

/** Keeps a fixed-position popup on-screen: shifts it left/up just enough
 * that its box stays within `margin` px of the viewport edge, never
 * right/down (a menu should never end up further from its trigger point
 * than necessary to fit). Used for the thumbnail context menu, which is
 * positioned at the raw click coordinates with no clamping of its own. */
export function clampMenuPosition(point: Point, menuSize: Size, viewport: Size, margin: number): Point {
  const maxLeft = Math.max(margin, viewport.width - menuSize.width - margin)
  const maxTop = Math.max(margin, viewport.height - menuSize.height - margin)
  return { x: Math.min(point.x, maxLeft), y: Math.min(point.y, maxTop) }
}
