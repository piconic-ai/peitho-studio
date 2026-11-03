'use client'

import { type ManifestSection, type SectionDraft } from '../domain/render'
import { type DurationPart } from '../domain/slides'
import { type SlideListEntry } from '../domain/slideList'
import { type RowVisibility } from '../domain/sectionCollapse'
import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import { commentKeyOf } from '../domain/reviewComment'
import { mountSlideCanvas, observeCanvasScale } from '../dom/slideCanvas'
import { SlideSectionHeader } from './SlideSectionHeader'
import { SlideStatusOverlay } from './SlideStatusOverlay'
import { slideRowClass } from './slideRow'

// Every prop here is a called value or a plain callback (never a signal
// getter or a setter) — see `components/WelcomeScreen.tsx` for the BF044
// rationale and `docs/architecture.md`'s "children never receive a setter"
// rule. Row identity, drag handling, visibility and canvas mounting stay
// together in the keyed map; section controls own only header presentation.
export interface SlideListProps {
  /** The UI language every label here is shown in. */
  language: Language
  /** Whether a deck is open at all — the rows show for one that is, even
   * when it doesn't build yet (then every row is a placeholder, see
   * `domain/slideList.ts`); without one, a hint to open a deck. */
  deckOpen: boolean
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
  /** How many comments for the agent the slide filed under `key` has
   * (`domain/reviewComment.ts`'s `commentKeyOf`). */
  commentCountOf: (key: string) => number
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
    // `flex-1 min-h-0`, not `shrink-0`: the slides panel lays this out in a
    // column, so it must take the panel's height and let the inner list
    // scroll, rather than grow to fit every thumbnail and spill over the
    // error and status bars below.
    <div
      className="flex-1 flex flex-col border-r border-border min-h-0"
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
        {!props.deckOpen ? (
          <p className="text-sm text-muted-foreground">{messagesFor(props.language).openDeckToSeeSlides}</p>
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
                className={slideRowClass({
                  index: entry.sourceIndex,
                  draggedIndex: props.draggedIndex,
                  dragOverGap: props.dragOverGap,
                  entryCount: props.entries.length,
                  lastVisibleRow: props.lastVisibleRow,
                  visibility: props.rowVisibility[entry.sourceIndex],
                })}
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
                  <SlideSectionHeader
                    language={props.language}
                    index={entry.sourceIndex}
                    collapsed={props.rowVisibility[entry.sourceIndex] === 'header-only'}
                    editing={props.editingSectionIndex === entry.sourceIndex}
                    draft={props.sectionDraftOf(entry.sourceIndex)}
                    onToggleSectionCollapse={props.onToggleSectionCollapse}
                    onEditSection={props.onEditSection}
                    onSectionNameInput={props.onSectionNameInput}
                    onSectionTimeInput={props.onSectionTimeInput}
                    onCommitSectionEdit={props.onCommitSectionEdit}
                  />
                ) : null}
                <button
                  type="button"
                  title={(entry.kind === 'rendered' ? entry.slide.text.title : entry.title) || messagesFor(props.language).slideFallbackTitle(entry.sourceIndex + 1)}
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
                          <span className="text-xs text-muted-foreground text-center line-clamp-3">{entry.kind === 'placeholder' ? (entry.title || messagesFor(props.language).slideFallbackTitle(entry.sourceIndex + 1)) : ''}</span>
                        </div>
                      )}
                      <SlideStatusOverlay badge={entry.badge} language={props.language} />
                      {/* The slide's comments for the agent (unsent, and
                          unresolved in crit). Kept mounted and hidden at
                          zero rather than branched in, like the canvas
                          toggles elsewhere. */}
                      <span
                        data-slide-comment-count={String(props.commentCountOf(commentKeyOf(entry)))}
                        aria-label={messagesFor(props.language).commentCount(props.commentCountOf(commentKeyOf(entry)))}
                        className={(props.commentCountOf(commentKeyOf(entry)) > 0 ? 'flex' : 'hidden') + ' absolute left-1 bottom-1 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold bg-[#eab308] text-black pointer-events-none'}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" className="block w-3 h-3">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        {props.commentCountOf(commentKeyOf(entry))}
                      </span>
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
