// Renders a slide fragment into a host element's Shadow root instead of an
// `<iframe srcdoc>` — see `todo/thumbnail-iframe-removal.md`. Not unit-
// tested (per CLAUDE.md, `dom/` is DOM-touching and untested for now);
// verify via `run-peitho-studio`.

import { containScale, type Size } from '../domain/geometry'

// Adopted by every mounted canvas alongside its theme sheet — one shared
// CSSStyleSheet object rather than a `<style>` re-parsed per thumbnail
// (`adoptedStyleSheets` accepts the same sheet in many shadow roots at
// once). `--peitho-thumb-scale` is written per-host by `observeCanvasScale`
// below; `.peitho-slide`'s own native size (theme CSS) is left alone here
// and only scaled down to fit.
const LAYOUT_SHEET = new CSSStyleSheet()
LAYOUT_SHEET.replaceSync(`
  :host { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .peitho-slide { flex-shrink: 0; transform: scale(var(--peitho-thumb-scale, 1)); transform-origin: center center; }
`)

/** Parses `cssText` (a deck theme's compiled CSS, already absolutized and
 * `@font-face`-stripped — see `state/renderStore.ts`'s `slideStylesheetText`)
 * into a `CSSStyleSheet` for `adoptedStyleSheets`. Call once per distinct
 * CSS string and reuse the result across every mounted canvas — a theme
 * change then only needs `sheet.replaceSync(next)`, not a re-parse per
 * thumbnail. */
export function createSlideStylesheet(cssText: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(cssText)
  return sheet
}

const FONT_FACE_STYLE_ATTR = 'data-peitho-fonts'

/** Hoists `@font-face` rules into one shared `<style>` in `<head>` rather
 * than each Shadow root's own adopted sheet — WKWebView font registration
 * inside a shadow tree is unconfirmed; see this PR's spike note in
 * `todo/thumbnail-iframe-removal.md`. */
export function ensureFontFaces(fontFaceCss: string): void {
  let styleEl = document.head.querySelector<HTMLStyleElement>(`style[${FONT_FACE_STYLE_ATTR}]`)
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.setAttribute(FONT_FACE_STYLE_ATTR, '')
    document.head.appendChild(styleEl)
  }
  if (styleEl.textContent !== fontFaceCss) styleEl.textContent = fontFaceCss
}

/** Mounts `fragmentHtml` into `host`'s Shadow root, creating it on first
 * call, adopting the theme `sheet` alongside the shared layout rules
 * above. Pair with `observeCanvasScale` to keep it fitted as `host`
 * resizes. */
export function mountSlideCanvas(host: HTMLElement, sheet: CSSStyleSheet, fragmentHtml: string): void {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  shadow.adoptedStyleSheets = [sheet, LAYOUT_SHEET]
  shadow.innerHTML = fragmentHtml
}

/** Swaps in fresh fragment HTML for an already-mounted canvas, replacing
 * only the existing `.peitho-slide` element rather than the whole subtree
 * — mirrors `Studio.tsx`'s `patchSlidePreviewIframes`. Returns whether a
 * swap actually happened, so a caller sweeping every mounted canvas on
 * every edit can tell which ones changed. A host with no shadow root yet
 * (mount hasn't run) or no `.peitho-slide` inside it is a safe no-op. */
export function patchSlideCanvas(host: HTMLElement, fragmentHtml: string): boolean {
  const shadow = host.shadowRoot
  const current = shadow?.querySelector('.peitho-slide')
  if (!shadow || !current || current.outerHTML === fragmentHtml) return false
  const wrapper = document.createElement('div')
  wrapper.innerHTML = fragmentHtml
  const next = wrapper.firstElementChild
  if (!next) return false
  current.replaceWith(next)
  return true
}

const canvasSizes = new WeakMap<Element, Size>()
let sharedObserver: ResizeObserver | null = null

function handleResize(entries: ResizeObserverEntry[]): void {
  for (const entry of entries) {
    const host = entry.target as HTMLElement
    const canvas = canvasSizes.get(host)
    if (!canvas) continue
    host.style.setProperty('--peitho-thumb-scale', String(containScale(entry.contentRect, canvas)))
  }
}

/** Keeps `host`'s `.peitho-slide` scaled to fit as `host` resizes, via one
 * `ResizeObserver` shared across every mounted canvas instead of one per
 * thumbnail. `canvas` is the deck's native slide size
 * (`RenderPayload.manifest.canvasWidth/Height`), not `host`'s own box. */
export function observeCanvasScale(host: HTMLElement, canvas: Size): void {
  canvasSizes.set(host, canvas)
  sharedObserver ??= new ResizeObserver(handleResize)
  sharedObserver.observe(host)
}
