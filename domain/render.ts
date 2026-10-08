// The deck's rendered-slide data model. Lives in domain/ (not ipc/) even
// though it's also the shape peitho-core's manifest_json deserializes
// into — it's a core domain concept the IPC boundary happens to carry,
// not a detail of that boundary; ipc/deckIpc.ts imports these types
// rather than the other way around, per docs/architecture.md's `ipc/ ->
// domain/` dependency direction.

export interface ManifestSlide {
  index: number
  key: string
  src: string
  hasNotes: boolean
  skip: boolean
  revealSteps: number
  text: { title: string; body: string; code: string }
}

export interface ManifestSection {
  name: string
  startIndex: number
  endIndex: number
  plannedDurationMs: number
}

export interface Manifest {
  title: string
  slideCount: number
  canvasWidth: number
  canvasHeight: number
  sections: ManifestSection[]
  slides: ManifestSlide[]
}

/** A section header's in-progress (unsaved) name/time edit, keyed by the
 * slide index it starts at — falls back to the section's own saved values
 * (`savedSectionDraft`) until the user edits. The time is held as
 * milliseconds rather than as peitho's `1m30s` text: the header edits it
 * with minutes/seconds spinners (`domain/slides.ts`'s
 * `withDurationPart`), so every value a draft can hold formats to a
 * string peitho accepts. */
export interface SectionDraft {
  name: string
  timeMs: number
}

/** The draft a section header shows before anyone edits it: the section's
 * own saved name and planned time. */
export function savedSectionDraft(section: ManifestSection): SectionDraft {
  return { name: section.name, timeMs: section.plannedDurationMs }
}

/** The result of one render pass — same "domain concept the IPC boundary
 * happens to carry" reasoning as `Manifest` above; `ipc/deckIpc.ts`
 * re-exports this rather than defining it. */
export interface RenderPayload {
  manifest: Manifest
  fragments: Record<string, string>
  /** The layout each slide was built on, by slide key — the manifest
   * itself names none. */
  slideLayouts: Record<string, string>
  /** The deck's layouts a slide holding only a heading builds on — the
   * ones New Slide (which inserts just `# New Slide`) may name. */
  headingLayouts: string[]
  assetBaseUrl: string
  css: string
}

/** The slide peitho-core attributes a build error to: `number` counts from
 * 1 over the source's slides, drafts included (`domain/slides.ts`'s
 * `splitSlides` order), `key` is its explicit PageComment key when it set
 * one. */
export interface RenderErrorSlide {
  number: number
  key: string | null
}

/** Why a render produced nothing — peitho-core's `BuildError` as
 * `engine::pipeline::RenderErrorPayload` carries it (camelCase): `kind` is
 * the error's category (`Parse`, `Arity`, ..., or `Other` for a failure
 * around peitho-core such as a layout file that doesn't parse), `headline`
 * is peitho-core's own location-prefixed first line (`slide 2 ('intro'),
 * line 12: ...`), `help` the advice it prints under it (empty for `Other`),
 * and `line`/`originFile`/`slide` are what the headline was built from. */
export interface RenderErrorPayload {
  kind: string
  line: number | null
  originFile: string | null
  message: string
  help: string
  headline: string
  slide: RenderErrorSlide | null
}

/** What `open_deck`/`render_draft` answer for a render: the payload, or
 * peitho-core's refusal with the deck still open (`RenderOutcome` in
 * peitho.rs, `#[serde(tag = "kind")]`). */
export type RenderOutcome =
  | ({ kind: 'rendered' } & RenderPayload)
  | { kind: 'failed'; error: RenderErrorPayload }

/** The error as one block of text — peitho-core's own `Display`: the
 * headline, then `  = help: ...` on a second line when there is help.
 * What the error bar shows and what `ipc/renderOutcome.ts`'s
 * `RenderFailure` carries as its `message`, so every `String(err)` reads
 * as the string the command used to reject with. */
export function renderFailureMessage(error: RenderErrorPayload): string {
  return error.help === '' ? error.headline : `${error.headline}\n  = help: ${error.help}`
}

/** The slide list index (`splitSlides` order, drafts included) of the
 * slide a build error points at, to select it when the deck opens broken
 * — `null` when the error isn't about a slide (frontmatter, an include),
 * or names a number outside the `slideCount` slides the source actually
 * splits into (nothing to select then, rather than a guess). */
export function brokenSlideIndex(error: RenderErrorPayload, slideCount: number): number | null {
  if (error.slide === null) return null
  const index = error.slide.number - 1
  return Number.isInteger(index) && index >= 0 && index < slideCount ? index : null
}

/** Indexes a manifest's sections by their starting slide index, for O(1)
 * "does slide i start a section?" lookups in the slide list. */
export function sectionStartByIndex(sections: readonly ManifestSection[]): Record<number, ManifestSection> {
  const byIndex: Record<number, ManifestSection> = {}
  for (const section of sections) byIndex[section.startIndex] = section
  return byIndex
}
