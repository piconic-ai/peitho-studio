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

/** Indexes a manifest's sections by their starting slide index, for O(1)
 * "does slide i start a section?" lookups in the slide list. */
export function sectionStartByIndex(sections: readonly ManifestSection[]): Record<number, ManifestSection> {
  const byIndex: Record<number, ManifestSection> = {}
  for (const section of sections) byIndex[section.startIndex] = section
  return byIndex
}
