// Renders a slide fragment into a host element's Shadow root instead of an
// `<iframe srcdoc>` — see `todo/thumbnail-iframe-removal.md`. Not unit-
// tested (per CLAUDE.md, `dom/` is DOM-touching and untested for now);
// verify via `run-peitho-studio`.

import { containScale, type Size } from '../domain/geometry'

// Adopted by every mounted canvas alongside its theme sheet — one shared
// `CSSStyleSheet` rather than a `<style>` re-parsed per thumbnail
// (`adoptedStyleSheets` accepts the same sheet in many shadow roots at
// once). `flex-shrink: 0` pins `.peitho-slide` at its native canvas size so
// the transform does 100% of the size reduction: as a flex child it would
// otherwise be squeezed below that width and re-wrap its own text *before*
// being scaled (the same pin, for the same reason, as in
// `domain/previewDoc.ts`).
const LAYOUT_CSS = `
  :host { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .peitho-slide { flex-shrink: 0; transform: scale(var(--peitho-thumb-scale, 1)); transform-origin: center center; }
`
// Built on first mount, not at module load: `new CSSStyleSheet()` only
// exists in a browser, so constructing it eagerly would make this module
// unimportable from a `bun test` (a component IR test, say) or any other
// non-DOM context.
let layoutSheet: CSSStyleSheet | null = null

/** Parses `cssText` (a deck theme's compiled CSS, already absolutized and
 * `@font-face`-stripped — see `state/renderStore.ts`'s
 * `slideStylesheetText`) for `adoptedStyleSheets`. Call once per distinct
 * CSS string and share the result across every mounted canvas, so a theme
 * change costs one `replaceSync` instead of a re-parse per thumbnail. */
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
  // Rewriting identical text would drop and re-add the same `@font-face`
  // rules, re-resolving fonts that are already loaded and drawn.
  if (styleEl.textContent !== fontFaceCss) styleEl.textContent = fontFaceCss
}

/** Mounts `fragmentHtml` into `host`'s Shadow root, reusing that root if it
 * already has one (a second `attachShadow` throws). `canvas` is the deck's
 * native slide size: the theme sizes `.peitho-slide` off
 * `--peitho-canvas-width/height`, which peitho only ever emits on the
 * `:root` of a document it generates itself, so a shadow-rendered slide
 * needs the host to carry it — otherwise every non-1280x720 deck silently
 * renders at the theme's `var()` fallback. Pair with `observeCanvasScale`
 * to keep it fitted as `host` resizes.
 *
 * A brand-new `.map()` row's `ref` runs while its element is still part of
 * the detached "template contents" document the row was parsed into — not
 * yet `host.ownerDocument`, which stays the real page document throughout.
 * A `CSSStyleSheet` can only be adopted by shadow roots/documents that
 * share its origin document (`DOMException: Sharing constructed
 * stylesheets in multiple documents is not allowed`), so mounting here
 * would throw for every fresh row. The insert that reparents `host` into
 * the real document happens synchronously, immediately after this `ref`
 * returns, so deferring one microtask is enough — never observed to need
 * a second pass. */
export function mountSlideCanvas(host: HTMLElement, sheet: CSSStyleSheet, fragmentHtml: string, canvas: Size): void {
  if (!host.isConnected) {
    queueMicrotask(() => mountSlideCanvas(host, sheet, fragmentHtml, canvas))
    return
  }
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  layoutSheet ??= createSlideStylesheet(LAYOUT_CSS)
  shadow.adoptedStyleSheets = [sheet, layoutSheet]
  host.style.setProperty('--peitho-canvas-width', `${String(canvas.width)}px`)
  host.style.setProperty('--peitho-canvas-height', `${String(canvas.height)}px`)
  shadow.innerHTML = fragmentHtml
}

/** Swaps fresh fragment HTML into an already-mounted canvas, and reports
 * whether anything actually changed. Only ever *replaces* an existing
 * `.peitho-slide`, never inserts one, so a patch that reaches a host that
 * isn't mounted yet is a safe no-op rather than a duplicated slide —
 * mirrors `Studio.tsx`'s `patchSlidePreviewIframes`, minus its `resize`
 * dispatch: the fit lives in a custom property on `host`, which the
 * replacement inherits untouched. */
export function patchSlideCanvas(host: HTMLElement, fragmentHtml: string): boolean {
  const current = host.shadowRoot?.querySelector('.peitho-slide')
  if (!current || current.outerHTML === fragmentHtml) return false
  const wrapper = document.createElement('div')
  wrapper.innerHTML = fragmentHtml
  const next = wrapper.firstElementChild
  if (!next) return false
  current.replaceWith(next)
  return true
}

const canvasSizes = new WeakMap<Element, Size>()
let sharedObserver: ResizeObserver | null = null

function handleResize(entries: ResizeObserverEntry[], observer: ResizeObserver): void {
  for (const entry of entries) {
    const host = entry.target as HTMLElement
    // A `ResizeObserver` holds its targets strongly and this one is never
    // disconnected, so a thumbnail the slide list has since destroyed would
    // stay pinned (with its whole shadow tree) for the app's lifetime.
    // Removal drops the host to 0x0, which is itself a notification — the
    // one chance to let go of it. Connectedness is read here, after layout,
    // so a row merely *moved* by a reorder still reads as connected.
    if (!host.isConnected) {
      observer.unobserve(host)
      continue
    }
    const canvas = canvasSizes.get(host)
    if (!canvas) continue
    host.style.setProperty('--peitho-thumb-scale', String(containScale(entry.contentRect, canvas)))
  }
}

/** Keeps `host`'s slide scaled to fit as `host` resizes, through a single
 * `ResizeObserver` shared by every mounted canvas rather than one each.
 * `canvas` is the deck's native slide size, not `host`'s own box. Fitting
 * against `contentRect` keeps a transform applied to `host` itself (the
 * `scale(0.95)` a drag puts on a row) out of the measurement. */
export function observeCanvasScale(host: HTMLElement, canvas: Size): void {
  canvasSizes.set(host, canvas)
  sharedObserver ??= new ResizeObserver(handleResize)
  sharedObserver.observe(host)
}
