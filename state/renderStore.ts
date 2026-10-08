import { createSignal, createMemo, batch } from '@barefootjs/client'
import { type DiskRenderState, type Manifest, type ManifestSection, type SectionDraft, type RenderErrorPayload, type RenderOutcomeState, type RenderPayload, savedSectionDraft, sectionStartByIndex as computeSectionStartByIndex } from '../domain/render'
import { type BrokenSlides, NO_BROKEN_SLIDES } from '../domain/brokenSlides'
import { absolutizeCssUrls, scopeRootToHost, splitFontFaceRules } from '../domain/slideCss'
import { absolutizeFragmentUrls, stripEditAnnotations } from '../domain/slideFragment'
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
  const [outcome, setOutcome] = createSignal<RenderOutcomeState>({ kind: 'none' })
  // What the deck on disk last rendered to (`DiskRenderState`), apart from
  // `outcome`, which a draft's render turns `rendered` too: `Studio.tsx`
  // reports the disk's build errors to the agent from this, and a draft
  // fixing a slide in memory must not read as the file fixed — the save
  // after it can fail, leaving the file broken and the agent untold.
  // Written by `markRenderFailed` and `markDiskRendered` only.
  const [diskRender, setDiskRender] = createSignal<DiskRenderState>({ kind: 'none' })
  /** The source on disk (`source`) doesn't build: `open_deck` refused it,
   * or a render of what's on disk did (`Studio.tsx`'s `renderPreview` of a
   * persisted source). The last successful render, if any, is kept as it
   * is — only `outcome` (and `diskRender`) changes. */
  function markRenderFailed(error: RenderErrorPayload, source: string): void {
    batch(() => {
      setOutcome({ kind: 'failed', error, source })
      setDiskRender({ kind: 'failed', error, source })
    })
  }
  /** `source` is on disk and rendered, without `broken`'s slides: the
   * render `open_deck` answered with, a persisted render's, or a save's
   * once `save_deck_source` returned — never a draft's, and never before
   * the write lands. Separate from `applyRenderPayload`, which a save
   * calls before writing (so the preview doesn't wait on the disk). */
  function markDiskRendered(source: string, broken: BrokenSlides = NO_BROKEN_SLIDES): void {
    setDiskRender({ kind: 'rendered', source, broken })
  }
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
  // The slides the current render isolated for not building (by their
  // position in `renderedSource()` — see `domain/brokenSlides.ts`),
  // written only with the manifest they were isolated from, in the same
  // `batch()`. A whole map in one signal, which CLAUDE.md warns against
  // for anything rows read: no row reads this — `Studio.tsx`'s
  // `slideEntries` memo bakes each slide's error into its own entry
  // (`buildSlideList`), and the error bar's summary is a memo of a
  // string — so a render that isolates the same slides notifies the same
  // readers a render always does, and nothing per row.
  const [brokenSlides, setBrokenSlides] = createSignal<BrokenSlides>(NO_BROKEN_SLIDES)
  // The layout each slide of `manifest()` was built on (by key) and the
  // deck's layouts, written with it — read when a slide is added, to name
  // the new slide's layout (`domain/standardLayouts.ts`).
  const [slideLayouts, setSlideLayouts] = createSignal<Record<string, string>>({})
  const [headingLayouts, setHeadingLayouts] = createSignal<string[]>([])
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
  /** A slide's fragment HTML as rendered, without peitho-core's edit
   * annotations ('' for a key never rendered) — for readers that only
   * inspect its markup, not display it. The annotations' byte spans shift
   * with every edit above a slide, so keeping them here would notify every
   * later slide's reader on each keystroke (see `stripEditAnnotations`). */
  function fragmentOf(key: string): string {
    return fragmentSignal(key)[0]()
  }

  // The fragments as rendered, annotations included, for the one canvas
  // that reads them: the preview's (its comment UI takes a click's target
  // from them). Per key, like `fragmentSignals`.
  const annotatedSignals = new Map<string, [() => string, (value: string) => void]>()
  function annotatedSignal(key: string): [() => string, (value: string) => void] {
    let entry = annotatedSignals.get(key)
    if (!entry) {
      entry = createSignal('')
      annotatedSignals.set(key, entry)
    }
    return entry
  }
  /** The fragment HTML a Shadow DOM canvas needs: read-only (the setter
   * never crosses the component boundary, per docs/architecture.md's
   * "children never receive a setter" rule) and absolutized, since a shadow
   * root has no `<base href>` to resolve a slide's `src="assets/…"` against
   * — those would otherwise resolve against the app's own document URL. */
  function canvasFragmentOf(key: string): string {
    return absolutizeFragmentUrls(fragmentOf(key), assetBaseUrl() ?? '')
  }

  /** `canvasFragmentOf` with peitho-core's edit annotations kept — what the
   * preview canvas mounts. */
  function previewFragmentOf(key: string): string {
    return absolutizeFragmentUrls(annotatedSignal(key)[0](), assetBaseUrl() ?? '')
  }

  // `slide` (edited or not) arrives as a freshly-deserialized object on every
  // keystroke, and reusing the *previous* slide's own reference for one
  // that's unchanged is what lets the keyed `.map()` over `manifest().slides`
  // skip re-running that row's bindings at all — see `stabilizeByKey`'s own
  // comment for why this is load-bearing, not just tidiness.
  //
  // `source` is the deck as written, even when `payload` was rendered
  // from a copy with `broken`'s slides marked draft: the manifest pairs up
  // with the written source exactly because `buildSlideList` skips those
  // positions (`domain/slideList.ts`).
  function applyRenderPayload(payload: RenderPayload, source: string, broken: BrokenSlides = NO_BROKEN_SLIDES): void {
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
        const stripped = stripEditAnnotations(html)
        if (get() !== stripped) set(stripped)
        const [getAnnotated, setAnnotated] = annotatedSignal(key)
        if (getAnnotated() !== html) setAnnotated(html)
      }
      setAssetBaseUrl(payload.assetBaseUrl)
      if (css() !== payload.css) setCss(payload.css)
      if (canvasWidth() !== payload.manifest.canvasWidth) setCanvasWidth(payload.manifest.canvasWidth)
      if (canvasHeight() !== payload.manifest.canvasHeight) setCanvasHeight(payload.manifest.canvasHeight)
      if (renderedSource() !== source) setRenderedSource(source)
      if (brokenSlides().size > 0 || broken.size > 0) setBrokenSlides(broken)
      setSlideLayouts(payload.slideLayouts)
      setHeadingLayouts(payload.headingLayouts)
      const previousSlides = manifest()?.slides ?? []
      setManifest({ ...payload.manifest, slides: stabilizeByKey(previousSlides, payload.manifest.slides) })
      const drafts: Record<number, SectionDraft> = {}
      for (const section of payload.manifest.sections) {
        drafts[section.startIndex] = savedSectionDraft(section)
      }
      setSectionDrafts(drafts)
      if (outcome().kind !== 'rendered') setOutcome({ kind: 'rendered' })
    })
  }

  return {
    assetBaseUrl, canvasWidth, canvasHeight, manifest, outcome, diskRender, markRenderFailed, markDiskRendered, renderedSource, brokenSlides, slideLayouts, headingLayouts, sectionStartByIndex,
    sectionDrafts, setSectionDrafts, sectionDraftOf,
    fragmentSignal, fragmentOf, canvasFragmentOf, previewFragmentOf, applyRenderPayload,
    slideStylesheetText, fontFaceCss,
  }
}
