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
// one shared `createEffect` per row — see the comment above the canvas
// host's own `ref` below for why that fusion is load-bearing here, and
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
  /** Pre-absolutized fragment HTML for `key` — a shadow root has no `<base
   * href>`, so this must already have its `src="assets/..."` resolved
   * (see `state/renderStore.ts`'s `canvasFragmentOf`, which this is always
   * meant to be). */
  canvasFragmentOf: (key: string) => string
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
                    {/* `aspect-ratio`, the border and `overflow-hidden` all
                        belong on this one span: the canvas host fills its
                        *content* box (`top/right/bottom/left: 0`), which is
                        the box `aspect-ratio` locks to the canvas only
                        because `box-sizing: content-box` keeps the border
                        out of it, and the host's own corners are square, so
                        without a rounded clip here the slide would poke
                        through the border's inner curve. */}
                    <span
                      className={props.selectedIndex === i
                        ? 'block relative rounded-md overflow-hidden border-4 border-[#eab308] bg-black'
                        : 'block relative rounded-md overflow-hidden border-2 border-border bg-black hover:border-4 hover:border-muted-foreground'}
                      style={`aspect-ratio: ${String(props.canvasWidth)} / ${String(props.canvasHeight)}; box-sizing: content-box`}
                    >
                      <div
                        // A `ref` callback rather than reactive JSX
                        // attributes: this row's whole `.map()` iteration
                        // shares one `createEffect`, so a binding here would
                        // re-run — re-mounting the canvas from a stale
                        // `canvasFragmentOf` snapshot — on every *sibling* edit. A
                        // `ref` runs exactly once, at creation; later content
                        // updates arrive through `patchSlideCanvas`
                        // (Studio.tsx's always-tracked effect), which finds
                        // this element by the `data-slide-canvas-key` set
                        // here.
                        ref={el => {
                          el.dataset.slideCanvasKey = slide.key
                          const canvas = { width: props.canvasWidth, height: props.canvasHeight }
                          mountSlideCanvas(el, props.slideStylesheet(), props.canvasFragmentOf(slide.key), canvas, 'thumbnail')
                          observeCanvasScale(el, canvas)
                        }}
                        className="absolute top-0 right-0 bottom-0 left-0"
                      />
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
