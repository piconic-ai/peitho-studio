// Watches an element's inner size (`clientWidth`/`clientHeight`: padding
// in, border and scrollbar out) as it changes — a window resize, a column
// divider dragged, the element shown after being hidden.

import type { Size } from '../domain/geometry'

/** Calls `onSize` with `el`'s inner size now and on every change, for as
 * long as `el` exists. */
export function observeInnerSize(el: HTMLElement, onSize: (size: Size) => void): void {
  const report = () => onSize({ width: el.clientWidth, height: el.clientHeight })
  new ResizeObserver(report).observe(el)
  report()
}
