import { createSignal, createMemo } from '@barefootjs/client'
import { type EditorSession, isDirty as computeIsDirty } from '../domain/editorSession'
import { type PageConfig } from '../domain/pageConfig'
import { type SlideRange } from '../domain/slides'

/** The editor pane's entire state — which slide (if any) is open, its
 * last-saved fields, and the live draft — as one `domain/editorSession.ts`
 * ADT signal, with memos projecting the pieces the rest of the app reads
 * individually — plus the raw source text and slide ranges it's derived
 * from. Orchestration that reads/writes this state alongside another
 * concern (`commitChange` also calling into `state/renderStore.ts` and the
 * DOM-touching `syncEditorFields`, `selectSlide` also calling `handleSave`)
 * stays in `Studio.tsx` — the composition root — rather than moving into
 * this store, matching `state/uiStore.ts`/`state/renderStore.ts`. */
export function createEditorStore() {
  // Previously five independent signals (`selectedIndex`/`bodyDraft`/
  // `noteDraft`/`originalBody`/`originalNote`) plus a separate
  // `pageConfig`, which is exactly the kind of "ADT scattered across
  // independent fields" docs/architecture.md warns against — nothing
  // stopped e.g. `bodyDraft` pointing at one slide's text while
  // `selectedIndex` had already moved to another. `pageConfig` is held in
  // `draft.config`/`saved.config` rather than in `bodyDraft` itself — the
  // whole point of this app is that hand-writing/eyeballing that JSON
  // comment (and telling it apart from the note comment, same HTML-comment
  // syntax) is the wrong way to edit it. Applied through `buildSlideText`
  // whenever the raw slide text is reconstructed for saving; edited only
  // via the thumbnail context menu / section-header inputs, never by hand
  // in the body textarea.
  const [editorSession, setEditorSession] = createSignal<EditorSession>({ kind: 'none' })
  const selectedIndex = createMemo(() => {
    const s = editorSession()
    return s.kind === 'editing' ? s.index : null
  })
  const bodyDraft = createMemo(() => {
    const s = editorSession()
    return s.kind === 'editing' ? s.draft.body : ''
  })
  const noteDraft = createMemo(() => {
    const s = editorSession()
    return s.kind === 'editing' ? s.draft.note : ''
  })
  const pageConfig = createMemo<PageConfig>(() => {
    const s = editorSession()
    return s.kind === 'editing' ? s.draft.config : {}
  })
  const isDirty = createMemo(() => computeIsDirty(editorSession()))

  const [fullSource, setFullSource] = createSignal('')
  const [slideRanges, setSlideRanges] = createSignal<SlideRange[]>([])
  const selectedRange = createMemo<SlideRange | null>(() => {
    const i = selectedIndex()
    if (i === null) return null
    return slideRanges()[i] ?? null
  })

  return {
    editorSession, setEditorSession, selectedIndex, bodyDraft, noteDraft, pageConfig, isDirty,
    fullSource, setFullSource, slideRanges, setSlideRanges, selectedRange,
  }
}
