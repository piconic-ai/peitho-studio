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
// being scaled (the same pin the iframe-era preview document used, for the
// same reason). `text-align: left` blocks an inherited property from
// leaking in from wherever `host` happens to sit in the light DOM: unlike
// the `<iframe>` this replaces (a separate document, so nothing about its
// parent's cascade ever reached its content), a shadow tree inherits
// ordinary inherited properties straight from its host's computed style.
// `SlideList.tsx` mounts a canvas inside a `<button>`, whose UA stylesheet
// default is `text-align: center`; left un-reset, a deck's `<h1>`/`<ul>`
// centered instead of left-aligned, and — since `list-style-position:
// outside` markers aren't subject to `text-align` — each `<li>`'s bullet
// stayed pinned at the far left while its now-centered text visibly
// detached from it. Confirmed via a synthetic host wrapped in the same
// button/span/span chain `SlideList.tsx` actually uses; the theme itself
// sets no `text-align` for this to override. Applies to both modes (unlike
// `THUMBNAIL_CONSTRAINT_CSS` below) since any host's ancestor chain could
// carry an inherited `text-align`, not just a thumbnail row's `<button>`.
const BASE_LAYOUT_CSS = `
  :host { display: flex; align-items: center; justify-content: center; overflow: hidden; text-align: left; }
  .peitho-slide { flex-shrink: 0; transform: scale(var(--peitho-thumb-scale, 1)); transform-origin: center center; }
`
// `mode: 'thumbnail'` only — a thumbnail/layout-picker host is itself the
// click/right-click/drag-reorder target, and the slide markup inside it is
// a deck author's arbitrary HTML (unlike the `<iframe srcdoc>` this
// replaces, it now lives in the app's own document): unconstrained, an
// `<a href>` would eat the click meant for the row and an `<img>` would
// start a native drag fighting the manual reorder gesture.
// `pointer-events`/`user-select` are inherited, so declaring them on
// `:host` covers that markup too, and hit-testing falls through to the row
// element behind the host. `mode: 'interactive'` (the standalone preview
// pane) skips this sheet on purpose — see `mountSlideCanvas`.
const THUMBNAIL_CONSTRAINT_CSS = `
  :host { pointer-events: none; user-select: none; }
`
// Built on first mount, not at module load: `new CSSStyleSheet()` only
// exists in a browser, so constructing it eagerly would make this module
// unimportable from a `bun test` (a component IR test, say) or any other
// non-DOM context.
let baseLayoutSheet: CSSStyleSheet | null = null
let thumbnailConstraintSheet: CSSStyleSheet | null = null

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

// How many queued-microtask retries `mountSlideCanvas` allows before giving
// up on a host that never connects — see the function's doc comment. Sized
// generously above the observed single-retry case, not tuned to any
// specific number of ticks.
const MAX_MOUNT_RETRIES = 5
const mountRetryCounts = new WeakMap<HTMLElement, number>()

// What each host's shadow root was last given, so `patchSlideCanvas` can
// recognize an unchanged fragment. Re-serializing the mounted DOM
// (`.outerHTML`) instead would compare two different spellings of the same
// markup: peitho emits pulldown-cmark's `<br />` and keeps `&lt;` inside
// attribute values, both of which the browser serializes back differently
// (`<br>`, a literal `<`) — so any deck using `breaks: true` would fail the
// check on every slide and rebuild every canvas on every keystroke.
const appliedFragments = new WeakMap<Element, string>()

// Shadow roots that already have the interactive-mode link guard attached
// — `mountSlideCanvas` re-runs on every selection change for the same
// preview-pane host (a fresh `srcdoc`-style remount, not a `patchSlideCanvas`
// in-place update), so this stops a second listener from stacking on top.
const linkGuardedRoots = new WeakSet<ShadowRoot>()

