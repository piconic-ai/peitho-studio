'use client'

import { createSignal, createMemo, createEffect, onMount, onCleanup } from '@barefootjs/client'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createTauriDeckIpc } from '../ipc/deckIpc'
import { type ManifestSlide } from '../domain/render'
import { clampMenuPosition } from '../domain/geometry'
import { type PageConfig } from '../domain/pageConfig'
import { type SelectionPlan, type SlideFields, reconcileAfterCommit, withRefreshedSaved, withDraftBody, withDraftNote } from '../domain/editorSession'
import { type SlideCommand, applyCommand, needsTimeResync, selectionPlanFor, validate } from '../domain/slideCommands'
import { arm, move, dropTarget, cancel } from '../domain/drag'
import { indexOf as contextMenuIndexOf, positionOf as contextMenuPositionOf, isLayoutPickerOpen, menuItems as computeMenuItems } from '../domain/contextMenu'
import { type DeckEvent, decide } from '../domain/deckLifecycle'
import { gapUnderCursor, attachDragListeners, setDragAffordance } from '../dom/dragGesture'
import { startColumnResize } from '../dom/columnResize'
import { createSlideStylesheet, ensureFontFaces, patchSlideCanvas } from '../dom/slideCanvas'
import { createUiStore } from '../state/uiStore'
import { createRenderStore } from '../state/renderStore'
import { createEditorStore } from '../state/editorStore'
import { createDeckStore } from '../state/deckStore'
import {
  splitSlides,
  extractNote,
  extractPageComment,
  buildSlideText,
  updatePageComment,
  slugifyTitle,
  uniqueSlideKey,
  clampFocusIndex,
  extractHeadingText,
  parseDurationToMs,
  updateFrontmatterTime,
  formatDurationMs,
  joinSlideTexts,
  sumSectionTimesMs,
} from '../domain/slides'
import { WelcomeScreen } from './WelcomeScreen'
import { NewDeckModal } from './NewDeckModal'
import { DeckHeader } from './DeckHeader'
import { StatusBar } from './StatusBar'
import { SlidePreview } from './SlidePreview'
import { SlideEditor } from './SlideEditor'
import { SlideContextMenu } from './SlideContextMenu'
import { SlideList } from './SlideList'

// Just the heading — `addSlide` attaches an explicit, collision-free
// PageComment `key` around this (see its own comment for why).
const NEW_SLIDE_MARKDOWN = '# New Slide\n'

