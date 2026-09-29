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

/** A file drop's position as Tauri reports it, in CSS pixels. Tauri calls
 * it a `PhysicalPosition`, but on macOS wry passes AppKit's
 * `draggingLocation` through unscaled (wry 0.55
 * `wkwebview/drag_drop.rs`), which is already in points — CSS pixels — so
 * only elsewhere is it divided by `scale`, the page's `devicePixelRatio`.
 * A scale that isn't a positive number (never a real one) leaves the point
 * as is rather than producing `Infinity`/`NaN`. */
export function dropPointToCss(point: Point, scale: number, macOS: boolean): Point {
  if (macOS || !(scale > 0) || !Number.isFinite(scale)) return point
  return { x: point.x / scale, y: point.y / scale }
}

/** Where `point` lies across `rect`, as fractions of its width and height
 * (0 at the left/top edge, 1 at the right/bottom), clamped to the box.
 * `null` for a box with no area. */
export function fractionInRect(point: Point, rect: Rect): Point | null {
  const width = rect.right - rect.left
  const height = rect.bottom - rect.top
  if (!(width > 0) || !(height > 0)) return null
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1)
  return { x: clamp((point.x - rect.left) / width), y: clamp((point.y - rect.top) / height) }
}

/** Where `fraction` (0-1 of `element`'s box) falls on `slide`, as fractions
 * of the slide's box: a pin anchored to an element, placed wherever the
 * slide laid that element out. `null` for a slide or an element with no
 * area (not laid out, or hidden). */
export function pinInSlide(fraction: Point, element: Rect, slide: Rect): Point | null {
  const width = slide.right - slide.left
  const height = slide.bottom - slide.top
  if (!(width > 0) || !(height > 0)) return null
  if (!(element.right > element.left) || !(element.bottom > element.top)) return null
  const x = element.left + fraction.x * (element.right - element.left)
  const y = element.top + fraction.y * (element.bottom - element.top)
  return { x: (x - slide.left) / width, y: (y - slide.top) / height }
}
