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

// "Contain" fit (letterbox, never crop) plus a fixed 2% overscan.
// `previewDoc.ts`'s in-iframe `fit()` script used a bare `Math.min(...)`
// until a hairline gap showed up in WKWebView specifically: its transform/
// layout rounding doesn't land on exactly the same ratio this division
// produces, and 2% is the margin that stayed imperceptible while covering
// that drift (see the comment on `fit()` for the empirical basis).
export function containScale(avail: Size, canvas: Size): number {
  return Math.min(avail.width / canvas.width, avail.height / canvas.height) * 1.02
}
