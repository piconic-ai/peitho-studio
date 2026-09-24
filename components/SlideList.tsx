'use client'

import { type Manifest, type ManifestSection, type SectionDraft } from '../domain/render'
import { type DurationPart, formatDurationMs, msToMinutesSeconds } from '../domain/slides'
import { type SlideListEntry } from '../domain/slideList'
import { type RowVisibility } from '../domain/sectionCollapse'
import { mountSlideCanvas, observeCanvasScale } from '../dom/slideCanvas'
import { isFocusMovingWithinSectionHeader, showCanonicalValue } from '../dom/sectionHeader'

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
  /** In-progress name/time of the section that starts at slide
   * `startIndex`, falling back to its saved values (`state/renderStore.ts`'s
   * `sectionDraftOf`). */
  sectionDraftOf: (startIndex: number) => SectionDraft
  /** Which section header (by `sourceIndex`) currently shows its editable
   * spinners instead of its plain collapsed summary — `null` when none do
   * (see `state/uiStore.ts`'s `editingSectionIndex`). */
  editingSectionIndex: number | null
  /** Expands this section header's collapsed summary into its editable
   * name/time spinners. */
  onEditSection: (index: number) => void
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
  /** `value` is the spinner's `valueAsNumber`: NaN when the field is empty
   * or half-typed, and possibly negative, fractional or past 59 seconds.
   * Studio.tsx normalizes it with `withDurationPart`. */
  onSectionTimeInput: (index: number, part: DurationPart, value: number) => void
  onCommitSectionEdit: (index: number) => void
  /** How each row (by `sourceIndex`) shows under the currently collapsed
   * sections (`domain/sectionCollapse.ts`'s `rowVisibilities`) — a
   * section's header row is `header-only` exactly while it is collapsed. */
  rowVisibility: RowVisibility[]
  /** The last row that shows at all (`domain/sectionCollapse.ts`'s
   * `lastVisibleRow` over `rowVisibility`), or `null` when none do. */
  lastVisibleRow: number | null
  /** Collapses, or expands again, the section whose header sits on row
   * `index`. */
  onToggleSectionCollapse: (index: number) => void
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

/** What this row's thumbnail should show: a live canvas keyed off a real
 * slide key (rendered normally, or a placeholder that still has a fragment
 * cached under its `lastRenderedKey` from before it lost its manifest
 * slot), or, only when there's truly nothing to show, a generic title-only
 * box. Checking `canvasFragmentOf(key) !== ''` rather than just
 * `lastRenderedKey !== null` matters for a placeholder that's never been
 * rendered under its key at all (a brand-new slide created already marked
 * draft) — `state/renderStore.ts`'s per-key fragment signal defaults to
 * `''` for a key it has never seen, and mounting an empty fragment would
 * leave the canvas host looking identical to an actual empty slide instead
 * of falling back to this row's title. */
