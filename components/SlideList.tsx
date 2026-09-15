'use client'

import { type Manifest, type ManifestSection, type SectionDraft } from '../domain/render'
import { formatDurationMs } from '../domain/slides'
import { type SlideListEntry } from '../domain/slideList'
import { mountSlideCanvas, observeCanvasScale } from '../dom/slideCanvas'

// Every prop here is a called value or a plain callback (never a signal
// getter or a setter) — see `components/WelcomeScreen.tsx` for the BF044
// rationale and `docs/architecture.md`'s "children never receive a setter"
// rule. This is the largest and most delicate extraction in this stack: the
// `.map()` over `entries` stays entirely inside this one component (rows
// are NOT split into further per-row child components) because
// BarefootJS's compiler fuses a whole `.map()` row's dynamic attributes into
// one shared `createEffect` per row — see the comment above the canvas
// host's own `ref` below for why that fusion is load-bearing here, and
// `todo/archive/studio-tsx-refactoring.md`'s Step 19 entry for why a per-row
// component split was deliberately avoided without a spike to validate it
// first.
export interface SlideListProps {
  manifest: Manifest | null
  /** One row per slide in the deck's own source — drafts included, unlike
   * `manifest.slides` (see `domain/slideList.ts`'s `buildSlideList`). Every
   * index-taking callback below (`onSelectSlide`, `onContextMenu`, ...) is
   * given a row's `sourceIndex`, the same index `Studio.tsx` already keys
   * `editor.slideRanges()`/`currentSlideText`/`selectSlide` by. */
  entries: SlideListEntry[]
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

/** This row's status badge, if any — `draft` wins over `skip` for a
 * rendered slide (mirroring `domain/slideStatus.ts`'s own rule), and a
 * placeholder wears DRAFT exactly when `entry.draft` says so (it never
 * wears SKIP: peitho-core rejects a slide marked both draft and skip, so a
 * placeholder — which only exists because it IS a draft, or because the
 * manifest hasn't caught up yet — is never meaningfully "skipped" too). */
function badgeFor(entry: SlideListEntry): 'draft' | 'skip' | null {
  if (entry.kind === 'placeholder') return entry.draft ? 'draft' : null
  if (entry.slide.skip) return 'skip'
  return null
}

export function SlideList(props: SlideListProps) {
  return (
    <div
      className="shrink-0 flex flex-col border-r border-border min-h-0"
      style={`width: ${String(props.slideListWidth)}px`}
    >
      <div
        className="flex-1 overflow-y-auto p-2"
        // Skip when the click landed inside a row: that row's own
        // `onContextMenu` below already reports the real index, but a
        // `.map()` row's handler compiles to a delegated listener on this
        // very container element, so this directly-authored handler ends
        // up as a *second*, separate listener on that same node —
        // `event.stopPropagation()` in the row's handler can't stop a
        // sibling listener already registered on the same element (see
        // piconic-ai/barefootjs#2930), so this one still runs right after
        // it. Unguarded, it silently overwrote the just-set `on-slide` menu
        // state with `on-empty-space`, which is why Cut/Copy/Delete looked
        // permanently disabled no matter which thumbnail was right-clicked.
        // `closest` only needs to detect *whether* the click was inside a
        // row, not read `data-slide-row`'s value, so it's unaffected by
        // that attribute's own staleness risk after a keyed reorder (see
        // CLAUDE.md's keyed-`.map()` pitfall).
        onContextMenu={e => {
          if ((e.target as Element).closest('[data-slide-row]')) return
          props.onContextMenu(null, e)
        }}
      >
        {props.manifest === null ? (
          <p className="text-sm text-muted-foreground">Open a deck to see its slides.</p>
        ) : (
          // The `.map()` callback below must stay an expression body (a
          // block body is a compile error, BF021 — see CLAUDE.md's
          // BarefootJS pitfalls), so every reference below re-reads
          // `entry.sourceIndex` directly rather than destructuring it into
          // a local first.
          props.entries.map(entry => (
              <div
                key={entry.kind === 'rendered' ? entry.slide.key : entry.key}
                data-slide-row={String(entry.sourceIndex)}
                onMouseDown={props.onDragStart(entry.sourceIndex)}
                onContextMenu={e => props.onContextMenu(entry.sourceIndex, e)}
                className={
                  // `relative z-10` lifts the dragged row above its
                  // siblings while `style`'s `translateY` below carries
                  // it past them — without a stacking order bump it
                  // would slide *under* whichever row it's currently
                  // overlapping instead of visibly floating over it.
                  (props.draggedIndex === entry.sourceIndex ? 'relative z-10 opacity-60 shadow-lg rounded-md ' : '')
                  + (props.draggedIndex !== null && props.dragOverGap === entry.sourceIndex ? 'border-t-2 border-t-primary ' : '')
                  + (props.draggedIndex !== null && entry.sourceIndex === props.entries.length - 1 && props.dragOverGap === entry.sourceIndex + 1 ? 'border-b-2 border-b-primary ' : '')
                  + 'cursor-grab'
                }
                // `scale` lives here instead of a `scale-95` class
                // because `transform` doesn't merge across a class and
                // an inline style — whichever is specified in `style`
                // (higher specificity) replaces the *entire* class-set
                // `transform`, not just adds to it. Combining both into
                // one declaration keeps the existing "lifted" shrink
                // effect alongside the new follow-the-cursor movement.
                style={props.draggedIndex === entry.sourceIndex ? `transform: translateY(${String(props.dragDeltaY)}px) scale(0.95)` : ''}
              >
                {props.sectionStartByIndex[entry.sourceIndex] ? (
                  <div className="flex items-center gap-1 pt-3 pb-1">
                    <input
                      value={props.sectionDrafts[entry.sourceIndex]?.name ?? props.sectionStartByIndex[entry.sourceIndex].name}
                      onInput={e => props.onSectionNameInput(entry.sourceIndex, e.target.value)}
                      onBlur={() => props.onCommitSectionEdit(entry.sourceIndex)}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                      className="min-w-0 flex-1 bg-transparent outline-none text-xs font-semibold text-foreground/80"
                    />
                    <input
                      value={props.sectionDrafts[entry.sourceIndex]?.time ?? formatDurationMs(props.sectionStartByIndex[entry.sourceIndex].plannedDurationMs)}
                      onInput={e => props.onSectionTimeInput(entry.sourceIndex, e.target.value)}
                      onBlur={() => props.onCommitSectionEdit(entry.sourceIndex)}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                      className="w-10 shrink-0 bg-transparent outline-none text-xs text-muted-foreground text-right"
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  title={(entry.kind === 'rendered' ? entry.slide.text.title : entry.title) || `Slide ${String(entry.sourceIndex + 1)}`}
                  onClick={() => props.onSelectSlide(entry.sourceIndex)}
                  className="w-full flex items-start gap-2 mb-2"
                >
                  <span className="w-4 pt-1 text-xs text-muted-foreground shrink-0">{String(entry.sourceIndex + 1)}</span>
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
                      className={props.selectedIndex === entry.sourceIndex
                        ? 'block relative rounded-md overflow-hidden border-4 border-[#eab308] bg-black'
                        : 'block relative rounded-md overflow-hidden border-2 border-border bg-black hover:border-4 hover:border-muted-foreground'}
                      style={`aspect-ratio: ${String(props.canvasWidth)} / ${String(props.canvasHeight)}; box-sizing: content-box`}
                    >
                      {entry.kind === 'rendered' ? (
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
                            const slideKey = entry.slide.key
                            el.dataset.slideCanvasKey = slideKey
                            const canvas = { width: props.canvasWidth, height: props.canvasHeight }
                            mountSlideCanvas(el, props.slideStylesheet(), props.canvasFragmentOf(slideKey), canvas, 'thumbnail')
                            observeCanvasScale(el, canvas)
                          }}
                          className="absolute top-0 right-0 bottom-0 left-0"
                        />
                      ) : (
                        // No fragment exists for this row at all — a draft
                        // slide is excluded from peitho-core's build on
                        // purpose, and a not-yet-rendered one just hasn't
                        // produced one yet — so there's nothing to mount a
                        // canvas onto. Its title (pulled straight from the
                        // raw Markdown, no build required) stands in for a
                        // thumbnail instead of leaving the row blank.
                        <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center p-2 bg-muted">
                          <span className="text-xs text-muted-foreground text-center line-clamp-3">{entry.title || `Slide ${String(entry.sourceIndex + 1)}`}</span>
                        </div>
                      )}
                      {/* Laid over the thumbnail (canvas or placeholder)
                          rather than replacing it, so the slide stays
                          recognizable underneath. */}
                      {badgeFor(entry) !== null ? (
                        <span
                          data-slide-status={badgeFor(entry)}
                          className="absolute top-0 right-0 bottom-0 left-0 flex items-start justify-end p-1 bg-black/40 pointer-events-none"
                        >
                          {/* Both badges share the same subdued, dark
                              treatment — SKIP used to be a solid destructive
                              red, which read as an error/alert rather than
                              an ordinary editorial state, easily the most
                              eye-catching thing on the whole slide list. */}
                          <span className="rounded-sm px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-muted text-foreground">
                            {badgeFor(entry)}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  )
}
