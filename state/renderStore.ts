import { createSignal, createMemo, batch } from '@barefootjs/client'
import { type Manifest, type ManifestSection, type SectionDraft, type RenderPayload, savedSectionDraft, sectionStartByIndex as computeSectionStartByIndex } from '../domain/render'
import { absolutizeCssUrls, scopeRootToHost, splitFontFaceRules } from '../domain/slideCss'
import { absolutizeFragmentUrls } from '../domain/slideFragment'
import { stabilizeByKey } from '../domain/slides'

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
  // The exact source string that produced the current `manifest()` —
  // written only by `applyRenderPayload`, atomically with the manifest
  // itself (same `batch()` below), never anywhere else. `domain/slideList.ts`'s
  // `buildSlideList` needs a source that's guaranteed to already match
  // `manifest.slides` (so drafts/positions line up); `editor.fullSource()`
  // doesn't give that guarantee — it's a separate signal `Studio.tsx`
  // updates independently, sometimes across an `await` (e.g.
  // `commitChange` applies the new manifest, then `await`s the disk
  // write, and only *after that* sets `fullSource`). A `slideEntries`
  // memo reading `manifest()` + `fullSource()` together could observe
  // that in-between state — a manifest with one fewer slide (say, one
  // just marked draft) paired with the *old* source that still has every
  // slide undrafted — and mis-pair a later same-titled slide's row with
  // the wrong manifest entry, handing BarefootJS's keyed `.map()` a
  // duplicate key it then permanently collapses to one DOM scope (logged
  // as a `[BarefootJS] mapArray: duplicate key` warning) — which is what
  // left a slide's thumbnail canvas blank until the whole deck was
  // reopened. Pairing the manifest with the source that *actually*
  // produced it removes the mismatched read entirely, regardless of when
  // `fullSource()` itself gets around to catching up.
  const [renderedSource, setRenderedSource] = createSignal('')
  const sectionStartByIndex = createMemo<Record<number, ManifestSection>>(() => computeSectionStartByIndex(manifest()?.sections ?? []))
  const [sectionDrafts, setSectionDrafts] = createSignal<Record<number, SectionDraft>>({})
  /** The draft for the section starting at slide `startIndex`, or that
   * section's saved values when there's no draft for it. Only meaningful
   * for an index in `sectionStartByIndex()`. */
  function sectionDraftOf(startIndex: number): SectionDraft {
    return sectionDrafts()[startIndex] ?? savedSectionDraft(sectionStartByIndex()[startIndex])
  }

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
  // `Record<string, string>` signal — a whole-record signal hands out a new
  // record on every render, so every reader was notified for every slide on
  // every keystroke, and each one re-touched its slide's DOM (the visible
  // flicker across the whole slide list this was introduced to fix). Per-key
  // signals are `Object.is`-guarded one slide at a time, so a render that
  // leaves a slide's fragment byte-identical notifies nobody for it.
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
  function applyRenderPayload(payload: RenderPayload, source: string): void {
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
    // each pass a no-op past the first (`patchSlideCanvas` bails on an
    // unchanged fragment), but still a `querySelectorAll` sweep over every
    // mounted thumbnail repeated for nothing.
    batch(() => {
      for (const [key, html] of Object.entries(payload.fragments)) {
        const [get, set] = fragmentSignal(key)
        if (get() !== html) set(html)
      }
      setAssetBaseUrl(payload.assetBaseUrl)
      if (css() !== payload.css) setCss(payload.css)
      if (canvasWidth() !== payload.manifest.canvasWidth) setCanvasWidth(payload.manifest.canvasWidth)
      if (canvasHeight() !== payload.manifest.canvasHeight) setCanvasHeight(payload.manifest.canvasHeight)
      if (renderedSource() !== source) setRenderedSource(source)
      const previousSlides = manifest()?.slides ?? []
      setManifest({ ...payload.manifest, slides: stabilizeByKey(previousSlides, payload.manifest.slides) })
      const drafts: Record<number, SectionDraft> = {}
      for (const section of payload.manifest.sections) {
        drafts[section.startIndex] = savedSectionDraft(section)
      }
      setSectionDrafts(drafts)
    })
  }

  return {
    assetBaseUrl, canvasWidth, canvasHeight, manifest, renderedSource, sectionStartByIndex,
    sectionDrafts, setSectionDrafts, sectionDraftOf,
    fragmentSignal, canvasFragmentOf, applyRenderPayload,
    slideStylesheetText, fontFaceCss,
  }
}
