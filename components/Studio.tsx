'use client'

import { createSignal, createMemo, createEffect, onMount, onCleanup } from '@barefootjs/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  splitSlides,
  extractNote,
  extractPageComment,
  buildSlideText,
  updatePageComment,
  stripPageCommentKey,
  parseDurationToMs,
  updateFrontmatterTime,
  formatDurationMs,
  joinSlideTexts,
  sumSectionTimesMs,
  stabilizeByKey,
  type SlideRange,
} from './slides'
import { buildSlidePreviewDoc } from './previewDoc'

interface ManifestSlide {
  index: number
  key: string
  src: string
  hasNotes: boolean
  skip: boolean
  revealSteps: number
  text: { title: string; body: string; code: string }
}

interface ManifestSection {
  name: string
  startIndex: number
  endIndex: number
  plannedDurationMs: number
}

interface Manifest {
  title: string
  slideCount: number
  canvasWidth: number
  canvasHeight: number
  sections: ManifestSection[]
  slides: ManifestSlide[]
}

interface SectionDraft {
  name: string
  time: string
}

interface RenderPayload {
  manifest: Manifest
  fragments: Record<string, string>
  assetBaseUrl: string
}

interface DeckSessionInfo {
  deckPath: string
  deckDir: string
  render: RenderPayload
}

const MIN_COLUMN_WIDTH = 180
const MAX_COLUMN_WIDTH = 640
const SLIDE_LIST_WIDTH = 176
// No PageComment — peitho assigns a fresh key at build time the same way
// it would for any other slide that never specified one.
const NEW_SLIDE_MARKDOWN = '# New Slide\n'

