'use client'

import { type Manifest, type ManifestSection, type SectionDraft } from '../domain/render'
import { formatDurationMs } from '../domain/slides'

// Every prop here is a called value or a plain callback (never a signal
// getter or a setter) — see `components/WelcomeScreen.tsx` for the BF044
// rationale and `docs/architecture.md`'s "children never receive a setter"
// rule. This is the largest and most delicate extraction in this stack: the
// `.map()` over `manifest.slides` stays entirely inside this one component
// (rows are NOT split into further per-row child components) because
// BarefootJS's compiler fuses a whole `.map()` row's dynamic attributes into
// one shared `createEffect` per row — see the comment above the thumbnail
// iframe's own `ref` below for why that fusion is load-bearing here, and
// `todo/studio-tsx-refactoring.md`'s Step 19 entry for why a per-row
// component split was deliberately avoided without a spike to validate it
// first.
export interface SlideListProps {
  manifest: Manifest | null
  slideListWidth: number
  draggedIndex: number | null
  dragOverGap: number | null
  dragDeltaY: number
  selectedIndex: number | null
  sectionStartByIndex: Record<number, ManifestSection>
  sectionDrafts: Record<number, SectionDraft>
  canvasWidth: number
  canvasHeight: number
  fragmentOf: (key: string) => string
  buildSlideDoc: (fragmentHtml: string) => string
  onContextMenu: (index: number | null, event: MouseEvent) => void
  onDragStart: (index: number) => (event: MouseEvent) => void
  onSelectSlide: (index: number) => void
  onSectionNameInput: (index: number, value: string) => void
  onSectionTimeInput: (index: number, value: string) => void
  onCommitSectionEdit: (index: number) => void
}

