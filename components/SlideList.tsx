'use client'

import { type Manifest, type ManifestSection, type SectionDraft } from '../domain/render'
import { formatDurationMs } from '../domain/slides'
import { mountSlideCanvas, observeCanvasScale } from '../dom/slideCanvas'

// Every prop here is a called value or a plain callback (never a signal
// getter or a setter) — see `components/WelcomeScreen.tsx` for the BF044
// rationale and `docs/architecture.md`'s "children never receive a setter"
// rule. This is the largest and most delicate extraction in this stack: the
// `.map()` over `manifest.slides` stays entirely inside this one component
// (rows are NOT split into further per-row child components) because
// BarefootJS's compiler fuses a whole `.map()` row's dynamic attributes into
// one shared `createEffect` per row — see the comment above the thumbnail
// iframe's own `ref` below for why that fusion is load-bearing here, and
// `todo/archive/studio-tsx-refactoring.md`'s Step 19 entry for why a per-row
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
  slideStylesheet: () => CSSStyleSheet
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
                    {/* `aspect-ratio` and the border must stay on the same
                        (inner) span: the canvas host below fills it via
                        `top/right/bottom/left: 0`, and `observeCanvasScale`
                        measures that same span's `contentRect` — splitting
                        them across the two spans would size/measure against
                        different content-boxes (the outer span has no
                        border of its own to subtract). */}
                    <span className="block relative rounded-md overflow-hidden">
                    <span
                      className={props.selectedIndex === i
                        ? 'block relative rounded-md border-4 border-[#eab308] bg-black'
                        : 'block relative rounded-md border-2 border-border bg-black hover:border-4 hover:border-muted-foreground'}
                      style={`aspect-ratio: ${String(props.canvasWidth)} / ${String(props.canvasHeight)}; box-sizing: content-box`}
                    >
                      <div
                        // A `ref` callback (not reactive JSX attributes)
                        // for the same reason the iframe version used one:
                        // this row's whole `.map()` iteration shares one
                        // `createEffect`, so a reactive binding here would
                        // re-run — and, for the initial mount call, re-fetch
                        // a stale `fragmentOf` snapshot — on every sibling
                        // edit. Later content updates flow through
                        // `patchSlideCanvas` (Studio.tsx's always-tracked
                        // effect), found via `data-slide-canvas-key`.
                        ref={el => {
                          el.dataset.slideCanvasKey = slide.key
                          const canvas = { width: props.canvasWidth, height: props.canvasHeight }
                          mountSlideCanvas(el, props.slideStylesheet(), props.fragmentOf(slide.key), canvas)
                          observeCanvasScale(el, canvas)
                        }}
                        className="absolute top-0 right-0 bottom-0 left-0"
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