function canvasSourceFor(entry: SlideListEntry, canvasFragmentOf: (key: string) => string): { key: string } | null {
  if (entry.kind === 'rendered') return { key: entry.slide.key }
  if (entry.lastRenderedKey !== null && canvasFragmentOf(entry.lastRenderedKey) !== '') return { key: entry.lastRenderedKey }
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
                  // The gap after the whole list is marked on the last row
                  // that shows at all: the very last row may sit inside a
                  // collapsed section.
                  + (props.draggedIndex !== null && props.dragOverGap === props.entries.length && entry.sourceIndex === props.lastVisibleRow ? 'border-b-2 border-b-primary ' : '')
                  // A collapsed section's rows stay mounted and are only
                  // hidden: unmounting and remounting a row's canvas host
                  // runs into piconic-ai/barefootjs#2927/#3009 (see
                  // CLAUDE.md). A hidden row has an all-zero bounding box,
                  // so `dom/dragGesture.ts`'s `gapUnderCursor` never picks
                  // it as a drop gap.
                  + (props.rowVisibility[entry.sourceIndex] === 'hidden' ? 'hidden ' : '')
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
                  <div className="flex items-center gap-1">
                    {/* Folds the section's slides away (or back) — separate
                        from the summary button beside it, which opens the
                        header's name/time editor instead. */}
                    <button
                      type="button"
                      aria-label={props.rowVisibility[entry.sourceIndex] === 'header-only' ? 'Expand section' : 'Collapse section'}
                      aria-expanded={props.rowVisibility[entry.sourceIndex] === 'header-only' ? 'false' : 'true'}
                      onClick={() => props.onToggleSectionCollapse(entry.sourceIndex)}
                      className="shrink-0 w-4 pt-3 pb-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {props.rowVisibility[entry.sourceIndex] === 'header-only' ? '▸' : '▾'}
                    </button>
                    <div className="min-w-0 flex-1">
                      {props.editingSectionIndex === entry.sourceIndex ? (
                        // The time is edited with two number spinners instead of
                        // free text in peitho's `1m30s` format, so no input can
                        // produce a time peitho rejects (see `domain/slides.ts`'s
                        // `withDurationPart`). The header saves — and collapses
                        // back to its plain summary below — once focus leaves
                        // it, not on each input's own blur (see
                        // `isFocusMovingWithinSectionHeader`).
                        <div data-section-header="" className="flex items-center gap-1 pt-3 pb-1">
                          <input
                            aria-label="Section name"
                            // Mounts focused: entering edit mode is a deliberate
                            // click, so the name field is ready to type in
                            // immediately rather than making that click's own
                            // target (the collapsed summary button below) also
                            // double as a focus target to aim for.
                            ref={el => el.focus()}
                            value={props.sectionDraftOf(entry.sourceIndex).name}
                            onInput={e => props.onSectionNameInput(entry.sourceIndex, e.target.value)}
                            onBlur={e => { if (!isFocusMovingWithinSectionHeader(e)) props.onCommitSectionEdit(entry.sourceIndex) }}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                            className="min-w-0 flex-1 bg-transparent outline-none text-xs font-semibold text-foreground/80"
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            aria-label="Section minutes"
                            value={String(msToMinutesSeconds(props.sectionDraftOf(entry.sourceIndex).timeMs).minutes)}
                            onInput={e => props.onSectionTimeInput(entry.sourceIndex, 'minutes', e.target.valueAsNumber)}
                            onChange={e => showCanonicalValue(e.target, String(msToMinutesSeconds(props.sectionDraftOf(entry.sourceIndex).timeMs).minutes))}
                            onBlur={e => { if (!isFocusMovingWithinSectionHeader(e)) props.onCommitSectionEdit(entry.sourceIndex) }}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                            className="w-10 shrink-0 bg-transparent outline-none text-xs text-muted-foreground text-right"
                          />
                          <span className="shrink-0 text-xs text-muted-foreground">m</span>
                          {/* No `min`/`max` on the seconds spinner, so its arrows
                              step past 59 and below 0 and carry into or borrow
                              from the minutes. */}
                          <input
                            type="number"
                            step="1"
                            aria-label="Section seconds"
                            value={String(msToMinutesSeconds(props.sectionDraftOf(entry.sourceIndex).timeMs).seconds)}
                            onInput={e => props.onSectionTimeInput(entry.sourceIndex, 'seconds', e.target.valueAsNumber)}
                            onChange={e => showCanonicalValue(e.target, String(msToMinutesSeconds(props.sectionDraftOf(entry.sourceIndex).timeMs).seconds))}
                            onBlur={e => { if (!isFocusMovingWithinSectionHeader(e)) props.onCommitSectionEdit(entry.sourceIndex) }}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                            className="w-10 shrink-0 bg-transparent outline-none text-xs text-muted-foreground text-right"
                          />
                          <span className="shrink-0 text-xs text-muted-foreground">s</span>
                        </div>
                      ) : (
                        // Collapsed by default: the native spinner arrows
                        // permanently sitting in an otherwise plain list read as
                        // an unstyled form, not a slide list, so they only
                        // appear once someone actually asks to edit this header.
                        <button
                          type="button"
                          aria-label="Edit section name and time"
                          onClick={() => props.onEditSection(entry.sourceIndex)}
                          className="w-full flex items-center gap-1 pt-3 pb-1 text-left"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground/80">
                            {props.sectionDraftOf(entry.sourceIndex).name}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDurationMs(props.sectionDraftOf(entry.sourceIndex).timeMs)}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  title={(entry.kind === 'rendered' ? entry.slide.text.title : entry.title) || `Slide ${String(entry.sourceIndex + 1)}`}
                  onClick={() => props.onSelectSlide(entry.sourceIndex)}
                  // `hidden` replaces the layout classes rather than joining
                  // them: `hidden` and `flex` both set `display`, and which
                  // one wins would come down to their order in UnoCSS's
                  // output.
                  className={(props.rowVisibility[entry.sourceIndex] ?? 'full') === 'full' ? 'w-full flex items-start gap-2 mb-2' : 'hidden'}
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
                      {canvasSourceFor(entry, props.canvasFragmentOf) !== null ? (
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
                          // here — a placeholder showing its `lastRenderedKey`'s
                          // cached fragment is deliberately *not* patched (that
                          // effect only walks `manifest().slides`), so it stays
                          // frozen at whatever was last rendered instead of
                          // reacting to edits peitho-core never applied to it.
                          ref={el => {
                            const source = canvasSourceFor(entry, props.canvasFragmentOf)
                            if (!source) return
                            el.dataset.slideCanvasKey = source.key
                            const canvas = { width: props.canvasWidth, height: props.canvasHeight }
                            mountSlideCanvas(el, props.slideStylesheet(), props.canvasFragmentOf(source.key), canvas, 'thumbnail')
                            observeCanvasScale(el, canvas)
                          }}
                          className="absolute top-0 right-0 bottom-0 left-0"
                        />
                      ) : (
                        // Truly nothing to show: a draft (or not-yet-rendered)
                        // slide with no fragment ever cached under its key —
                        // peitho-core has never produced one. Its title
                        // (pulled straight from the raw Markdown, no build
                        // required) stands in for a thumbnail instead of
                        // leaving the row blank.
                        <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center p-2 bg-muted">
                          <span className="text-xs text-muted-foreground text-center line-clamp-3">{entry.kind === 'placeholder' ? (entry.title || `Slide ${String(entry.sourceIndex + 1)}`) : ''}</span>
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
