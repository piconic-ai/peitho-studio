// Keeps an absolutely positioned popup (one placed next to its trigger by
// CSS, not at a click's coordinates) inside the window: once it shows, it is
// shifted left/up just enough to fit, by the same rule as the context menus
// (`clampMenuPosition`).

import { clampMenuPosition } from '../domain/geometry'

const MARGIN = 8

/** On the next frame, shifts each shown element `selector` matches back
 * inside the window. A shift from an earlier opening is undone first, so
 * the popup is measured where its CSS puts it. */
export function keepShownPopupsInWindow(selector: string): void {
  requestAnimationFrame(() => {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      el.style.translate = ''
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const at = clampMenuPosition({ x: rect.left, y: rect.top }, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight }, MARGIN)
      const dx = at.x - rect.left
      const dy = at.y - rect.top
      if (dx !== 0 || dy !== 0) el.style.translate = `${String(dx)}px ${String(dy)}px`
    }
  })
}
