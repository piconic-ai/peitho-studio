// Isolating the slides peitho-core refuses so the rest of the deck still
// renders (todo/isolate-broken-slides.md). peitho-core stops at the first
// slide that doesn't build, so one render names one broken slide; the
// deck is rendered again with that slide marked draft — in memory only,
// never on disk — until a render goes through or isolation gives up. The
// loop itself (an IPC call per attempt) lives in `components/Studio.tsx`;
// this module holds every decision it makes, so the decisions can be
// tested without an engine: which slide an error isolates, when to give
// up, and which failures a save may isolate rather than be blocked by.
import { type RenderErrorPayload, brokenSlideIndex } from './render'
import { type PageConfig, serializePageConfig } from './pageConfig'
import { type SlideCommand, indexAfterCommand } from './slideCommands'
import { extractPageComment, splitSlides, sumSectionTimesMs, updateFrontmatterTime, updatePageComment } from './slides'
import { readFrontmatterKey } from './frontmatter'

/** How many slides one render may isolate before giving up: a deck with
 * more broken slides than this is shown without a render instead (the
 * `todo/open-broken-deck.md` state), so a deck that is broken all over
 * never costs an unbounded series of renders. */
export const MAX_ISOLATIONS = 5

/** The slides isolated from the current render, by their `splitSlides`
 * index in the source as written, each with the error peitho-core gave
 * for it. Empty for a deck that built as written. */
export type BrokenSlides = ReadonlyMap<number, RenderErrorPayload>

export const NO_BROKEN_SLIDES: BrokenSlides = new Map()

/** One render's isolation so far. `source` is the deck as written — what
 * is saved, and what the resulting manifest is paired with (its slide
 * positions are the ones `broken` is keyed by). `attempt` is `source`
 * with every slide in `broken` marked draft: what is actually rendered. */
export interface Isolation {
  readonly source: string
  readonly attempt: string
  readonly broken: BrokenSlides
}

export function startIsolation(source: string): Isolation {
  return { source, attempt: source, broken: NO_BROKEN_SLIDES }
}

/** The isolation after `error` failed `isolation.attempt`: the slide it
 * names is isolated too. `null` means give up and show the deck without a
 * render, because another attempt couldn't do better:
 * - the error isn't about a slide (frontmatter, an include, a layout
 *   file), or names a slide the source doesn't have;
 * - the slide is isolated already (marking it draft didn't help: a parse
 *   error, which peitho-core raises before it drops draft slides) or was
 *   a draft to begin with;
 * - `MAX_ISOLATIONS` slides are isolated already;
 * - no slide would be left to build (peitho-core refuses an all-draft
 *   deck). */
export function isolateSlide(isolation: Isolation, error: RenderErrorPayload): Isolation | null {
  const index = brokenSlideIndex(error, splitSlides(isolation.source).length)
  if (index === null || isolation.broken.has(index) || isolation.broken.size >= MAX_ISOLATIONS) return null
  const broken = new Map(isolation.broken).set(index, error)
  const attempt = withSlidesDrafted(isolation.source, broken)
  return attempt === null ? null : { source: isolation.source, attempt, broken }
}

/** `source` with the slides at `indexes` (`splitSlides` positions) marked
 * `"draft":true`, for rendering without them; `null` when one of them is a
 * draft already or no other slide would be left to build. Everything but
 * those slides' PageComments stays byte for byte, and a comment added to
 * a slide takes the blank line that opened it when there is one, so the
 * line numbers peitho-core reports for the attempt are the file's own
 * wherever possible. A draft may not also be skipped, hide its page
 * number or start a section (peitho-core refuses each), so those flags go
 * with the mark; a section dropped this way takes its time out of the
 * frontmatter's `time:` too, which peitho-core requires to equal the
 * sections' sum. */
export function withSlidesDrafted(source: string, indexes: ReadonlySet<number> | ReadonlyMap<number, unknown>): string | null {
  const ranges = splitSlides(source)
  let remaining = 0
  let attempt = source
  // Last to first, so each replacement leaves the earlier ranges' offsets
  // as `splitSlides` found them.
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i]
    const { config } = extractPageComment(range.text)
    if (!indexes.has(i)) {
      if (config.draft !== true) remaining++
      continue
    }
    if (config.draft === true) return null
    attempt = attempt.slice(0, range.start) + markedDraft(range.text, config) + attempt.slice(range.end)
  }
  if (remaining === 0) return null
  const sectionsMs = sumSectionTimesMs(splitSlides(attempt).map(range => range.text))
  const resync = sectionsMs !== sumSectionTimesMs(ranges.map(range => range.text)) && sectionsMs > 0 && readFrontmatterKey(source, 'time') !== null
  return resync ? updateFrontmatterTime(attempt, sectionsMs) : attempt
}

const DRAFT_MARK: Partial<PageConfig> = { draft: true, skip: undefined, page_number: undefined, section: undefined, time: undefined }

function markedDraft(text: string, config: PageConfig): string {
  if (Object.keys(config).length > 0) return updatePageComment(text, DRAFT_MARK)
  const comment = `<!-- ${serializePageConfig({ draft: true })} -->`
  return text.startsWith('\n') ? `${comment}${text}` : `${comment}\n${text}`
}

/** Whether a save whose render failed with `error` may isolate the slide
 * it names and save anyway (`isolate`), or is refused as any draft that
 * doesn't build is (`block`). Only a slide already known broken
 * (`known`: by the position it holds now, or by the key peitho-core
 * reports for it, which survives a reorder) is isolated — the deck on
 * disk is no worse off for it — and never the slide the user is editing
 * (`editedIndex`): their own typing not building is the editor's state,
 * not the deck's, and stays unsaved until it builds. `slideCount` is the
 * source being saved's, for `brokenSlideIndex`. */
export function saveDecision(error: RenderErrorPayload, known: BrokenSlides, editedIndex: number | null, slideCount: number): 'isolate' | 'block' {
  const index = brokenSlideIndex(error, slideCount)
  if (index === null || index === editedIndex) return 'block'
  if (known.has(index)) return 'isolate'
  const key = error.slide?.key ?? null
  if (key !== null && [...known.values()].some(knownError => knownError.slide?.key === key)) return 'isolate'
  return 'block'
}

/** `known` re-keyed to where its slides sit once `cmd` has run (see
 * `indexAfterCommand`) — a deleted slide is forgotten. */
export function brokenSlidesAfterCommand(known: BrokenSlides, cmd: SlideCommand): BrokenSlides {
  const shifted = new Map<number, RenderErrorPayload>()
  for (const [index, error] of known) {
    const next = indexAfterCommand(index, cmd)
    if (next !== null) shifted.set(next, error)
  }
  return shifted
}

/** What the error bar says while slides are isolated: how many, and the
 * first one's error (lowest position). `null` when none are. */
export function brokenSlidesSummary(broken: BrokenSlides): { count: number; first: RenderErrorPayload } | null {
  if (broken.size === 0) return null
  const firstIndex = Math.min(...broken.keys())
  const first = broken.get(firstIndex)
  return first === undefined ? null : { count: broken.size, first }
}
