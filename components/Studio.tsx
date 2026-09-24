'use client'

import { createSignal, createMemo, createEffect, onMount, onCleanup, untrack } from '@barefootjs/client'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createTauriDeckIpc } from '../ipc/deckIpc'
import { createTauriSettingsIpc } from '../ipc/settingsIpc'
import { createTauriEditorIpc } from '../ipc/editorIpc'
import { type ManifestSlide, type RenderPayload, type SectionDraft } from '../domain/render'
import { clampMenuPosition, type Size } from '../domain/geometry'
import { deviceForShape, effectiveCanvas } from '../domain/viewport'
import { hasFixedCanvas } from '../domain/slideFragment'
import { type PageConfig } from '../domain/pageConfig'
import { type SelectionPlan, type SlideFields, opensSameSlide, reconcileAfterCommit, withRefreshedSaved, withDraftBody, withDraftNote } from '../domain/editorSession'
import { type SlideCommand, applyCommand, needsTimeResync, selectionPlanFor, validate } from '../domain/slideCommands'
import { type HistoryStep, type StepOutcome, commandForStep, inverseStep, slideConfigOfText } from '../domain/editorHistory'
import { arm, move, dropTarget, cancel } from '../domain/drag'
import { indexOf as contextMenuIndexOf, positionOf as contextMenuPositionOf, isLayoutPickerOpen, menuItems as computeMenuItems, chooseLayout, layoutFitOf, layoutNoticeOf } from '../domain/contextMenu'
import { type LayoutVerdict } from '../domain/layoutFit'
import { type DeckEvent, decide } from '../domain/deckLifecycle'
import { buildSlideList, manifestIndexAt, sectionStartBySourceIndex } from '../domain/slideList'
import { collapseKeyAt, collapsedSectionContaining, collapsedSectionStarts, lastVisibleRow, rowVisibilities, sectionSpans } from '../domain/sectionCollapse'
import { type DeckVariant, currentVariantLabelOf, toVariantSwitcher, variantOptionsOf } from '../domain/deckVariants'
import { racePresentOutcome } from '../domain/eventRace'
import { type Language } from '../domain/language'
import { type StatusMessage, statusText } from '../domain/statusMessage'
import { takesCommandKeys, type VimMode } from '../domain/vimMode'
import { gapUnderCursor, attachDragListeners, setDragAffordance } from '../dom/dragGesture'
import { startColumnResize } from '../dom/columnResize'
import { blurEditorFieldOnRowPress, isTypingInField, replayFocusedFieldHistory } from '../dom/fieldFocus'
import { createCodeEditor, resetCodeEditorText, setCodeEditorPlaceholder, setCodeEditorText, setCodeEditorVimMode, type CodeEditorOptions } from '../dom/codeEditor'
import { createVimClipboardBridge, onClipboardMayHaveChanged } from '../dom/vimClipboard'
import { focusSectionNameInput, pressOutsideSectionHeader, sectionHeaderOfRow } from '../dom/sectionHeader'
import { focusSettingsPanel, restoreFocusAfterSettingsPanel } from '../dom/settingsPanel'
import { createSlideStylesheet, ensureFontFaces, patchSlideCanvas, setManifestKeysSource } from '../dom/slideCanvas'
import { createUiStore } from '../state/uiStore'
import { createRenderStore } from '../state/renderStore'
import { createEditorStore } from '../state/editorStore'
import { createDeckStore } from '../state/deckStore'
import { createHistoryStore } from '../state/historyStore'
import { createSettingsStore } from '../state/settingsStore'
import {
  splitSlides,
  extractNote,
  extractPageComment,
  buildSlideText,
  updatePageComment,
  slugifyTitle,
  uniqueSlideKey,
  newSlideConfig,
  clampFocusIndex,
  extractHeadingText,
  updateFrontmatterTime,
  formatDurationMs,
  joinSlideTexts,
  sumSectionTimesMs,
  withDurationPart,
  savableSectionTimeMs,
  type DurationPart,
} from '../domain/slides'
import { WelcomeScreen } from './WelcomeScreen'
import { NewDeckModal } from './NewDeckModal'
import { SettingsPanel } from './SettingsPanel'
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
      await refreshSource(false, info.render)
      setStatusMessage({ kind: 'opened', deckPath: info.deckPath })
      await dispatch({ type: 'opened', deckPath: info.deckPath })
      // Only once `open`: a variant picked while still `opening` would be
      // rejected by `decide` as busy, silently doing nothing.
      void refreshDeckVariants()
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
  // The `spawn-window` effect: an `open` window that receives another
  // `open-requested` keeps its own deck and opens the new one in a new
  // window. Fired by the deck header's variant switcher (deck.md ->
  // deck.ja.md); the welcome screen's buttons/Recent entries dispatch the
  // same event but only while `welcome`, and native "Open Recent" opens a
  // new window entirely Rust-side without going through this component.
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
  // Structural undo/redo (Cmd+Z / Cmd+Shift+Z outside the text editors) — see
  // `state/historyStore.ts` and `replayHistory` below.
  const history = createHistoryStore()
  // App-wide settings, whether this window's settings panel is open, and
  // the UI language they come to — see `state/settingsStore.ts`. Saved and
  // shared Rust-side (`src-tauri/src/settings.rs`). The webview's own idea
  // of the OS languages is only a first guess, so the first paint is
  // already in the right language where it agrees; `loadSettings` replaces
  // it with the OS's answer, which the native menu bar also goes by.
  const settingsIpc = createTauriSettingsIpc()
  const settings = createSettingsStore(typeof navigator === 'undefined' ? [] : navigator.languages)
  // Vim mode's ties to the OS: the input source goes to ASCII whenever
  // vim takes command keys, and the unnamed register follows the system
  // clipboard (`dom/vimClipboard.ts`).
  const editorIpc = createTauriEditorIpc()
  const vimClipboard = createVimClipboardBridge({
    readText: () => editorIpc.readClipboardText(),
    writeText: text => editorIpc.writeClipboardText(text),
  })
  // Distinct from `isBusy` above (the deck-lifecycle one): this guards
  // `commitChange`'s own in-flight save, which used to share the same
  // `isBusy` signal with the welcome-screen open/create flow. The two
  // never actually overlapped in practice (the welcome screen only
  // shows while `deck.deckPath() === null`, and `commitChange` only runs
  // once a deck is open), but sharing one flag for two unrelated
  // "something is in flight" meanings was exactly the kind of implicit
  // coupling this refactor is trying to remove.
  const [isSavingSlide, setIsSavingSlide] = createSignal(false)
  // What happened, not its text: `StatusBar` words it in the current UI
  // language, so a language change rewords a message already shown.
  const [statusMessage, setStatusMessage] = createSignal<StatusMessage>({ kind: 'none' })
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [errorMessageCopied, setErrorMessageCopied] = createSignal(false)
  // Shown centered in place of the whole 3-pane layout until a deck is
  // open. `recentDecks` (full deck.md paths) is persisted Rust-side (see
  // `get_recent_decks`/`remember_recent_deck` in peitho.rs) rather than in
  // `localStorage`, since the native File > Open Recent submenu needs the
  // same list and has no access to this webview's storage.
  const [recentDecks, setRecentDecks] = createSignal<string[]>([])
  // Same-base sibling decks of the open one (deck.md, deck.ja.md, ...) —
  // fetched once per open by `refreshDeckVariants`.
  const [deckVariants, setDeckVariants] = createSignal<DeckVariant[]>([])
  const variantSwitcher = createMemo(() => toVariantSwitcher(deckVariants()))

  // The two CodeMirror editors (body and notes) — created once their host
  // `<div>`s mount, and written to only by `syncEditorFields`, never from a
  // reactive binding (see the note above it).
  let bodyEditor: ReturnType<typeof createCodeEditor> | undefined
  let noteEditor: ReturnType<typeof createCodeEditor> | undefined
  // The context menu is permanently mounted (only its `hidden` class
  // toggles — see the comment above its JSX for why), so its `ref` fires
  // exactly once and this stays valid for the component's whole lifetime.
  let contextMenuEl: HTMLElement | undefined

  // Pushes the current bodyDraft/noteDraft signal values into the editors.
  // Call this after any *non-typing* change to those signals — never react
  // to the signals directly: our own `onChange` is what changes them while
  // the user types, and writing the text back under the user mid-keystroke
  // (or mid-IME-conversion) can drop keystrokes or move the cursor. Both
  // writes skip an editor with an IME composition in progress
  // (`dom/codeEditor.ts`).
  //
  // - `same-slide` (a save response for the slide still open): touches only
  //   what differs, keeps the cursor and the undo history, and stays out of
  //   the history itself.
  // - `new-slide` (a slide switch, a deck read fresh from disk): also drops
  //   the undo history, so Undo can't bring back another slide's text.
  function syncEditorFields(scope: 'same-slide' | 'new-slide'): void {
    const write = scope === 'new-slide' ? resetCodeEditorText : setCodeEditorText
    if (bodyEditor) write(bodyEditor, editor.bodyDraft())
    if (noteEditor) write(noteEditor, editor.noteDraft())
  }

  function selectAsciiInputFor(mode: VimMode): void {
    // Best effort: failing leaves the input source as the user set it.
    if (takesCommandKeys(mode)) editorIpc.selectAsciiInputSource().catch(() => {})
  }

  // Shared by both editors. Read once per editor; later changes of the
  // setting go through `setCodeEditorVimMode` (the effect below).
  function vimEditorOptions(): Pick<CodeEditorOptions, 'vimMode' | 'onVimModeChange' | 'onVimFocus' | 'onVimCommandDone'> {
    return {
      vimMode: untrack(() => settings.settings().vimMode),
      onVimModeChange: selectAsciiInputFor,
      onVimFocus: mode => {
        vimClipboard.pullClipboard()
        selectAsciiInputFor(mode)
      },
      onVimCommandDone: () => { vimClipboard.pushRegister() },
    }
  }

  createEffect(() => {
    const on = settings.settings().vimMode
    if (bodyEditor) setCodeEditorVimMode(bodyEditor, on)
    if (noteEditor) setCodeEditorVimMode(noteEditor, on)
  })

  // A host remounts only with the whole editor pane (a deck-lifecycle
  // branch), so the previous editor, if any, is already detached.
  function onBodyEditorHost(el: HTMLElement): void {
    bodyEditor?.destroy()
    bodyEditor = createCodeEditor(el, editor.bodyDraft(), {
      ...vimEditorOptions(),
      monospace: true,
      spellcheck: false,
      onChange: text => editor.setEditorSession(session => withDraftBody(session, text)),
    })
  }

  function onNoteEditorHost(el: HTMLElement): void {
    noteEditor?.destroy()
    noteEditor = createCodeEditor(el, editor.noteDraft(), {
      ...vimEditorOptions(),
      placeholder: untrack(() => settings.messages().speakerNotesPlaceholder),
      onChange: text => editor.setEditorSession(session => withDraftNote(session, text)),
    })
  }

  // The notes editor's placeholder follows the UI language; the editor
  // itself is uncontrolled, so it is told rather than bound.
  createEffect(() => {
    const text = settings.messages().speakerNotesPlaceholder
    if (noteEditor) setCodeEditorPlaceholder(noteEditor, text)
  })

  const layoutPickerView = createMemo<'loading' | 'empty' | 'ready'>(() => {
    const previews = ui.layoutPreviews()
    if (previews === null) return 'loading'
    if (previews.length === 0) return 'empty'
    return 'ready'
  })
  // Rows in `editor.slideRanges()` order (drafts included), each paired
  // with its manifest data when it has any — see `domain/slideList.ts`.
  // `slideCount` below is deliberately this list's length, not
  // `manifest.slideCount`: the manifest's own count excludes drafts, and
  // every index this component hands around (`selectSlide`,
  // `updateSlideConfig`, this menu's own `index`, ...) is already a
  // `slideRanges` index, so a manifest-sized count would under-count the
  // deck whenever a draft slide is in it.
  // `render.renderedSource()`, not `editor.fullSource()` — the two can
  // briefly disagree (see `state/renderStore.ts`'s `renderedSource` doc
  // comment for the exact scenario this fixes), and pairing `manifest()`
  // with anything other than the source that actually produced it is
  // exactly what corrupted a thumbnail's canvas permanently.
  const slideEntries = createMemo(() => buildSlideList(render.renderedSource(), render.manifest()?.slides ?? []))
  const sectionStarts = createMemo(() => sectionStartBySourceIndex(render.manifest()?.sections ?? [], slideEntries()))
  // The slide list's section folding (`domain/sectionCollapse.ts`): each
  // section's rows, which of them are collapsed, and from that how every
  // row shows.
  const sectionRowSpans = createMemo(() => sectionSpans(Object.keys(sectionStarts()).map(Number), slideEntries().length))
  const collapsedStarts = createMemo(() => collapsedSectionStarts(slideEntries(), sectionStarts(), ui.collapsedSectionKeys()))
  const rowVisibility = createMemo(() => rowVisibilities(sectionRowSpans(), collapsedStarts(), slideEntries().length))
  // Hoisted out of the slide list's rows so each row compares against one
  // precomputed index instead of rescanning every row's visibility itself.
  const lastShownRow = createMemo(() => lastVisibleRow(rowVisibility()))
  /** Collapses, or expands again, the section whose header sits on row
   * `index` (a no-op for a row that can't carry one). */
  function toggleSectionAt(index: number): void {
    const key = collapseKeyAt(slideEntries(), index)
    if (key !== null) ui.toggleSectionCollapsed(key)
  }
  // A slide that becomes selected inside a collapsed section (New Slide or
  // Paste from its header row, a delete that moves the selection there)
  // expands that section, so the selection never lands out of sight. Only
  // a selection change triggers this — collapsing the section the open
  // slide sits in is a deliberate click and stays collapsed. By the time
  // `commitChange` moves the selection, `applyRenderPayload` has already
  // refreshed the entries this reads, so the spans match the new index.
  createEffect(() => {
    const selected = editor.selectedIndex()
    untrack(() => {
      const start = collapsedSectionContaining(sectionRowSpans(), collapsedStarts(), selected)
      if (start !== null) toggleSectionAt(start)
    })
  })
  const currentMenuItems = createMemo(() => computeMenuItems(ui.contextMenu(), {
    slideCount: slideEntries().length,
    hasClipboard: ui.clipboardSlideText() !== null,
    configOf: slideConfigOf,
  }))
  const selectedSlide = createMemo<ManifestSlide | null>(() => {
    const i = editor.selectedIndex()
    if (i === null) return null
    const entry = slideEntries()[i]
    return entry?.kind === 'rendered' ? entry.slide : null
  })
  // `selectedSlide()` itself is a *new object* on every keystroke (even to
  // some other slide — see `stabilizeByKey` in slides.ts), but a memo's
  // own output is compared by value before it notifies anyone, and two
  // strings that read the same are `Object.is`-equal regardless of which
  // slide object produced them. Deriving just the key through a memo is
  // what lets the preview pane (below) depend on "which slide is
  // selected" without also depending on "has its content changed".
  const selectedSlideKey = createMemo<string | null>(() => selectedSlide()?.key ?? null)
  // The preview's header (and the phone shape menu in it) is hidden while no
  // slide is selected — a draft placeholder or no slide at all — so an open
  // menu goes with it instead of reappearing already open on the next
  // selection.
  createEffect(() => {
    if (selectedSlideKey() === null) ui.closePhoneShapeMenu()
  })

  // The canvas the *preview pane* lays the selected slide out on: the
  // deck's own, or (phone display, tall shape) the same width grown to a
  // phone's proportion — see `domain/viewport.ts`. Phone display with the
  // deck-ratio shape is the deck's own canvas again. The thumbnail list and
  // layout picker keep reading `render.canvasWidth()/canvasHeight()`
  // directly.
  //
  // Number memos, not one memo of a `Size`: `effectiveCanvas` returns a
  // fresh object every call, and `SlidePreview`'s mount effect would
  // re-mount on every notification. `selectedSlideIsFixedCanvas` reads the
  // fragment, so it re-runs on every edit of the selected slide; as its own
  // boolean memo it notifies nobody until the opt-out really flips.
  const selectedSlideIsFixedCanvas = createMemo<boolean>(() => {
    const key = selectedSlideKey()
    return key !== null && hasFixedCanvas(render.fragmentOf(key))
  })
  function previewCanvas(): Size {
    const deck = { width: render.canvasWidth(), height: render.canvasHeight() }
    return effectiveCanvas(deck, ui.viewportMode(), deviceForShape(ui.phoneShape(), deck), selectedSlideIsFixedCanvas())
  }
  const previewCanvasWidth = createMemo<number>(() => previewCanvas().width)
  const previewCanvasHeight = createMemo<number>(() => previewCanvas().height)

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
      render.applyRenderPayload(payload, content)
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

  // `renderPayload`, when given, is applied together with the exact
  // `source` this same call just read — see `state/renderStore.ts`'s
  // `renderedSource` for why `applyRenderPayload` must always receive its
  // matching source directly, rather than this function setting
  // `editor.fullSource` off on its own and leaving the manifest to catch
  // up separately.
  async function refreshSource(preserveSelection: boolean, renderPayload?: RenderPayload): Promise<void> {
    const source = await deckIpc.readDeckSource()
    // History steps address slides by position; a deck read fresh from disk
    // (a newly opened deck, an external edit) may not match them anymore.
    history.clear()
    if (renderPayload) render.applyRenderPayload(renderPayload, source)
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
    syncEditorFields('new-slide')
  }

  async function refreshRecentDecks(): Promise<void> {
    try {
      setRecentDecks(await deckIpc.getRecentDecks())
    } catch {
      // Best-effort — an empty Recent list just means nothing to suggest.
    }
  }

  // Called by `runOpen` once the deck is open — `list_deck_variants` reads
  // this window's session, which `open_deck` has already set. Best-effort
  // like `refreshRecentDecks`: a failed listing just hides the switcher.
  async function refreshDeckVariants(): Promise<void> {
    try {
      setDeckVariants(await deckIpc.listDeckVariants())
    } catch {
      setDeckVariants([])
    }
  }

  async function handleOpenFolder(): Promise<void> {
    const picked = await openDialog({ directory: true, title: settings.messages().openDeckDialogTitle })
    if (!picked || typeof picked !== 'string') return
    await dispatch({ type: 'open-requested', path: picked })
  }

  async function handleNewDeck(): Promise<void> {
    const parent = await openDialog({ directory: true, title: settings.messages().newDeckLocationDialogTitle })
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
  //
  // Resolves `true` once the change is rendered and saved, `false` if either
  // step failed (the error is already shown) — undo history records only a
  // change that actually landed.
  async function commitChange(
    nextSource: string,
    plan: SelectionPlan,
    expectedDraft?: { body: string; note: string },
  ): Promise<boolean> {
    const before = editor.editorSession()
    setIsSavingSlide(true)
    setErrorMessage(null)
    try {
      const payload = await deckIpc.renderDraft(nextSource)
      render.applyRenderPayload(payload, nextSource)
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
      // to push into the editors. Otherwise `saved` refreshed and/or
      // `draft` synced to it, so re-sync (a no-op if `draft` itself didn't
      // actually change, e.g. the user kept typing through the gap).
      if (next !== now) syncEditorFields(opensSameSlide(plan) ? 'same-slide' : 'new-slide')
      setStatusMessage({ kind: 'saved' })
      return true
    } catch (err) {
      setErrorMessage(String(err))
      return false
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

  // Every slide's `currentSlideText`, trimmed — the list every structural
  // operation (and its undo) applies its `SlideCommand` to.
  function currentSlideTexts(): string[] {
    return editor.slideRanges().map((_, i) => currentSlideText(i).trim())
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
    syncEditorFields('new-slide')
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
    // Typed text can itself re-split the deck (a `---` line, an unclosed code
    // fence), shifting the positions every history step addresses slides by.
    const resplits = splitSlides(nextSource).length !== editor.slideRanges().length
    if (await commitChange(nextSource, { kind: 'keep' }, { body, note }) && resplits) history.clear()
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

  // `state/renderStore.ts`'s section-draft records are keyed by manifest
  // index (they're built straight from `manifest.sections`, drafts never
  // among them) — the section header's own row index is a `sourceIndex`
  // (see `slideEntries` above), so every entry point here converts through
  // `manifestIndexAt` before touching them. A draft slide can never start
  // a section (peitho-core rejects that combination outright), so a
  // `sourceIndex` that reaches these with no manifest index behind it is
  // not a real state to handle, just a defensive no-op.
  //
  // Applies `edit` to section `manifestIndex`'s draft. Skips the write
  // when nothing changed (e.g. a half-typed spinner entry), so the
  // section headers' bindings don't re-run for it.
  function updateSectionDraft(manifestIndex: number, edit: (draft: SectionDraft) => SectionDraft): void {
    const current = render.sectionDraftOf(manifestIndex)
    const next = edit(current)
    if (next.name === current.name && next.timeMs === current.timeMs) return
    render.setSectionDrafts(prev => ({ ...prev, [manifestIndex]: next }))
  }

  function onSectionNameInput(index: number, value: string): void {
    const manifestIndex = manifestIndexAt(slideEntries(), index)
    if (manifestIndex === null) return
    updateSectionDraft(manifestIndex, draft => ({ ...draft, name: value }))
  }

  function onSectionTimeInput(index: number, part: DurationPart, value: number): void {
    const manifestIndex = manifestIndexAt(slideEntries(), index)
    if (manifestIndex === null) return
    updateSectionDraft(manifestIndex, draft => ({ ...draft, timeMs: withDurationPart(draft.timeMs, part, value) }))
  }

  function openSectionEditor(index: number): void {
    ui.setEditingSectionIndex(index)
    focusSectionNameInput(index)
  }

  /** Saves the header editing on row `index` and collapses it back to its
   * plain summary — same trigger for both, so a spinner isn't left open
   * just because the deck happens to be mid-save. */
  function closeSectionEditor(index: number): void {
    void commitSectionEdit(index)
    if (ui.editingSectionIndex() === index) ui.setEditingSectionIndex(null)
  }

  function closeSectionEditorOnOutsidePress(event: MouseEvent): void {
    const index = ui.editingSectionIndex()
    if (index === null) return
    // `blurred` closes it through the header inputs' own `onBlur`.
    if (pressOutsideSectionHeader(event, sectionHeaderOfRow(index)) === 'unfocused') closeSectionEditor(index)
  }

  async function commitSectionEdit(startIndex: number): Promise<void> {
    const manifestIndex = manifestIndexAt(slideEntries(), startIndex)
    if (manifestIndex === null) return
    const draft = render.sectionDrafts()[manifestIndex]
    const range = editor.slideRanges()[startIndex]
    if (!draft || !range) return
    const otherSectionsMs = (render.manifest()?.sections ?? [])
      .reduce((sum, section) => section.startIndex === manifestIndex ? sum : sum + section.plannedDurationMs, 0)
    // The spinners can read a time peitho-core rejects (0m0s, or one that
    // pushes the deck total past its limit), so the saved time is clamped.
    // Show the clamped value right away: when the slide already holds that
    // time, nothing below saves or re-renders to correct the spinners.
    const timeMs = savableSectionTimeMs(draft.timeMs, otherSectionsMs)
    updateSectionDraft(manifestIndex, current => ({ ...current, timeMs }))
    const slideText = currentSlideText(startIndex)
    const patch = { section: draft.name, time: formatDurationMs(timeMs) }
    const updatedSlideText = updatePageComment(slideText, patch)
    if (updatedSlideText === slideText) return
    // Through the same path as every other structural operation, so it is
    // undoable; `syncedSource` re-totals the frontmatter `time:` from every
    // section's own time, keeping the next build from rejecting a stale total.
    await perform({ kind: 'config', index: startIndex, patch })
  }

  // `selectionPlanFor(move)` is `follow-move`, not "select `to`":
  // unconditionally selecting `to` would drag the *editor's* selection over
  // to whatever slide just got dropped even when a *different* slide,
  // mid-edit and not yet saved, was the one actually open. `follow-move`
  // keeps the open slide's own position (shifted for the reorder) unless
  // it's the one that moved, in which case that's `to` anyway.
  async function reorderSlides(from: number, to: number): Promise<void> {
    await perform({ kind: 'slides', cmd: { type: 'move', from, to } })
  }

  // Runs one history step against the current slides (the open slide's
  // unsaved draft included) through the same `commitChange` path every
  // structural operation uses, and reports the step that undoes it.
  async function runStep(step: HistoryStep): Promise<StepOutcome> {
    const texts = currentSlideTexts()
    const cmd = commandForStep(texts, step)
    if (validate(texts, cmd)) return { kind: 'rejected' }
    const inverse = inverseStep(texts, step)
    const ok = await commitChange(sourceFor(applyCommand(texts, cmd), cmd), selectionPlanFor(cmd))
    return ok ? { kind: 'done', inverse } : { kind: 'failed' }
  }

  // Structural operations and undo/redo run one at a time: each reads the
  // slides only once the previous one has landed. Run concurrently, both
  // would compute from the same slides, the later whole-file save would
  // silently overwrite the earlier, and the history would record a step for
  // a change that is no longer in the file.
  let structuralQueue: Promise<void> = Promise.resolve()
  function serialized(run: () => Promise<void>): Promise<void> {
    const next = structuralQueue.then(run)
    structuralQueue = next.catch(() => undefined)
    return next
  }

  // A new structural operation: runs it and records how to undo it.
  function perform(step: HistoryStep): Promise<void> {
    return serialized(async () => {
      const outcome = await runStep(step)
      if (outcome.kind === 'done') history.record(outcome.inverse)
    })
  }

  // Edit > Undo (`undo`) / Redo (`redo`) outside the text fields, queued
  // behind any structural operation still saving. On success the opposite
  // step goes onto the other stack; a failed commit puts the step back so it
  // can be retried; a rejected one means the history no longer matches the
  // deck, so it is dropped whole rather than left to misfire on the next
  // press.
  function replayHistory(direction: 'undo' | 'redo'): Promise<void> {
    return serialized(() => replayHistoryNow(direction))
  }
  async function replayHistoryNow(direction: 'undo' | 'redo'): Promise<void> {
    const isUndo = direction === 'undo'
    const step = isUndo ? history.takeUndo() : history.takeRedo()
    if (step === null) return
    const outcome = await runStep(step)
    if (outcome.kind === 'done') {
      if (isUndo) history.pushRedo(outcome.inverse)
      else history.pushUndo(outcome.inverse)
      setStatusMessage({ kind: isUndo ? 'undone' : 'redone' })
    } else if (outcome.kind === 'failed') {
      if (isUndo) history.pushUndo(step)
      else history.pushRedo(step)
    } else {
      history.clear()
      setStatusMessage({ kind: 'history-cleared' })
    }
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
      if ((event.target as HTMLElement).closest('input, textarea')) return
      // Any button, so Cmd+Z after a right-click menu operation also
      // reaches the structural undo rather than the body editor.
      blurEditorFieldOnRowPress()
      if (event.button !== 0) return
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
    if (index === null) {
      ui.setContextMenu({ kind: 'on-empty-space', x: event.clientX, y: event.clientY })
    } else {
      void selectSlide(index)
      void checkLayoutFit(index, ui.openSlideContextMenu(index, event.clientX, event.clientY))
    }
    void loadLayoutPreviews()
  }

  // Asks peitho-core which layouts slide `index` fits, against the source
  // `updateSlideConfig` would pin a layout onto — the open slide's unsaved
  // draft included. Read synchronously, before the first `await`: when the
  // right-click switched away from a dirty slide, `selectSlide`'s flush is
  // still in flight and that draft is still what's current. A failed call
  // (e.g. a draft that doesn't parse yet) settles as "unavailable", leaving
  // every layout choosable — `commitChange` renders before it saves, so a
  // mismatch that gets past this still never reaches disk.
  async function checkLayoutFit(index: number, requestId: number): Promise<void> {
    const source = editor.isDirty() ? (currentDraftSource() ?? editor.fullSource()) : editor.fullSource()
    let verdicts: LayoutVerdict[] | null = null
    try {
      verdicts = await deckIpc.checkSlideLayouts(source, index)
    } catch {
      // Settles as unavailable below.
    }
    ui.settleLayoutFit(requestId, verdicts)
  }

  // A layout the slide fits is pinned and the menu closes, same as before
  // the fit check existed; one it doesn't fit — or any, while the check is
  // still running — keeps the menu open with a notice, and deck.md is left
  // untouched.
  function chooseLayoutFromPicker(layout: string): void {
    const choice = chooseLayout(ui.contextMenu(), layout)
    if (choice.kind === 'apply') {
      void changeSlideLayout(choice.index, layout)
      ui.closeContextMenu()
    } else if (choice.kind === 'reject' || choice.kind === 'wait') {
      ui.showLayoutNotice(choice.notice)
    }
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
    await perform({ kind: 'slides', cmd: { type: 'delete', index } })
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
  // Untracked: canvases are mounted from inside effects, and a tracked
  // read here would subscribe them to the manifest — remounting every
  // canvas on each edit.
  setManifestKeysSource(() => untrack(existingSlideKeys))

  // Inserts a blank new slide right after `index`, with an explicit
  // PageComment `key` — pressing "New Slide" more than once always
  // produces the exact same heading ("New Slide"), and peitho derives a
  // key from a slide's heading when it has no explicit one, so leaving
  // the key unset (as this used to) meant a second press collided with
  // the first ("duplicate slide key 'new-slide'"). `uniqueSlideKey` picks
  // `new-slide`, `new-slide-2`, `new-slide-3`, ... against the deck's
  // actual current keys instead.
  async function addSlide(index: number): Promise<void> {
    const texts = currentSlideTexts()
    const insertAt = Math.min(index + 1, texts.length)
    const key = uniqueSlideKey(slugifyTitle('New Slide'), existingSlideKeys())
    const { config: previousConfig } = extractPageComment(texts[index] ?? '')
    const config = newSlideConfig(previousConfig, key)
    await perform({ kind: 'slides', cmd: { type: 'insert', at: insertAt, text: buildSlideText(config, NEW_SLIDE_MARKDOWN, '') } })
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
    const insertAt = Math.min(index + 1, editor.slideRanges().length)
    const trimmedClip = clip.trim()
    const { config } = extractPageComment(trimmedClip)
    const baseKey = typeof config.key === 'string' && config.key !== ''
      ? config.key
      : slugifyTitle(extractHeadingText(trimmedClip) ?? '')
    const key = uniqueSlideKey(baseKey, existingSlideKeys())
    await perform({ kind: 'slides', cmd: { type: 'insert', at: insertAt, text: updatePageComment(trimmedClip, { key }) } })
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
    return slideConfigOfText(editor.slideRanges()[index]?.text ?? '')
  }

  // Routed through `syncedSource` (not a direct range-slice replace) so a
  // config change that adds or removes a section (see `toggleSlideSection`)
  // keeps the frontmatter time total correct — a no-op resync for updates
  // (layout/draft/skip) that don't touch `section`/`time`.
  async function updateSlideConfig(index: number, updates: Partial<PageConfig>): Promise<void> {
    const slideText = currentSlideText(index)
    if (updatePageComment(slideText, updates) === slideText) return
    // Recorded as a field patch, not a whole-text replace, so undoing it
    // later keeps text typed into the slide in between.
    await perform({ kind: 'config', index, patch: updates })
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
      const discard = window.confirm(settings.messages().externalChangeConfirm)
      if (!discard) {
        const ranges = splitSlides(source)
        history.clear()
        editor.setFullSource(source)
        editor.setSlideRanges(ranges)
        const i = editor.selectedIndex()
        if (i !== null && i < ranges.length) {
          const { rest: withoutNote, note } = extractNote(ranges[i].text)
          const { rest, config } = extractPageComment(withoutNote)
          editor.setEditorSession(session => withRefreshedSaved(session, { body: rest, note, config }))
        }
        await renderPreview(source)
        setStatusMessage({ kind: 'merged-external-change' })
        return
      }
    }
    await refreshSource(true)
    await renderPreview(editor.fullSource())
    setStatusMessage({ kind: 'reloaded-external-change' })
  }

  async function loadSettings(): Promise<void> {
    try {
      settings.applyLoaded(await settingsIpc.getSettings())
    } catch {
      // Best-effort like `refreshRecentDecks`: the defaults stay in place.
      // `get_settings` itself never fails (a bad file reads as defaults),
      // so only a broken IPC bridge lands here, and an error banner would
      // be cleared by the deck opening at the same time anyway.
    }
  }

  // Best-effort like `loadSettings`: on failure the webview's own guess
  // stays in place.
  async function loadSystemLocales(): Promise<void> {
    try {
      settings.applySystemLocales(await settingsIpc.getSystemLocales())
    } catch {
      // Keeps the guess.
    }
  }

  // Saved like any setting: every window, this one included, switches on
  // hearing `settings:changed`; applying the answer here too covers this
  // window without waiting on the broadcast.
  async function changeLanguage(language: Language): Promise<void> {
    if (settings.settings().uiLanguage === language) return
    try {
      settings.applyChanged(await settingsIpc.updateSettings({ uiLanguage: language }))
    } catch (err) {
      setErrorMessage(String(err))
    }
  }

  // Focus moves onto the panel while it's open, so a slide editor behind
  // it stops taking typing and Edit > Undo (see `dom/settingsPanel.ts`).
  function openSettings(): void {
    if (settings.panelOpen()) return
    ui.closeContextMenu()
    settings.openPanel()
    focusSettingsPanel()
  }

  function closeSettings(): void {
    if (!settings.panelOpen()) return
    settings.closePanel()
    restoreFocusAfterSettingsPanel()
  }

  // Every window, this one included, also hears the saved result through
  // `settings:changed`; applying the answer here too keeps this window
  // right even if that broadcast is missed.
  async function changeVimMode(on: boolean): Promise<void> {
    try {
      settings.applyChanged(await settingsIpc.updateSettings({ vimMode: on }))
    } catch (err) {
      setErrorMessage(settings.messages().vimModeSaveFailed(String(err)))
    }
  }

  onMount(() => {
    void refreshRecentDecks()
    void loadSettings()
    void loadSystemLocales()

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

    // App menu "Settings…" (Cmd+,), sent to the focused window only; and
    // any window's saved change, sent to every window.
    const unlistenMenuSettings = settingsIpc.onMenuSettings(openSettings)
    const unlistenSettingsChanged = settingsIpc.onSettingsChanged(settings.applyChanged)
    // Vim mode's `p` puts what another app copied: the clipboard is read
    // into vim's register ahead of time (see `dom/vimClipboard.ts`).
    const unlistenClipboard = onClipboardMayHaveChanged(() => {
      if (settings.settings().vimMode) vimClipboard.pullClipboard()
    })

    // Edit > Undo/Redo, by mouse or by Cmd+Z / Cmd+Shift+Z (see
    // `src-tauri/src/edit_menu.rs`): a focused text field gets its own text
    // undo, anything else undoes a slide operation. Only the slide operation
    // waits while the phone shape menu is open, like every other shortcut in
    // `onKeyDown`: WebKit keeps focus in the body through the clicks that
    // open that menu, and its text undo must still run.
    const onMenuHistory = (direction: 'undo' | 'redo') => {
      if (replayFocusedFieldHistory(direction)) return
      if (ui.phoneShapeMenuOpen() || settings.panelOpen()) return
      void replayHistory(direction)
    }
    const unlistenMenuUndo = deckIpc.onMenuUndo(() => { onMenuHistory('undo') })
    const unlistenMenuRedo = deckIpc.onMenuRedo(() => { onMenuHistory('redo') })

    const onKeyDown = (event: KeyboardEvent) => {
      // While the settings panel is open, Escape closes it and every other
      // shortcut waits, since Delete or an arrow key would otherwise act on
      // the slides behind it.
      if (settings.panelOpen()) {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeSettings()
        }
        return
      }
      // While the phone shape menu is open, Escape closes it and every other
      // shortcut waits: arrows would move the selection, and Delete or Cmd+X
      // would act on a slide behind the open menu.
      if (ui.phoneShapeMenuOpen()) {
        if (event.key === 'Escape') {
          event.preventDefault()
          ui.closePhoneShapeMenu()
        }
        return
      }
      if (event.key === 'Escape' && ui.contextMenu().kind !== 'closed') {
        event.preventDefault()
        ui.closeContextMenu()
        return
      }
      if (isTypingInField()) return
      // Cmd+Z / Cmd+Shift+Z aren't handled here: left alone, they reach the
      // Edit menu's Undo/Redo accelerators, the one path for both keyboard
      // and mouse (see `onMenuHistory` above).
      const key = event.key.toLowerCase()
      // `slideEntries().length`, not `manifest.slideCount`/`manifest.slides.length`
      // — the latter excludes drafts, which would leave ArrowUp/ArrowDown
      // permanently unable to reach a draft placeholder (or anything past
      // it) once a deck has one, even though it's reachable by click.
      const count = slideEntries().length
      if (count === 0) return
      const current = editor.selectedIndex()
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
    window.addEventListener('mousedown', closeSectionEditorOnOutsidePress, true)

    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', closeSectionEditorOnOutsidePress, true)
      unlistenFileChanged()
      unlistenMenuNew()
      unlistenMenuSettings()
      unlistenSettingsChanged()
      unlistenClipboard()
      unlistenMenuUndo()
      unlistenMenuRedo()
    })
  })

  // `present_deck` resolving only means the OS accepted spawning the
  // `peitho present` subprocess — near-instant regardless of deck size,
  // well before that subprocess has actually rendered anything. Clearing
  // `presentPending` right there (the original version of this function)
  // made the busy state flash for a single frame on every click, reading
  // as a glitch rather than feedback, and — worse — never actually covered
  // the slow part a heavy deck spends rendering, which is exactly the lag
  // this feature exists to cover. `onPresentReady` fires once the
  // subprocess's own stdout shows it actually started serving (see
  // `watch_present_readiness` in peitho.rs); the fixed timeout is only a
  // fallback for a `peitho` binary that, for whatever reason, never prints
  // that line (e.g. a version mismatch) — busy state just clears silently
  // in that case rather than hanging forever with no way out.
  const PRESENT_READY_TIMEOUT_MS = 15_000

  async function handlePresent(rehearsal: boolean): Promise<void> {
    // Guards against a second `present_deck` firing while the first is
    // still in flight even if some caller reaches this past the button's
    // own `disabled` — same defensive pattern as `deck.isBusy()` above.
    if (ui.presentPending()) return
    setErrorMessage(null)
    ui.setPresentPending(true)
    try {
      await deckIpc.presentDeck(rehearsal)
      const outcome = await racePresentOutcome(deckIpc.onPresentReady, deckIpc.onPresentFailed, PRESENT_READY_TIMEOUT_MS)
      if (outcome.kind === 'failed') {
        setErrorMessage(outcome.message)
        return
      }
      setStatusMessage({ kind: 'presenting', rehearsal })
    } catch (err) {
      setErrorMessage(String(err))
    } finally {
      ui.setPresentPending(false)
    }
  }

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {!deck.showEditor() ? (
        <WelcomeScreen
          language={settings.language()}
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
        language={settings.language()}
        deckPath={deck.deckPath()}
        variantSwitcherShown={variantSwitcher().kind === 'shown'}
        currentVariantLabel={currentVariantLabelOf(variantSwitcher())}
        variantOptions={variantOptionsOf(variantSwitcher())}
        variantMenuOpen={ui.variantMenuOpen()}
        onToggleVariantMenu={() => ui.setVariantMenuOpen(!ui.variantMenuOpen())}
        onCloseVariantMenu={() => ui.setVariantMenuOpen(false)}
        onOpenVariant={path => void dispatch({ type: 'open-requested', path })}
        presentMenuOpen={ui.presentMenuOpen()}
        presentPending={ui.presentPending()}
        onTogglePresentMenu={() => ui.setPresentMenuOpen(!ui.presentMenuOpen())}
        onClosePresentMenu={() => ui.setPresentMenuOpen(false)}
        onPresent={rehearsal => void handlePresent(rehearsal)}
      />

      {deck.deckPath() === null ? (
        // `showEditor()` went true the instant `open-requested`/`created`
        // was dispatched — before `deckIpc.openDeck()` has even started,
        // let alone resolved. Landing here immediately (rather than
        // staying on WelcomeScreen until data arrives) is the whole
        // point: the screen change itself is the "you pressed it and it's
        // doing something" signal, which held up far better on a real
        // device than any busy-indicator design bolted onto WelcomeScreen
        // did (see todo/archive/welcome-open-feels-frozen.md). A deck the
        // launch warm-up didn't cover (`engine::warm_up`), or a large one,
        // can still sit here a noticeable moment, so the spinner keeps
        // moving to show it hasn't stalled.
        <div role="status" className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <span aria-hidden="true" className="w-4 h-4 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin"></span>
          {settings.messages().loadingDeck}
        </div>
      ) : (
      <div className="flex-1 flex min-h-0">
        <SlideList
          language={settings.language()}
          manifest={render.manifest()}
          entries={slideEntries()}
          slideListWidth={ui.slideListWidth()}
          draggedIndex={ui.draggedIndex()}
          dragOverGap={ui.dragOverGap()}
          dragDeltaY={ui.dragDeltaY()}
          selectedIndex={editor.selectedIndex()}
          sectionStartByIndex={sectionStarts()}
          rowVisibility={rowVisibility()}
          lastVisibleRow={lastShownRow()}
          onToggleSectionCollapse={toggleSectionAt}
          sectionDraftOf={index => {
            const manifestIndex = manifestIndexAt(slideEntries(), index)
            return manifestIndex === null ? { name: '', timeMs: 0 } : render.sectionDraftOf(manifestIndex)
          }}
          editingSectionIndex={ui.editingSectionIndex()}
          onEditSection={openSectionEditor}
          canvasWidth={render.canvasWidth()}
          canvasHeight={render.canvasHeight()}
          canvasFragmentOf={render.canvasFragmentOf}
          slideStylesheet={getSlideStylesheet}
          onContextMenu={openContextMenu}
          onDragStart={startSlideDrag}
          onSelectSlide={index => selectSlide(index)}
          onSectionNameInput={onSectionNameInput}
          onSectionTimeInput={onSectionTimeInput}
          onCommitSectionEdit={closeSectionEditor}
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
            language={settings.language()}
            hasSelection={editor.selectedRange() !== null}
            onBodyHost={onBodyEditorHost}
            onNoteHost={onNoteEditorHost}
          />
        </div>

        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startColumnResize(ui.editorWidth, ui.setEditorWidth, 1)}
        />

        <SlidePreview
          language={settings.language()}
          selectedSlideKey={selectedSlideKey()}
          hasDeck={Boolean(render.assetBaseUrl())}
          canvasFragmentOf={render.canvasFragmentOf}
          slideStylesheet={getSlideStylesheet}
          viewportMode={ui.viewportMode()}
          onToggleViewportMode={ui.toggleViewportMode}
          phoneShape={ui.phoneShape()}
          phoneShapeMenuOpen={ui.phoneShapeMenuOpen()}
          onTogglePhoneShapeMenu={ui.togglePhoneShapeMenu}
          onClosePhoneShapeMenu={ui.closePhoneShapeMenu}
          onSelectPhoneShape={ui.selectPhoneShape}
          canvasWidth={previewCanvasWidth()}
          canvasHeight={previewCanvasHeight()}
        />
      </div>
      )}

      <StatusBar
        language={settings.language()}
        errorMessage={errorMessage()}
        errorMessageCopied={errorMessageCopied()}
        statusMessage={statusText(settings.messages(), statusMessage())}
        onCopyErrorMessage={() => void copyErrorMessage()}
      />

      <SlideContextMenu
        language={settings.language()}
        hidden={ui.contextMenu().kind === 'closed'}
        position={contextMenuPositionOf(ui.contextMenu())}
        menuItems={currentMenuItems()}
        layoutPickerOpen={isLayoutPickerOpen(ui.contextMenu())}
        layoutPickerView={layoutPickerView()}
        layoutPreviews={ui.layoutPreviews()}
        layoutFit={layoutFitOf(ui.contextMenu())}
        layoutNotice={layoutNoticeOf(ui.contextMenu())}
        layoutPreviewStylesheet={getLayoutPreviewStylesheet}
        canvasWidth={render.canvasWidth()}
        canvasHeight={render.canvasHeight()}
        onMenuRef={el => { contextMenuEl = el }}
        onClose={ui.closeContextMenu}
        onNewSlide={() => { void addSlide(ui.contextMenuAppendIndex(slideEntries().length || 1)); ui.closeContextMenu() }}
        onCut={() => { void cutSlide(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onCopy={() => { copySlide(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onPaste={() => { void pasteSlideAfter(ui.contextMenuAppendIndex(slideEntries().length || 1)); ui.closeContextMenu() }}
        onDelete={() => { void deleteSlide(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onToggleLayoutPicker={ui.toggleLayoutPicker}
        onChangeLayout={chooseLayoutFromPicker}
        onToggleDraft={() => { void toggleSlideDraft(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onToggleSkip={() => { void toggleSlideSkip(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onToggleSection={() => { void toggleSlideSection(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onMoveUp={() => { void moveSlide(contextMenuIndexOf(ui.contextMenu())!, -1); ui.closeContextMenu() }}
        onMoveDown={() => { void moveSlide(contextMenuIndexOf(ui.contextMenu())!, 1); ui.closeContextMenu() }}
      />
        </>
      )}

      <NewDeckModal
        language={settings.language()}
        isOpen={deck.newDeckModalOpen()}
        name={deck.newDeckName()}
        parentDir={deck.newDeckParentDir()}
        isBusy={deck.isBusy()}
        errorMessage={errorMessage()}
        onNameChange={name => void dispatch({ type: 'name-changed', name })}
        onCancel={() => { setErrorMessage(null); void dispatch({ type: 'create-cancelled' }) }}
        onConfirm={() => void dispatch({ type: 'create-confirmed' })}
      />

      <SettingsPanel
        isOpen={settings.panelOpen()}
        language={settings.language()}
        vimMode={settings.settings().vimMode}
        onClose={closeSettings}
        onChangeLanguage={language => void changeLanguage(language)}
        onVimModeChange={on => { void changeVimMode(on) }}
      />
    </div>
  )
}
