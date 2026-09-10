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
 * (`ManifestSection.name`/`plannedDurationMs`) until the user types. */
export interface SectionDraft {
  name: string
  time: string
}

/** The result of one render pass — same "domain concept the IPC boundary
 * happens to carry" reasoning as `Manifest` above; `ipc/deckIpc.ts`
 * re-exports this rather than defining it. */
export interface RenderPayload {
  manifest: Manifest
  fragments: Record<string, string>
  assetBaseUrl: string
  css: string
}

/** Indexes a manifest's sections by their starting slide index, for O(1)
 * "does slide i start a section?" lookups in the slide list. */
export function sectionStartByIndex(sections: readonly ManifestSection[]): Record<number, ManifestSection> {
  const byIndex: Record<number, ManifestSection> = {}
  for (const section of sections) byIndex[section.startIndex] = section
  return byIndex
}