export function SlideList(props: SlideListProps) {
  return (
    <div
      className="shrink-0 flex flex-col border-r border-border min-h-0"
      style={`width: ${String(props.slideListWidth)}px`}
    >
      <div className="flex-1 overflow-y-auto p-2" onContextMenu={e => props.onContextMenu(null, e)}>
        {props.manifest === null ? (
          <p className="text-sm text-muted-foreground">Open a deck to see its slides.</p>
        ) : (
          props.manifest.slides.map((slide, i) => (
              <div
                key={slide.key}
                data-slide-row={String(i)}
                onMouseDown={props.onDragStart(i)}
                onContextMenu={e => props.onContextMenu(i, e)}
                className={
                  // `relative z-10` lifts the dragged row above its
                  // siblings while `style`'s `translateY` below carries
                  // it past them — without a stacking order bump it
                  // would slide *under* whichever row it's currently
                  // overlapping instead of visibly floating over it.
                  (props.draggedIndex === i ? 'relative z-10 opacity-60 shadow-lg rounded-md ' : '')
                  + (props.draggedIndex !== null && props.dragOverGap === i ? 'border-t-2 border-t-primary ' : '')
                  + (props.draggedIndex !== null && i === props.manifest!.slides.length - 1 && props.dragOverGap === i + 1 ? 'border-b-2 border-b-primary ' : '')
                  + 'cursor-grab'
                }
                // `scale` lives here instead of a `scale-95` class
                // because `transform` doesn't merge across a class and
                // an inline style — whichever is specified in `style`
                // (higher specificity) replaces the *entire* class-set
                // `transform`, not just adds to it. Combining both into
                // one declaration keeps the existing "lifted" shrink
                // effect alongside the new follow-the-cursor movement.
                style={props.draggedIndex === i ? `transform: translateY(${String(props.dragDeltaY)}px) scale(0.95)` : ''}
              >
                {props.sectionStartByIndex[i] ? (
                  <div className="flex items-center gap-1 pt-3 pb-1">
                    <input
                      value={props.sectionDrafts[i]?.name ?? props.sectionStartByIndex[i].name}
                      onInput={e => props.onSectionNameInput(i, e.target.value)}
                      onBlur={() => props.onCommitSectionEdit(i)}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                      className="min-w-0 flex-1 bg-transparent outline-none text-xs font-semibold text-foreground/80"
                    />
                    <input
                      value={props.sectionDrafts[i]?.time ?? formatDurationMs(props.sectionStartByIndex[i].plannedDurationMs)}
                      onInput={e => props.onSectionTimeInput(i, e.target.value)}
                      onBlur={() => props.onCommitSectionEdit(i)}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                      className="w-10 shrink-0 bg-transparent outline-none text-xs text-muted-foreground text-right"
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  title={slide.text.title || `Slide ${String(i + 1)}`}
                  onClick={() => props.onSelectSlide(i)}
                  className="w-full flex items-start gap-2 mb-2"
                >
                  <span className="w-4 pt-1 text-xs text-muted-foreground shrink-0">{String(i + 1)}</span>
                  {/* A semi-transparent hover border color (e.g. `border-foreground/40`)
                      paints over this element's *own* `bg-black` — CSS backgrounds clip
                      under the border area by default — so it looked black instead of
                      gray. `muted-foreground` is used solid (no alpha) to avoid that. */}
                  <span className="flex-1 flex flex-col gap-0.5 min-w-0">
                    {/* This outer span exists purely to clip — no border, no
                        background, no size of its own (it's a plain
                        `block`, so it just fills the available width and
                        auto-heights to match its one normal-flow child,
                        exactly like the inner span used to on its own).
                        The iframe's own size sync (below) is a
                        `ResizeObserver` callback reacting to the *inner*
                        span's box, so for a brief window after mount —
                        before that box has settled into its final layout
                        (e.g. while a sibling row's text is still being
                        laid out) — the iframe can be sized against a
                        stale rect and briefly overshoot. With
                        `overflow-hidden` on the inner span itself (the
                        previous approach), that overshoot was contained,
                        but so was the corner-repaint overlay's ring (see
                        below) — it clips at the *content* edge, inside
                        the border, cutting the ring off before it could
                        cover the corner seam. Splitting the clip out to
                        this borderless outer span clips at what is now
                        the outer span's own outer edge instead — which
                        coincides exactly with the inner span's own outer
                        (border-box) edge, since the outer span has no
                        border/padding of its own to offset it — so both
                        problems are covered: transient overshoot never
                        escapes the card, and the ring can still freely
                        reach the border area. Confirmed via a repro
                        loop: an intermittent black line under "New
                        Slide" thumbnails shortly after mount, gone by
                        the time layout settled — consistent with
                        exactly this race.
                        IMPORTANT: `aspect-ratio` + the border must stay
                        on the *same* (inner) span. Splitting them here
                        once — aspect-ratio on the outer span, border on
                        the inner — silently reintroduced the original
                        border-box-vs-content-box bug this file's first
                        commit fixed: the outer span's content-box (with
                        no border of its own to subtract) matched the
                        canvas ratio, but that's not the box the iframe
                        actually needs to fit — the *inner* span's
                        content-box (canvas ratio minus the border it
                        alone carries) is, and the two aren't the same
                        box. Caught via pixel measurement: a uniform 6px
                        gap on both the left *and* right straight edges,
                        not just the corners. */}
                    <span className="block relative rounded-md overflow-hidden">
                    <span
                      className={props.selectedIndex === i
                        ? 'block relative rounded-md border-4 border-[#eab308] bg-black'
                        : 'block relative rounded-md border-2 border-border bg-black hover:border-4 hover:border-muted-foreground'}
                      style={`aspect-ratio: ${String(props.canvasWidth)} / ${String(props.canvasHeight)}; box-sizing: content-box`}
                    >
                      <iframe
                        title={`Slide ${String(i + 1)}`}
                        ref={el => {
                          // `data-slide-preview-key`/`srcdoc` are set here
                          // (once, at row creation) instead of as ordinary
                          // reactive JSX attributes — `title` above shares a
                          // *single* effect with every other dynamic binding
                          // on this row (confirmed via `bf debug graph`:
                          // they all report the same slot ID), because this
                          // compiler fuses a whole `.map()` row's dynamic
                          // attributes into one `createEffect`. Editing this
                          // row's own text legitimately changes its `slide`
                          // object reference (only *unchanged* rows get a
                          // stabilized reference — see `stabilizeByKey`),
                          // which reruns that *entire* shared effect — so
                          // even a `srcdoc={untrack(() => ...)}` binding
                          // still gets *recomputed and reassigned* every
                          // keystroke, since `untrack` only stops a read
                          // from registering a *new* subscription, not the
                          // expression from being re-evaluated when the
                          // effect reruns for an unrelated sibling
                          // binding's sake. A `ref` callback, by contrast,
                          // runs exactly once at creation — confirmed by an
                          // isolated repro where a sibling reactive text
                          // binding re-rendered 6 times while a `ref`-set
                          // value never changed — so it's immune to that
                          // shared effect entirely. Later content updates
                          // still flow through `patchSlidePreviewIframes`
                          // (a separate, always-tracked effect below),
                          // which finds this element via the very
                          // `data-slide-preview-key` attribute set here.
                          el.dataset.slidePreviewKey = slide.key
                          const iframeEl = el as HTMLIFrameElement
                          iframeEl.srcdoc = props.buildSlideDoc(props.fragmentOf(slide.key))
                          // Three root-caused-from-real-data attempts
                          // before this one (all via Cmd+Shift+D
                          // snapshots against the actual WKWebView):
                          // `h-full` (height:100%) came out one
                          // border-width too tall; `absolute inset-0`
                          // didn't apply at all (the CSS `inset`
                          // shorthand went unrecognized); `absolute` with
                          // explicit `top/right/bottom/left` and no
                          // width/height turned out to be spec-correct,
                          // unhelpful behavior, not a bug — CSS2.1
                          // §10.3.8 says an absolutely positioned
                          // *replaced* element (an <iframe> is one) with
                          // `width`/`height: auto` uses its *intrinsic*
                          // size (300x150 for an iframe) regardless of
                          // what top/right/bottom/left resolve to; the
                          // snapshot confirmed exactly that. None of
                          // these are reproducible in Chromium (which
                          // this repo can test), so each got shipped on
                          // real-device data rather than a guess, and
                          // each still turned out wrong — CSS sizing of
                          // this element clearly isn't trustworthy here
                          // by any means tried so far.
                          // This drops CSS out of the loop entirely:
                          // `clientWidth`/`clientHeight` are DOM
                          // properties, not CSS, and are unambiguously
                          // defined as the wrapper's content-box size —
                          // no percentage/aspect-ratio/replaced-element
                          // resolution involved. Set once at mount and
                          // re-synced on any resize of the wrapper (the
                          // slide-list panel's own width is
                          // user-draggable) via ResizeObserver.
                          //
                          // Sizing the iframe to the *raw* content-box
                          // (clientWidth x clientHeight directly) left a
                          // final, tiny residual: the wrapper's own
                          // aspect-ratio is locked to the canvas ratio
                          // at its *border-box*, but subtracting a fixed
                          // border width from both dimensions of a
                          // 16:9-ish box doesn't preserve 16:9 exactly
                          // (confirmed in a debug snapshot: a 1px sliver
                          // of the iframe's own black background,
                          // visible only on the thicker border-4 case,
                          // where the drift is large enough to round up
                          // to a whole pixel). Instead of sizing the
                          // iframe to the content-box and letting
                          // previewDoc.ts's own fit() paper over the
                          // mismatch, compute the largest canvas-ratio
                          // box that fits the content-box and center it
                          // directly — the iframe's own aspect ratio
                          // then matches the canvas exactly, so fit()'s
                          // Math.min never has anything to reconcile.
                          const wrapperEl = iframeEl.parentElement
                          if (wrapperEl) {
                            const syncIframeSize = (entries?: ResizeObserverEntry[]) => {
                              // clientWidth/clientHeight round to the
                              // nearest integer (per spec) — with the
                              // wrapper's content-box already exactly
                              // canvas-ratio (box-sizing: content-box
                              // above), that rounding was the last
                              // source of a ~1px residual gap. The
                              // sub-pixel-precise sources are the
                              // ResizeObserver entry's `contentRect`
                              // (preferred) and getBoundingClientRect()
                              // (initial call only, before any entry
                              // exists).
                              //
                              // `contentRect` over getBoundingClientRect()
                              // is load-bearing, not a style choice:
                              // getBoundingClientRect() is in *viewport*
                              // space, so it bakes in every ancestor
                              // transform — and during a drag-reorder
                              // this row carries `scale(0.95)` (see the
                              // row's `style`). A `:hover` flicker on the
                              // wrapper mid-drag (its border toggles
                              // 2px<->4px, so its content-box changes and
                              // this observer fires) then measured the
                              // wrapper 5% too small and sized the iframe
                              // to that — in the row's *own*, untransformed
                              // coordinate space, where the 5% is real.
                              // Nothing fires again once the transform is
                              // cleared on drop (transforms don't touch
                              // layout), so the undersized iframe stuck,
                              // leaving a black band along its right/
                              // bottom edge. The observer entry reports
                              // layout-space (pre-transform) CSS px, which
                              // is exactly the space this element's own
                              // `width`/`height` are set in. Reproduced
                              // step by step in a standalone page: the
                              // entry read 232x130.5 while the rect read
                              // 228x131.6 for the same box under
                              // scale(0.95).
                              const cs = getComputedStyle(wrapperEl)
                              const borderLeft = parseFloat(cs.borderLeftWidth) || 0
                              const borderRight = parseFloat(cs.borderRightWidth) || 0
                              const borderTop = parseFloat(cs.borderTopWidth) || 0
                              const borderBottom = parseFloat(cs.borderBottomWidth) || 0
                              let availW: number
                              let availH: number
                              const contentRect = entries?.[0]?.contentRect
                              if (contentRect) {
                                availW = contentRect.width
                                availH = contentRect.height
                              } else {
                                const rect = wrapperEl.getBoundingClientRect()
                                availW = rect.width - borderLeft - borderRight
                                availH = rect.height - borderTop - borderBottom
                              }
                              // A detached or display:none wrapper
                              // measures 0x0; sizing against that would
                              // collapse the iframe to its overscan alone.
                              // The observer fires again with real numbers
                              // as soon as it's rendered, so just wait.
                              if (availW <= 0 || availH <= 0) return
                              const scale = Math.min(availW / props.canvasWidth, availH / props.canvasHeight)
                              const w = props.canvasWidth * scale
                              const h = props.canvasHeight * scale
                              // Deliberately render the iframe a few px
                              // *larger* than the exact-fit box (and
                              // recentered), then use `clip-path` to
                              // crop it back down to that exact box.
                              // An exact-fit iframe left a persistent
                              // black wedge at each rounded corner even
                              // once every straight edge measured
                              // pixel-perfect (confirmed via zoomed
                              // screenshot pixel measurement, and ruled
                              // out the slide theme's own CSS as the
                              // cause — peitho.css has no border-radius
                              // anywhere). That corner-only symptom
                              // matches a sub-pixel shortfall too small
                              // to darken a straight-edge pixel but
                              // still large enough to show at a curve.
                              // previewDoc.ts's own fit() script hit
                              // the same class of WebKit sub-pixel
                              // rounding gap and already papers over it
                              // with a 1.02x overscan — this is that
                              // same fix applied one level out, sized
                              // in real px instead of a ratio since the
                              // amount to cover here is constant
                              // (governed by the browser's own rounding
                              // granularity, not by the box size).
                              const overscan = 3
                              iframeEl.style.width = `${String(w + overscan * 2)}px`
                              iframeEl.style.height = `${String(h + overscan * 2)}px`
                              // NOT `borderLeft + ...` — an absolutely
                              // positioned element's `left`/`top` are
                              // already relative to the containing
                              // block's *padding* edge (just inside the
                              // border), so adding the border width
                              // again double-counts it, shifting the
                              // iframe down-right by a full border
                              // width (confirmed the hard way: produced
                              // a lopsided gap at the top-left only).
                              iframeEl.style.left = `${String((availW - w) / 2 - overscan)}px`
                              iframeEl.style.top = `${String((availH - h) / 2 - overscan)}px`
                              // WebKit gives an <iframe> its own
                              // compositing layer, which doesn't
                              // reliably honor the wrapper's
                              // `overflow:hidden` + `border-radius`
                              // clip, so the iframe needs its own
                              // `clip-path` regardless of the overscan
                              // above. It must use the *inner* radius —
                              // the wrapper's own border-radius is
                              // defined for its outer (border-box)
                              // edge, while the visible box sits inset
                              // from that edge by the border width, so
                              // reusing the outer radius directly
                              // overshoots — and must inset by
                              // `overscan` to crop the iframe's own
                              // enlarged box back down to that exact
                              // visible box.
                              // No rounding on this clip: the overlay
                              // div below repaints the wrapper's border
                              // on top of the iframe, and its own inner
                              // curve (governed by the browser's own,
                              // always-precise self-painted
                              // border-radius, not a second independent
                              // clip-path) is what actually determines
                              // the visible rounded shape. A square
                              // iframe corner sitting at the border
                              // inset is always safely inside that
                              // overlay ring's outer curve, so it's
                              // fully masked regardless.
                              iframeEl.style.clipPath = `inset(${String(overscan)}px)`
                            }
                            syncIframeSize()
                            // KNOWN ISSUE, not yet fixed: a repro loop
                            // reproducibly leaves a handful of scattered
                            // rows (different ones each run, no content/
                            // position pattern) with a black gap below
                            // the card that a manual resize of the
                            // slide-list column always clears. That
                            // looked at first like a stale-measurement
                            // race, but a Cmd+Shift+D debug snapshot
                            // ruled it out: on an affected row, the
                            // wrapper rect, iframe rect/style, and even
                            // the iframe's *own* internal `.peitho-slide`
                            // transform were byte-for-byte identical to
                            // a clean row's — every number our JS reads
                            // or writes was already correct, and
                            // re-running `syncIframeSize` (tried up to
                            // 2s later, well past any layout-settling
                            // race) reproducibly changed nothing. That
                            // points at the *paint*, not the geometry —
                            // WebKit gives this iframe its own
                            // compositing layer (already the reason it
                            // needs its own `clip-path` rather than
                            // trusting an ancestor's `overflow:hidden`),
                            // and for some subset of layers that paint
                            // apparently goes stale independent of the
                            // underlying values. A forced-repaint nudge
                            // (briefly perturbing `style.width` via
                            // `calc()` then restoring it) was tried here
                            // and made things *worse* — every thumbnail
                            // went solid black — so that specific
                            // approach is ruled out, not just untested.
                            new ResizeObserver(syncIframeSize).observe(wrapperEl)
                          }
                        }}
                        // clip-path (the correct, border-inset-adjusted
                        // radius) is set imperatively in the ref
                        // callback's syncIframeSize above, alongside
                        // the size/position it also depends on.
                        className="border-0 rounded-md"
                        style="position: absolute; pointer-events: none"
                      />
                      {/* `pointer-events: none` on the iframe above keeps normal
                          clicks/drags passing through to the row beneath, but
                          WKWebView still routes a right-click landing on the
                          iframe to its own native "Open Frame in New Window"
                          menu regardless — this fully transparent, ordinary
                          (non-`pointer-events:none`) overlay blocks the iframe
                          from ever being the event target at all, so both
                          clicks and right-clicks always bubble from here up to
                          the row/button instead.
                          It also repaints the wrapper's own border on top of
                          the iframe — since this sits after the iframe in DOM
                          order, it paints over it, unlike the wrapper's own
                          border (painted before/under any absolutely positioned
                          child per CSS stacking order). Getting the iframe's
                          own clip-path to land *exactly* on the wrapper's
                          native border-radius curve, pixel for pixel, turned
                          out not to be reliably achievable — the two are
                          independent WebKit rendering/anti-aliasing paths and
                          kept leaving a faint 1px seam even once the radius
                          math was right (confirmed via pixel measurement).
                          Painting an identical border on top sidesteps that
                          entirely — it doesn't matter whether the iframe's edge
                          lands a sub-pixel off, this covers it either way.
                          Its border *look* (style/width/color/radius) is
                          plain CSS `inherit` from the wrapper, so it tracks
                          every wrapper change at style-resolution time with
                          no JS in the loop. Only its *placement* is
                          imperative (in the ref below): it has to sit on the
                          wrapper's border-box, but an absolutely positioned
                          child's insets are measured from the wrapper's
                          *padding* edge (inside the border) — `top-0 right-0
                          bottom-0 left-0` would paint a second ring further
                          inward, not over the original — so each inset is
                          pulled outward by that side's own border width.
                          Those insets only need updating when the border
                          width changes, and a width change always shrinks/
                          grows the wrapper's content-box, which is exactly
                          what the ResizeObserver below fires on.
                          Why not copy the color/width from computed style
                          in that same observer callback (the previous
                          approach)? Because the observer only fires on a
                          content-box *size* change, and two of this
                          wrapper's state transitions change the border
                          color without changing its width: hovered-
                          unselected (`hover:border-4`, 4px gray) ->
                          selected (`border-4`, 4px yellow), and the
                          reverse. A click-to-select is always the former
                          (the cursor is on the card), and so is a
                          drag-reorder's drop: the dragged card stays
                          `:hover` through the drop (no mousemove happens
                          between release and the reorder landing), then
                          becomes the selection. The copied gray stuck on
                          top of the new yellow border — and, when a hover
                          flicker mid-drag had also re-run the copy while
                          the row was `scale(0.95)` (see `syncIframeSize`
                          for that getBoundingClientRect trap), stuck at 95%
                          size too: the "smaller gray ring nested inside the
                          yellow border" seen after a drop. Reproduced and
                          confirmed fixed in a standalone page driven
                          through the same hover/transform/class sequence. */}
                      <div
                        ref={el => {
                          const overlayEl = el as HTMLDivElement
                          const wrapperEl = overlayEl.parentElement
                          if (!wrapperEl) return
                          overlayEl.style.borderStyle = 'inherit'
                          overlayEl.style.borderWidth = 'inherit'
                          overlayEl.style.borderColor = 'inherit'
                          overlayEl.style.borderRadius = 'inherit'
                          // Four negative insets and no explicit width/
                          // height: a non-replaced absolutely positioned
                          // box with all four insets set stretches to fill
                          // them (CSS2.1 §10.3.7/§10.6.4), landing exactly
                          // on the wrapper's border-box with sub-pixel
                          // accuracy and no measurement at all — so no
                          // getBoundingClientRect(), and no way for the
                          // dragged row's transform to leak into these
                          // numbers. (The individual physical properties,
                          // not the `inset` shorthand — that shorthand
                          // doesn't apply in this WKWebView.)
                          const syncOverlay = () => {
                            const cs = getComputedStyle(wrapperEl)
                            overlayEl.style.top = `-${cs.borderTopWidth}`
                            overlayEl.style.right = `-${cs.borderRightWidth}`
                            overlayEl.style.bottom = `-${cs.borderBottomWidth}`
                            overlayEl.style.left = `-${cs.borderLeftWidth}`
                          }
                          syncOverlay()
                          new ResizeObserver(syncOverlay).observe(wrapperEl)
                        }}
                        className="absolute box-border"
                      />
                    </span>
                    </span>
                    {slide.skip ? <span className="text-xs text-destructive">skip</span> : null}
                  </span>
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  )
}
