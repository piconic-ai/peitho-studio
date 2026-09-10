import { createSignal, createMemo, batch } from '@barefootjs/client'
import { type Manifest, type ManifestSection, type SectionDraft, type RenderPayload, sectionStartByIndex as computeSectionStartByIndex } from '../domain/render'
import { absolutizeCssUrls, scopeRootToHost, splitFontFaceRules } from '../domain/slideCss'
import { absolutizeFragmentUrls } from '../domain/slideFragment'
import { formatDurationMs, stabilizeByKey } from '../domain/slides'

/** The deck's last-rendered state: manifest, per-slide fragment HTML, canvas
 * size, asset base URL, and the section-header drafts a fresh render resets.
 * DOM effects that *consume* this state (patching an already-mounted
 * canvas's content in place) stay in `Studio.tsx` — they touch the DOM,
 * which `state/` isn't allowed to (see `scripts/arch-check.test.ts`) — so
 * this store only ever produces new values, never reaches into the page to
 * push them anywhere itself. */
export function createRenderStore() {
  const [assetBaseUrl, setAssetBaseUrl] = createSignal<string | null>(null)
  // The deck's native slide canvas size — split out of `manifest` into its
  // own equality-guarded signals (set in `applyRenderPayload`) even though
  // it logically lives there. `manifest()` gets a brand-new object on every
  // single-slide edit, but every thumbnail's `.map()` row reads canvas size
  // (for its aspect-ratio style and its canvas host's `--peitho-canvas-*`)
  // — reading it via `manifest()` directly made *every* row's reactive
  // bindings depend on *every* edit, re-running work on rows whose own
  // content never changed — same problem, and same fix, as `fragmentSignal`
  // below.
  const [canvasWidth, setCanvasWidth] = createSignal(1280)
  const [canvasHeight, setCanvasHeight] = createSignal(720)
  const [manifest, setManifest] = createSignal<Manifest | null>(null)
  const sectionStartByIndex = createMemo<Record<number, ManifestSection>>(() => computeSectionStartByIndex(manifest()?.sections ?? []))
  const [sectionDrafts, setSectionDrafts] = createSignal<Record<number, SectionDraft>>({})

  const [css, setCss] = createSignal('')
  // A memo, rather than something computed once in `applyRenderPayload`,
  // because the result depends on `assetBaseUrl()` too — the asset server's
  // URL can change independently of the CSS itself.
  const absolutizedCss = createMemo<string>(() => absolutizeCssUrls(css(), assetBaseUrl() ?? ''))
  const splitCss = createMemo<{ fontFaces: string; rest: string }>(() => splitFontFaceRules(absolutizedCss()))
  /** CSS for a Shadow DOM canvas's adopted style sheet: `:root` rewritten
   * to `:host`, since `:root` resolves to the *document* root and so would
   * never reach `.peitho-slide` inside a shadow tree, and `@font-face`
   * split off into `fontFaceCss` for `dom/slideCanvas.ts` to hoist into
   * `<head>` instead. */
  const slideStylesheetText = createMemo<string>(() => scopeRootToHost(splitCss().rest))
  const fontFaceCss = createMemo<string>(() => splitCss().fontFaces)

  // One independent signal per slide key, rather than a single
  // `Record<string, string>` signal — reading `slideFragments()` as a whole
  // record would subscribe every thumbnail's `srcdoc` effect to the *entire*
  // record, so editing one slide reassigned every other thumbnail's
  // `<iframe srcdoc>` too (same value, but `.srcdoc` always forces a
  // navigate/reload on assignment regardless of whether the string actually
  // changed) — the visible flicker across the whole slide list on every
  // keystroke. Keying a separate signal per slide means only the row whose
  // fragment actually changed re-touches its own DOM.
  const fragmentSignals = new Map<string, [() => string, (value: string) => void]>()
  function fragmentSignal(key: string): [() => string, (value: string) => void] {
    let entry = fragmentSignals.get(key)
    if (!entry) {
      entry = createSignal('')
      fragmentSignals.set(key, entry)
    }
    return entry
  }
  /** The fragment HTML a Shadow DOM canvas needs: read-only (the setter
   * never crosses the component boundary, per docs/architecture.md's
   * "children never receive a setter" rule) and absolutized, since a shadow
   * root has no `<base href>` to resolve a slide's `src="assets/…"` against
   * — those would otherwise resolve against the app's own document URL. */
  function canvasFragmentOf(key: string): string {
    return absolutizeFragmentUrls(fragmentSignal(key)[0](), assetBaseUrl() ?? '')
  }

  // `slide` (edited or not) arrives as a freshly-deserialized object on every
  // keystroke, and reusing the *previous* slide's own reference for one
  // that's unchanged is what lets the keyed `.map()` over `manifest().slides`
  // skip re-running that row's bindings at all — see `stabilizeByKey`'s own
  // comment for why this is load-bearing, not just tidiness.
  function applyRenderPayload(payload: RenderPayload): void {
    // Everything a slide's one-shot mount read depends on — its fragment,
    // the canvas size, the asset base URL — must already be current
    // *before* `setManifest` below, not after. A brand-new row (this deck's
    // first render, or a slide that didn't exist a moment ago) does that
    // read synchronously as part of reacting to the manifest update that
    // creates it, and it is never repeated (a `ref`-scoped effect that only
    // tracks `selectedSlideKey`, not the fragment itself — see
    // `SlidePreview.tsx`), so setting it up in the other order let a fresh
    // row capture an empty fragment permanently, before this function ever
    // reached the loop that would have given it real content.
    //
    // Wrapped in `batch()` so the DOM-patching effect that watches both
    // `manifest()` and every slide's own `fragmentSignal` (see Studio.tsx)
    // flushes once per call to this function instead of once per signal
    // write inside it — a multi-slide deck's first render used to fire
    // that effect once per fragment plus once more for `setManifest`,
    // each pass a no-op past the first (its own `outerHTML` equality
    // check bails immediately), but still a `querySelectorAll` sweep over
    // every mounted thumbnail repeated for nothing.
    batch(() => {
      for (const [key, html] of Object.entries(payload.fragments)) {
        const [get, set] = fragmentSignal(key)
        if (get() !== html) set(html)
      }
      setAssetBaseUrl(payload.assetBaseUrl)
      if (css() !== payload.css) setCss(payload.css)
      if (canvasWidth() !== payload.manifest.canvasWidth) setCanvasWidth(payload.manifest.canvasWidth)
      if (canvasHeight() !== payload.manifest.canvasHeight) setCanvasHeight(payload.manifest.canvasHeight)
      const previousSlides = manifest()?.slides ?? []
      setManifest({ ...payload.manifest, slides: stabilizeByKey(previousSlides, payload.manifest.slides) })
      const drafts: Record<number, SectionDraft> = {}
      for (const section of payload.manifest.sections) {
        drafts[section.startIndex] = { name: section.name, time: formatDurationMs(section.plannedDurationMs) }
      }
      setSectionDrafts(drafts)
    })
  }

  return {
    assetBaseUrl, canvasWidth, canvasHeight, manifest, sectionStartByIndex,
    sectionDrafts, setSectionDrafts,
    fragmentSignal, canvasFragmentOf, applyRenderPayload,
    slideStylesheetText, fontFaceCss,
  }
}