export function Studio() {
  const deckIpc = createTauriDeckIpc()
  // Deck lifecycle ADT (welcome/naming-new-deck/creating/opening/open) and
  // its projections — see `state/deckStore.ts`.
  const deck = createDeckStore()
  // Applies `event` to the current lifecycle via `decide`, commits the
  // resulting state, and runs whichever IPC call the transition implies
  // — awaited, so a caller that needs to know the outcome (`onMount`'s
  // pending-deck load) can inspect `deck.deckLifecycle()` right after this
  // resolves. `rejected` decisions are silently dropped: every caller
  // already only fires events its own UI state makes reachable (e.g. the
  // Create button is `disabled` while `deck.isBusy()`), so a rejection here
  // would mean a caller raced its own guard, not something worth
  // surfacing to the user.
  async function dispatch(event: DeckEvent): Promise<void> {
    const decision = decide(deck.deckLifecycle(), event)
    if (decision.kind === 'rejected') return
    const next = decision.next
    deck.setDeckLifecycle(next)
    if (decision.effect === 'invoke-open' && next.kind === 'opening') {
      await runOpen(next.path)
    } else if (decision.effect === 'invoke-create' && next.kind === 'creating') {
      await runCreate(next.parentDir, next.name)
    } else if (decision.effect === 'spawn-window' && event.type === 'open-requested') {
      await openDeckInNewWindow(event.path)
    }
  }
  // The `invoke-open` effect: opens `path` in *this* window. Feeds its
  // outcome back through `dispatch` (`opened`/`failed`) rather than
  // setting `deckLifecycle` directly, so `creating` -> `opening` ->
  // `open` always goes through the same one state-transition table
  // regardless of which event started the chain.
  async function runOpen(path: string): Promise<void> {
    setErrorMessage(null)
    try {
      const info = await deckIpc.openDeck(path)
      render.applyRenderPayload(info.render)
      await refreshSource(false)
      setStatusMessage(`Opened ${info.deckPath}`)
      await dispatch({ type: 'opened', deckPath: info.deckPath })
    } catch (err) {
      setErrorMessage(String(err))
      // A failure here often means the path was a Recent entry pointing
      // at a folder that's since moved or been deleted — re-fetch so a
      // now-stale entry (Rust prunes it against disk on every read)
      // isn't still sitting there to fail the exact same way if clicked
      // again.
      void refreshRecentDecks()
      await dispatch({ type: 'failed', message: String(err) })
    }
  }
  async function runCreate(parentDir: string, name: string): Promise<void> {
    setErrorMessage(null)
    try {
      const path = await deckIpc.createDeck(parentDir, name)
      await dispatch({ type: 'created', path })
    } catch (err) {
      setErrorMessage(String(err))
      await dispatch({ type: 'failed', message: String(err) })
    }
  }
  // The `spawn-window` effect — modeled in `domain/deckLifecycle.ts` for
  // completeness (an `open` window that somehow receives another
  // `open-requested` shouldn't lose its own deck), but as of this
  // writing nothing in this file can actually fire `open-requested`
  // while `open`: the buttons/Recent entries that dispatch it only
  // render on the welcome screen, and native "Open Recent" opens a new
  // window entirely Rust-side without going through this component.
  async function openDeckInNewWindow(path: string): Promise<void> {
    try {
      await deckIpc.openDeckWindow(path)
    } catch (err) {
      setErrorMessage(String(err))
    }
  }
  // Manifest/fragments/canvas size/asset base URL/section drafts — see
  // `state/renderStore.ts`.
  const render = createRenderStore()
  // Editor session ADT (selection/saved/draft), source text/ranges, and
  // their projections — see `state/editorStore.ts`.
  const editor = createEditorStore()
  // Drag gesture, context menu/layout-picker, in-app clipboard, Present
  // dropdown, column widths — see `state/uiStore.ts` for what each field
  // means. Orchestration that spans this store and another concern
  // (`startSlideDrag` ending in `reorderSlides`, `openContextMenu` also
  // calling `selectSlide`) stays here in the composition root rather than
  // moving into the store itself.
  //
  // A previous version of this comment claimed a `createXxxStore()`
  // factory couldn't work here — that a signal declared inside a function
  // called from this component, rather than with `createSignal` literally
  // written in this file, showed `deps: []` in `bf debug graph` and never
  // updated the DOM. That was wrong: a later, more careful repro (Step 9
  // of `todo/archive/studio-tsx-refactoring.md`) showed the exact same factory
  // shape updating correctly via BarefootJS's dynamic (wrap-by-default)
  // reactivity tracking, which `bf debug graph`'s static analysis doesn't
  // capture. See CLAUDE.md's BarefootJS pitfalls for the full account.
  const ui = createUiStore()
  // Distinct from `isBusy` above (the deck-lifecycle one): this guards
  // `commitChange`'s own in-flight save, which used to share the same
  // `isBusy` signal with the welcome-screen open/create flow. The two
  // never actually overlapped in practice (the welcome screen only
  // shows while `deck.deckPath() === null`, and `commitChange` only runs
  // once a deck is open), but sharing one flag for two unrelated
  // "something is in flight" meanings was exactly the kind of implicit
  // coupling this refactor is trying to remove.
  const [isSavingSlide, setIsSavingSlide] = createSignal(false)
  const [statusMessage, setStatusMessage] = createSignal('')
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [errorMessageCopied, setErrorMessageCopied] = createSignal(false)
  // Shown centered in place of the whole 3-pane layout until a deck is
  // open. `recentDecks` (full deck.md paths) is persisted Rust-side (see
  // `get_recent_decks`/`remember_recent_deck` in peitho.rs) rather than in
  // `localStorage`, since the native File > Open Recent submenu needs the
  // same list and has no access to this webview's storage.
  const [recentDecks, setRecentDecks] = createSignal<string[]>([])

  // Plain (non-reactive) DOM handles for the two editor textareas — see the
  // note above `syncEditorFields` for why these are *not* driven by a
  // reactive `value={...}` binding.
  let bodyTextareaEl: HTMLTextAreaElement | undefined
  let noteTextareaEl: HTMLTextAreaElement | undefined
  // The context menu is permanently mounted (only its `hidden` class
  // toggles — see the comment above its JSX for why), so its `ref` fires
  // exactly once and this stays valid for the component's whole lifetime.
  let contextMenuEl: HTMLElement | undefined
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
    if (bodyTextareaEl && !bodyComposing && bodyTextareaEl.value !== editor.bodyDraft()) bodyTextareaEl.value = editor.bodyDraft()
    if (noteTextareaEl && !noteComposing && noteTextareaEl.value !== editor.noteDraft()) noteTextareaEl.value = editor.noteDraft()
  }

  function onBodyTextareaRef(el: HTMLTextAreaElement): void {
    bodyTextareaEl = el
    el.value = editor.bodyDraft()
    el.addEventListener('compositionstart', () => { bodyComposing = true })
    el.addEventListener('compositionend', () => { bodyComposing = false })
  }

  function onNoteTextareaRef(el: HTMLTextAreaElement): void {
    noteTextareaEl = el
    el.value = editor.noteDraft()
    el.addEventListener('compositionstart', () => { noteComposing = true })
    el.addEventListener('compositionend', () => { noteComposing = false })
  }

  const layoutPickerView = createMemo<'loading' | 'empty' | 'ready'>(() => {
    const previews = ui.layoutPreviews()
    if (previews === null) return 'loading'
    if (previews.length === 0) return 'empty'
    return 'ready'
  })
  const currentMenuItems = createMemo(() => computeMenuItems(ui.contextMenu(), {
    slideCount: render.manifest()?.slideCount ?? 0,
    hasClipboard: ui.clipboardSlideText() !== null,
    configOf: slideConfigOf,
  }))
  const selectedSlide = createMemo<ManifestSlide | null>(() => {
    const i = editor.selectedIndex()
    if (i === null) return null
    return render.manifest()?.slides[i] ?? null
  })
  // `selectedSlide()` itself is a *new object* on every keystroke (even to
  // some other slide — see `stabilizeByKey` in slides.ts), but a memo's
  // own output is compared by value before it notifies anyone, and two
  // strings that read the same are `Object.is`-equal regardless of which
  // slide object produced them. Deriving just the key through a memo is
  // what lets the preview pane (below) depend on "which slide is
  // selected" without also depending on "has its content changed".
  const selectedSlideKey = createMemo<string | null>(() => selectedSlide()?.key ?? null)

  // One `CSSStyleSheet` shared by every Shadow DOM thumbnail canvas, so a
  // theme change costs a single `replaceSync` here instead of a re-parse
  // per thumbnail. Sharing the *object* is also what makes mount order
  // irrelevant: a row whose `ref` adopts this sheet before the effect below
  // has ever run still picks the CSS up when it lands, with no remount.
  // `SlideList` gets the accessor, never `slideStylesheet` itself: the
  // compiler inlines a `const`'s initializer into the prop getter it lowers
  // (that's what keeps a derived prop reactive), which for an initializer
  // that *constructs* something hands every reader its own fresh instance —
  // here, a separately-parsed sheet per row that no `replaceSync` reaches.
  const slideStylesheet = createSlideStylesheet(render.slideStylesheetText())
  function getSlideStylesheet(): CSSStyleSheet {
    return slideStylesheet
  }
  createEffect(() => {
    slideStylesheet.replaceSync(render.slideStylesheetText())
  })
  createEffect(() => {
    ensureFontFaces(render.fontFaceCss())
  })

  // The same shared-object/accessor-prop pattern, for the "Change Layout"
  // picker's grid. Its own sheet rather than `slideStylesheet`: this CSS
  // comes from `preview_layouts`' separate render, which deliberately never
  // touches the deck's live asset server (see its Rust doc comment), so it
  // arrives — and goes stale — independently of the deck's own.
  const layoutPreviewStylesheet = createSlideStylesheet(ui.layoutPreviewStylesheetText())
  function getLayoutPreviewStylesheet(): CSSStyleSheet {
    return layoutPreviewStylesheet
  }
  createEffect(() => {
    layoutPreviewStylesheet.replaceSync(ui.layoutPreviewStylesheetText())
  })

  // Skipped while the New Deck modal is open: this timer was designed for
  // WelcomeScreen/StatusBar's transient toast-style banner, but the same
  // signal now also drives the modal's persistent inline error — an error
  // shown there should stay until the user dismisses the modal or retries
  // (both already clear it explicitly), not vanish on a fixed timer while
  // still unread.
  createEffect(() => {
    if (errorMessage() === null || deck.newDeckModalOpen()) return
    const timer = window.setTimeout(() => setErrorMessage(null), 6000)
    return () => window.clearTimeout(timer)
  })

  async function copyErrorMessage(): Promise<void> {
    const message = errorMessage()
    if (message === null) return
    await navigator.clipboard.writeText(message)
    setErrorMessageCopied(true)
    window.setTimeout(() => setErrorMessageCopied(false), 1500)
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
      const payload = await deckIpc.renderDraft(content)
      if (generation !== previewGeneration) return
      render.applyRenderPayload(payload)
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
    const range = editor.selectedRange()
    const index = editor.selectedIndex()
    if (!range || index === null) return null
    const newSlideText = buildSlideText(editor.pageConfig(), editor.bodyDraft(), editor.noteDraft())
    const source = editor.fullSource()
    return source.slice(0, range.start) + newSlideText + source.slice(range.end)
  }

  // Fast lane: re-renders (in-memory only) a beat after typing stops, so
  // Preview reflects Editor/notes edits without waiting on a disk save.
  // Re-fires on every bodyDraft/noteDraft change, so each keystroke resets
  // the timer via the cleanup below.
  createEffect(() => {
    editor.bodyDraft()
    editor.noteDraft()
    if (!editor.isDirty()) return
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
    editor.bodyDraft()
    editor.noteDraft()
    if (!editor.isDirty()) return
    let live = true
    let timerId: number
    const attempt = () => {
      if (!live) return
      if (isSavingSlide()) {
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

  // One key can match two hosts: a thumbnail row and the "selected slide"
  // pane both carry `data-slide-canvas-key`. Fed the *absolutized*
  // fragment, not the raw one — a shadow root has no `<base href>` to
  // resolve `src="assets/…"` against, and a spelling other than the one
  // mounted would defeat `patchSlideCanvas`'s unchanged-fragment check.
  function patchSlideCanvases(key: string, fragmentHtml: string): void {
    const selector = `[data-slide-canvas-key="${CSS.escape(key)}"]`
    for (const host of document.querySelectorAll<HTMLElement>(selector)) {
      patchSlideCanvas(host, fragmentHtml)
    }
  }

  createEffect(() => {
    for (const slide of render.manifest()?.slides ?? []) {
      patchSlideCanvases(slide.key, render.canvasFragmentOf(slide.key))
    }
  })

  async function refreshSource(preserveSelection: boolean): Promise<void> {
    const source = await deckIpc.readDeckSource()
    editor.setFullSource(source)
    const ranges = splitSlides(source)
    editor.setSlideRanges(ranges)
    const nextIndex = clampFocusIndex(preserveSelection ? editor.selectedIndex() : null, ranges.length)
    if (nextIndex === null) {
      editor.setEditorSession({ kind: 'none' })
    } else {
      const { rest: withoutNote, note } = extractNote(ranges[nextIndex].text)
      const { rest, config } = extractPageComment(withoutNote)
      const fields: SlideFields = { body: rest, note, config }
      editor.setEditorSession({ kind: 'editing', index: nextIndex, saved: fields, draft: fields })
    }
    syncEditorFields()
  }

  async function refreshRecentDecks(): Promise<void> {
    try {
      setRecentDecks(await deckIpc.getRecentDecks())
    } catch {
      // Best-effort — an empty Recent list just means nothing to suggest.
    }
  }

  async function handleOpenFolder(): Promise<void> {
    const picked = await openDialog({ directory: true, title: 'Open a Peitho deck folder' })
    if (!picked || typeof picked !== 'string') return
    await dispatch({ type: 'open-requested', path: picked })
  }

  async function handleNewDeck(): Promise<void> {
    const parent = await openDialog({ directory: true, title: 'Choose a location for the new deck' })
    if (!parent || typeof parent !== 'string') return
    setErrorMessage(null)
    await dispatch({ type: 'new-deck-requested', parentDir: parent })
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
  // `editor.bodyDraft()`/`editor.noteDraft()` itself), pass those back
  // here so they can be reused verbatim instead of round-tripping through
  // `extractNote`.
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
    plan: SelectionPlan,
    expectedDraft?: { body: string; note: string },
  ): Promise<void> {
    const before = editor.editorSession()
    setIsSavingSlide(true)
    setErrorMessage(null)
    try {
      const payload = await deckIpc.renderDraft(nextSource)
      render.applyRenderPayload(payload)
      await deckIpc.saveDeckSource(nextSource)
      editor.setFullSource(nextSource)
      const ranges = splitSlides(nextSource)
      editor.setSlideRanges(ranges)
      // `reconcileAfterCommit` only moves the selection/refreshes `saved`
      // if the user hasn't already navigated elsewhere themselves while
      // this was in flight — every caller passes a `SelectionPlan` naming
      // its own intent (`keep` for `handleSave`/`commitSectionEdit`/
      // `updateSlideConfig`, which never move anything; `follow-move` for
      // `reorderSlides`, which keeps the open slide's own position even
      // when the slide it moved isn't the one that's open;
      // `select`/`clamp-after-delete` for insert/paste/delete) — never the
      // position of whatever the change actually touched, or this would
      // drag the selection there regardless of what the user had open.
      const now = editor.editorSession()
      const next = reconcileAfterCommit(before, now, ranges, plan, expectedDraft)
      editor.setEditorSession(next)
      // `next === now` means the user moved on (a different selection, or
      // no change resolved) and this deliberately left it alone — nothing
      // to push into the textareas. Otherwise `saved` refreshed and/or
      // `draft` synced to it, so re-sync (a no-op if `draft` itself didn't
      // actually change, e.g. the user kept typing through the gap).
      if (next !== now) syncEditorFields()
      setStatusMessage('Saved')
    } catch (err) {
      setErrorMessage(String(err))
    } finally {
      setIsSavingSlide(false)
    }
  }

  // The saved text for a slide, unless it's the one currently open with
  // unsaved edits — then the live draft, so an operation on a *different*
  // slide (reordering, editing another section's time) never clobbers
  // in-progress work in the editor.
  function currentSlideText(index: number): string {
    if (index === editor.selectedIndex() && editor.isDirty()) return buildSlideText(editor.pageConfig(), editor.bodyDraft(), editor.noteDraft())
    return editor.slideRanges()[index]?.text ?? ''
  }

  // `window.confirm` used to gate this on discarding unsaved edits, but
  // Tauri's webview doesn't reliably surface it (it can resolve as
  // cancelled with no dialog shown at all), which silently blocked every
  // slide switch attempted while the fast/slow save lanes hadn't caught up
  // yet. There's no need to ask at all: flush the pending edit through the
  // same save path the auto-save effects use, then switch — never losing
  // work, never blocking on a dialog the webview won't show.
  async function selectSlide(index: number): Promise<void> {
    if (index === editor.selectedIndex()) return
    if (editor.isDirty()) await handleSave()
    const { rest: withoutNote, note } = extractNote(editor.slideRanges()[index]?.text ?? '')
    const { rest, config } = extractPageComment(withoutNote)
    const fields: SlideFields = { body: rest, note, config }
    editor.setEditorSession({ kind: 'editing', index, saved: fields, draft: fields })
    syncEditorFields()
  }

  async function handleSave(): Promise<void> {
    const range = editor.selectedRange()
    const index = editor.selectedIndex()
    if (!range || index === null) return
    const body = editor.bodyDraft()
    const note = editor.noteDraft()
    const newSlideText = buildSlideText(editor.pageConfig(), body, note)
    const source = editor.fullSource()
    const nextSource = source.slice(0, range.start) + newSlideText + source.slice(range.end)
    await commitChange(nextSource, { kind: 'keep' }, { body, note })
  }

  // Rebuilds `fullSource` from an ordered list of slide texts, preserving
  // whatever precedes the first slide (YAML frontmatter) and follows the
  // last. Every operation that adds, removes, or reorders slides goes
  // through this rather than slicing `fullSource` directly, so none of
  // them can leave a doubled separator or stray blank line behind.
  function rebuildSource(texts: string[]): string {
    const ranges = editor.slideRanges()
    const source = editor.fullSource()
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

  function onSectionNameInput(index: number, value: string): void {
    render.setSectionDrafts(prev => ({
      ...prev,
      [index]: { name: value, time: prev[index]?.time ?? formatDurationMs(render.sectionStartByIndex()[index].plannedDurationMs) },
    }))
  }

  function onSectionTimeInput(index: number, value: string): void {
    render.setSectionDrafts(prev => ({
      ...prev,
      [index]: { name: prev[index]?.name ?? render.sectionStartByIndex()[index].name, time: value },
    }))
  }

  async function commitSectionEdit(startIndex: number): Promise<void> {
    const draft = render.sectionDrafts()[startIndex]
    const range = editor.slideRanges()[startIndex]
    if (!draft || !range) return
    const slideText = currentSlideText(startIndex)
    const updatedSlideText = updatePageComment(slideText, { section: draft.name, time: draft.time })
    if (updatedSlideText === slideText) return

    let nextSource = editor.fullSource()
    nextSource = nextSource.slice(0, range.start) + updatedSlideText + nextSource.slice(range.end)

    // peitho requires the frontmatter's total time to equal the sum of
    // every section's time — keep that in sync so editing one section's
    // time here doesn't quietly break the next build.
    const editedMs = parseDurationToMs(draft.time)
    if (editedMs !== null) {
      const sections = render.manifest()?.sections ?? []
      const totalMs = sections.reduce(
        (sum, section) => sum + (section.startIndex === startIndex ? editedMs : section.plannedDurationMs),
        0,
      )
      nextSource = updateFrontmatterTime(nextSource, totalMs)
    }

    await commitChange(nextSource, { kind: 'keep' })
  }

  async function reorderSlides(from: number, to: number): Promise<void> {
    const ranges = editor.slideRanges()
    const texts = ranges.map((_, i) => currentSlideText(i).trim())
    const cmd: SlideCommand = { type: 'move', from, to }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    // `commitChange`'s selection-follows-plan step assumes every caller
    // but this one already passes back a `keep` (a no-op for them) — so
    // unconditionally selecting `to` here would drag the *editor's*
    // selection over to whatever slide just got dropped even when a
    // *different* slide, mid-edit and not yet saved, was the one actually
    // open. `follow-move` keeps the open slide's own position (shifted
    // for the reorder) unless it's the one that moved, in which case
    // that's `to` anyway.
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
  }

  // `move` never changes *which* sections exist or their times, only
  // their positions — the frontmatter total can't have gone stale, so
  // this skips `syncedSource`'s (harmless, but pointless) recompute for
  // it; every other command routes through the resync.
  function sourceFor(texts: string[], cmd: SlideCommand): string {
    return needsTimeResync(cmd) ? syncedSource(texts) : rebuildSource(texts)
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
      ui.setDragState(arm(index, event.clientX, event.clientY))
      attachDragListeners({
        onMove(moveEvent) {
          const wasArmed = ui.dragState().kind === 'armed'
          ui.setDragState(prev => move(prev, moveEvent.clientX, moveEvent.clientY, gapUnderCursor(moveEvent.clientY)))
          if (wasArmed && ui.dragState().kind === 'dragging') setDragAffordance(true)
        },
        onUp() {
          const target = dropTarget(ui.dragState())
          ui.setDragState(cancel())
          setDragAffordance(false)
          if (target && target.from !== target.to) void reorderSlides(target.from, target.to)
        },
        // If the window loses focus mid-drag (e.g. a native dialog steals
        // focus, or the user alt-tabs away) the `mouseup` that would
        // normally end the drag can land outside this window and never
        // reach these listeners — WKWebView doesn't reliably deliver it
        // here either way. Without this, the drag state stays stuck at
        // whatever it was the moment focus was lost, permanently pinning a
        // leftover `border-t-primary`/`border-b-primary` line on whatever
        // row/gap the drag last passed over. Cancel outright (no reorder)
        // — unlike a normal `mouseup`, a focus loss isn't a deliberate
        // "drop here" gesture.
        onBlur() {
          ui.setDragState(cancel())
          setDragAffordance(false)
        },
      })
    }
  }

  function openContextMenu(index: number | null, event: MouseEvent): void {
    event.preventDefault()
    // `stopPropagation()` here does NOT stop `SlideList.tsx`'s own
    // container-level `onContextMenu` from also firing for the same
    // right-click: a `.map()` row's handler is compiled as a delegated
    // listener on the container (not a real per-element listener), so the
    // container's own directly-authored handler ends up as a *second*
    // listener on that identical node — `stopPropagation()` only blocks
    // reaching other elements, never a sibling listener already registered
    // on the same one (see piconic-ai/barefootjs#2930). Confirmed by
    // logging both calls landing (`index` then `null`) for one physical
    // click. `SlideList.tsx`'s container handler guards against this
    // itself, by skipping the `null` call whenever the click actually
    // landed inside a row — so by the time this function runs at all,
    // `index` reflects that row (or truly is empty space) and doesn't get
    // overwritten afterward.
    event.stopPropagation()
    if (index !== null) void selectSlide(index)
    ui.setContextMenu(
      index === null
        ? { kind: 'on-empty-space', x: event.clientX, y: event.clientY }
        : { kind: 'on-slide', index, x: event.clientX, y: event.clientY, layoutPickerOpen: false },
    )
    void loadLayoutPreviews()
  }

  // Keeps the context menu on-screen: it's positioned at the raw click
  // coordinates, with no clamping of its own, so a right-click low in the
  // slide list could open a menu whose bottom items render past the
  // window edge with no way to reach them. Runs on open and whenever
  // `layoutPickerOpen` changes (its expanded submenu can itself push the
  // menu's bottom edge off-screen) — both are captured just by reading the
  // whole `contextMenu()` ADT — via `requestAnimationFrame`, deferring to
  // the next paint, which is what guarantees the menu has actually been
  // laid out (at its current, possibly just-toggled height) before
  // `getBoundingClientRect` runs.
  createEffect(() => {
    if (ui.contextMenu().kind === 'closed') return
    requestAnimationFrame(() => {
      // Re-read rather than closing over this run's `contextMenu()` value —
      // it may have moved (a new right-click) or closed by the time this
      // frame actually runs.
      const menu = ui.contextMenu()
      if (!contextMenuEl || menu.kind === 'closed') return
      const rect = contextMenuEl.getBoundingClientRect()
      const { x, y } = clampMenuPosition(
        { x: menu.x, y: menu.y },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
        8,
      )
      if (x !== menu.x || y !== menu.y) {
        ui.setContextMenu(prev => (prev.kind === 'closed' ? prev : { ...prev, x, y }))
      }
    })
  })

  async function loadLayoutPreviews(): Promise<void> {
    if (ui.layoutPreviews() !== null) return
    try {
      const payload = await deckIpc.previewLayouts()
      ui.setLayoutPreviewCss(payload.css)
      ui.setLayoutPreviews(payload.previews)
    } catch {
      ui.setLayoutPreviews([])
    }
  }

  function copySlide(index: number): void {
    ui.setClipboardSlideText(currentSlideText(index))
  }

  // Removes a slide by re-joining every other slide's text — the frontmatter
  // time total is re-synced in case the removed slide was itself a section
  // start (see `syncedSource`).
  async function deleteSlide(index: number): Promise<void> {
    const texts = editor.slideRanges().map((_, i) => currentSlideText(i).trim())
    const cmd: SlideCommand = { type: 'delete', index }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
  }

  async function cutSlide(index: number): Promise<void> {
    const ranges = editor.slideRanges()
    if (ranges.length <= 1) return
    ui.setClipboardSlideText(currentSlideText(index))
    await deleteSlide(index)
  }

  // Every currently-known slide key (derived or explicit) — the source of
  // truth for picking a new key that's guaranteed not to collide.
  function existingSlideKeys(): string[] {
    return (render.manifest()?.slides ?? []).map(s => s.key)
  }

  // Inserts a blank new slide right after `index`, with an explicit
  // PageComment `key` — pressing "New Slide" more than once always
  // produces the exact same heading ("New Slide"), and peitho derives a
  // key from a slide's heading when it has no explicit one, so leaving
  // the key unset (as this used to) meant a second press collided with
  // the first ("duplicate slide key 'new-slide'"). `uniqueSlideKey` picks
  // `new-slide`, `new-slide-2`, `new-slide-3`, ... against the deck's
  // actual current keys instead.
  async function addSlide(index: number): Promise<void> {
    const texts = editor.slideRanges().map((_, i) => currentSlideText(i).trim())
    const insertAt = Math.min(index + 1, texts.length)
    const key = uniqueSlideKey(slugifyTitle('New Slide'), existingSlideKeys())
    const cmd: SlideCommand = { type: 'insert', at: insertAt, text: buildSlideText({ key }, NEW_SLIDE_MARKDOWN, '') }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
  }

  // Same collision as `addSlide`, one step removed: pasting the same
  // clipboard slide more than once (or a slide whose heading matches one
  // already in the deck) used to just drop the copied `key` and hope
  // peitho's own heading-derived fallback was unique — it isn't, when the
  // heading itself repeats. Re-key explicitly instead, based on the
  // original's own key if it had one, else its heading.
  async function pasteSlideAfter(index: number): Promise<void> {
    const clip = ui.clipboardSlideText()
    if (clip === null) return
    const texts = editor.slideRanges().map((_, i) => currentSlideText(i).trim())
    const insertAt = Math.min(index + 1, texts.length)
    const trimmedClip = clip.trim()
    const { config } = extractPageComment(trimmedClip)
    const baseKey = typeof config.key === 'string' && config.key !== ''
      ? config.key
      : slugifyTitle(extractHeadingText(trimmedClip) ?? '')
    const key = uniqueSlideKey(baseKey, existingSlideKeys())
    const cmd: SlideCommand = { type: 'insert', at: insertAt, text: updatePageComment(trimmedClip, { key }) }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
  }

  async function moveSlide(index: number, direction: 1 | -1): Promise<void> {
    await reorderSlides(index, index + direction)
  }

  // Reads a slide's PageComment config without going through `commitChange`
  // — the live `pageConfig` signal for the open slide (which may have
  // pending edits not yet reflected in `slideRanges`), the raw on-disk text
  // for any other slide.
  function slideConfigOf(index: number): PageConfig {
    if (index === editor.selectedIndex()) return editor.pageConfig()
    const { rest: withoutNote } = extractNote(editor.slideRanges()[index]?.text ?? '')
    return extractPageComment(withoutNote).config
  }

  // Routed through `syncedSource` (not a direct range-slice replace) so a
  // config change that adds or removes a section (see `toggleSlideSection`)
  // keeps the frontmatter time total correct — a no-op resync for updates
  // (layout/draft/skip) that don't touch `section`/`time`.
  async function updateSlideConfig(index: number, updates: Partial<PageConfig>): Promise<void> {
    const slideText = currentSlideText(index)
    const updated = updatePageComment(slideText, updates)
    if (updated === slideText) return
    const texts = editor.slideRanges().map((_, i) => currentSlideText(i).trim())
    const cmd: SlideCommand = { type: 'replace', index, text: updated.trim() }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
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
    if (!deck.deckPath() || deck.isBusy()) return
    const source = await deckIpc.readDeckSource()
    if (source === editor.fullSource()) return
    if (editor.isDirty()) {
      const discard = window.confirm(
        'This deck changed outside Peitho Studio (e.g. another editor). Reload it and discard your unsaved edits here?',
      )
      if (!discard) {
        const ranges = splitSlides(source)
        editor.setFullSource(source)
        editor.setSlideRanges(ranges)
        const i = editor.selectedIndex()
        if (i !== null && i < ranges.length) {
          const { rest: withoutNote, note } = extractNote(ranges[i].text)
          const { rest, config } = extractPageComment(withoutNote)
          editor.setEditorSession(session => withRefreshedSaved(session, { body: rest, note, config }))
        }
        await renderPreview(source)
        setStatusMessage('Deck changed on disk elsewhere — merged around your unsaved edit.')
        return
      }
    }
    await refreshSource(true)
    await renderPreview(editor.fullSource())
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
      const pending = await deckIpc.takePendingDeck()
      if (pending) {
        await dispatch({ type: 'open-requested', path: pending })
        if (deck.deckLifecycle().kind !== 'open') {
          // This window exists solely to show `pending` (e.g. a Recent
          // entry that pointed at a folder deleted/moved since it was
          // remembered) — closing it returns focus to whichever window
          // the user was already on, instead of leaving a second,
          // otherwise-empty window sitting on screen with an error banner.
          await getCurrentWindow().close()
        }
        return
      }
      const devDeck = await deckIpc.devDefaultDeck()
      if (devDeck) await dispatch({ type: 'open-requested', path: devDeck })
    })()

    const unlistenFileChanged = deckIpc.onDeckFileChanged(() => {
      void handleExternalChange()
    })

    // Native "File > New Deck…" (see `build_menu` in lib.rs) still needs
    // this app's own name-entry modal, so it round-trips through here.
    // "Open Deck…"/"Open Recent" are handled entirely Rust-side now (a
    // native folder-picker dialog + `open_deck_window`), since neither
    // needs anything this webview can do.
    const unlistenMenuNew = deckIpc.onMenuNewDeck(() => { void handleNewDeck() })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ui.contextMenu().kind !== 'closed') {
        event.preventDefault()
        ui.closeContextMenu()
        return
      }
      const tag = document.activeElement?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      const count = render.manifest()?.slides.length ?? 0
      if (count === 0) return
      const current = editor.selectedIndex()
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
          // A slide stays "selected" (and this handler active) the whole
          // time a deck is open, so Cmd+C over an ordinary text selection
          // elsewhere (the deck path, an error message, ...) hit this
          // unconditionally and stole it — `preventDefault` here blocks
          // the native Edit-menu Copy from ever running. Only intercept
          // when there's no real text selection to defer to.
          if ((window.getSelection()?.toString().length ?? 0) > 0) return
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
      unlistenFileChanged()
      unlistenMenuNew()
    })
  })

  async function handlePresent(rehearsal: boolean): Promise<void> {
    setErrorMessage(null)
    try {
      await deckIpc.presentDeck(rehearsal)
      setStatusMessage(rehearsal ? 'Presenting (rehearsal)…' : 'Presenting…')
    } catch (err) {
      setErrorMessage(String(err))
    }
  }

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {deck.deckPath() === null ? (
        <WelcomeScreen
          isBusy={deck.isBusy()}
          errorMessage={errorMessage()}
          recentDecks={recentDecks()}
          onOpenFolder={() => void handleOpenFolder()}
          onNewDeck={() => void handleNewDeck()}
          onOpenRecent={path => void dispatch({ type: 'open-requested', path })}
        />
      ) : (
        <>
      <DeckHeader
        deckPath={deck.deckPath()}
        presentMenuOpen={ui.presentMenuOpen()}
        onTogglePresentMenu={() => ui.setPresentMenuOpen(!ui.presentMenuOpen())}
        onClosePresentMenu={() => ui.setPresentMenuOpen(false)}
        onPresent={rehearsal => void handlePresent(rehearsal)}
      />

      <div className="flex-1 flex min-h-0">
        <SlideList
          manifest={render.manifest()}
          slideListWidth={ui.slideListWidth()}
          draggedIndex={ui.draggedIndex()}
          dragOverGap={ui.dragOverGap()}
          dragDeltaY={ui.dragDeltaY()}
          selectedIndex={editor.selectedIndex()}
          sectionStartByIndex={render.sectionStartByIndex()}
          sectionDrafts={render.sectionDrafts()}
          canvasWidth={render.canvasWidth()}
          canvasHeight={render.canvasHeight()}
          canvasFragmentOf={render.canvasFragmentOf}
          slideStylesheet={getSlideStylesheet}
          onContextMenu={openContextMenu}
          onDragStart={startSlideDrag}
          onSelectSlide={index => selectSlide(index)}
          onSectionNameInput={onSectionNameInput}
          onSectionTimeInput={onSectionTimeInput}
          onCommitSectionEdit={index => void commitSectionEdit(index)}
        />

        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startColumnResize(ui.slideListWidth, ui.setSlideListWidth, 1)}
        />

        <div
          className="shrink-0 flex flex-col border-r border-border min-h-0"
          style={`width: ${ui.editorWidth()}px`}
        >
          <SlideEditor
            hasSelection={editor.selectedRange() !== null}
            onBodyRef={onBodyTextareaRef}
            onNoteRef={onNoteTextareaRef}
            onBodyInput={value => editor.setEditorSession(session => withDraftBody(session, value))}
            onNoteInput={value => editor.setEditorSession(session => withDraftNote(session, value))}
          />
        </div>

        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startColumnResize(ui.editorWidth, ui.setEditorWidth, 1)}
        />

        <SlidePreview
          selectedSlideKey={selectedSlideKey()}
          hasDeck={Boolean(render.assetBaseUrl())}
          canvasFragmentOf={render.canvasFragmentOf}
          slideStylesheet={getSlideStylesheet}
          canvasWidth={render.canvasWidth()}
          canvasHeight={render.canvasHeight()}
        />
      </div>

      <StatusBar
        errorMessage={errorMessage()}
        errorMessageCopied={errorMessageCopied()}
        statusMessage={statusMessage()}
        onCopyErrorMessage={() => void copyErrorMessage()}
      />

      <SlideContextMenu
        hidden={ui.contextMenu().kind === 'closed'}
        position={contextMenuPositionOf(ui.contextMenu())}
        menuItems={currentMenuItems()}
        layoutPickerOpen={isLayoutPickerOpen(ui.contextMenu())}
        layoutPickerView={layoutPickerView()}
        layoutPreviews={ui.layoutPreviews()}
        layoutPreviewStylesheet={getLayoutPreviewStylesheet}
        canvasWidth={render.canvasWidth()}
        canvasHeight={render.canvasHeight()}
        onMenuRef={el => { contextMenuEl = el }}
        onClose={ui.closeContextMenu}
        onNewSlide={() => { void addSlide(ui.contextMenuAppendIndex(render.manifest()?.slideCount ?? 1)); ui.closeContextMenu() }}
        onCut={() => { void cutSlide(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onCopy={() => { copySlide(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onPaste={() => { void pasteSlideAfter(ui.contextMenuAppendIndex(render.manifest()?.slideCount ?? 1)); ui.closeContextMenu() }}
        onDelete={() => { void deleteSlide(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onToggleLayoutPicker={ui.toggleLayoutPicker}
        onChangeLayout={name => { void changeSlideLayout(contextMenuIndexOf(ui.contextMenu())!, name); ui.closeContextMenu() }}
        onToggleDraft={() => { void toggleSlideDraft(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onToggleSkip={() => { void toggleSlideSkip(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onToggleSection={() => { void toggleSlideSection(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onMoveUp={() => { void moveSlide(contextMenuIndexOf(ui.contextMenu())!, -1); ui.closeContextMenu() }}
        onMoveDown={() => { void moveSlide(contextMenuIndexOf(ui.contextMenu())!, 1); ui.closeContextMenu() }}
      />
        </>
      )}

      <NewDeckModal
        isOpen={deck.newDeckModalOpen()}
        name={deck.newDeckName()}
        parentDir={deck.newDeckParentDir()}
        isBusy={deck.isBusy()}
        errorMessage={errorMessage()}
        onNameChange={name => void dispatch({ type: 'name-changed', name })}
        onCancel={() => { setErrorMessage(null); void dispatch({ type: 'create-cancelled' }) }}
        onConfirm={() => void dispatch({ type: 'create-confirmed' })}
      />
    </div>
  )
}