export function Studio() {
  const [deckPath, setDeckPath] = createSignal<string | null>(null)
  const [assetBaseUrl, setAssetBaseUrl] = createSignal<string | null>(null)
  // The deck's native slide canvas size — split out of `manifest` into its
  // own equality-guarded signals (set in `applyRenderPayload`) even though
  // it logically lives there. `manifest()` gets a brand-new object on every
  // single-slide edit, but every thumbnail's `.map()` row reads canvas size
  // (for its `<iframe>` doc and its aspect-ratio style) — reading it via
  // `manifest()` directly made *every* row's reactive bindings depend on
  // *every* edit, forcing a real `.srcdoc` reassignment (a visible reload)
  // on rows whose own content never changed. See [[barefootjs-per-key-signal-pattern]].
  const [canvasWidth, setCanvasWidth] = createSignal(1280)
  const [canvasHeight, setCanvasHeight] = createSignal(720)
  const [manifest, setManifest] = createSignal<Manifest | null>(null)
  const [fullSource, setFullSource] = createSignal('')
  const [slideRanges, setSlideRanges] = createSignal<SlideRange[]>([])
  const [selectedIndex, setSelectedIndex] = createSignal<number | null>(null)
  const [bodyDraft, setBodyDraft] = createSignal('')
  const [noteDraft, setNoteDraft] = createSignal('')
  const [originalBody, setOriginalBody] = createSignal('')
  const [originalNote, setOriginalNote] = createSignal('')
  // The selected slide's PageComment JSON, held out of `bodyDraft` entirely
  // so the body textarea never shows it — the whole point of this app is
  // that hand-writing/eyeballing that JSON comment (and telling it apart
  // from the note comment, same HTML-comment syntax) is the wrong way to
  // edit it. Applied through `buildSlideText` whenever the raw slide text is
  // reconstructed for saving; edited only via the thumbnail context menu /
  // section-header inputs, never by hand here.
  const [pageConfig, setPageConfig] = createSignal<Record<string, unknown>>({})
  // One independent signal per slide key, rather than a single
  // `Record<string, string>` signal — reading `slideFragments()` as a whole
  // record would subscribe every thumbnail's `srcdoc` effect to the *entire*
  // record, so editing one slide reassigned every other thumbnail's
  // `<iframe srcdoc>` too (same value, but `.srcdoc` always forces a
  // navigate/reload on assignment regardless of whether the string actually
  // changed) — the visible flicker across the whole slide list on every
  // keystroke. Keying a separate signal per slide means only the row whose
  // fragment actually changed re-touches its iframe.
  const fragmentSignals = new Map<string, [() => string, (value: string) => void]>()
  function fragmentSignal(key: string): [() => string, (value: string) => void] {
    let entry = fragmentSignals.get(key)
    if (!entry) {
      entry = createSignal('')
      fragmentSignals.set(key, entry)
    }
    return entry
  }
  const [sectionDrafts, setSectionDrafts] = createSignal<Record<number, SectionDraft>>({})
  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null)
  // The gap the dragged slide would land in if dropped now: 0 means "before
  // row 0", N means "after the last row" — an insertion point between rows,
  // not a row index, so the drop-line indicator can render between two rows
  // rather than highlighting one of them.
  const [dragOverGap, setDragOverGap] = createSignal<number | null>(null)
  const [isBusy, setIsBusy] = createSignal(false)
  const [statusMessage, setStatusMessage] = createSignal('')
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [slideListWidth, setSlideListWidth] = createSignal(SLIDE_LIST_WIDTH)
  const [contextMenu, setContextMenu] = createSignal<{ index: number; x: number; y: number } | null>(null)
  // "Change Layout" expands this inline within the thumbnail context menu.
  // A grid of real rendered previews (Google Slides-style) was attempted
  // first, backed by `preview_layouts`'s per-layout fragment/CSS render —
  // but a conditional (`layoutPreviews() === null ? Loading : ... : ...`)
  // sitting in the context menu's part of the tree never showed its
  // post-mount branches (confirmed with plain `<div>` content too, so not
  // about the grid/`.map()`/iframe specifically), while the identical
  // pattern elsewhere in this file that isn't inside the context menu (e.g.
  // `manifest() === null ? ... : ...` for the slide list) works fine. Given
  // more time this is worth a proper BarefootJS repro/issue like the
  // stale-index one; for now this uses the plain name list, which is the
  // same shape that already worked before this attempt.
  const [layoutPickerOpen, setLayoutPickerOpen] = createSignal(false)
  const [layoutPreviews, setLayoutPreviews] = createSignal<{ name: string; fragment: string }[] | null>(null)
  // The thumbnail context menu's Cut/Copy/Paste clipboard. Deliberately not
  // backed by `navigator.clipboard` — OS clipboard access needs its own
  // Tauri capability/plugin wiring, and the ask here is standard in-app
  // cut/copy/paste, not cross-app interop.
  const [clipboardSlideText, setClipboardSlideText] = createSignal<string | null>(null)
  // Shown centered in place of the whole 3-pane layout until a deck is
  // open. `recentDecks` (full deck.md paths) is persisted Rust-side (see
  // `get_recent_decks`/`remember_recent_deck` in peitho.rs) rather than in
  // `localStorage`, since the native File > Open Recent submenu needs the
  // same list and has no access to this webview's storage.
  const [recentDecks, setRecentDecks] = createSignal<string[]>([])
  const [newDeckModalOpen, setNewDeckModalOpen] = createSignal(false)
  const [newDeckParentDir, setNewDeckParentDir] = createSignal<string | null>(null)
  const [newDeckName, setNewDeckName] = createSignal('')

  // Plain (non-reactive) DOM handles for the two editor textareas — see the
  // note above `syncEditorFields` for why these are *not* driven by a
  // reactive `value={...}` binding.
  let bodyTextareaEl: HTMLTextAreaElement | undefined
  let noteTextareaEl: HTMLTextAreaElement | undefined
  // Tracks an in-progress IME composition (kana->kanji conversion, etc.) on
  // each textarea, via `compositionstart`/`compositionend`. `syncEditorFields`
  // must never touch `.value` while one is active: WebKit owns the
  // in-progress composition buffer separately from the element's `.value`
  // during that window, and an external `.value` write — even to a byte-
  // identical string — can desync the two, surfacing as dropped characters
  // or a backspace that appears to delete the wrong thing.
  let bodyComposing = false
  let noteComposing = false

  // Pushes the current bodyDraft/noteDraft signal values into the actual
  // textarea DOM nodes. Call this after any *non-typing* change to those
  // signals (switching slides, a save response, an external-file merge) —
  // never react to the signals directly with a `value={...}` JSX binding.
  // A reactive binding re-assigns `.value` on every keystroke too, since
  // our own onInput handler is what changes the signal in the first place;
  // WebKit's textarea can drop or misplace a keystroke (a space swallowed,
  // the cursor jumping a line) when `.value` is reassigned while the user
  // is actively typing/composing. Uncontrolled + explicit imperative sync
  // avoids that class of bug entirely.
  function syncEditorFields(): void {
    if (bodyTextareaEl && !bodyComposing && bodyTextareaEl.value !== bodyDraft()) bodyTextareaEl.value = bodyDraft()
    if (noteTextareaEl && !noteComposing && noteTextareaEl.value !== noteDraft()) noteTextareaEl.value = noteDraft()
  }

  const [editorWidth, setEditorWidth] = createSignal(420)
  const [presentMenuOpen, setPresentMenuOpen] = createSignal(false)

  const sectionStartByIndex = createMemo<Record<number, ManifestSection>>(() => {
    const byIndex: Record<number, ManifestSection> = {}
    for (const section of manifest()?.sections ?? []) byIndex[section.startIndex] = section
    return byIndex
  })
  // Looks up a slide's *current* position by its stable key, rather than
  // trusting the `i` a `.map()` callback closed over at render time. After a
  // reorder, this compiler's keyed list reconciliation moves/reuses a row's
  // DOM node for a persisted key but does not appear to refresh plain
  // (non-signal) closure values like a bare `i` bound inside it — confirmed
  // by the slide-number badge and section header both landing on the wrong
  // row after a drag-reorder while the row's own reactive content (bound by
  // key) stayed correct. Every per-row index used for anything that must
  // stay right after reordering (badges, section lookups, click/drag/context
  // menu targeting) goes through this instead of the raw `i` parameter.
  //
  // One signal per key — same reasoning as `fragmentSignal` above, and the
  // same regression it was originally written to avoid: a single memo
  // recomputing a `Map` from `manifest()` looked equivalent, but *every*
  // row's index lookup then read that one memo, so any edit to *any* slide
  // (which always produces a brand-new `manifest()`) invalidated every
  // row's index binding and re-touched every thumbnail — reintroducing the
  // exact cross-thumbnail flicker the per-key fragment signals were meant
  // to eliminate. Writing to a key's own signal only when its index
  // actually changed (mirroring `applyRenderPayload`'s `if (get() !== ...)
  // set(...)` guard) means editing one slide's text never notifies any
  // other slide's index binding at all.
  const indexSignals = new Map<string, [() => number, (value: number) => void]>()
  function indexSignal(key: string): [() => number, (value: number) => void] {
    let entry = indexSignals.get(key)
    if (!entry) {
      entry = createSignal(-1)
      indexSignals.set(key, entry)
    }
    return entry
  }
  createEffect(() => {
    const slides = manifest()?.slides ?? []
    for (let idx = 0; idx < slides.length; idx++) {
      const [get, set] = indexSignal(slides[idx].key)
      if (get() !== idx) set(idx)
    }
  })
  const layoutPickerView = createMemo<'loading' | 'empty' | 'ready'>(() => {
    const previews = layoutPreviews()
    if (previews === null) return 'loading'
    if (previews.length === 0) return 'empty'
    return 'ready'
  })
  const selectedRange = createMemo<SlideRange | null>(() => {
    const i = selectedIndex()
    if (i === null) return null
    return slideRanges()[i] ?? null
  })
  const isDirty = createMemo(() => {
    if (selectedRange() === null) return false
    return bodyDraft() !== originalBody() || noteDraft() !== originalNote()
  })
  const selectedSlide = createMemo<ManifestSlide | null>(() => {
    const i = selectedIndex()
    if (i === null) return null
    return manifest()?.slides[i] ?? null
  })

  createEffect(() => {
    if (errorMessage() === null) return
    const timer = window.setTimeout(() => setErrorMessage(null), 6000)
    return () => window.clearTimeout(timer)
  })

  // Applies a render result (from `open_deck` or `render_draft`) to state.
  // Each fragment is written to its own key's signal, and only when the
  // value actually changed — see `fragmentSignal` above for why this must
  // stay per-key rather than one shared record. `manifest.slides` itself
  // gets the same treatment at the object level via `stabilizeByKey`: every
  // slide (edited or not) arrives as a freshly-deserialized object on every
  // keystroke, and reusing the *previous* slide's own reference for one
  // that's unchanged is what lets the keyed `.map()` over `manifest().slides`
  // skip re-running that row's bindings at all — see `stabilizeByKey`'s own
  // comment for why this is load-bearing, not just tidiness.
  function applyRenderPayload(payload: RenderPayload): void {
    const previousSlides = manifest()?.slides ?? []
    setManifest({ ...payload.manifest, slides: stabilizeByKey(previousSlides, payload.manifest.slides) })
    setAssetBaseUrl(payload.assetBaseUrl)
    if (canvasWidth() !== payload.manifest.canvasWidth) setCanvasWidth(payload.manifest.canvasWidth)
    if (canvasHeight() !== payload.manifest.canvasHeight) setCanvasHeight(payload.manifest.canvasHeight)
    const drafts: Record<number, SectionDraft> = {}
    for (const section of payload.manifest.sections) {
      drafts[section.startIndex] = { name: section.name, time: formatDurationMs(section.plannedDurationMs) }
    }
    setSectionDrafts(drafts)
    for (const [key, html] of Object.entries(payload.fragments)) {
      const [get, set] = fragmentSignal(key)
      if (get() !== html) set(html)
    }
  }

  // Renders `content` in-process (no disk write — see `engine::pipeline` on
  // the Rust side) and applies the result. `generation` guards against an
  // older, slower-to-resolve render landing after a newer one — with
  // peitho-core embedded directly this is on the order of tens of ms, but
  // IPC calls can still resolve out of order under load.
  let previewGeneration = 0
  async function renderPreview(content: string): Promise<void> {
    const generation = ++previewGeneration
    try {
      const payload = await invoke<RenderPayload>('render_draft', { content })
      if (generation !== previewGeneration) return
      applyRenderPayload(payload)
      setErrorMessage(null)
    } catch (err) {
      if (generation !== previewGeneration) return
      // Keep whatever last rendered successfully on screen; just surface
      // the build error (e.g. a mid-edit unclosed code fence) — a draft
      // that doesn't build yet shouldn't blank the preview.
      setErrorMessage(String(err))
    }
  }

  function currentDraftSource(): string | null {
    const range = selectedRange()
    const index = selectedIndex()
    if (!range || index === null) return null
    const newSlideText = buildSlideText(pageConfig(), bodyDraft(), noteDraft())
    const source = fullSource()
    return source.slice(0, range.start) + newSlideText + source.slice(range.end)
  }

  // Fast lane: re-renders (in-memory only) a beat after typing stops, so
  // Preview reflects Editor/notes edits without waiting on a disk save.
  // Re-fires on every bodyDraft/noteDraft change, so each keystroke resets
  // the timer via the cleanup below.
  createEffect(() => {
    bodyDraft()
    noteDraft()
    if (!isDirty()) return
    const timer = window.setTimeout(() => {
      const draft = currentDraftSource()
      if (draft !== null) void renderPreview(draft)
    }, 80)
    return () => window.clearTimeout(timer)
  })

  // Slow lane: persists to disk well after the fast lane already has
  // Preview showing the latest content, so saving never competes with
  // typing for responsiveness.
  createEffect(() => {
    bodyDraft()
    noteDraft()
    if (!isDirty()) return
    let live = true
    let timerId: number
    const attempt = () => {
      if (!live) return
      if (isBusy()) {
        timerId = window.setTimeout(attempt, 150)
        return
      }
      void handleSave()
    }
    timerId = window.setTimeout(attempt, 600)
    return () => {
      live = false
      window.clearTimeout(timerId)
    }
  })

  // This reloads the whole iframe (a visible flash) on every content
  // change, which is worth fixing now that renders happen on every
  // keystroke — but an earlier attempt at that (patching content in place
  // via `postMessage`, srcdoc set once through a `ref`) broke thumbnail
  // rendering outright, most likely because this compiler's `.map()` output
  // doesn't guarantee a mounted row's `ref` fires only once the way that
  // fix assumed. Reverted to the simple, known-correct reactive `srcdoc`
  // binding; revisit the flicker separately once that assumption is
  // actually verified against the compiled output.
  function buildSlideDoc(fragmentHtml: string): string {
    return buildSlidePreviewDoc(fragmentHtml, assetBaseUrl() ?? '', canvasWidth(), canvasHeight())
  }

  async function refreshSource(preserveSelection: boolean): Promise<void> {
    const source = await invoke<string>('read_deck_source')
    setFullSource(source)
    const ranges = splitSlides(source)
    setSlideRanges(ranges)
    const currentIndex = selectedIndex()
    const nextIndex = preserveSelection && currentIndex !== null && currentIndex < ranges.length
      ? currentIndex
      : ranges.length > 0 ? 0 : null
    setSelectedIndex(nextIndex)
    const { rest: withoutNote, note } = extractNote(nextIndex !== null ? ranges[nextIndex].text : '')
    const { rest, config } = extractPageComment(withoutNote)
    setBodyDraft(rest)
    setNoteDraft(note)
    setOriginalBody(rest)
    setOriginalNote(note)
    setPageConfig(config)
    syncEditorFields()
  }

  // Loads a deck into *this* window, replacing whatever it currently shows
  // (nothing, on first mount via `take_pending_deck`/`dev_default_deck` —
  // see `onMount` below; the welcome screen, via
  // `openDeckPreferringCurrentWindow`). Never call this directly for a
  // window that might already have a *different* deck open — that's what
  // `openDeckInNewWindow` is for.
  async function loadDeck(path: string): Promise<void> {
    setIsBusy(true)
    setErrorMessage(null)
    try {
      const info = await invoke<DeckSessionInfo>('open_deck', { path })
      setDeckPath(info.deckPath)
      applyRenderPayload(info.render)
      await refreshSource(false)
      setStatusMessage(`Opened ${info.deckPath}`)
    } catch (err) {
      setErrorMessage(String(err))
      // A failure here often means the path was a Recent entry pointing at
      // a folder that's since moved or been deleted — re-fetch so a
      // now-stale entry (Rust prunes it against disk on every read) isn't
      // still sitting there to fail the exact same way if clicked again.
      void refreshRecentDecks()
    } finally {
      setIsBusy(false)
    }
  }

  async function refreshRecentDecks(): Promise<void> {
    try {
      setRecentDecks(await invoke<string[]>('get_recent_decks'))
    } catch {
      // Best-effort — an empty Recent list just means nothing to suggest.
    }
  }

  // A window that already has a deck open never loses it just because
  // another one was picked from, say, the native menu — a user comparing
  // two decks side by side needs both on screen at once, so that always
  // spawns a separate window. A window still on the welcome screen has
  // nothing to lose, though, so filling *that* window beats leaving it
  // stranded, empty, behind a new one.
  async function openDeckInNewWindow(path: string): Promise<void> {
    try {
      await invoke('open_deck_window', { path })
    } catch (err) {
      setErrorMessage(String(err))
    }
  }

  async function openDeckPreferringCurrentWindow(path: string): Promise<void> {
    if (deckPath() === null) {
      await loadDeck(path)
    } else {
      await openDeckInNewWindow(path)
    }
  }

  async function handleOpenFolder(): Promise<void> {
    const picked = await openDialog({ directory: true, title: 'Open a Peitho deck folder' })
    if (!picked || typeof picked !== 'string') return
    await openDeckPreferringCurrentWindow(picked)
  }

  async function handleNewDeck(): Promise<void> {
    const parent = await openDialog({ directory: true, title: 'Choose a location for the new deck' })
    if (!parent || typeof parent !== 'string') return
    setNewDeckParentDir(parent)
    setNewDeckName('')
    setNewDeckModalOpen(true)
  }

  async function submitNewDeck(): Promise<void> {
    const parent = newDeckParentDir()
    const name = newDeckName().trim()
    if (!parent || !name) return
    setIsBusy(true)
    setErrorMessage(null)
    try {
      const path = await invoke<string>('create_deck', { parentDir: parent, name })
      setNewDeckModalOpen(false)
      await openDeckPreferringCurrentWindow(path)
    } catch (err) {
      setErrorMessage(String(err))
    } finally {
      setIsBusy(false)
    }
  }

  // Writes a full deck.md replacement to disk, then re-derives every piece
  // of state that depends on file content (ranges, manifest, thumbnails,
  // the editor's drafts) from what actually gets persisted — the single
  // path `handleSave`, section-header edits, and drag-reorder all funnel
  // through, so none of them can drift from what `save_deck_source` wrote.
  // Renders first (in-memory) so Preview/thumbnails reflect the change
  // immediately, then persists to disk.
  //
  // Even though a render is fast now, the user hasn't stopped
  // typing/navigating just because this is in flight. Snapshotting
  // selection + drafts *before* awaiting and only applying them after *if*
  // nothing has changed in the meantime is what stops a slow, stale
  // response from yanking the cursor or reverting text out from under
  // someone who kept typing — without this guard the editor could still
  // visibly "fight" the user on a slower render (a large deck, a cold
  // custom-syntax load, ...).
  // `expectedDraft`: when the caller already knows exactly what it injected
  // for the focus slide (`handleSave` does — it built `nextSource` from
  // `bodyDraft()`/`noteDraft()` itself), pass those back here so they can be
  // reused verbatim instead of round-tripping through `extractNote`.
  // `extractNote` trims/collapses blank lines — appropriate for a *fresh*
  // read from disk, but lossy when looped back into the live draft: it
  // would silently swallow trailing whitespace the user just typed (e.g.
  // typing "the " mid-word) a few hundred ms later when this resync lands,
  // which then makes the *next* backspace remove a different character than
  // the one the user was looking at — exactly the "backspace deletes more
  // than I pressed" symptom. Callers that don't know the exact value up
  // front (section-header edits, drag-reorder) omit it and accept that
  // small risk, since those are discrete one-off actions, not continuous
  // typing.
  async function commitChange(
    nextSource: string,
    focusIndex: number | null,
    expectedDraft?: { body: string; note: string },
  ): Promise<void> {
    const selectedBefore = selectedIndex()
    const bodyBefore = bodyDraft()
    const noteBefore = noteDraft()
    setIsBusy(true)
    setErrorMessage(null)
    try {
      const payload = await invoke<RenderPayload>('render_draft', { content: nextSource })
      applyRenderPayload(payload)
      await invoke('save_deck_source', { content: nextSource })
      setFullSource(nextSource)
      const ranges = splitSlides(nextSource)
      setSlideRanges(ranges)
      const nextIndex = focusIndex !== null && focusIndex < ranges.length
        ? focusIndex
        : ranges.length > 0 ? 0 : null

      // Only move the user's selection if they haven't already navigated
      // elsewhere themselves while this was in flight. (Drag-reorder is the
      // one caller that legitimately wants to move selection to follow the
      // slide it just moved — every other caller passes the slide that was
      // already selected, so this is a no-op for them.)
      if (selectedIndex() === selectedBefore) {
        setSelectedIndex(nextIndex)
      }
      const activeIndex = selectedIndex()
      if (activeIndex !== null && activeIndex === nextIndex) {
        const rawText = ranges[activeIndex]?.text ?? ''
        const { rest: withoutNote, note: extractedNote } = extractNote(rawText)
        const { rest: extractedBody, config } = extractPageComment(withoutNote)
        const { rest, note } = expectedDraft
          ? { rest: expectedDraft.body, note: expectedDraft.note }
          : { rest: extractedBody, note: extractedNote }
        setOriginalBody(rest)
        setOriginalNote(note)
        setPageConfig(config)
        // Only overwrite the live draft if it still matches what we just
        // sent — if the user typed more in the meantime, leave their newer
        // text alone; isDirty() stays true against the fresh originalBody
        // above, so the autosave effect naturally fires again for it.
        if (bodyDraft() === bodyBefore && noteDraft() === noteBefore) {
          setBodyDraft(rest)
          setNoteDraft(note)
          syncEditorFields()
        }
      }
      setStatusMessage('Saved')
    } catch (err) {
      setErrorMessage(String(err))
    } finally {
      setIsBusy(false)
    }
  }

  // The saved text for a slide, unless it's the one currently open with
  // unsaved edits — then the live draft, so an operation on a *different*
  // slide (reordering, editing another section's time) never clobbers
  // in-progress work in the editor.
  function currentSlideText(index: number): string {
    if (index === selectedIndex() && isDirty()) return buildSlideText(pageConfig(), bodyDraft(), noteDraft())
    return slideRanges()[index]?.text ?? ''
  }

  // `window.confirm` used to gate this on discarding unsaved edits, but
  // Tauri's webview doesn't reliably surface it (it can resolve as
  // cancelled with no dialog shown at all), which silently blocked every
  // slide switch attempted while the fast/slow save lanes hadn't caught up
  // yet. There's no need to ask at all: flush the pending edit through the
  // same save path the auto-save effects use, then switch — never losing
  // work, never blocking on a dialog the webview won't show.
  async function selectSlide(index: number): Promise<void> {
    if (index === selectedIndex()) return
    if (isDirty()) await handleSave()
    const { rest: withoutNote, note } = extractNote(slideRanges()[index]?.text ?? '')
    const { rest, config } = extractPageComment(withoutNote)
    setSelectedIndex(index)
    setBodyDraft(rest)
    setNoteDraft(note)
    setOriginalBody(rest)
    setOriginalNote(note)
    setPageConfig(config)
    syncEditorFields()
  }

  async function handleSave(): Promise<void> {
    const range = selectedRange()
    const index = selectedIndex()
    if (!range || index === null) return
    const body = bodyDraft()
    const note = noteDraft()
    const newSlideText = buildSlideText(pageConfig(), body, note)
    const source = fullSource()
    const nextSource = source.slice(0, range.start) + newSlideText + source.slice(range.end)
    await commitChange(nextSource, index, { body, note })
  }

  // Rebuilds `fullSource` from an ordered list of slide texts, preserving
  // whatever precedes the first slide (YAML frontmatter) and follows the
  // last. Every operation that adds, removes, or reorders slides goes
  // through this rather than slicing `fullSource` directly, so none of
  // them can leave a doubled separator or stray blank line behind.
  function rebuildSource(texts: string[]): string {
    const ranges = slideRanges()
    const source = fullSource()
    const prefix = source.slice(0, ranges[0]?.start ?? 0)
    const suffix = source.slice(ranges[ranges.length - 1]?.end ?? source.length)
    return joinSlideTexts(prefix, texts, suffix)
  }

  // Same as `rebuildSource`, plus keeping the frontmatter `time:` in sync
  // with the sum of every section's own time — required whenever the
  // *set* of slides changes (adding, pasting, or deleting a slide can add
  // or remove a section along with it), unlike a plain reorder, which
  // never changes that sum. Left untouched when the deck uses no sections
  // at all, so a plain deck never gets a `time:` frontmatter block it
  // never asked for.
  function syncedSource(texts: string[]): string {
    const rebuilt = rebuildSource(texts)
    const totalMs = sumSectionTimesMs(texts)
    return totalMs > 0 ? updateFrontmatterTime(rebuilt, totalMs) : rebuilt
  }

  async function commitSectionEdit(startIndex: number): Promise<void> {
    const draft = sectionDrafts()[startIndex]
    const range = slideRanges()[startIndex]
    if (!draft || !range) return
    const slideText = currentSlideText(startIndex)
    const updatedSlideText = updatePageComment(slideText, { section: draft.name, time: draft.time })
    if (updatedSlideText === slideText) return

    let nextSource = fullSource()
    nextSource = nextSource.slice(0, range.start) + updatedSlideText + nextSource.slice(range.end)

    // peitho requires the frontmatter's total time to equal the sum of
    // every section's time — keep that in sync so editing one section's
    // time here doesn't quietly break the next build.
    const editedMs = parseDurationToMs(draft.time)
    if (editedMs !== null) {
      const sections = manifest()?.sections ?? []
      const totalMs = sections.reduce(
        (sum, section) => sum + (section.startIndex === startIndex ? editedMs : section.plannedDurationMs),
        0,
      )
      nextSource = updateFrontmatterTime(nextSource, totalMs)
    }

    await commitChange(nextSource, selectedIndex())
  }

  async function reorderSlides(from: number, to: number): Promise<void> {
    const ranges = slideRanges()
    if (from < 0 || from >= ranges.length || to < 0 || to >= ranges.length) return
    const texts = ranges.map((_, i) => currentSlideText(i).trim())
    const [moved] = texts.splice(from, 1)
    texts.splice(to, 0, moved)
    // A reorder never changes *which* sections exist or their times, only
    // their positions — the frontmatter total can't have gone stale, so
    // this skips `syncedSource`'s (harmless, but pointless) recompute.
    await commitChange(rebuildSource(texts), to)
  }

  // Native HTML5 drag-and-drop (`draggable`/`onDragStart`/`onDrop`) used to
  // back slide reordering, but WKWebView's support for it is unreliable —
  // the same category of bug as `window.confirm` above. Plain
  // mousedown/mousemove/mouseup (already how the column-resize dividers
  // work) sidesteps the browser's native DnD stack entirely.
  function startSlideDrag(index: number) {
    return (event: MouseEvent) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('input, textarea')) return
      // Without this, the browser's own native text-selection drag runs
      // alongside the custom drag below — the mouse path highlights
      // whatever text/inputs it crosses (most visibly the section-name
      // inputs) at the same time the row is being dragged.
      event.preventDefault()
      const startX = event.clientX
      const startY = event.clientY
      let dragging = false
      const onMove = (moveEvent: MouseEvent) => {
        if (!dragging) {
          if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return
          dragging = true
          setDraggedIndex(index)
          document.body.style.userSelect = 'none'
        }
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-slide-row]'))
        // The gap right before the first row whose vertical center the
        // cursor is still above; if the cursor is below every row's center,
        // that's the gap after the last row (rows.length).
        let gap = rows.length
        for (const row of rows) {
          const rect = row.getBoundingClientRect()
          if (moveEvent.clientY < rect.top + rect.height / 2) {
            gap = Number(row.dataset.slideRow)
            break
          }
        }
        setDragOverGap(gap)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.userSelect = ''
        const gap = dragOverGap()
        setDraggedIndex(null)
        setDragOverGap(null)
        if (dragging && gap !== null) {
          // Removing `index` first shifts every later index down by one, so
          // a gap that was after the dragged row lands one earlier once it's
          // gone; a gap at or before it is unaffected.
          const to = gap <= index ? gap : gap - 1
          if (to !== index) void reorderSlides(index, to)
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
  }

  function closeContextMenu(): void {
    setContextMenu(null)
    setLayoutPickerOpen(false)
  }

  function openContextMenu(index: number, event: MouseEvent): void {
    event.preventDefault()
    void selectSlide(index)
    setLayoutPickerOpen(false)
    setContextMenu({ index, x: event.clientX, y: event.clientY })
    void loadLayoutPreviews()
  }

  async function loadLayoutPreviews(): Promise<void> {
    if (layoutPreviews() !== null) return
    try {
      const payload = await invoke<{ previews: { name: string; fragment: string }[]; css: string }>('preview_layouts')
      setLayoutPreviews(payload.previews)
    } catch {
      setLayoutPreviews([])
    }
  }

  function copySlide(index: number): void {
    setClipboardSlideText(currentSlideText(index))
  }

  // Removes a slide by re-joining every other slide's text — the frontmatter
  // time total is re-synced in case the removed slide was itself a section
  // start (see `syncedSource`).
  async function deleteSlide(index: number): Promise<void> {
    const ranges = slideRanges()
    if (ranges.length <= 1) return
    if (index < 0 || index >= ranges.length) return
    const texts = ranges.map((_, i) => currentSlideText(i).trim())
    texts.splice(index, 1)
    await commitChange(syncedSource(texts), Math.min(index, texts.length - 1))
  }

  async function cutSlide(index: number): Promise<void> {
    const ranges = slideRanges()
    if (ranges.length <= 1) return
    setClipboardSlideText(currentSlideText(index))
    await deleteSlide(index)
  }

  // Inserts a blank new slide right after `index` — content-free (no
  // PageComment), so peitho assigns it a key the same way it would for any
  // hand-written slide that never specified one.
  async function addSlide(index: number): Promise<void> {
    const ranges = slideRanges()
    const texts = ranges.map((_, i) => currentSlideText(i).trim())
    const insertAt = Math.min(index + 1, texts.length)
    texts.splice(insertAt, 0, NEW_SLIDE_MARKDOWN)
    await commitChange(syncedSource(texts), insertAt)
  }

  async function pasteSlideAfter(index: number): Promise<void> {
    const clip = clipboardSlideText()
    if (clip === null) return
    const ranges = slideRanges()
    const texts = ranges.map((_, i) => currentSlideText(i).trim())
    const insertAt = Math.min(index + 1, texts.length)
    texts.splice(insertAt, 0, stripPageCommentKey(clip.trim()))
    await commitChange(syncedSource(texts), insertAt)
  }

  async function moveSlide(index: number, direction: 1 | -1): Promise<void> {
    await reorderSlides(index, index + direction)
  }

  // Reads a slide's PageComment config without going through `commitChange`
  // — the live `pageConfig` signal for the open slide (which may have
  // pending edits not yet reflected in `slideRanges`), the raw on-disk text
  // for any other slide.
  function slideConfigOf(index: number): Record<string, unknown> {
    if (index === selectedIndex()) return pageConfig()
    const { rest: withoutNote } = extractNote(slideRanges()[index]?.text ?? '')
    return extractPageComment(withoutNote).config
  }

  // Routed through `syncedSource` (not a direct range-slice replace) so a
  // config change that adds or removes a section (see `toggleSlideSection`)
  // keeps the frontmatter time total correct — a no-op resync for updates
  // (layout/draft/skip) that don't touch `section`/`time`.
  async function updateSlideConfig(index: number, updates: Record<string, unknown>): Promise<void> {
    const slideText = currentSlideText(index)
    const updated = updatePageComment(slideText, updates)
    if (updated === slideText) return
    const texts = slideRanges().map((_, i) => (i === index ? updated : currentSlideText(i)).trim())
    await commitChange(syncedSource(texts), index)
  }

  async function changeSlideLayout(index: number, layout: string): Promise<void> {
    await updateSlideConfig(index, { layout })
  }

  async function toggleSlideDraft(index: number): Promise<void> {
    await updateSlideConfig(index, { draft: slideConfigOf(index).draft !== true })
  }

  async function toggleSlideSkip(index: number): Promise<void> {
    await updateSlideConfig(index, { skip: slideConfigOf(index).skip !== true })
  }

  // Toggles whether this slide marks the *start* of a section. peitho
  // requires `section`/`time` to be set together, so both are set (with
  // sensible defaults the user immediately overwrites via the section
  // header's own inline name/time editing) or both cleared — never one
  // without the other.
  async function toggleSlideSection(index: number): Promise<void> {
    const config = slideConfigOf(index)
    if (typeof config.section === 'string') {
      await updateSlideConfig(index, { section: undefined, time: undefined })
    } else {
      await updateSlideConfig(index, { section: 'New Section', time: '30s' })
    }
  }

  // Reacts to the Rust-side file watcher (`deck-file-changed`): an external
  // editor (or an AI agent) wrote deck.md. With no unsaved edits it's safe
  // to just reload; with unsaved edits in the open slide, ask — and if the
  // user wants to keep editing, still adopt the new file for everything
  // *except* that one slide, so a later Save targets the right offsets
  // instead of stomping the external change with stale surrounding text.
  async function handleExternalChange(): Promise<void> {
    if (!deckPath() || isBusy()) return
    const source = await invoke<string>('read_deck_source')
    if (source === fullSource()) return
    if (isDirty()) {
      const discard = window.confirm(
        'This deck changed outside Peitho Studio (e.g. another editor). Reload it and discard your unsaved edits here?',
      )
      if (!discard) {
        const ranges = splitSlides(source)
        setFullSource(source)
        setSlideRanges(ranges)
        const i = selectedIndex()
        if (i !== null && i < ranges.length) {
          const { rest: withoutNote, note } = extractNote(ranges[i].text)
          const { rest, config } = extractPageComment(withoutNote)
          setOriginalBody(rest)
          setOriginalNote(note)
          setPageConfig(config)
        }
        await renderPreview(source)
        setStatusMessage('Deck changed on disk elsewhere — merged around your unsaved edit.')
        return
      }
    }
    await refreshSource(true)
    await renderPreview(fullSource())
    setStatusMessage('Reloaded — the deck changed on disk.')
  }

  onMount(() => {
    void refreshRecentDecks()

    // A window spawned by `open_deck_window` (native "Open Deck…"/"Open
    // Recent", or this app's own welcome-screen buttons) has a deck
    // waiting for it in Rust-side `PendingDecks` — that takes priority
    // over the dev-convenience env var, which only matters for a window
    // with nothing else assigned to it.
    void (async () => {
      const pending = await invoke<string | null>('take_pending_deck')
      if (pending) {
        await loadDeck(pending)
        if (deckPath() === null) {
          // This window exists solely to show `pending` (e.g. a Recent
          // entry that pointed at a folder deleted/moved since it was
          // remembered) — closing it returns focus to whichever window
          // the user was already on, instead of leaving a second,
          // otherwise-empty window sitting on screen with an error banner.
          await getCurrentWindow().close()
        }
        return
      }
      const devDeck = await invoke<string | null>('dev_default_deck')
      if (devDeck) await loadDeck(devDeck)
    })()

    const unlistenFileChanged = listen('deck-file-changed', () => {
      void handleExternalChange()
    })

    // Native "File > New Deck…" (see `build_menu` in lib.rs) still needs
    // this app's own name-entry modal, so it round-trips through here.
    // "Open Deck…"/"Open Recent" are handled entirely Rust-side now (a
    // native folder-picker dialog + `open_deck_window`), since neither
    // needs anything this webview can do.
    const unlistenMenuNew = listen('menu:new-deck', () => { void handleNewDeck() })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && contextMenu() !== null) {
        event.preventDefault()
        closeContextMenu()
        return
      }
      const tag = document.activeElement?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      const count = manifest()?.slides.length ?? 0
      if (count === 0) return
      const current = selectedIndex()
      const key = event.key.toLowerCase()
      if (current !== null) {
        if (event.metaKey && event.shiftKey && event.key === 'ArrowUp') {
          event.preventDefault()
          void moveSlide(current, -1)
          return
        }
        if (event.metaKey && event.shiftKey && event.key === 'ArrowDown') {
          event.preventDefault()
          void moveSlide(current, 1)
          return
        }
        if (event.metaKey && event.key === 'Enter') {
          event.preventDefault()
          void addSlide(current)
          return
        }
        if (event.metaKey && key === 'x') {
          event.preventDefault()
          void cutSlide(current)
          return
        }
        if (event.metaKey && key === 'c') {
          event.preventDefault()
          copySlide(current)
          return
        }
        if (event.metaKey && key === 'v') {
          event.preventDefault()
          void pasteSlideAfter(current)
          return
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          void deleteSlide(current)
          return
        }
      }
      const base = current ?? 0
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        void selectSlide(Math.min(base + 1, count - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        void selectSlide(Math.max(base - 1, 0))
      }
    }
    window.addEventListener('keydown', onKeyDown)

    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown)
      unlistenFileChanged.then(stop => stop())
      unlistenMenuNew.then(stop => stop())
    })
  })

  async function handlePresent(rehearsal: boolean): Promise<void> {
    setErrorMessage(null)
    try {
      await invoke('present_deck', { rehearsal })
      setStatusMessage(rehearsal ? 'Presenting (rehearsal)…' : 'Presenting…')
    } catch (err) {
      setErrorMessage(String(err))
    }
  }

  function startResize(
    getWidth: () => number,
    setWidth: (next: number) => void,
    direction: 1 | -1,
  ) {
    return (event: MouseEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = getWidth()
      // Dragging the Editor/Preview divider toward the Preview side moves
      // the cursor over the Preview `<iframe>` — a separate browsing
      // context, so `mousemove` stops reaching this document's listener
      // the instant the cursor crosses into it (the drag "stops working"
      // past that point, but only in that direction, since dragging the
      // other way never crosses an iframe). Disabling pointer-events on
      // every iframe for the duration of the drag keeps the cursor's
      // moves targeted at this document throughout.
      const iframes = Array.from(document.querySelectorAll('iframe'))
      for (const frame of iframes) frame.style.pointerEvents = 'none'
      const onMove = (moveEvent: MouseEvent) => {
        const delta = (moveEvent.clientX - startX) * direction
        const next = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, startWidth + delta))
        setWidth(next)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        for (const frame of iframes) frame.style.pointerEvents = ''
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
  }

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {deckPath() === null ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm flex flex-col items-center gap-4 px-6">
            <h1 className="text-lg font-semibold">Peitho Studio</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleOpenFolder()}
                disabled={isBusy()}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
              >
                Open Deck…
              </button>
              <button
                type="button"
                onClick={() => void handleNewDeck()}
                disabled={isBusy()}
                className="px-4 py-2 rounded-md border border-border text-sm disabled:opacity-50"
              >
                New Deck…
              </button>
            </div>
            {errorMessage() ? <div className="text-xs text-destructive text-center">{errorMessage()}</div> : null}
            {recentDecks().length > 0 ? (
              <div className="w-full">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recent</div>
                <div className="flex flex-col gap-1">
                  {recentDecks().map(path => (
                    <button
                      type="button"
                      key={path}
                      onClick={() => void openDeckPreferringCurrentWindow(path)}
                      title={path}
                      // A path's most distinguishing part (the deck's own
                      // folder name) is at the *end* — plain `truncate`
                      // elides there first, leaving every entry looking
                      // like the same shared parent directory. `dir="rtl"`
                      // flips which side the ellipsis lands on (to the
                      // left) while the path text itself still renders
                      // left-to-right, so the tail stays visible instead.
                      dir="rtl"
                      className="w-full text-left px-3 py-2 rounded-md border border-border hover:bg-accent text-sm truncate"
                    >
                      {path}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-border">
        <span className="text-sm text-muted-foreground truncate">{deckPath()}</span>
        <div className="flex-1" />
        <div className="relative">
          <div
            className={
              deckPath()
                ? 'flex items-center rounded-full bg-primary text-primary-foreground overflow-hidden'
                : 'flex items-center rounded-full bg-primary text-primary-foreground overflow-hidden opacity-50'
            }
          >
            <button
              type="button"
              disabled={!deckPath()}
              onClick={() => {
                setPresentMenuOpen(false)
                void handlePresent(false)
              }}
              className="pl-4 pr-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <span aria-hidden="true">▶</span>
              Present
            </button>
            <button
              type="button"
              disabled={!deckPath()}
              onClick={() => setPresentMenuOpen(!presentMenuOpen())}
              aria-label="Present options"
              className="pl-2 pr-3 py-1.5 border-l border-primary-foreground/25 disabled:cursor-not-allowed"
            >
              <span aria-hidden="true">▾</span>
            </button>
          </div>
          {presentMenuOpen() ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPresentMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-20">
                <button
                  type="button"
                  onClick={() => {
                    setPresentMenuOpen(false)
                    void handlePresent(true)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-accent flex items-start gap-2.5"
                >
                  <span aria-hidden="true" className="mt-0.5">▶</span>
                  <span>
                    <div className="text-sm font-medium">Present (Rehearsal)</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Time each section as you go and save it for comparison against the plan.</div>
                  </span>
                </button>
              </div>
            </>
          ) : null}
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div
          className="shrink-0 flex flex-col border-r border-border min-h-0"
          style={`width: ${slideListWidth()}px`}
        >
          <div className="flex-1 overflow-y-auto p-2">
            {manifest() === null ? (
              <p className="text-sm text-muted-foreground">Open a deck to see its slides.</p>
            ) : (
              manifest()!.slides.map(slide => (
                  <div
                    key={slide.key}
                    data-slide-row={String(indexSignal(slide.key)[0]())}
                    onMouseDown={startSlideDrag(indexSignal(slide.key)[0]())}
                    onContextMenu={e => openContextMenu(indexSignal(slide.key)[0](), e)}
                    className={
                      (draggedIndex() === (indexSignal(slide.key)[0]()) ? 'opacity-60 scale-95 shadow-lg rounded-md ' : '')
                      + (draggedIndex() !== null && dragOverGap() === (indexSignal(slide.key)[0]()) ? 'border-t-2 border-t-primary ' : '')
                      + (draggedIndex() !== null && (indexSignal(slide.key)[0]()) === manifest()!.slides.length - 1 && dragOverGap() === (indexSignal(slide.key)[0]()) + 1 ? 'border-b-2 border-b-primary ' : '')
                      + 'cursor-grab'
                    }
                  >
                    {sectionStartByIndex()[indexSignal(slide.key)[0]()] ? (
                      <div className="flex items-center gap-1 pt-3 pb-1">
                        <input
                          value={sectionDrafts()[indexSignal(slide.key)[0]()]?.name ?? sectionStartByIndex()[indexSignal(slide.key)[0]()].name}
                          onInput={e => setSectionDrafts(prev => ({
                            ...prev,
                            [indexSignal(slide.key)[0]()]: { name: e.target.value, time: prev[indexSignal(slide.key)[0]()]?.time ?? formatDurationMs(sectionStartByIndex()[indexSignal(slide.key)[0]()].plannedDurationMs) },
                          }))}
                          onBlur={() => void commitSectionEdit(indexSignal(slide.key)[0]())}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                          className="min-w-0 flex-1 bg-transparent outline-none text-xs font-semibold text-foreground/80"
                        />
                        <input
                          value={sectionDrafts()[indexSignal(slide.key)[0]()]?.time ?? formatDurationMs(sectionStartByIndex()[indexSignal(slide.key)[0]()].plannedDurationMs)}
                          onInput={e => setSectionDrafts(prev => ({
                            ...prev,
                            [indexSignal(slide.key)[0]()]: { name: prev[indexSignal(slide.key)[0]()]?.name ?? sectionStartByIndex()[indexSignal(slide.key)[0]()].name, time: e.target.value },
                          }))}
                          onBlur={() => void commitSectionEdit(indexSignal(slide.key)[0]())}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                          className="w-10 shrink-0 bg-transparent outline-none text-xs text-muted-foreground text-right"
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      title={slide.text.title || `Slide ${String((indexSignal(slide.key)[0]()) + 1)}`}
                      onClick={() => selectSlide(indexSignal(slide.key)[0]())}
                      className="w-full flex items-start gap-2 mb-2"
                    >
                      <span className="w-4 pt-1 text-xs text-muted-foreground shrink-0">{String((indexSignal(slide.key)[0]()) + 1)}</span>
                      {/* A semi-transparent hover border color (e.g. `border-foreground/40`)
                          paints over this element's *own* `bg-black` — CSS backgrounds clip
                          under the border area by default — so it looked black instead of
                          gray. `muted-foreground` is used solid (no alpha) to avoid that. */}
                      <span className="flex-1 flex flex-col gap-0.5 min-w-0">
                        <span
                          className={selectedIndex() === (indexSignal(slide.key)[0]())
                            ? 'block relative rounded-md border-4 border-[#eab308] overflow-hidden bg-black'
                            : 'block relative rounded-md border-2 border-border overflow-hidden bg-black hover:border-4 hover:border-muted-foreground'}
                          style={`aspect-ratio: ${String(canvasWidth())} / ${String(canvasHeight())}`}
                        >
                          <iframe
                            title={`Slide ${String((indexSignal(slide.key)[0]()) + 1)}`}
                            srcdoc={buildSlideDoc(fragmentSignal(slide.key)[0]())}
                            className="w-full h-full border-0"
                            style="pointer-events: none"
                          />
                          {/* `pointer-events: none` above keeps normal clicks/drags
                              passing through to the row beneath, but WKWebView still
                              routes a right-click landing on the iframe to its own
                              native "Open Frame in New Window" menu regardless — this
                              fully transparent, ordinary (non-`pointer-events:none`)
                              overlay blocks the iframe from ever being the event
                              target at all, so both clicks and right-clicks always
                              bubble from here up to the row/button instead. */}
                          <div className="absolute inset-0" />
                        </span>
                        {slide.skip ? <span className="text-xs text-destructive">skip</span> : null}
                      </span>
                    </button>
                  </div>
                ))
            )}
          </div>
        </div>

        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startResize(slideListWidth, setSlideListWidth, 1)}
        />

        <div
          className="shrink-0 flex flex-col border-r border-border min-h-0"
          style={`width: ${editorWidth()}px`}
        >
          {selectedRange() === null ? (
            <p className="p-3 text-sm text-muted-foreground">Select a slide to edit it.</p>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <textarea
                ref={el => {
                  bodyTextareaEl = el
                  el.value = bodyDraft()
                  el.addEventListener('compositionstart', () => { bodyComposing = true })
                  el.addEventListener('compositionend', () => { bodyComposing = false })
                }}
                onInput={e => setBodyDraft(e.target.value)}
                spellcheck={false}
                className="flex-1 resize-none p-3 font-mono text-sm bg-background text-foreground outline-none border-b border-border"
              />
              <div className="shrink-0 h-40 flex flex-col">
                <div className="h-6 shrink-0 flex items-center px-3 text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
                  Speaker Notes
                </div>
                <textarea
                  ref={el => {
                    noteTextareaEl = el
                    el.value = noteDraft()
                    el.addEventListener('compositionstart', () => { noteComposing = true })
                    el.addEventListener('compositionend', () => { noteComposing = false })
                  }}
                  onInput={e => setNoteDraft(e.target.value)}
                  placeholder="Notes for the presenter — not shown to the audience."
                  className="flex-1 resize-none p-3 text-sm bg-background text-foreground outline-none"
                />
              </div>
            </div>
          )}
        </div>

        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startResize(editorWidth, setEditorWidth, 1)}
        />

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {selectedSlide() ? (
            <iframe
              title="Selected slide preview"
              srcdoc={buildSlideDoc(fragmentSignal(selectedSlide()!.key)[0]())}
              className="flex-1 w-full border-0"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {assetBaseUrl() ? 'Select a slide to preview it.' : 'Open a deck to preview it.'}
            </div>
          )}
        </div>
      </div>

      {errorMessage() ? (
        <div className="px-3 py-1.5 bg-destructive/10 text-destructive text-xs shrink-0 border-t border-destructive/30">
          {errorMessage()}
        </div>
      ) : null}
      <footer className="h-6 shrink-0 flex items-center px-3 text-xs text-muted-foreground border-t border-border">
        {statusMessage()}
      </footer>

      {/* This whole block (backdrop + both panels) is mounted exactly once,
          for the app's entire lifetime — visibility is a `hidden` class
          toggle on `contextMenu() === null`, never a mount/unmount. A child
          conditional (`layoutPreviews() === null ? Loading : ... : ...`)
          inside a subtree that gets freshly mounted on every open (the old
          `{contextMenu() ? (...) : null}` gate) never showed its later,
          post-mount branches here — not from `.map()`, not from CSS Grid,
          not from any nesting/prop variant tried — while the exact same
          kind of conditional inside the app's permanently-mounted tree
          (e.g. `manifest() === null ? ... : ...` for the slide list) has
          worked correctly all session. Keeping this permanently mounted
          like that one, instead of gated on `contextMenu()`, sidesteps
          whatever that remount-specific issue is. */}
      <div
        className={(contextMenu() === null ? 'hidden ' : '') + 'fixed inset-0 z-30'}
        onClick={closeContextMenu}
        onContextMenu={e => { e.preventDefault(); closeContextMenu() }}
      />
      <div
        className={(contextMenu() === null || layoutPickerOpen() ? 'hidden ' : '') + 'fixed w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-40 text-sm'}
        style={`left: ${String(contextMenu()?.x ?? 0)}px; top: ${String(contextMenu()?.y ?? 0)}px`}
      >
        <button
          type="button"
          onClick={() => { void addSlide(contextMenu()!.index); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent"
        >
          <span>New Slide</span><span className="text-xs text-muted-foreground">⌘⏎</span>
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          onClick={() => { void cutSlide(contextMenu()!.index); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent"
        >
          <span>Cut</span><span className="text-xs text-muted-foreground">⌘X</span>
        </button>
        <button
          type="button"
          onClick={() => { copySlide(contextMenu()!.index); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent"
        >
          <span>Copy</span><span className="text-xs text-muted-foreground">⌘C</span>
        </button>
        <button
          type="button"
          disabled={clipboardSlideText() === null}
          onClick={() => { void pasteSlideAfter(contextMenu()!.index); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Paste</span><span className="text-xs text-muted-foreground">⌘V</span>
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={(manifest()?.slideCount ?? 0) <= 1}
          onClick={() => { void deleteSlide(contextMenu()!.index); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent text-destructive"
        >
          <span>Delete</span><span className="text-xs text-muted-foreground">⌦</span>
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          onClick={() => { setLayoutPickerOpen(v => !v) }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent"
        >
          <span>Change Layout</span><span aria-hidden="true">{layoutPickerOpen() ? '▾' : '▸'}</span>
        </button>
        {layoutPickerOpen() ? (
          <div className="pl-3 max-h-40 overflow-y-auto">
            {layoutPickerView() === 'loading' ? (
              <div className="px-3 py-1.5 text-xs text-muted-foreground">Loading…</div>
            ) : layoutPickerView() === 'empty' ? (
              <div className="px-3 py-1.5 text-xs text-muted-foreground">No layouts found</div>
            ) : (
              layoutPreviews()!.map(preview => (
                <button
                  type="button"
                  key={preview.name}
                  onClick={() => { void changeSlideLayout(contextMenu()!.index, preview.name); closeContextMenu() }}
                  className="w-full text-left px-3 py-1.5 hover:bg-accent text-xs"
                >
                  {preview.name}
                </button>
              ))
            )}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => { void toggleSlideDraft(contextMenu()!.index); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent"
        >
          <span>Mark as Draft</span>
          {contextMenu() !== null && slideConfigOf(contextMenu()!.index).draft === true ? <span aria-hidden="true">✓</span> : null}
        </button>
        <button
          type="button"
          onClick={() => { void toggleSlideSkip(contextMenu()!.index); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent"
        >
          <span>Skip in Present</span>
          {contextMenu() !== null && slideConfigOf(contextMenu()!.index).skip === true ? <span aria-hidden="true">✓</span> : null}
        </button>
        <button
          type="button"
          onClick={() => { void toggleSlideSection(contextMenu()!.index); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent"
        >
          <span>Section Start</span>
          {contextMenu() !== null && typeof slideConfigOf(contextMenu()!.index).section === 'string' ? <span aria-hidden="true">✓</span> : null}
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={(contextMenu()?.index ?? 0) <= 0}
          onClick={() => { void moveSlide(contextMenu()!.index, -1); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Move Slide Up</span><span className="text-xs text-muted-foreground">⌘⇧↑</span>
        </button>
        <button
          type="button"
          disabled={(contextMenu()?.index ?? 0) >= (manifest()?.slideCount ?? 1) - 1}
          onClick={() => { void moveSlide(contextMenu()!.index, 1); closeContextMenu() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Move Slide Down</span><span className="text-xs text-muted-foreground">⌘⇧↓</span>
        </button>
      </div>
        </>
      )}

      {newDeckModalOpen() ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setNewDeckModalOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="w-full max-w-sm rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-4">
              <div className="text-sm font-medium mb-3">New Deck</div>
              <input
                type="text"
                value={newDeckName()}
                onInput={e => setNewDeckName(e.target.value)}
                placeholder="Deck name"
                autofocus
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm outline-none mb-1"
                onKeyDown={e => {
                  if (e.key === 'Enter') void submitNewDeck()
                  if (e.key === 'Escape') setNewDeckModalOpen(false)
                }}
              />
              <div className="text-xs text-muted-foreground mb-3 truncate">{newDeckParentDir()}</div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewDeckModalOpen(false)}
                  className="px-3 py-1.5 rounded-md border border-border text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={newDeckName().trim() === ''}
                  onClick={() => void submitNewDeck()}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
