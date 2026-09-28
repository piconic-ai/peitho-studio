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

/** "Contain" (letterbox, never crop) plus a fixed 2% overscan. `Math.max`
 * ("cover") would blow content up on the tighter axis; a bare `Math.min`
 * leaves a hairline gap in WKWebView, whose transform/layout rounding
 * doesn't land on the same ratio this division produces. 2% is the smallest
 * margin that covered that drift while staying inside the theme's own slide
 * padding — empirically tuned against the iframe-era `fit()` script this
 * replaced. */
export function containScale(avail: Size, canvas: Size): number {
  return Math.min(avail.width / canvas.width, avail.height / canvas.height) * 1.02
}

/** A box on screen, in the same units as the points tested against it. */
export interface Rect { left: number; top: number; right: number; bottom: number }

/** Whether `point` lies inside `rect`, edges included. */
export function isPointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

/** A point in physical (device) pixels, as Tauri reports a file drop's
 * position, in CSS pixels — `scale` is the page's `devicePixelRatio`. A
 * scale that isn't a positive number (never a real one) leaves the point
 * as is rather than producing `Infinity`/`NaN`. */
export function physicalToCssPoint(point: Point, scale: number): Point {
  if (!(scale > 0) || !Number.isFinite(scale)) return point
  return { x: point.x / scale, y: point.y / scale }
}
