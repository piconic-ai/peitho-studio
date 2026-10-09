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
import { extractPageComment, findPageComment, splitSlides, sumSectionTimesMs, updateFrontmatterTime, updatePageComment } from './slides'
import { readFrontmatterKey } from './frontmatter'
import { mapEditAnnotations } from './slideFragment'

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

/** One change `withSlidesDrafted` made to the source, in UTF-8 bytes (the
 * unit of peitho-core's edit annotations): `removed` bytes at `at` of the
 * source as written became `inserted` bytes of the attempt. */
export interface SourceEdit {
  readonly at: number
  readonly removed: number
  readonly inserted: number
}

/** One render's isolation so far. `source` is the deck as written — what
 * is saved, and what the resulting manifest is paired with (its slide
 * positions are the ones `broken` is keyed by). `attempt` is `source`
 * with every slide in `broken` marked draft: what is actually rendered;
 * `edits` is how it differs from `source`, for `restoreEditAnnotations`. */
export interface Isolation {
  readonly source: string
  readonly attempt: string
  readonly edits: readonly SourceEdit[]
  readonly broken: BrokenSlides
}

/** A fresh isolation of `source` — or, given `known` (the slides an
 * earlier render isolated, keyed to `source`'s positions; see
 * `brokenSlidesAfterEdit`), one that starts with those slides drafted,
 * so a draft being typed renders in one go without them. A known slide
 * `source` no longer has, or marks draft itself, is left out; when none
 * could be drafted (none left, or nothing would be left to build), the
 * isolation starts fresh instead. */
export function startIsolation(source: string, known: BrokenSlides = NO_BROKEN_SLIDES): Isolation {
  const fresh: Isolation = { source, attempt: source, edits: [], broken: NO_BROKEN_SLIDES }
  if (known.size === 0) return fresh
  const ranges = splitSlides(source)
  const broken: BrokenSlides = new Map([...known].filter(([index]) => index < ranges.length && extractPageComment(ranges[index].text).config.draft !== true))
  if (broken.size === 0) return fresh
  const drafted = withSlidesDrafted(source, broken)
  return drafted === null ? fresh : { source, attempt: drafted.attempt, edits: drafted.edits, broken }
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
  const drafted = withSlidesDrafted(isolation.source, broken)
  return drafted === null ? null : { source: isolation.source, attempt: drafted.attempt, edits: drafted.edits, broken }
}

/** `source` with the slides at `indexes` (`splitSlides` positions) marked
 * `"draft":true`, for rendering without them, and the edits that made it
 * (in source order); `null` when one of them is a draft already or no
 * other slide would be left to build. Everything but those slides'
 * PageComments stays byte for byte, and a comment added to a slide takes
 * the blank line that opened it when there is one, so the line numbers
 * peitho-core reports for the attempt are the file's own wherever
 * possible. A draft may not also be skipped, hide its page number or
 * start a section (peitho-core refuses each), so those flags go with the
 * mark; a section dropped this way takes its time out of the
 * frontmatter's `time:` too, which peitho-core requires to equal the
 * sections' sum. */
export function withSlidesDrafted(source: string, indexes: ReadonlySet<number> | ReadonlyMap<number, unknown>): { attempt: string; edits: SourceEdit[] } | null {
  const ranges = splitSlides(source)
  let remaining = 0
  let attempt = source
  const edits: SourceEdit[] = []
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
    const marked = markedDraft(range.text, config)
    attempt = attempt.slice(0, range.start) + marked + attempt.slice(range.end)
    edits.unshift(editBetween(source, range.start, range.text, marked))
  }
  if (remaining === 0) return null
  const sectionsMs = sumSectionTimesMs(splitSlides(attempt).map(range => range.text))
  const resync = sectionsMs !== sumSectionTimesMs(ranges.map(range => range.text)) && sectionsMs > 0 && readFrontmatterKey(source, 'time') !== null
  if (!resync) return { attempt, edits }
  // The frontmatter precedes every slide, so its offsets are the same in
  // the source and in the attempt so far.
  const resynced = updateFrontmatterTime(attempt, sectionsMs)
  const frontmatterEnd = ranges[0].start
  edits.unshift(editBetween(source, 0, attempt.slice(0, frontmatterEnd), resynced.slice(0, resynced.length - (attempt.length - frontmatterEnd))))
  return { attempt: resynced, edits }
}

/** The one edit that turns `before` (the text of `source` at `at`) into
 * `after`: the part past their common prefix and suffix, in UTF-8 bytes.
 * Not `domain/editorText.ts`'s `editorTextChange`: that normalizes the
 * line breaks of its target, which would count a CRLF deck's every line
 * as changed. The edits here only ever touch ASCII (a PageComment, a
 * `time:` value), so a prefix or suffix never ends inside a character. */