/** Mounts `fragmentHtml` into `host`'s Shadow root, reusing that root if it
 * already has one (a second `attachShadow` throws). `canvas` is the deck's
 * native slide size: the theme sizes `.peitho-slide` off
 * `--peitho-canvas-width/height`, which peitho only ever emits on the
 * `:root` of a document it generates itself, so a shadow-rendered slide
 * needs the host to carry it — otherwise every non-1280x720 deck silently
 * renders at the theme's `var()` fallback. Pair with `observeCanvasScale`
 * to keep it fitted as `host` resizes.
 *
 * `mode: 'thumbnail'` (a slide-list row or layout-picker cell) constrains
 * the mounted slide to a non-target, non-selectable image — see
 * `THUMBNAIL_CONSTRAINT_CSS`. `mode: 'interactive'` (the standalone preview
 * pane) leaves it selectable and clickable like the `<iframe>` it replaces
 * did, except an in-slide `<a href>` click is suppressed: unlike that
 * iframe (a separate document, so a link navigating it never touched the
 * app), a Shadow root shares this document, and letting a slide's link
 * navigate the whole app is worse than the iframe-era behavior it would
 * otherwise regress from.
 *
 * A brand-new `.map()` row's `ref` runs while its element is still part of
 * the detached "template contents" document the row was parsed into — not
 * yet `host.ownerDocument`, which stays the real page document throughout.
 * A `CSSStyleSheet` can only be adopted by shadow roots/documents that
 * share its origin document (`DOMException: Sharing constructed
 * stylesheets in multiple documents is not allowed`), so mounting here
 * would throw for every fresh row. The insert that reparents `host` typically
 * lands within the same synchronous tick this `ref` returns in, so one
 * deferred microtask is normally enough — but if the row is added and then
 * removed again within that same tick (before the retry runs), `host` never
 * connects at all. `MAX_MOUNT_RETRIES` caps the resulting retry loop so an
 * abandoned row's closure gets dropped instead of rescheduling forever. */
export function mountSlideCanvas(host: HTMLElement, sheet: CSSStyleSheet, fragmentHtml: string, canvas: Size, mode: 'thumbnail' | 'interactive'): void {
  if (!host.isConnected) {
    const attempt = mountRetryCounts.get(host) ?? 0
    if (attempt >= MAX_MOUNT_RETRIES) {
      mountRetryCounts.delete(host)
      return
    }
    mountRetryCounts.set(host, attempt + 1)
    queueMicrotask(() => mountSlideCanvas(host, sheet, fragmentHtml, canvas, mode))
    return
  }
  mountRetryCounts.delete(host)
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  baseLayoutSheet ??= createSlideStylesheet(BASE_LAYOUT_CSS)
  const sheets = [sheet, baseLayoutSheet]
  if (mode === 'thumbnail') {
    thumbnailConstraintSheet ??= createSlideStylesheet(THUMBNAIL_CONSTRAINT_CSS)
    sheets.push(thumbnailConstraintSheet)
  } else if (!linkGuardedRoots.has(shadow)) {
    // Capture phase: a click inside .peitho-slide never bubbles past the
    // shadow boundary anyway (retargeted to `host` first), so a bubble-
    // phase listener on `shadow` itself would never see the original
    // target. `closest` still works on the retargeted-within-the-root
    // target since that's this same shadow tree.
    shadow.addEventListener('click', event => {
      if ((event.target as Element).closest('a[href]')) event.preventDefault()
    }, true)
    linkGuardedRoots.add(shadow)
  }
  shadow.adoptedStyleSheets = sheets
  host.style.setProperty('--peitho-canvas-width', `${String(canvas.width)}px`)
  host.style.setProperty('--peitho-canvas-height', `${String(canvas.height)}px`)
  shadow.innerHTML = fragmentHtml
  appliedFragments.set(host, fragmentHtml)
}

/** Swaps fresh fragment HTML into an already-mounted canvas, and reports
 * whether anything actually changed. Only ever *replaces* an existing
 * `.peitho-slide`, never inserts one, so a patch that reaches a host that
 * isn't mounted yet is a safe no-op rather than a duplicated slide. No
 * re-fit is needed after the swap: the scale lives in a custom property on
 * `host`, which the replacement inherits untouched. */
export function patchSlideCanvas(host: HTMLElement, fragmentHtml: string): boolean {
  if (appliedFragments.get(host) === fragmentHtml) return false
  const current = host.shadowRoot?.querySelector('.peitho-slide')
  if (!current) return false
  const wrapper = document.createElement('div')
  wrapper.innerHTML = fragmentHtml
  const next = wrapper.firstElementChild
  if (!next) return false
  current.replaceWith(next)
  appliedFragments.set(host, fragmentHtml)
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