function editBetween(source: string, at: number, before: string, after: string): SourceEdit {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return {
    at: utf8ByteLength(source.slice(0, at + prefix)),
    removed: utf8ByteLength(before.slice(prefix, before.length - suffix)),
    inserted: utf8ByteLength(after.slice(prefix, after.length - suffix)),
  }
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Where UTF-8 byte `offset` of an attempt built with `edits` falls in the
 * source as written — `null` strictly inside an edit, which no slide that
 * rendered contains (an edit is a drafted slide's PageComment, or the
 * frontmatter's `time:`). An offset at either end of an edit is where
 * the edit sits in the source, so a span ending where one starts keeps
 * its end. */
export function originalByteOffset(offset: number, edits: readonly SourceEdit[]): number | null {
  let shift = 0
  for (const edit of edits) {
    const start = edit.at + shift
    if (offset <= start) break
    if (offset < start + edit.inserted) return null
    shift += edit.inserted - edit.removed
  }
  return offset - shift
}

/** `fragments` as rendered from an attempt built with `edits`, their edit
 * annotations (byte spans into the attempt) rewritten as spans into the
 * source as written — the source every consumer of an annotation holds.
 * An annotation that can't be placed (one inside an edit) is dropped.
 * With no edits, `fragments` itself: nothing to rewrite, and this runs on
 * every render. */
export function restoreEditAnnotations(fragments: Readonly<Record<string, string>>, edits: readonly SourceEdit[]): Readonly<Record<string, string>> {
  if (edits.length === 0) return fragments
  const restored: Record<string, string> = {}
  for (const [key, html] of Object.entries(fragments)) {
    restored[key] = mapEditAnnotations(html, span => {
      const start = originalByteOffset(span.start, edits)
      const end = originalByteOffset(span.end, edits)
      return start === null || end === null ? null : { start, end }
    })
  }
  return restored
}

const DRAFT_MARK: Partial<PageConfig> = { draft: true, skip: undefined, page_number: undefined, section: undefined, time: undefined }

/** `text` with the draft mark: in its PageComment when it has one (even
 * an empty `<!-- {} -->` — a second comment is a parse error to
 * peitho-core, which would make the slide unisolatable), else in a new
 * one. */
function markedDraft(text: string, config: PageConfig): string {
  if (findPageComment(text) !== null) return updatePageComment(text, DRAFT_MARK)
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
 * not the deck's, and stays unsaved until it builds. The one exception is
 * `handOff`: the user asked for their typing to go to the agent as it is
 * (todo/send-build-error-from-error-bar.md), so the slide they are
 * editing is isolated and saved broken, like a known one — still never a
 * slide the error doesn't name (nothing to isolate). `slideCount` is the
 * source being saved's, for `brokenSlideIndex`. */
export function saveDecision(error: RenderErrorPayload, known: BrokenSlides, editedIndex: number | null, slideCount: number, handOff = false): 'isolate' | 'block' {
  const index = brokenSlideIndex(error, slideCount)
  if (index === null) return 'block'
  if (index === editedIndex) return handOff ? 'isolate' : 'block'
  if (known.has(index)) return 'isolate'
  const key = error.slide?.key ?? null
  if (key !== null && [...known.values()].some(knownError => knownError.slide?.key === key)) return 'isolate'
  return 'block'
}

/** `known` re-keyed to where its slides sit once the slide at
 * `editedIndex` was retyped: typed text can re-split a slide (a `---`
 * line, an unclosed code fence swallowing the separators after it), so the
 * deck of `countBefore` slides `known` is keyed to has `countAfter` once
 * the typing is in, and every slide after the edited one moves by the
 * difference. The edited slide itself is forgotten — whether it builds
 * now is for the render to say — and so is a slide the typing swallowed.
 * With no slide edited (`null`), `known` as it is. */
export function brokenSlidesAfterEdit(known: BrokenSlides, editedIndex: number | null, countBefore: number, countAfter: number): BrokenSlides {
  if (editedIndex === null) return known
  const delta = countAfter - countBefore
  const shifted = new Map<number, RenderErrorPayload>()
  for (const [index, error] of known) {
    if (index < editedIndex) {
      shifted.set(index, error)
      continue
    }
    if (index === editedIndex) continue
    const next = index + delta
    if (next > editedIndex && next < countAfter) shifted.set(next, error)
  }
  return shifted
}

/** `saveDecision` for the whole-deck source editor, whose text can move
 * any slide, so a position alone says nothing: the slide `error` names
 * in `to` (the text being saved) is isolated when it is, word for word,
 * one `known` names in `from` (the source `known` is keyed to) — the
 * slide was known broken and the user didn't touch it, wherever it now
 * sits. A slide they changed is their own typing, never saved broken. */
export function sourceSaveDecision(error: RenderErrorPayload, known: BrokenSlides, from: string, to: string): 'isolate' | 'block' {
  const toRanges = splitSlides(to)
  const index = brokenSlideIndex(error, toRanges.length)
  if (index === null) return 'block'
  const fromRanges = splitSlides(from)
  const text = toRanges[index].text.trim()
  for (const knownIndex of known.keys()) {
    if (fromRanges[knownIndex]?.text.trim() === text) return 'isolate'
  }
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
