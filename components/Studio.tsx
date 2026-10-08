'use client'

import { moveImageOrder, type ImageOrderAction } from '../domain/imageOrder'

import { suppressNativeContextMenu } from '../dom/nativeContextMenu'
import { createSignal, createMemo, createEffect, onMount, onCleanup, untrack } from '@barefootjs/client'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createTauriDeckIpc } from '../ipc/deckIpc'
import { createTauriUpdateIpc } from '../ipc/updateIpc'
import { initialUpdateStatus, canPrepareUpdate, showUpdateNotice, updateBlocksEditing, updateMessages, updateStatusText, type UpdateStatus } from '../domain/updates'
import { createTauriSettingsIpc } from '../ipc/settingsIpc'
import { createTauriEditorIpc } from '../ipc/editorIpc'
import { createTauriImageIpc, type FileDrop } from '../ipc/imageIpc'
import { editorTextChange } from '../domain/editorText'
import { clearedSlideText, removeSlideText, imageSlotContent, textEditFor, textEditInsertion, slotTextInsertion, looseBodyEdit, removeImageSlot, type SlideEditTarget, type SlideEditSession } from '../domain/slideEdit'
import { createTauriCritIpc } from '../ipc/critIpc'
import {
  REVIEW_AUTHOR, REVIEW_POLL_MS, commentCountsBySlide, commentKeyOf, commentTargetOf, layoutClickTarget, layoutTargetLabel, layoutTargetOfComment, lineSelectionOf, newLayoutComment, newReviewComment, pollsForAgent,
  previewPinsOf, reviewStatusText, slideIndexOfComment, slideSpans, targetLabel, editorLinesTarget, targetLines,
  type CommentTarget, type LayoutCommentTarget, type PreviewPin,
} from '../domain/reviewComment'
import { agentConnectCommand, agentConnectPrompt, agentGoneQuiet, connectTargetOf, showsConnectGuide } from '../domain/agentConnect'
import { formatReviewTime, isUnsentEditing, resolvedCount, reviewRows, threadOfPin } from '../domain/reviewPanel'
import { layoutThumbnailClickOf, layoutThumbnailContextClickOf, noteLayoutRowPress } from '../dom/layoutComments'
import { keepShownPopupsInWindow } from '../dom/popupFit'
import { observeInnerSize } from '../dom/elementSize'
import { focusCommentBox, focusUnsentEdit, placePreviewPins, revealReviewThread, watchPreviewLayout, type PreviewClick } from '../dom/previewComments'
import { createReviewStore } from '../state/reviewStore'
import { CommentBox } from './CommentBox'
import { PanelToggle } from './PanelToggle'
import { ReviewPanel } from './ReviewPanel'
import { type ManifestSlide, type RenderErrorPayload, type RenderPayload, type SectionDraft, brokenSlideIndex, renderFailureMessage } from '../domain/render'
import { type BrokenSlides, brokenSlidesAfterCommand, brokenSlidesSummary, isolateSlide, saveDecision, startIsolation } from '../domain/brokenSlides'
import { RenderFailure } from '../ipc/renderOutcome'
import { SOURCE_EDITING_CLOSED, openSourceEditing, slideIndexAfterSourceSave, sourceEditorOffered, sourceReadFromDisk, sourceSaved, typeInSource } from '../domain/sourceEditing'
import { clampMenuPosition, dropPointToCss, type Size } from '../domain/geometry'
import { replacementInsertion, textBetween } from '../domain/editorText'
import { fileNameOf, partitionDroppedPaths } from '../domain/images'
import { previewDevice, scaledDownPercent, viewportCanvas } from '../domain/viewport'
import { hasFixedCanvas } from '../domain/slideFragment'
import { type PageConfig } from '../domain/pageConfig'
import { type SelectionPlan, type SlideFields, opensSameSlide, reconcileAfterCommit, withRefreshedSaved, withDraftBody, withDraftNote } from '../domain/editorSession'
import { type SlideCommand, applyCommand, indexAfterCommand, needsTimeResync, selectionPlanFor, validate } from '../domain/slideCommands'
import { type FrontmatterStep, type HistoryStep, type LayoutPinsStep, type PageNumbersStep, type SlideChange, type StepOutcome, type StructuralStep, type TextField, type TextStep, applyFrontmatterStep, applyLayoutPinsStep, applyPageNumbersStep, commandForStep, inverseFrontmatterStep, inverseLayoutPinsStep, inversePageNumbersStep, historyPinsLayout, layoutPinsStepFor, inverseStep, pageNumbersStepFor, selectionForReplay, slideConfigOfText } from '../domain/editorHistory'
import { type DeckSettingsState, frontmatterValueOf, pickChangesNothing, readDeckSettings, resolveDeckSettingPick, sameDeckSettings } from '../domain/deckSettings'
import { PAGE_NUMBERS_KEY, pageNumbersShown, parsePageNumbersMode, readFrontmatterKey, setFrontmatterKey } from '../domain/frontmatter'
import { arm, move, dropTarget, cancel } from '../domain/drag'
import { indexOf as contextMenuIndexOf, positionOf as contextMenuPositionOf, isLayoutPickerOpen, menuItems as computeMenuItems, chooseLayout, commentClickOf, layoutFitOf, layoutNoticeOf } from '../domain/contextMenu'
import { type LayoutVerdict, availabilityOf, settledFitCheck } from '../domain/layoutFit'
import { type LayoutColumns, type LayoutNameProblem, type StudioMode, initialLayoutListWidth, layoutColumnFilling, layoutRailShown, layoutFilesChanged, layoutListGeneration, layoutRows, layoutThumbnailStyle, layoutUsage, selectedPreviewRoom, shownLayout } from '../domain/layoutScreen'
import { canConfirmDelete, replacementChoices } from '../domain/layoutDelete'
import { FILE_AUTOSAVE_DELAY_MS, allTabsOpen, autosavePaths, canCloseFile, fileDraft, isFileChangedOnDisk, isFileDirty, leaveBlocker, shouldAutosave, tabsBlocker, type FileEditor } from '../domain/fileEditor'
import { fileLanguage, fileName, fileTreeRows, layoutFilePaths, layoutOfFile } from '../domain/deckFiles'
import { DEFAULT_LAYOUT, layoutDisplayName } from '../domain/standardLayouts'
import type { Messages } from '../domain/messages'
import { type ImageSlotFix, imageLayoutPin, imageSlotFixFor, parseImageSlotError, shownImageSlotFix } from '../domain/imageSlot'
import { type DeckEvent, decide } from '../domain/deckLifecycle'
import { buildSlideList, lastRenderedLayoutOf, manifestIndexAt, sectionStartBySourceIndex } from '../domain/slideList'
import { collapseKeyAt, collapsedSectionContaining, collapsedSectionStarts, lastVisibleRow, rowVisibilities, sectionSpans } from '../domain/sectionCollapse'
import { type DeckVariant, currentVariantLabelOf, toVariantSwitcher, variantOptionsOf } from '../domain/deckVariants'
import { racePresentOutcome } from '../domain/eventRace'
import { type Language } from '../domain/language'
import { type StatusMessage, statusText } from '../domain/statusMessage'
import { type ScriptTrust, type ScriptTrustEvent, nextScriptTrust, scriptTrustOnOpen, trustBannerShown } from '../domain/scriptTrust'
import { takesCommandKeys, type VimMode } from '../domain/vimMode'
import { gapUnderCursor, attachDragListeners, setDragAffordance } from '../dom/dragGesture'
import { COLUMN_WIDTH_BOUNDS, measureWidthsNextFrame, startColumnResize } from '../dom/columnResize'
import { blurEditorFieldOnRowPress, isFocusWithin, isTypingInField, replayFocusedFieldHistory } from '../dom/fieldFocus'
import { canReplayCodeEditorGroup, codeEditorPositionAt, codeEditorSelection, codeEditorSelectionPoint, createCodeEditor, insertIntoCodeEditor, isCodeEditorComposing, isolateCodeEditorHistory, replaceCodeEditorTextUndoable, replayCodeEditorGroup, replayFocusedCodeEditorHistory, resetCodeEditorText, restoreCodeEditor, selectInCodeEditor, setCodeEditorPlaceholder, setCodeEditorText, setCodeEditorVimMode, snapshotCodeEditor, type CodeEditorOptions, type CodeEditorSnapshot } from '../dom/codeEditor'
import { createEditorSlideStates } from '../dom/editorSlideStates'
import { createVimClipboardBridge, onClipboardMayHaveChanged } from '../dom/vimClipboard'
import { readPastedImage } from '../dom/imagePaste'
import { focusSectionNameInput, pressOutsideSectionHeader, sectionHeaderOfRow } from '../dom/sectionHeader'
import { focusSettingsPanel, restoreFocusAfterSettingsPanel } from '../dom/settingsPanel'
import { slideRowMenuAnchor } from '../dom/slideRow'
import { createSlideStylesheet, ensureFontFaces, mountSlideCanvas, observeCanvasScale, patchSlideCanvas, remountSlideCanvases, setDraftFontFaces, setManifestKeysSource, setScriptsBlockedListener, setSlideScriptsTrusted } from '../dom/slideCanvas'
import { createUiStore } from '../state/uiStore'
import { createLayoutScreenStore } from '../state/layoutScreenStore'
import { createRenderStore } from '../state/renderStore'
import { createEditorStore } from '../state/editorStore'
import { createDeckStore } from '../state/deckStore'
import { createHistoryStore } from '../state/historyStore'
import { createSaveTracker } from '../state/saveTracker'
import { createSettingsStore } from '../state/settingsStore'
import {
  splitSlides,
  extractNote,
  extractPageComment,
  buildSlideText,
  replaceSlideText,
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
import type { NewDeckSettings } from '../domain/newDeckSettings'
import { SettingsPanel } from './SettingsPanel'
import { DeckHeader } from './DeckHeader'
import { ScriptTrustBanner } from './ScriptTrustBanner'
import { StatusBar } from './StatusBar'
import { SlidePreview } from './SlidePreview'
import { SlideEditor } from './SlideEditor'
import { SlideContextMenu } from './SlideContextMenu'
import { SlideList } from './SlideList'
import { LayoutScreen, type LayoutDeleteView } from './LayoutScreen'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { type CommentMenu, type CommentMenuAction, type EditorTarget, type MenuEditor, sameEditorTarget, commentMenuItems, commentMenuLabel, commentMenuPosition, openOnEditor, selectionForMenu } from '../domain/commentMenu'
import { menuItemIcon, setApartFromComment } from '../domain/menuComment'
import { focusDeleteLayoutDialog, focusNewLayoutName } from '../dom/layoutModals'
import { absolutizedDraft, draftPreviewError, draftedLayout, previewDraftCss, previewToDraw } from '../domain/layoutDraftPreview'
import { scopeRootToHost } from '../domain/slideCss'
import { type LayoutMenuAction, layoutMenuItems, layoutMenuLabel, layoutMenuPosition, layoutMenuSlot, layoutMenuTarget, layoutMenuTitle } from '../domain/layoutMenu'

// Just the heading — `addSlide` attaches an explicit, collision-free
// PageComment `key` around this (see its own comment for why).
const NEW_SLIDE_MARKDOWN = '# New Slide\n'

// How `syncEditorFields` pushes the drafts into the editors (see there).
type EditorSync =
  | { kind: 'same-slide' }
  | { kind: 'switch'; from: number | null; to: number | null }
  | { kind: 'reset' }

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
      await runCreate(next.parentDir, next.name, next.settings)
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
      // Before any slide mounts, so none of them goes in with the wrong trust.
      setSlideScriptsTrusted(info.trusted)
      setScriptTrust(scriptTrustOnOpen(info.trusted))
      // A deck peitho-core refused opens all the same (see `open_deck` in
      // peitho.rs): the editor works from the source alone — every row a
      // placeholder (`slideEntries`) — with the refusal in the error bar
      // (`shownErrorMessage`, from `render.outcome()`) and the preview
      // pane, and the slide it names selected, until a fixed source
      // renders.
      await refreshSource(false, info.render.kind === 'rendered' ? info.render : undefined)
      if (info.render.kind === 'failed') {
        render.markRenderFailed(info.render.error)
        const broken = brokenSlideIndex(info.render.error, editor.slideRanges().length)
        if (broken !== null) await selectSlide(broken)
        // Render the rest of the deck without the slides that don't build
        // (`domain/brokenSlides.ts`): `open_deck` renders once and stops
        // at the first refusal; this retries, isolating each slide named,
        // and lands as a render with ERROR rows — or, when it can't
        // isolate, leaves the failed state set above. Not awaited: the
        // editor opens on the source meanwhile.
        void renderPreview(editor.fullSource(), { persisted: true })
      }
      setStatusMessage({ kind: 'opened', deckPath: info.deckPath })
      await dispatch({ type: 'opened', deckPath: info.deckPath })
      // Only once `open`: a variant picked while still `opening` would be
      // rejected by `decide` as busy, silently doing nothing.
      void refreshDeckVariants()
      review.reset()
      void refreshReview()
      void noteLayoutFiles()
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
  async function runCreate(parentDir: string, name: string, settings: NewDeckSettings): Promise<void> {
    setErrorMessage(null)
    try {
      const path = await deckIpc.createDeck(parentDir, name, settings)
      await dispatch({ type: 'created', path })
    } catch (err) {
      setErrorMessage(String(err))
      await dispatch({ type: 'failed', message: String(err) })
    }
  }
  // The banner's "Trust and Run": saves the trust Rust-side first, then
  // re-inserts every slide unsanitized so its scripts run.
  async function trustDeckScripts(): Promise<void> {
    if (scriptTrust().kind !== 'untrusted') return
    applyScriptTrustEvent('trust-requested')
    try {
      await deckIpc.trustOpenDeck()
      setSlideScriptsTrusted(true)
      remountSlideCanvases()
      applyScriptTrustEvent('trust-succeeded')
    } catch (err) {
      setErrorMessage(String(err))
      applyScriptTrustEvent('trust-failed')
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
      await deckIpc.openDeckVariant(path)
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
  // The layout screen (the header's Layouts mode) — see
  // `state/layoutScreenStore.ts`; its file operations run from here.
  const layouts = createLayoutScreenStore()
  // Undo/redo (Edit menu, Cmd+Z / Cmd+Shift+Z): one timeline of slide
  // operations and the editors' typing — see `state/historyStore.ts` and
  // `replayHistory` below.
  const history = createHistoryStore()
  // App-wide settings, whether this window's settings panel is open, and
  // the UI language they come to — see `state/settingsStore.ts`. Saved and
  // shared Rust-side (`src-tauri/src/settings.rs`). The webview's own idea
  // of the OS languages is only a first guess, so the first paint is
  // already in the right language where it agrees; `loadSettings` replaces
  // it with the OS's answer, which the native menu bar also goes by.
  const updateIpc = createTauriUpdateIpc()
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>(initialUpdateStatus())
  let heardUpdate = false
  const applyUpdateStatus = (status: UpdateStatus) => { heardUpdate = true; setUpdateStatus(status) }
  async function runUpdateAction(action: 'prepare' | 'dismiss'): Promise<void> {
    try { applyUpdateStatus(await updateIpc[action]()) }
    catch (error) { setUpdateStatus({ ...updateStatus(), phase: 'error', error: String(error) }) }
  }
  async function changeUpdateSetting(field: 'autoCheckUpdates' | 'autoUpdate', on: boolean): Promise<boolean> {
    try {
      settings.applyChanged(await settingsIpc.updateSettings({ [field]: on }))
      return true
    } catch (error) {
      setErrorMessage(`${updateMessages(settings.language()).saveFailed}: ${String(error)}`)
      return false
    }
  }
  const settingsIpc = createTauriSettingsIpc()
  const settings = createSettingsStore(typeof navigator === 'undefined' ? [] : navigator.languages)
  // Vim mode's ties to the OS: the input source goes to ASCII whenever
  // vim takes command keys, and the unnamed register follows the system
  // clipboard (`dom/vimClipboard.ts`).
  const editorIpc = createTauriEditorIpc()
  // Images dropped or pasted into the body, saved into the deck's `img/`.
  const imageIpc = createTauriImageIpc()
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
  const saves = createSaveTracker()
  const [activeSaveCount, setActiveSaveCount] = createSignal(0)
  const isSavingSlide = createMemo(() => activeSaveCount() > 0)
  // What happened, not its text: `StatusBar` words it in the current UI
  // language, so a language change rewords a message already shown.
  const [statusMessage, setStatusMessage] = createSignal<StatusMessage>({ kind: 'none' })
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [errorMessageCopied, setErrorMessageCopied] = createSignal(false)
  // Whether the open deck may run its scripts, and so whether the "scripts
  // are turned off" banner is up — see `domain/scriptTrust.ts`. Until the
  // deck is trusted, `dom/slideCanvas.ts` sanitizes every slide and calls
  // back here when that took a script out.
  const [scriptTrust, setScriptTrust] = createSignal<ScriptTrust>(scriptTrustOnOpen(false))
  function applyScriptTrustEvent(event: ScriptTrustEvent): void {
    setScriptTrust(prev => nextScriptTrust(prev, event))
  }
  setScriptsBlockedListener(() => applyScriptTrustEvent('blocked'))
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
  // The layout screen's editor (`createLayoutCodeEditor`), the file whose
  // text (and undo history) it shows, and the states of the tabs not shown.
  let layoutEditor: ReturnType<typeof createCodeEditor> | undefined
  let layoutEditorShows: string | null = null
  const layoutEditorStates = new Map<string, CodeEditorSnapshot>()
  // Both editors' states for each slide the user has left, so going back
  // to one brings back its undo history (`dom/editorSlideStates.ts`).
  // Positional like the structural history: `forgetSlidePositions` drops
  // both together.
  const slideStates = createEditorSlideStates<{ body: CodeEditorSnapshot | undefined; note: CodeEditorSnapshot | undefined }>()
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
  // - `switch` (another slide opened): keeps the editors' states for the
  //   slide left, at `from` — its position *now*, after any command that
  //   just ran, or `null` when it no longer exists — and brings back the
  //   ones kept for `to`. A slide with none kept (or whose text changed
  //   since) starts with an empty history, so Undo can't bring back
  //   another slide's text.
  // - `reset` (a deck read fresh from disk): the open slide's history goes
  //   too; call `forgetSlidePositions` first for the other slides'.
  function syncEditorFields(sync: EditorSync): void {
    if (sync.kind === 'same-slide') {
      if (bodyEditor) setCodeEditorText(bodyEditor, editor.bodyDraft())
      if (noteEditor) setCodeEditorText(noteEditor, editor.noteDraft())
      return
    }
    // Stored before taking, so a switch whose `from` and `to` name the same
    // slide (the one open before a delete above it) keeps its own state.
    if (sync.kind === 'switch' && sync.from !== null) {
      slideStates.store(sync.from, {
        body: bodyEditor && snapshotCodeEditor(bodyEditor),
        note: noteEditor && snapshotCodeEditor(noteEditor),
      })
    }
    const kept = sync.kind === 'switch' && sync.to !== null ? slideStates.take(sync.to) : undefined
    if (bodyEditor) restoreCodeEditor(bodyEditor, editor.bodyDraft(), kept?.body)
    if (noteEditor) restoreCodeEditor(noteEditor, editor.noteDraft(), kept?.note)
  }

  // History steps and the kept editor states both address slides by
  // position; after anything that may have shifted positions some other
  // way (a deck read fresh from disk, a save that re-split the deck), none
  // of them can be trusted. `slidePositionsEpoch` counts these, so a step
  // taken before an `await` can tell it no longer applies.
  let slidePositionsEpoch = 0
  function forgetSlidePositions(): void {
    slidePositionsEpoch++
    history.clear()
    slideStates.clear()
  }

  function codeEditorOf(field: TextField): ReturnType<typeof createCodeEditor> | undefined {
    return field === 'body' ? bodyEditor : noteEditor
  }

  // A new group of typing in one editor goes onto the timeline, marked
  // with the slide it was typed into. The other editor's newest group is
  // closed, so typing there next starts a group above this one instead of
  // joining one below it.
  let activeTextLayout: { layout: NonNullable<TextStep['layout']>; recorded: (seq: number) => void } | null = null

  function recordTextGroup(field: TextField, seq: number): void {
    const index = editor.selectedIndex()
    if (index === null) return
    const other = codeEditorOf(field === 'body' ? 'note' : 'body')
    if (other) isolateCodeEditorHistory(other)
    const layout = field === 'body' ? activeTextLayout : null
    history.record({ kind: 'text', index, field, seq, ...(layout ? { layout: layout.layout } : {}) })
    layout?.recorded(seq)
  }

  // Closes both editors' newest group of typing, for when a slide
  // operation (or an undo/redo of any step) joins the timeline: CodeMirror
  // would otherwise merge quick typing on both sides of it into one group,
  // whose marker sits below the operation.
  function separateTextHistory(): void {
    if (bodyEditor) isolateCodeEditorHistory(bodyEditor)
    if (noteEditor) isolateCodeEditorHistory(noteEditor)
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
    for (const view of [bodyEditor, noteEditor, layoutEditor, sourceEditor]) {
      if (view) setCodeEditorVimMode(view, on)
    }
  })

  // The whole-deck source editor (`domain/sourceEditing.ts`): the repair
  // path for a deck that doesn't build because of text the slide editor
  // never shows — the frontmatter, a page settings comment. Uncontrolled
  // like the body, off the app's undo timeline like the layout editors
  // (its typing undoes in the editor itself, see `onMenuHistory`), saved
  // like them too: each pause in typing saves (`scheduleSourceAutosave`),
  // through the same render-then-write rule as every other save
  // (`commitSource`), so a draft that doesn't build stays in the editor
  // with its reason in the error bar. A save that goes through rebuilds
  // the per-slide session from disk, since a whole-source edit can move
  // any slide.
  let sourceEditor: ReturnType<typeof createCodeEditor> | undefined
  function onSourceEditorHost(el: HTMLElement): void {
    sourceEditor = createCodeEditor(el, '', {
      ...vimEditorOptions(),
      monospace: true,
      spellcheck: false,
      onChange: text => {
        editor.setSourceEditing(editing => typeInSource(editing, text))
        scheduleSourceAutosave()
      },
    })
  }
  let sourceAutosaveTimer: ReturnType<typeof setTimeout> | undefined
  let sourceSaveQueue: Promise<unknown> = Promise.resolve()
  function scheduleSourceAutosave(): void {
    clearTimeout(sourceAutosaveTimer)
    sourceAutosaveTimer = setTimeout(() => { void queueSourceSave() }, FILE_AUTOSAVE_DELAY_MS)
  }
  // Saves run one after another, each reading the draft when its turn
  // comes, so an older save can't land after a newer one. The chain never
  // holds a rejection: `commitSource` reports its failures as `false`,
  // and one that threw anyway must not skip every save queued after it.
  function queueSourceSave(): Promise<boolean> {
    const run = sourceSaveQueue.then(commitSource)
    sourceSaveQueue = run.catch(() => {})
    return run
  }
  // How many source saves are between reading the draft and landing on
  // disk — the pending-draft report counts them (`reportLayoutDraft`), as
  // the draft reads clean meanwhile when typed back to the earlier text.
  const [sourceSavesInFlight, setSourceSavesInFlight] = createSignal(0)
  async function commitSource(): Promise<boolean> {
    const editing = editor.sourceEditing()
    if (editing.kind !== 'open' || !editor.isSourceDirty()) return true
    const text = editing.draft
    setErrorMessage(null)
    setSourceSavesInFlight(n => n + 1)
    try {
      const payload = await deckIpc.renderDraft(text)
      render.applyRenderPayload(payload, text)
      await deckIpc.saveDeckSource(text)
      // From disk, as after an external change: the slide session, its
      // drafts and every kept position are rebuilt for the new source.
      await refreshSource(true)
      editor.setSourceEditing(current => sourceSaved(current, text))
      setStatusMessage({ kind: 'saved' })
      return true
    } catch (err) {
      if (err instanceof RenderFailure) showBuildError(err.message)
      else setErrorMessage(String(err))
      return false
    } finally {
      setSourceSavesInFlight(n => n - 1)
    }
  }
  // Opens on the deck as the user sees it: the open slide's draft is
  // saved first when it can be, and included as typed when it can't (the
  // deck doesn't build — which is why the editor is being opened).
  async function openSourceEditor(): Promise<void> {
    await flushDeck()
    const text = liveSource()
    editor.setSourceEditing(openSourceEditing(text))
    if (sourceEditor) {
      resetCodeEditorText(sourceEditor, text)
      sourceEditor.focus()
    }
  }
  // Saves typing still waiting for its pause now, and whatever is typed
  // while that save is in flight (`sourceSaved` keeps a draft that moved
  // on dirty), until nothing is left to save. Resolves whether deck.md
  // holds the editor's text — `false` for a draft that doesn't build,
  // which stays in the editor with its reason shown.
  async function flushSourceEditor(): Promise<boolean> {
    clearTimeout(sourceAutosaveTimer)
    // Through the queue even when the draft reads clean: a save in flight
    // writes the text it captured, and the draft is clean against what
    // was on disk before it — only once it lands (`sourceSaved`) does the
    // draft show whether it still differs from disk.
    do {
      if (!await queueSourceSave()) return false
    } while (editor.isSourceDirty())
    return true
  }
  // Resolves whether the editor was left: only once everything typed is
  // on disk — nothing typed is lost.
  async function closeSourceEditor(): Promise<boolean> {
    if (!await flushSourceEditor()) return false
    editor.setSourceEditing(SOURCE_EDITING_CLOSED)
    return true
  }
  function toggleSourceEditor(): void {
    if (editor.sourceOpen()) void closeSourceEditor()
    else void openSourceEditor()
  }
  // Disk changed outside the app: an editor with nothing to save follows
  // it (its text replaced), one holding typing keeps the typing.
  function syncSourceEditorFromDisk(source: string): void {
    const before = editor.sourceEditing()
    const after = sourceReadFromDisk(before, source)
    editor.setSourceEditing(after)
    if (sourceEditor && after.kind === 'open' && after.draft !== (before.kind === 'open' ? before.draft : null)) setCodeEditorText(sourceEditor, after.draft)
  }

  // The layout screen's editor: the same editor as the slide body, vim mode
  // included, but off the app's undo timeline — its typing is undone in the
  // editor itself (see `onMenuHistory`), since it changes no slide. One
  // editor for every tab: switching tabs keeps the tab left's state (text,
  // cursor, undo history) and puts back the one shown
  // (`showLayoutEditorFile`). Uncontrolled like the body: typing reaches the
  // layout store through `onChange` (and each pause in it saves the file,
  // `scheduleLayoutAutosave`), and the app writes back only when the file
  // shown changes from outside (`replaceLayoutEditorText`).
  function createLayoutCodeEditor(el: HTMLElement): ReturnType<typeof createCodeEditor> {
    layoutEditor?.destroy()
    layoutEditorStates.clear()
    layoutEditorShows = untrack(() => layouts.activePath())
    return createCodeEditor(el, untrack(() => fileDraft(layouts.activeFile())), {
      ...vimEditorOptions(),
      monospace: true,
      spellcheck: false,
      lineWrapping: false,
      onContextMenu: event => { openEditorMenu('layout', event) },
      onChange: text => {
        const path = layoutEditorShows
        if (path === null) return
        layouts.typeInFile(path, text)
        scheduleDraftPreview()
        scheduleLayoutAutosave()
      },
    })
  }

  // Puts the file shown into the editor: another tab's comes back as the
  // user left it (or fresh, when it was never shown or its text changed
  // since); the same tab's (read again) changes only where it differs,
  // keeping the cursor and the undo history.
  function showLayoutEditorFile(): void {
    const file = layouts.activeFile()
    const path = file?.kind === 'ready' ? file.path : null
    if (!layoutEditor) return
    if (path === layoutEditorShows) {
      if (path !== null) setCodeEditorText(layoutEditor, fileDraft(file))
      return
    }
    if (layoutEditorShows !== null) layoutEditorStates.set(layoutEditorShows, snapshotCodeEditor(layoutEditor))
    restoreCodeEditor(layoutEditor, fileDraft(file), path === null ? undefined : layoutEditorStates.get(path))
    layoutEditorShows = path
  }
  // The file shown once it's read: a switch, or a tab's first read arriving.
  const readyActivePath = createMemo(() => {
    const file = layouts.activeFile()
    return file?.kind === 'ready' ? file.path : null
  })
  createEffect(() => {
    readyActivePath()
    untrack(showLayoutEditorFile)
  })

  // Puts file `path`, changed on disk (the agent's edit), into the editor
  // as one step Undo takes back — undone, the text before it is typing
  // again, saved like any other. A tab not shown drops its kept state
  // instead: it comes back with the new text.
  function replaceLayoutEditorText(path: string): void {
    if (layoutEditor && path === layoutEditorShows) replaceCodeEditorTextUndoable(layoutEditor, fileDraft(layouts.fileOf(path)))
    else layoutEditorStates.delete(path)
  }
  function layoutEditorComposing(): boolean {
    return layoutEditor !== undefined && isCodeEditorComposing(layoutEditor)
  }

  // Autosave: typing that pauses for `FILE_AUTOSAVE_DELAY_MS` saves every
  // tab holding unsaved typing (`saveOpenFiles`) through the same build
  // check as before. Saves run one after another (`layoutSaveQueue`), each
  // deciding then whether there's anything to save (`autosavePaths`), so an
  // older save can't land after a newer one; typing during a save stays
  // unsaved and is saved next. A refused draft stays in its tab, its reason
  // shown, until the next edit tries again.
  let layoutAutosaveTimer: ReturnType<typeof setTimeout> | undefined
  let layoutSaveQueue: Promise<void> = Promise.resolve()
  function scheduleLayoutAutosave(): void {
    clearTimeout(layoutAutosaveTimer)
    layoutAutosaveTimer = setTimeout(() => { void queueLayoutSave() }, FILE_AUTOSAVE_DELAY_MS)
  }
  function queueLayoutSave(): Promise<void> {
    layoutSaveQueue = layoutSaveQueue.then(saveOpenFiles)
    return layoutSaveQueue
  }
  // Saves drafts still waiting for their pause now, and waits for any save
  // running. Resolves whether the editor can be left (`tabsBlocker`).
  async function flushLayoutEditor(): Promise<boolean> {
    clearTimeout(layoutAutosaveTimer)
    await queueLayoutSave()
    return tabsBlocker(layouts.tabs()) === null
  }
  // Tells this window's close whether there's a draft to save first
  // (`report_layout_draft`): a layout file's, or the whole-deck source
  // editor's — typing not on disk, or a save of it still in flight
  // (`closeAfterLayoutFlush` waits for both); quiet with no deck open.
  createEffect(() => {
    const pending = layouts.editorDirty() || editor.isSourceDirty() || sourceSavesInFlight() > 0
    untrack(() => { deckIpc.reportLayoutDraft(pending).catch(() => {}) })
  })
  // `flushLayoutEditor` before the editor is left — the slides screen, a
  // new layout. When it can't be, shows the tab that holds it back, says
  // why and resolves `false`: the caller stays where it is.
  async function leaveLayoutEditor(): Promise<boolean> {
    if (await flushLayoutEditor()) return true
    const blocked = tabsBlocker(layouts.tabs())
    if (blocked !== null) showLayoutTab(blocked.path)
    const messages = settings.messages()
    layouts.setNotice(blocked?.blocker === 'conflict' ? messages.layoutConflictFirst : messages.layoutSaveFirst)
    return false
  }

  // The live preview: typing that pauses for `DRAFT_PREVIEW_DELAY_MS`
  // renders the selected layout's draft — its HTML and CSS tabs' drafts,
  // a side with no tab as on disk (`preview_layout_draft`, writing
  // nothing). Only the latest request's answer is shown (the store drops
  // older ones); a draft that doesn't render leaves the last good one up,
  // with the reason under it. A draft back to the saved files shows their
  // preview again.
  const DRAFT_PREVIEW_DELAY_MS = 250
  let draftPreviewTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleDraftPreview(): void {
    clearTimeout(draftPreviewTimer)
    draftPreviewTimer = setTimeout(() => { void renderDraftPreview() }, DRAFT_PREVIEW_DELAY_MS)
  }
  async function renderDraftPreview(): Promise<void> {
    const name = layouts.selectedLayout()
    const paths = name === null ? null : layoutFilePaths(name)
    const html = paths === null ? undefined : layouts.fileOf(paths.html)
    const css = paths === null ? undefined : layouts.fileOf(paths.css)
    if (name === null || !(html !== undefined && isFileDirty(html)) && !(css !== undefined && isFileDirty(css))) {
      layouts.resetPreview()
      return
    }
    const draftOf = (file: typeof html) => (file?.kind === 'ready' ? file.draft : null)
    const seq = layouts.requestPreview(name)
    try {
      const rendered = await deckIpc.previewLayoutDraft(name, draftOf(html), draftOf(css))
      layouts.previewRendered(seq, absolutizedDraft(rendered, render.assetBaseUrl() ?? ''))
    } catch (err) {
      layouts.previewFailed(seq, err instanceof Error ? err.message : String(err))
    }
  }
  function resetDraftPreview(): void {
    clearTimeout(draftPreviewTimer)
    layouts.resetPreview()
  }

  // A host remounts only with the whole editor pane (a deck-lifecycle
  // branch), so the previous editor, if any, is already detached.
  // The kept states belong to the editors they were taken from.
  function onBodyEditorHost(el: HTMLElement): void {
    bodyEditor?.destroy()
    slideStates.clear()
    bodyEditor = createCodeEditor(el, editor.bodyDraft(), {
      ...vimEditorOptions(),
      monospace: true,
      spellcheck: false,
      onChange: text => editor.setEditorSession(session => withDraftBody(session, text)),
      onHistoryGroup: seq => { recordTextGroup('body', seq) },
      onPasteImages: files => { void pasteImages(files) },
      onContextMenu: event => { openEditorMenu('body', event) },
    })
  }

  // Images pasted or dropped into the body: each is saved under the deck's
  // `img/` first (`engine::images` — the draft render reads it from disk),
  // then routed Markdown and a slide-specific image canvas are committed
  // together as one Undo step. Imported files remain available after Undo.
  //
  // Saving takes a moment; if the user left the slide meanwhile (or the
  // deck was re-read), the images are saved but not inserted anywhere.
  async function pasteImages(files: File[]): Promise<void> {
    await addImagesToPreview(files, null)
  }

  let pendingSlideTextEdit: Promise<void> | null = null

  function startSlideTextEdit(target: SlideEditTarget): SlideEditSession | null {
    const view = bodyEditor
    const index = editor.selectedIndex()
    if (!view || index === null || isCodeEditorComposing(view)) return null
    const before = editor.bodyDraft()
    const range = splitSlides(render.renderedSource())[index]
    const renderedBody = range ? extractPageComment(extractNote(range.text).rest).rest : null
    const recovery = errorMessage()?.includes(`slide ${index + 1} `) && errorMessage()?.includes("missing 'body' slot")
    if (renderedBody === null || (renderedBody !== before.replace(/\n{3,}/g, '\n\n').trim() && !recovery)) return null
    const rawBody = range ? extractPageComment(extractNote(range.text, true).rest, true).rest : ''
    const bodyStart = (range?.start ?? 0) + (range?.text.indexOf(rawBody) ?? 0)
    const edit = target.kind === 'text' ? textEditFor(target, render.renderedSource(), before, bodyStart, rawBody) : recovery ? looseBodyEdit(before, target.slot, target.accepts) : null
    if (target.kind === 'text' && edit === null) return null
    let currentBody = before
    let historyStarted = false
    let finished = false
    let cancelled = false
    let queuedBody: string | null = null
    let preparing: Promise<void> | null = null
    let prepared = false
    const originalConfig = editor.pageConfig()
    let preparedLayout: string | null = null
    let layoutHistorySeq: number | null = null
    const applyBody = (next: string): boolean => {
      if (bodyEditor !== view || editor.selectedIndex() !== index || editor.bodyDraft() !== currentBody || view.state.doc.toString() !== currentBody || isCodeEditorComposing(view)) return false
      if (splitSlides(buildSlideText(editor.pageConfig(), next, '')).length !== 1) return false
      const change = editorTextChange(currentBody, next)
      if (!change) return true
      const firstUpdate = !historyStarted
      historyStarted = true
      currentBody = next
      const previousLayout = activeTextLayout
      if (firstUpdate && preparedLayout) activeTextLayout = { layout: { before: originalConfig.layout, after: preparedLayout }, recorded: seq => { layoutHistorySeq = seq } }
      try { insertIntoCodeEditor(view, { ...change, cursor: change.from + change.insert.length }, 'input.slide', firstUpdate) }
      finally { activeTextLayout = previousLayout }
      return true
    }
    return {
      value: edit?.value ?? '',
      commit: value => {
        const cleared = target.kind === 'text' && edit ? clearedSlideText(target, edit, value) : null
        if (cleared !== null) return applyBody(cleared)
        const insertion = edit ? textEditInsertion(edit, before, value) : target.kind === 'slot' ? slotTextInsertion(before, target.slot, target.accepts, value) : null
        if (!insertion) return false
        const next = before.slice(0, insertion.from) + insertion.insert + before.slice(insertion.to)
        if (next === before && preparing) queuedBody = before
        if (target.kind !== 'text' || !target.listItems?.length || !target.slot || next === before || prepared) return applyBody(next)
        // Prepare the slot contract before publishing a paragraph/list mix.
        // Keep the latest keystrokes while IPC creates the immutable variant.
        queuedBody = next
        if (!preparing) {
          const base = originalConfig.layout ?? render.slideLayouts()[selectedSlideKey() ?? ''] ?? DEFAULT_LAYOUT
          preparing = imageIpc.createImageCanvas(syncedSource(currentSlideTexts()), base, 0, [], [], undefined, undefined, 0, target.slot).then(canvas => {
            if (cancelled || bodyEditor !== view || editor.selectedIndex() !== index || editor.bodyDraft() !== currentBody) return
            const session = editor.editorSession()
            if (session.kind !== 'editing' || session.draft.config !== originalConfig) return
            prepared = true
            if (canvas.layout !== base) {
              preparedLayout = canvas.layout
              editor.setEditorSession({ ...session, draft: { ...session.draft, config: { ...session.draft.config, layout: canvas.layout } } })
            }
            if (queuedBody !== null) applyBody(queuedBody)
            if (finished && historyStarted) isolateCodeEditorHistory(view)
          }).catch(err => {
            // Retain typed content even if the layout cannot be created.
            prepared = true
            if (!cancelled && queuedBody !== null) applyBody(queuedBody)
            setErrorMessage(String(err))
          })
          const pending = preparing
          pendingSlideTextEdit = pending
          void pending.finally(() => { if (pendingSlideTextEdit === pending) pendingSlideTextEdit = null })
        }
        return true
      },
      cancel: () => {
        cancelled = true; queuedBody = null
        const session = editor.editorSession()
        if (preparedLayout && bodyEditor === view && session.kind === 'editing' && session.index === index && session.draft.config.layout === preparedLayout) {
          editor.setEditorSession({ ...session, draft: { ...session.draft, config: originalConfig } })
        }
        const restored = applyBody(before)
        if (restored && layoutHistorySeq !== null) history.clearTextLayout(index, 'body', layoutHistorySeq)
        return restored
      },
      finish: () => { finished = true; if (historyStarted) isolateCodeEditorHistory(view) },
    }
  }

  const [previewImageBusy, setPreviewImageBusy] = createSignal(false)

  async function addImagesToPreview(files: File[], slot: string | null): Promise<void> {
    if (files.length === 0 || previewImageBusy() || editor.selectedIndex() === null) return
    const index = editor.selectedIndex()!
    const epoch = slidePositionsEpoch
    setPreviewImageBusy(true)
    setStatusMessage({ kind: 'importing-images', count: files.length })
    try {
      const paths: string[] = []
      for (const file of files) {
        const image = await readPastedImage(file, new Date())
        paths.push(await imageIpc.importImageBytes(image.name, image.bytes))
      }
      setStatusMessage({ kind: 'imported-images', count: paths.length })
      if (editor.selectedIndex() !== index || slidePositionsEpoch !== epoch) return
      await placePreviewImages(paths, slot, index, epoch)
    } catch (err) {
      setStatusMessage({ kind: 'none' })
      setErrorMessage(settings.messages().imageImportFailed(String(err)))
    } finally { setPreviewImageBusy(false) }
  }

  async function placePreviewImages(paths: string[], slot: string | null, index: number, epoch: number): Promise<void> {
    const before = currentSlideText(index)
    const fields = extractPageComment(extractNote(before).rest)
    const base = fields.config.layout ?? render.slideLayouts()[selectedSlideKey() ?? ''] ?? DEFAULT_LAYOUT
    const source = syncedSource(currentSlideTexts())
    const count = slot === null ? paths.length : Math.max(0, paths.length - 1)
    const canvas = count > 0 ? await imageIpc.createImageCanvas(source, base, count, []) : null
    if (editor.selectedIndex() !== index || slidePositionsEpoch !== epoch || currentSlideText(index) !== before) {
      setErrorMessage(settings.language() === 'ja' ? '画像の追加中にスライドが変わりました。もう一度追加してください。' : 'The slide changed while adding the image. Please add it again.')
      return
    }
    const targets = slot === null ? canvas!.slots : [slot, ...(canvas?.slots ?? [])]
    const additions = paths.map((path, i) => `::: {slot=${targets[i]}}\n\n![](${path})\n\n:::`).join('\n\n')
    const body = `${fields.rest}\n\n${additions}`
    const note = extractNote(before).note
    const text = buildSlideText({ ...fields.config, ...(canvas ? { layout: canvas.layout } : {}) }, body, note)
    await perform({ kind: 'slides', cmd: { type: 'replace', index, text } })
    setStatusMessage({ kind: 'imported-images', count: paths.length })
  }

  async function positionPreviewImage(slot: string, rect: { x: number; y: number; width: number; height: number }): Promise<boolean> {
    const index = editor.selectedIndex()
    const base = editor.pageConfig().layout
    if (index === null || !base || previewImageBusy()) return false
    const before = currentSlideText(index)
    const epoch = slidePositionsEpoch
    setPreviewImageBusy(true)
    try {
      const canvas = await imageIpc.createImageCanvas(syncedSource(currentSlideTexts()), base, 0, [{ slot, ...rect }])
      if (editor.selectedIndex() !== index || slidePositionsEpoch !== epoch || currentSlideText(index) !== before) return false
      const outcome = await updateSlideConfig(index, { layout: canvas.layout })
      return outcome === 'done' || outcome === 'unchanged'
    } catch (err) { setErrorMessage(String(err)); return false }
    finally { setPreviewImageBusy(false) }
  }

  async function orderPreviewImage(order: string[]): Promise<boolean> {
    const index = editor.selectedIndex()
    const base = editor.pageConfig().layout
    if (index === null || !base || previewImageBusy()) return false
    const before = currentSlideText(index)
    const epoch = slidePositionsEpoch
    setPreviewImageBusy(true)
    try {
      const canvas = await imageIpc.createImageCanvas(syncedSource(currentSlideTexts()), base, 0, [], [], undefined, order)
      if (editor.selectedIndex() !== index || slidePositionsEpoch !== epoch || currentSlideText(index) !== before) return false
      const outcome = await updateSlideConfig(index, { layout: canvas.layout })
      return outcome === 'done' || outcome === 'unchanged'
    } catch (err) { setErrorMessage(String(err)); return false }
    finally { setPreviewImageBusy(false) }
  }

  async function removePreviewImage(slot: string): Promise<void> {
    const index = editor.selectedIndex()
    const base = editor.pageConfig().layout
    if (index === null || !base || previewImageBusy()) return
    const before = currentSlideText(index)
    const { rest, note } = extractNote(before)
    const fields = extractPageComment(rest)
    const body = removeImageSlot(fields.rest, slot)
    if (body === null) return
    setPreviewImageBusy(true)
    try {
      const canvas = await imageIpc.createImageCanvas(syncedSource(currentSlideTexts()), base, 0, [], [slot])
      if (editor.selectedIndex() !== index || currentSlideText(index) !== before) return
      await perform({ kind: 'slides', cmd: { type: 'replace', index, text: buildSlideText({ ...fields.config, layout: canvas.layout }, body, note) } })
    } catch (err) { setErrorMessage(String(err)) }
    finally { setPreviewImageBusy(false) }
  }

  // Files dropped on the body editor or preview create a freely positioned
  // image without changing the shared layout. A drop
  // holding any file that isn't an image Peitho can show is refused whole,
  // naming those files in the error bar: nothing is written. (Importing the
  // rest would re-render the draft, whose success clears the error bar
  // before the user could read which files were left out.)
  async function dropFiles(drop: FileDrop): Promise<void> {
    const view = bodyEditor
    if (!view || editor.selectedIndex() === null || settings.panelOpen() || previewImageBusy()) return
    const at = dropPointToCss(drop.position, window.devicePixelRatio, /Mac/.test(navigator.userAgent))
    const pos = codeEditorPositionAt(view, at)
    const preview = document.querySelector('[data-preview-host]')?.getBoundingClientRect()
    const onPreview = preview && at.x >= preview.left && at.x <= preview.right && at.y >= preview.top && at.y <= preview.bottom && ui.previewOpen()
    if (pos === null && !onPreview) return
    const { images, rejected } = partitionDroppedPaths(drop.paths)
    if (rejected.length > 0) {
      setErrorMessage(settings.messages().unsupportedImageFiles(rejected.map(fileNameOf).join(', ')))
      return
    }
    if (images.length === 0) return
    const index = editor.selectedIndex()!
    const epoch = slidePositionsEpoch
    setPreviewImageBusy(true)
    setStatusMessage({ kind: 'importing-images', count: images.length })
    try {
      const paths: string[] = []
      for (const path of images) paths.push(await imageIpc.importImageFile(path))
      setStatusMessage({ kind: 'imported-images', count: paths.length })
      if (editor.selectedIndex() === index && slidePositionsEpoch === epoch) await placePreviewImages(paths, null, index, epoch)
    } catch (err) { setErrorMessage(settings.messages().imageImportFailed(String(err))) }
    finally { setPreviewImageBusy(false) }
  }

  function onNoteEditorHost(el: HTMLElement): void {
    noteEditor?.destroy()
    slideStates.clear()
    noteEditor = createCodeEditor(el, editor.noteDraft(), {
      ...vimEditorOptions(),
      placeholder: untrack(() => settings.messages().speakerNotesPlaceholder),
      onChange: text => editor.setEditorSession(session => withDraftNote(session, text)),
      onHistoryGroup: seq => { recordTextGroup('note', seq) },
      onContextMenu: event => { openEditorMenu('note', event) },
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
  // With no render at all (a deck that opened broken — `runOpen`), there
  // is no manifest to pair with anything: every slide of the source as the
  // editor has it is a placeholder, which that pairing can't get wrong.
  // `render.brokenSlides()` is keyed by position in `renderedSource()` and
  // written with the manifest (same `batch()`), so the three agree.
  const slideEntries = createMemo(() => {
    const manifest = render.manifest()
    return manifest === null ? buildSlideList(editor.fullSource(), []) : buildSlideList(render.renderedSource(), manifest.slides, render.brokenSlides())
  })
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
  // The deck's `page_numbers` setting: its raw frontmatter value (what an
  // undo writes back), and whether it shows numbers at all (for the slide
  // context menu's Hide Page Number).
  const pageNumbersValue = createMemo(() => readFrontmatterKey(editor.fullSource(), PAGE_NUMBERS_KEY))
  const pageNumbersMode = createMemo(() => parsePageNumbersMode(pageNumbersValue()))
  // The Edit menu's deck settings as this deck's frontmatter holds them
  // (see `src-tauri/src/deck_menu.rs`). Each change is reported so the
  // menu can show them (checks and current-value labels) while this window
  // is in front; a report equal to the last one sent (a save that left the
  // frontmatter alone) is skipped. A report that fails is sent again with
  // the next change.
  const deckSettings = createMemo(() => readDeckSettings(editor.fullSource()))
  let reportedDeckSettings: DeckSettingsState | null = null
  createEffect(() => {
    if (deck.deckPath() === null) return
    const report = deckSettings()
    if (reportedDeckSettings !== null && sameDeckSettings(reportedDeckSettings, report)) return
    reportedDeckSettings = report
    deckIpc.reportDeckSettings(report).catch(() => { reportedDeckSettings = null })
  })
  const currentMenuItems = createMemo(() => computeMenuItems(ui.contextMenu(), {
    slideCount: slideEntries().length,
    hasClipboard: ui.clipboardSlideText() !== null,
    configOf: slideConfigOf,
    pageNumbersShown: pageNumbersShown(pageNumbersMode()),
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
  // peitho-core's refusal of the deck on disk, or of the selected slide
  // when it was isolated from the render, for the preview pane — as one
  // string, so the pane isn't notified for an error object that reads the
  // same. The deck's own refusal wins: with it set, the last render (and
  // its isolated slides) is stale.
  const selectedBrokenSlideError = createMemo<RenderErrorPayload | null>(() => {
    const i = editor.selectedIndex()
    const entry = i === null ? undefined : slideEntries()[i]
    return entry?.kind === 'placeholder' ? entry.error : null
  })
  const buildErrorScope = createMemo<'deck' | 'slide'>(() => (render.outcome().kind === 'failed' ? 'deck' : 'slide'))
  const buildError = createMemo<string | null>(() => {
    const outcome = render.outcome()
    if (outcome.kind === 'failed') return renderFailureMessage(outcome.error)
    const slideError = selectedBrokenSlideError()
    return slideError === null ? null : renderFailureMessage(slideError)
  })
  // The error bar behind a transient error (`errorMessage`, cleared on
  // its timer): the deck's refusal, else how many slides are isolated and
  // the first one's error — either comes back once the transient error
  // clears, so neither is lost to the other. The refusal is never put in
  // `errorMessage` itself: it lasts as long as `render.outcome()` says so.
  const deckErrorMessage = createMemo<string | null>(() => {
    const outcome = render.outcome()
    return outcome.kind === 'failed' ? renderFailureMessage(outcome.error) : null
  })
  const brokenSlidesMessage = createMemo<string | null>(() => {
    const summary = brokenSlidesSummary(render.brokenSlides())
    return summary === null ? null : settings.messages().slidesDoNotBuild(summary.count, summary.first.headline)
  })
  const shownErrorMessage = createMemo<string | null>(() => errorMessage() ?? deckErrorMessage() ?? brokenSlidesMessage())
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
  // deck-ratio shape is the deck's own canvas again. The slide list and
  // layout picker keep reading `render.canvasWidth()/canvasHeight()`
  // directly.
  //
  // Number memos, not one memo of a `Size`: `viewportCanvas` returns a
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
    return viewportCanvas(deck, ui.viewportMode(), ui.phoneShape(), selectedSlideIsFixedCanvas())
  }
  const previewCanvasWidth = createMemo<number>(() => previewCanvas().width)
  const previewCanvasHeight = createMemo<number>(() => previewCanvas().height)
  // Phone display on a device preset draws the preview at that device's
  // real CSS width (a fixed-canvas slide too, as a 16:9 box that wide),
  // shrinking it with a "Scaled to N%" label when the panel is too small;
  // the layout list caps its thumbnails at the same width.
  const previewDeviceWidth = createMemo<number | null>(() => previewDevice(ui.viewportMode(), ui.phoneShape())?.width ?? null)
  const previewScaleLabel = createMemo<string>(() => {
    const deviceWidth = previewDeviceWidth()
    const area = ui.previewArea()
    if (deviceWidth === null || area === null) return ''
    const percent = scaledDownPercent(area, { width: previewCanvasWidth(), height: previewCanvasHeight() }, deviceWidth)
    return percent === null ? '' : settings.messages().previewScaledDown(percent)
  })

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

  // The selected layout's drawing: the saved files' preview with the sheet
  // above, or the editor's rendered draft with that draft's own CSS.
  const layoutPreviewDraw = createMemo(() => {
    const name = layouts.selectedLayout()
    return previewToDraw(layouts.draftPreview(), name, name === null ? '' : layoutFragmentOf(name))
  })
  const layoutDraftStylesheet = createSlideStylesheet(ui.layoutPreviewStylesheetText())
  // The draft's CSS with any family the deck defines and the draft
  // redefines moved to a preview-only name, so its faces can't change how
  // the deck's slides draw (`previewDraftCss`).
  const layoutPreviewCss = createMemo(() => previewDraftCss(layoutPreviewDraw(), render.fontFaceCss()))
  createEffect(() => {
    const rest = layoutPreviewCss().rest
    layoutDraftStylesheet.replaceSync(rest === null ? ui.layoutPreviewStylesheetText() : scopeRootToHost(rest))
  })
  // A draft's own `@font-face` rules: registered page-wide while its
  // preview is drawn on the layout screen, dropped when the saved preview
  // is drawn again or the slides screen shows (and back when it returns).
  createEffect(() => {
    setDraftFontFaces(ui.studioMode() === 'layouts' ? layoutPreviewCss().fontFaces : '')
  })

  // The layout list's thumbnails: each draws its layout's saved files, and
  // the one with a rendered draft (`draftedLayout`) draws that instead, on
  // the PC / Phone switch's canvas. A row's `ref` hands its host over once,
  // at mount (`mountLayoutThumbnail`); a row re-keyed by a fresh set of
  // previews or a switch change mounts again and reads the current draw.
  function layoutThumbnailDraw(name: string): { fragment: string; css: string | null } {
    return previewToDraw(layouts.draftPreview(), name, layoutFragmentOf(name))
  }
  function layoutCanvasOf(name: string): Size {
    const deck = { width: render.canvasWidth(), height: render.canvasHeight() }
    return viewportCanvas(deck, ui.viewportMode(), ui.phoneShape(), hasFixedCanvas(layoutThumbnailDraw(name).fragment))
  }
  function mountLayoutThumbnail(el: HTMLElement, name: string): void {
    el.dataset.layoutCanvas = name
    drawLayoutInto(el, name)
  }
  function drawLayoutInto(el: HTMLElement, name: string): void {
    const draw = untrack(() => layoutThumbnailDraw(name))
    const canvas = untrack(() => layoutCanvasOf(name))
    mountSlideCanvas(el, draw.css === null ? layoutPreviewStylesheet : layoutDraftStylesheet, draw.fragment, canvas, 'thumbnail')
    observeCanvasScale(el, canvas)
  }
  // A keyed row's `ref` never runs again (CLAUDE.md's BarefootJS
  // pitfalls), so a draft arriving, changing or going away redraws the
  // rows concerned from here: the row drawing a draft now, and the one that
  // drew it before (back to its saved files). Tracks the drawn draft object
  // itself, which a failed later draft or a new request leaves as it is —
  // so neither redraws anything.
  const draftedLayoutName = createMemo(() => draftedLayout(layouts.draftPreview()))
  const draftedLayoutShown = createMemo(() => layouts.draftPreview().shown)
  let layoutRowDrawingDraft: string | null = null
  createEffect(() => {
    const drafted = draftedLayoutName()
    draftedLayoutShown()
    untrack(() => {
      for (const name of new Set([layoutRowDrawingDraft, drafted])) {
        if (name === null) continue
        for (const host of document.querySelectorAll<HTMLElement>(`[data-layout-canvas="${CSS.escape(name)}"]`)) mountLayoutThumbnail(host, name)
      }
    })
    layoutRowDrawingDraft = drafted
  })
  // The selected layout's large preview: one host, mounted once, drawn
  // again whenever the selection, the set of previews, the PC / Phone
  // switch or the draft changes.
  let selectedPreviewHost: HTMLElement | undefined
  function onSelectedPreviewHost(el: HTMLElement): void {
    selectedPreviewHost = el
    redrawSelectedPreview()
  }
  function redrawSelectedPreview(): void {
    const name = layouts.selectedLayout()
    layouts.previewGeneration()
    ui.layoutPreviews()
    ui.viewportMode()
    ui.phoneShape()
    draftedLayoutName()
    draftedLayoutShown()
    const host = selectedPreviewHost
    if (name === null || host === undefined) return
    host.dataset.layoutSelectedCanvas = name
    untrack(() => drawLayoutInto(host, name))
  }
  createEffect(redrawSelectedPreview)
  const selectedPreviewStyle = createMemo(() => {
    const name = layouts.selectedLayout()
    if (name === null) return ''
    return layoutThumbnailStyle(layoutCanvasOf(name), selectedPreviewRoom(layouts.thumbnailRoom()), previewDeviceWidth())
  })

  // The error bar's way out of peitho-core's "no slot accepts image" (see
  // `domain/imageSlot.ts`), whichever path the failing build came from — a
  // draft render or a save. Each such error asks which layouts that slide
  // fits; a slower answer for an earlier error is dropped.
  const imageSlotError = createMemo(() => parseImageSlotError(shownErrorMessage(), editor.slideRanges().length))
  const [imageSlotFix, setImageSlotFix] = createSignal<ImageSlotFix>({ kind: 'none' })
  const shownFix = createMemo(() => shownImageSlotFix(imageSlotError(), imageSlotFix()))
  let imageSlotFixRequest = 0
  createEffect(() => {
    const error = imageSlotError()
    if (error === null) return
    untrack(() => { void findImageSlotFix(error.index) })
  })
  async function findImageSlotFix(index: number): Promise<void> {
    const request = ++imageSlotFixRequest
    const pinned = slideConfigOf(index).layout
    let verdicts: LayoutVerdict[] | null = null
    try {
      verdicts = await deckIpc.checkSlideLayouts(liveSource(), index)
    } catch {
      // Nothing to go on: no fix is offered.
    }
    if (request !== imageSlotFixRequest) return
    setImageSlotFix(imageSlotFixFor(index, pinned, verdicts))
  }

  // `event`: the button's click, where the picker opens when the slide's
  // own row isn't showing.
  function applyImageSlotFix(event: MouseEvent): void {
    const fix = shownFix()
    if (fix.kind === 'pick-layout') {
      void selectSlide(fix.index)
      const at = slideRowMenuAnchor(fix.index) ?? { x: event.clientX, y: event.clientY }
      void openLayoutPickerOn(fix.index, at)
    } else if (fix.kind === 'add-image-layout') {
      void addImageLayout(fix.index)
    }
  }

  // Adds the built-in image layout's files to the deck (never Undo-able,
  // like an imported image), then brings the slide onto it: a slide pinned
  // to another layout is re-pinned through the usual Undo-able config
  // change; an unpinned one finds it by its content, so its pending draft
  // is saved (which re-renders) or the deck just re-rendered. Rust checks
  // the result against the source this sends — the draft included, the pin
  // already changed — so nothing is written when another slide would stop
  // building.
  async function addImageLayout(index: number): Promise<void> {
    if (ui.imageLayoutAdding()) return
    ui.setImageLayoutAdding(true)
    try {
      const pin = imageLayoutPin(slideConfigOf(index).layout)
      const texts = currentSlideTexts()
      const source = pin === null ? liveSource() : rebuildSource(texts.map((text, i) => (i === index ? updatePageComment(text, pin) : text)))
      try {
        await deckIpc.addImageLayout(source, index)
      } catch (err) {
        setErrorMessage(settings.messages().imageLayoutAddFailed(String(err)))
        return
      }
      // The picker's layout list is cached per deck; it has a new one now.
      ui.setLayoutPreviews(null)
      if (pin !== null) await updateSlideConfig(index, pin)
      else if (editor.isDirty()) await handleSave()
      else await renderPreview(editor.fullSource())
      // After the save above, whose own "Saved" would otherwise hide it.
      setStatusMessage({ kind: 'image-layout-added' })
    } finally {
      ui.setImageLayoutAdding(false)
    }
  }

  // Skipped while the New Deck modal is open: this timer was designed for
  // WelcomeScreen/StatusBar's transient toast-style banner, but the same
  // signal now also drives the modal's persistent inline error — an error
  // shown there should stay until the user dismisses the modal or retries
  // (both already clear it explicitly), not vanish on a fixed timer while
  // still unread.
  // Also skipped while the error bar offers a fix: the error stays until
  // it's acted on or goes away by itself (the next successful render).
  // And skipped for a build error of the text being edited while the deck
  // on disk doesn't build either (`render.outcome()`): that error is what
  // is left to fix, and it goes by itself the moment a render goes through
  // (`renderPreview`/`commitChange`). Only that one — any other error
  // shown meanwhile (a failed present, the clipboard) clears as usual, and
  // the deck's own refusal comes back behind it (`shownErrorMessage`).
  createEffect(() => {
    if (errorMessage() === null || deck.newDeckModalOpen() || shownFix().kind !== 'none') return
    if (render.outcome().kind === 'failed' && errorMessage() === shownBuildError) return
    const timer = window.setTimeout(() => setErrorMessage(null), 6000)
    return () => window.clearTimeout(timer)
  })
  // The last build error shown for the text being edited (a draft that
  // doesn't build, a save refused for it) — see the timer above.
  let shownBuildError: string | null = null
  function showBuildError(message: string): void {
    shownBuildError = message
    setErrorMessage(message)
  }

  async function copyErrorMessage(): Promise<void> {
    const message = shownErrorMessage()
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
  // `persisted`: `content` is what deck.md holds (not a draft being typed),
  // so its failure to build is the deck's state, not the editor's — recorded
  // in `render.outcome()` (see `state/renderStore.ts`), which keeps the
  // error bar from clearing itself and puts the error in the preview pane.
  // A persisted source is also rendered without the slides that don't
  // build (`renderIsolating`, any slide), so one broken slide shows as an
  // ERROR row instead of blanking the whole deck; a draft being typed
  // isn't (its failure is the editor's, shown in the error bar only).
  //
  // A persisted render costs up to `MAX_ISOLATIONS + 1` renders, and the
  // same source is asked for from several places at once when a deck
  // opens broken (`runOpen`, and the typing effect below as the selection
  // settles): a persisted render already in flight for the same source is
  // shared, and a source known not to build (`persistedFailedSource`)
  // isn't rendered again until it changes.
  let previewGeneration = 0
  let persistedRender: { content: string; done: Promise<void> } | null = null
  let persistedFailedSource: string | null = null
  function renderPreview(content: string, { persisted = false }: { persisted?: boolean } = {}): Promise<void> {
    if (!persisted) return runRenderPreview(content, false)
    if (persistedRender?.content === content) return persistedRender.done
    const done = runRenderPreview(content, true)
    persistedRender = { content, done }
    void done.finally(() => { if (persistedRender?.done === done) persistedRender = null })
    return done
  }
  async function runRenderPreview(content: string, persisted: boolean): Promise<void> {
    const generation = ++previewGeneration
    try {
      const result = await renderIsolating(content, () => persisted)
      if (generation !== previewGeneration) return
      if (result.kind === 'rendered') {
        persistedFailedSource = null
        render.applyRenderPayload(result.payload, content, result.broken)
        setErrorMessage(null)
        return
      }
      // Keep whatever last rendered successfully on screen; just surface
      // the build error (e.g. a mid-edit unclosed code fence) — a draft
      // that doesn't build yet shouldn't blank the preview.
      if (persisted) {
        // The deck on disk doesn't build: `render.outcome()` carries its
        // error (the error bar and the preview pane show it from there),
        // and an earlier draft's error — about text that is gone — goes.
        persistedFailedSource = content
        render.markRenderFailed(result.error)
        setErrorMessage(null)
      } else {
        showBuildError(renderFailureMessage(result.error))
      }
    } catch (err) {
      if (generation !== previewGeneration) return
      setErrorMessage(String(err))
    }
  }

  // Renders `content`, and when peitho-core refuses a slide that `allow`
  // permits isolating, renders again without it — until a render goes
  // through, `allow` says no, or `isolateSlide` gives up (an error about
  // no slide, no progress, the isolation limit; see
  // `domain/brokenSlides.ts`). Resolves with the payload and the slides it
  // was rendered without, or with the error that stopped it; rejects only
  // for a failure other than peitho-core's refusal (the deck not open).
  async function renderIsolating(content: string, allow: (error: RenderErrorPayload, broken: BrokenSlides) => boolean): Promise<
    { kind: 'rendered'; payload: RenderPayload; broken: BrokenSlides } | { kind: 'failed'; error: RenderErrorPayload }
  > {
    let isolation = startIsolation(content)
    for (;;) {
      try {
        const payload = await deckIpc.renderDraft(isolation.attempt)
        return { kind: 'rendered', payload, broken: isolation.broken }
      } catch (err) {
        if (!(err instanceof RenderFailure)) throw err
        const next = allow(err.error, isolation.broken) ? isolateSlide(isolation, err.error) : null
        if (next === null) return { kind: 'failed', error: err.error }
        isolation = next
      }
    }
  }

  function currentDraftSource(): string | null {
    const range = editor.selectedRange()
    const index = editor.selectedIndex()
    if (!range || index === null) return null
    const newSlideText = buildSlideText(editor.pageConfig(), editor.bodyDraft(), editor.noteDraft())
    const source = editor.fullSource()
    return replaceSlideText(source, range, newSlideText)
  }

  // Fast lane: re-renders (in-memory only) a beat after typing stops, so
  // Preview reflects Editor/notes edits without waiting on a disk save.
  // Re-fires on every bodyDraft/noteDraft change, so each keystroke resets
  // the timer via the cleanup below.
  createEffect(() => {
    editor.bodyDraft()
    editor.noteDraft()
    if (!editor.isDirty()) {
      untrack(() => {
        const source = editor.fullSource()
        if (source !== render.renderedSource() && source !== persistedFailedSource) void renderPreview(source, { persisted: true })
        // Back to what's on screen (an Undo before the typed text rendered):
        // a render still in flight is now stale and must not land.
        else previewGeneration++
      })
      return
    }
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
    if (!editor.isDirty() || updateBlocksEditing(updateStatus())) return
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
  // pane both carry `data-slide-canvas-key`. The thumbnails get the
  // fragment without peitho-core's edit annotations, the preview with them
  // (its comment UI reads them) — see `state/renderStore.ts`. Fed the
  // *absolutized* fragment, not the raw one — a shadow root has no
  // `<base href>` to resolve `src="assets/…"` against, and a spelling other
  // than the one mounted would defeat `patchSlideCanvas`'s
  // unchanged-fragment check.
  function patchSlideCanvases(selector: string, fragmentHtml: string): void {
    for (const host of document.querySelectorAll<HTMLElement>(selector)) {
      patchSlideCanvas(host, fragmentHtml)
    }
  }

  createEffect(() => {
    for (const slide of render.manifest()?.slides ?? []) {
      patchSlideCanvases(`[data-slide-canvas-key="${CSS.escape(slide.key)}"]:not([data-preview-host])`, render.canvasFragmentOf(slide.key))
    }
  })

  createEffect(() => {
    const key = selectedSlideKey()
    if (key !== null) patchSlideCanvases(`[data-preview-host][data-slide-canvas-key="${CSS.escape(key)}"]`, render.previewFragmentOf(key))
  })

  // --- Comments for the Coding Agent (todo/archive/review-comment-ui.md) ---
  // A click on the preview opens the comment box; added comments wait,
  // unsent, until "Send to Agent" hands them all to the agent waiting in
  // crit (starting the deck's crit session with the first one). What was
  // sent — replies, resolved state — is read back from crit.
  const critIpc = createTauriCritIpc()
  const review = createReviewStore()
  // The layout folders the deck has (`critIpc.sessionDirs`): with no
  // session yet, the connect card's command names them (`connectTargetOf`).
  const [sessionDirs, setSessionDirs] = createSignal<string[]>([])

  // Each slide's comment key and span in the source the preview shows.
  const renderedSlideSpans = createMemo(() => slideSpans(render.renderedSource(), render.manifest()?.slides ?? []))

  function slideNumberOf(key: string): number {
    return renderedSlideSpans().findIndex(slide => slide.key === key) + 1
  }

  let reviewGeneration = 0
  // Reads the session and its comments back from crit. Quiet on failure —
  // without crit (a dev build that never ran `crit:fetch`) there is simply
  // no session; acting on one is what reports errors.
  async function refreshReview(): Promise<void> {
    // The layout folders the connect card's command names; quiet on failure
    // too, keeping what was last known.
    critIpc.sessionDirs().then(dirs => {
      const next = dirs ?? []
      if (next.join('/') !== sessionDirs().join('/')) setSessionDirs(next)
    }, () => {})
    const generation = ++reviewGeneration
    try {
      const session = (await critIpc.sessionStatus()) ?? { kind: 'none' as const }
      const comments = session.kind === 'found' ? (await critIpc.listComments()) ?? [] : []
      if (generation !== reviewGeneration) return
      review.setSession(session)
      review.setComments(comments)
    } catch {
      if (generation !== reviewGeneration) return
      review.setSession({ kind: 'none' })
      review.setComments([])
    }
  }

  async function startReviewSession(): Promise<void> {
    const session = review.session()
    if (review.busy() !== 'idle' || (session !== null && session.kind !== 'none')) return
    review.setBusy('starting')
    review.setError(null)
    try {
      review.setSession(await critIpc.startSession())
    } catch (err) {
      review.setError(settings.messages().reviewFailed(String(err)))
    } finally {
      review.setBusy('idle')
    }
  }

  function openCommentBox(click: PreviewClick): void {
    const key = selectedSlideKey()
    if (key === null) return
    const slide = renderedSlideSpans().find(s => s.key === key)
    const target = commentTargetOf(render.renderedSource(), slide?.span ?? null, click.hit)
    const at = clampMenuPosition(click.at, { width: 336, height: 180 }, { width: window.innerWidth, height: window.innerHeight }, 8)
    review.openBox(key, target, click.pin, at)
    focusCommentBox()
  }

  // A pin clicked on the preview: its comment, not a new one — the
  // comments column scrolls to its thread and lights it up for a moment.
  const [highlightedThread, setHighlightedThread] = createSignal<string | null>(null)
  let highlightTimer: number | undefined
  function showPinnedThread(pinId: string): void {
    const thread = threadOfPin(pinId)
    if (thread === null) return
    ui.setReviewOpen(true)
    setHighlightedThread(thread)
    revealReviewThread(thread)
    window.clearTimeout(highlightTimer)
    highlightTimer = window.setTimeout(() => setHighlightedThread(null), 2000)
  }

  function addComment(): void {
    const filed = review.box().kind === 'open-layout' ? review.commitLayoutBox() : review.commitBox()
    if (filed !== null) void startReviewSession()
  }

  // The layout screen's menu opens the box on a layout, or on every layout
  // (todo/archive/layout-review-comments.md), where the menu was.
  function openLayoutCommentBox(target: LayoutCommentTarget, from: { x: number; y: number }): void {
    const at = clampMenuPosition(from, { width: 336, height: 180 }, { width: window.innerWidth, height: window.innerHeight }, 8)
    review.openLayoutBox(target, at)
    focusCommentBox()
  }

  // A click on the selected layout's large preview opens a comment on the
  // layout, naming the slot clicked — the layout screen's counterpart of a
  // click on the slide preview.
  function clickSelectedPreview(event: MouseEvent): void {
    const click = layoutThumbnailClickOf(event)
    const name = layouts.selectedLayout()
    if (click !== null && name !== null) openLayoutCommentBox(layoutClickTarget(name, click.slot), click.at)
  }

  // ---- The right-click menu on the previews and the editors ----
  // (`domain/commentMenu.ts`.) It replaces the webview's own: a comment on
  // what was right-clicked — the same box and target a left-click there
  // gives — and in an editor, the Cut / Copy / Paste the native one had.

  // A right-click on the slide preview: the slide list's menu for the
  // slide shown — the same items, enable rules and handlers — whose comment
  // is on what a left-click there would be on.
  function openSlidePreviewMenu(click: PreviewClick): void {
    const index = editor.selectedIndex()
    if (index === null || selectedSlideKey() === null) return
    void checkLayoutFit(index, ui.openSlideContextMenu(index, click.at.x, click.at.y, click))
    void loadLayoutPreviews()
  }

  const previewMenuImage = createMemo(() => {
    const menu = ui.contextMenu()
    return menu.kind === 'on-slide' ? menu.comment?.image ?? null : null
  })

  const previewElementMenu = createMemo(() => {
    const menu = ui.contextMenu()
    return menu.kind === 'on-slide' && Boolean(menu.comment?.image || menu.comment?.hit)
  })

  const [pasteSerial, setPasteSerial] = createSignal(0)
  const [elementClipboard, setElementClipboard] = createSignal<{ markdown: string; image: boolean; deckPath: string | null; placement?: { x: number; y: number; width: number; height: number } } | null>(null)
  const previewCanvasMenu = createMemo(() => {
    const menu = ui.contextMenu()
    return menu.kind === 'on-slide' && menu.comment !== null
  })

  const handledPasteGestures = new WeakSet<object>()
  async function pasteElementShortcut(gesture: object): Promise<void> {
    const copied = elementClipboard()
    const index = editor.selectedIndex()
    if (!copied || copied.deckPath !== deck.deckPath()) return
    try {
      const text = await editorIpc.readClipboardText()
      if (copied === elementClipboard() && copied.deckPath === deck.deckPath() && index === editor.selectedIndex() && text === copied.markdown) await pasteElement(gesture)
    } catch (err) { setErrorMessage(String(err)) }
  }

  function tryPasteElement(text: string, gesture?: object): boolean {
    const copied = elementClipboard()
    if (!copied || copied.deckPath !== deck.deckPath() || copied.markdown !== text) return false
    void pasteElement(gesture)
    return true
  }

  async function pasteElement(gesture?: object): Promise<void> {
    if (gesture && handledPasteGestures.has(gesture)) return
    const copied = elementClipboard()
    const index = editor.selectedIndex()
    if (!copied || index === null || copied.deckPath !== deck.deckPath() || previewImageBusy()) return
    if (gesture) handledPasteGestures.add(gesture)
    ui.closeContextMenu()
    const before = currentSlideText(index)
    const epoch = slidePositionsEpoch
    const { rest, note } = extractNote(before)
    const fields = extractPageComment(rest)
    const base = fields.config.layout ?? render.slideLayouts()[selectedSlideKey() ?? ''] ?? DEFAULT_LAYOUT
    setPreviewImageBusy(true)
    try {
      const text = await editorIpc.readClipboardText()
      if (text !== copied.markdown || editor.selectedIndex() !== index || currentSlideText(index) !== before || slidePositionsEpoch !== epoch) return
      const source = syncedSource(currentSlideTexts())
      let canvas = await imageIpc.createImageCanvas(source, base, copied.image ? 1 : 0, [], [], undefined, undefined, copied.image ? 0 : 1)
      if (editor.selectedIndex() !== index || currentSlideText(index) !== before || slidePositionsEpoch !== epoch) return
      if (copied.placement) {
        const rect = copied.placement
        canvas = await imageIpc.createImageCanvas(source, canvas.layout, 0, [{ slot: canvas.slots[0], ...rect, x: Math.min(1 - rect.width, rect.x + .02 * (pasteSerial() + 1)), y: Math.min(1 - rect.height, rect.y + .02 * (pasteSerial() + 1)) }]).then(positioned => ({ ...positioned, slots: canvas.slots }))
      }
      if (editor.selectedIndex() !== index || currentSlideText(index) !== before || slidePositionsEpoch !== epoch) return
      const body = `${fields.rest}\n\n::: {slot=${canvas.slots[0]}}\n\n${copied.markdown}\n\n:::`
      await perform({ kind: 'slides', cmd: { type: 'replace', index, text: buildSlideText({ ...fields.config, layout: canvas.layout }, body, note) } })
      setPasteSerial(pasteSerial() + 1)
    } catch (err) { setErrorMessage(String(err)) }
    finally { setPreviewImageBusy(false) }
  }

  async function runElementAction(action: 'cut' | 'copy' | 'delete', target?: PreviewClick): Promise<void> {
    const menu = ui.contextMenu()
    const index = editor.selectedIndex()
    if (index === null || previewImageBusy()) return
    const click = target ?? (menu.kind === 'on-slide' && menu.index === index ? menu.comment : null)
    if (!click) return
    ui.closeContextMenu()
    const before = currentSlideText(index)
    const epoch = slidePositionsEpoch
    const body = editor.bodyDraft()
    const range = splitSlides(render.renderedSource())[index]
    const renderedBody = range ? extractPageComment(extractNote(range.text).rest).rest : null
    if (renderedBody !== body.trim()) return
    const rawBody = extractPageComment(extractNote(range!.text, true).rest, true).rest
    const bodyStart = range!.start + range!.text.indexOf(rawBody)
    const edit = click.image ? null : click.hit?.byteSpan ? textEditFor({ ...click.hit, kind: 'text', byteSpan: click.hit.byteSpan, heading: click.hit.kind === 'heading' }, render.renderedSource(), body, bodyStart, rawBody) : null
    const copiedDeckPath = deck.deckPath()
    const previewRoot = document.querySelector('[data-preview-host]')?.shadowRoot
    const imageElement = click.image ? Array.from(previewRoot?.querySelectorAll<HTMLElement>('[data-studio-image]') ?? []).find(element => element.dataset.studioImage === click.image?.slot) : Array.from(previewRoot?.querySelectorAll<HTMLElement>('[data-peitho-src]') ?? []).find(element => element.getAttribute('data-peitho-md') === click.hit?.quote && element.getAttribute('data-peitho-src') === `${click.hit?.byteSpan?.start}-${click.hit?.byteSpan?.end}`)?.closest<HTMLElement>('[data-studio-text],h1,h2,h3,h4,h5,h6,p,li')
    const slideRect = imageElement?.closest('.peitho-slide')?.getBoundingClientRect()
    const imageRect = imageElement?.getBoundingClientRect()
    const placement = slideRect && imageRect ? { x: (imageRect.x - slideRect.x) / slideRect.width, y: (imageRect.y - slideRect.y) / slideRect.height, width: imageRect.width / slideRect.width, height: imageRect.height / slideRect.height } : undefined
    const copied = click.image ? imageSlotContent(body, click.image.slot) : edit ? (edit.heading ? '# ' : '') + edit.value : null
    if (copied === null) return
    try {
      if (action !== 'delete') {
        await editorIpc.writeClipboardText(copied)
        setPasteSerial(0)
        setElementClipboard({ markdown: copied, image: Boolean(click.image), deckPath: copiedDeckPath, placement })
      }
      if (action === 'copy' || editor.selectedIndex() !== index || slidePositionsEpoch !== epoch || currentSlideText(index) !== before) return
      if (click.image || click.textSlot) { await removePreviewImage(click.image?.slot ?? click.textSlot!); return }
      if (edit && bodyEditor) {
        const change = editorTextChange(body, removeSlideText(edit))
        if (change) insertIntoCodeEditor(bodyEditor, { ...change, cursor: change.from }, 'delete.cut')
      }
    } catch (err) { setErrorMessage(String(err)) }
  }

  function runImageOrderAction(action: ImageOrderAction): void {
    const image = previewMenuImage()
    ui.closeContextMenu()
    if (image) void orderPreviewImage(moveImageOrder(image.order, image.slot, action))
  }

  function editorViewOf(which: MenuEditor): ReturnType<typeof createCodeEditor> | undefined {
    switch (which) {
      case 'body': return bodyEditor
      case 'note': return noteEditor
      case 'layout': return layoutEditor
      default: {
        const _exhaustive: never = which
        return _exhaustive
      }
    }
  }

  // A right-click in an editor: inside the selection it's kept, anywhere
  // else the caret goes there (`selectionForMenu`), and the menu acts on
  // that. Nothing to act on — no slide open, no file shown — no menu.
  function openEditorMenu(which: MenuEditor, event: MouseEvent): void {
    const view = editorViewOf(which)
    if (!view) return
    if (which === 'layout' ? layouts.activeFile()?.kind !== 'ready' : selectedSlideKey() === null) return
    const { from, to } = codeEditorSelection(view)
    const next = selectionForMenu(from, to, codeEditorPositionAt(view, { x: event.clientX, y: event.clientY }))
    if (next.moved) selectInCodeEditor(view, next.from, next.to)
    ui.openCommentMenu(openOnEditor(which, event.clientX, event.clientY, next.from, next.to))
  }

  // The editor menu's comment: on lines of the file shown (the layout
  // screen), or of the slide's body or notes — deck.md's lines, found by
  // their text (`editorLinesTarget`) — in the same box as the preview's.
  function commentOnEditorLines(menu: Extract<CommentMenu, { kind: 'on-editor' }>): void {
    const view = editorViewOf(menu.editor)
    if (!view) return
    const { doc } = codeEditorSelection(view)
    const at = { x: menu.x, y: menu.y }
    if (menu.editor === 'layout') {
      const file = layouts.activeFile()
      if (file?.kind !== 'ready') return
      const { lines, quote } = lineSelectionOf(doc, menu.from, menu.to)
      openLayoutCommentBox({ kind: 'file', path: file.path, lines, quote }, at)
      return
    }
    const key = selectedSlideKey()
    if (key === null) return
    const fields = {
      config: editor.pageConfig(),
      body: menu.editor === 'body' ? doc : editor.bodyDraft(),
      note: menu.editor === 'note' ? doc : editor.noteDraft(),
    }
    const target = editorLinesTarget(fields, menu.editor, menu.from, menu.to)
    review.openBox(key, target, null, clampMenuPosition(at, { width: 336, height: 180 }, { width: window.innerWidth, height: window.innerHeight }, 8))
    focusCommentBox()
  }

  // The editor menu's Cut / Copy / Paste, on the OS clipboard (the same
  // access vim mode's `p` reads, `ipc/editorIpc.ts`), as the webview's own
  // menu did. A cut or paste is the user's own edit (`onChange`, one undo
  // step); vim's register takes up what was cut or copied. Focus goes back
  // to the editor.
  //
  // The clipboard answers later: by then another slide or tab may be in
  // the same editor view. What it acts on is taken first
  // (`editorTargetOf`), and a cut or paste is applied only to that same
  // slide or file, its text untouched (`sameEditorTarget`); otherwise it's
  // dropped (a cut then only copied).
  async function runEditorClipboard(menu: Extract<CommentMenu, { kind: 'on-editor' }>, action: 'cut' | 'copy' | 'paste'): Promise<void> {
    const view = editorViewOf(menu.editor)
    const before = editorTargetOf(menu.editor)
    if (!view || before === null) return
    view.focus()
    if (action === 'paste') {
      const text = await editorIpc.readClipboardText()
      if (text === null || text === '' || !sameEditorTarget(before, editorTargetOf(menu.editor))) return
      insertIntoCodeEditor(view, replacementInsertion(before.doc, menu.from, menu.to, text), 'input.paste')
      return
    }
    const text = textBetween(before.doc, menu.from, menu.to)
    if (text === '') return
    try {
      await editorIpc.writeClipboardText(text)
    } catch {
      // Nothing was put on the clipboard: a cut leaves the text in place.
      return
    }
    if (settings.settings().vimMode) vimClipboard.pullClipboard()
    if (action === 'cut' && sameEditorTarget(before, editorTargetOf(menu.editor))) {
      insertIntoCodeEditor(view, replacementInsertion(before.doc, menu.from, menu.to, ''), 'delete.cut')
    }
  }

  // What editor `which` shows now — the slide's key, or the file's path —
  // and its text; `null` without the editor.
  function editorTargetOf(which: MenuEditor): EditorTarget | null {
    const view = editorViewOf(which)
    if (!view) return null
    const shows = which === 'layout' ? layoutEditorShows : selectedSlideKey()
    return { editor: which, shows, doc: codeEditorSelection(view).doc }
  }

  const commentMenuEntries = createMemo<ContextMenuEntry[]>(() => {
    const menu = ui.commentMenu()
    const messages = settings.messages()
    return commentMenuItems(menu).map(item => ({
      action: item.action,
      label: commentMenuLabel(item.action, menu, messages),
      enabled: item.enabled,
      title: '',
      danger: false,
      icon: menuItemIcon(item.action),
      separatorBefore: item.separatorBefore,
    }))
  })

  function runCommentMenuAction(action: CommentMenuAction): void {
    const menu = ui.commentMenu()
    ui.closeCommentMenu()
    switch (action) {
      case 'comment':
        if (menu.kind === 'on-editor') commentOnEditorLines(menu)
        return
      case 'cut':
      case 'copy':
      case 'paste':
        if (menu.kind === 'on-editor') void runEditorClipboard(menu, action)
        return
      default: {
        const _exhaustive: never = action
        return _exhaustive
      }
    }
  }

  // The slide list menu's comment on the slide right-clicked: the whole
  // slide, as a click on no element of its preview gives, where the menu
  // was.
  // From the slide preview, it's on what was right-clicked there, as a
  // left-click gives.
  function commentOnSlideFromMenu(): void {
    const menu = ui.contextMenu()
    const index = contextMenuIndexOf(menu)
    ui.closeContextMenu()
    const fromPreview = commentClickOf(menu)
    if (fromPreview !== null) {
      openCommentBox(fromPreview)
      return
    }
    const entry = index === null ? undefined : slideEntries()[index]
    if (menu.kind !== 'on-slide' || entry === undefined) return
    const at = clampMenuPosition({ x: menu.x, y: menu.y }, { width: 336, height: 180 }, { width: window.innerWidth, height: window.innerHeight }, 8)
    review.openBox(commentKeyOf(entry), { kind: 'slide', text: '', quote: '', offsetInSlide: 0 }, null, at)
    focusCommentBox()
  }

  // Keeps the menu on-screen, as the layout menu's effect does.
  let commentMenuEl: HTMLElement | undefined
  createEffect(() => {
    if (ui.commentMenu().kind === 'closed') return
    requestAnimationFrame(() => {
      const menu = ui.commentMenu()
      if (!commentMenuEl || menu.kind === 'closed') return
      const rect = commentMenuEl.getBoundingClientRect()
      const at = clampMenuPosition(
        { x: menu.x, y: menu.y },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
        8,
      )
      if (at.x !== menu.x || at.y !== menu.y) ui.moveCommentMenu(at)
    })
  })

  // deck.md's lines a comment on lines of a slide is on now, as far as the
  // preview's source shows them (`null` until they're found there).
  function renderedTargetLines(slideKey: string, target: CommentTarget) {
    if (target.kind !== 'lines') return null
    const span = renderedSlideSpans().find(slide => slide.key === slideKey)?.span ?? null
    return targetLines(render.renderedSource(), span, target)
  }

  const commentBoxLabel = createMemo(() => {
    const box = review.box()
    if (box.kind === 'open-layout') return layoutTargetLabel(box.target)
    return box.kind === 'open' ? targetLabel(slideNumberOf(box.slideKey), box.target, null, renderedTargetLines(box.slideKey, box.target)) : ''
  })

  const commentBoxAt = createMemo(() => {
    const box = review.box()
    return box.kind === 'closed' ? { x: 0, y: 0 } : box.at
  })

  // Hands every unsent comment and reply to the agent waiting in crit and
  // finishes the round. Lines are worked out against the deck as saved
  // (what crit and the agent read), so an unsaved edit is saved first.
  async function sendReview(): Promise<void> {
    if (review.availability().kind !== 'ready') return
    // Send what the user sees: a rewrite still open goes in as it reads.
    review.commitEdit()
    review.setBusy('sending')
    review.setError(null)
    try {
      if (editor.isDirty()) await handleSave()
      const source = editor.fullSource()
      const slides = slideSpans(source, render.manifest()?.slides ?? [])
      const pending = review.pending()
      const comments = pending.map(comment => {
        const index = slides.findIndex(slide => slide.key === comment.slideKey)
        return newReviewComment(comment, source, slides[index]?.span ?? null, index + 1 || slideNumberOf(comment.slideKey))
      })
      const layoutPending = review.layoutPending()
      const layoutComments = layoutPending.map(newLayoutComment)
      const sendable = review.sendableReplies()
      const replies = sendable.map(reply => ({ commentId: reply.commentId, body: reply.body, author: REVIEW_AUTHOR }))
      if (comments.length > 0) await critIpc.addComments(comments)
      if (layoutComments.length > 0) await critIpc.addLayoutComments(layoutComments)
      if (replies.length > 0) await critIpc.addReplies(replies)
      await critIpc.finish()
      review.markSent(pending, comments.map(comment => comment.body), sendable, layoutPending)
    } catch (err) {
      review.setError(settings.messages().reviewFailed(String(err)))
    } finally {
      review.setBusy('idle')
    }
    await refreshReview()
  }

  async function resolveReviewComment(id: string): Promise<void> {
    try {
      review.setComments(await critIpc.resolveComment(id))
    } catch (err) {
      review.setError(settings.messages().reviewFailed(String(err)))
    }
  }

  createEffect(() => {
    review.syncCommentCounts(commentCountsBySlide(render.renderedSource(), renderedSlideSpans(), review.pending(), review.comments()))
  })

  const previewPins = createMemo(() => {
    const source = render.renderedSource()
    const slides = renderedSlideSpans()
    return previewPinsOf(selectedSlideKey(), review.comments(), review.sentPins(), review.pending(), review.box(), comment => {
      const index = slideIndexOfComment(source, slides, comment)
      return index === null ? null : slides[index].key
    })
  })

  // The pins as drawn: each anchored one moved onto its element wherever
  // the slide lays it out (`placePreviewPins`). Placed again whenever the
  // slide is laid out anew — another slide, another canvas shape, a new
  // render — two frames on, once the canvas has mounted and laid out; and
  // again whenever that slide reflows on its own (`watchPreviewLayout`).
  const [placedPins, setPlacedPins] = createSignal<PreviewPin[]>([])
  createEffect(() => {
    const pins = previewPins()
    const key = selectedSlideKey()
    if (key !== null) render.previewFragmentOf(key)
    previewCanvasWidth()
    previewCanvasHeight()
    setPlacedPins(pins)
    let stopWatching = () => {}
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setPlacedPins(placePreviewPins(pins))
        if (pins.some(pin => pin.anchor !== null)) stopWatching = watchPreviewLayout(() => setPlacedPins(placePreviewPins(pins)))
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      stopWatching()
    }
  })

  // See `pollsForAgent`: an agent that connected can be missed by the
  // event alone, so the session is re-read until one is seen waiting.
  createEffect(() => {
    // Only with a deck open: the session is the open deck's.
    if (!deck.deckPath() || !pollsForAgent(review.availability())) return
    const timer = window.setInterval(() => { void refreshReview() }, REVIEW_POLL_MS)
    return () => window.clearInterval(timer)
  })

  // The connect card's prompt and command name the bundled crit by its full
  // path; without one (a dev build that never ran `crit:fetch`) they fall
  // back to plain `crit` on the agent's PATH.
  const [bundledCritPath, setBundledCritPath] = createSignal<string | null>(null)
  critIpc.bundledCritPath().then(setBundledCritPath, () => setBundledCritPath(null))
  const connectTarget = createMemo(() => connectTargetOf(review.session(), sessionDirs()))
  const connectPrompt = createMemo(() => agentConnectPrompt(deck.deckPath(), bundledCritPath() ?? 'crit', settings.language(), connectTarget()))
  const connectCommand = createMemo(() => agentConnectCommand(deck.deckPath(), bundledCritPath() ?? 'crit', connectTarget()))
  const [connectCopied, setConnectCopied] = createSignal<'prompt' | 'command' | null>(null)
  let connectCopiedTimer: number | undefined
  async function copyConnectText(which: 'prompt' | 'command'): Promise<void> {
    try {
      await editorIpc.writeClipboardText(which === 'prompt' ? connectPrompt() : connectCommand())
    } catch (err) {
      review.setError(settings.messages().reviewFailed(String(err)))
      return
    }
    setConnectCopied(which)
    window.clearTimeout(connectCopiedTimer)
    connectCopiedTimer = window.setTimeout(() => setConnectCopied(null), 1500)
  }

  const reviewPanelRows = createMemo(() => {
    const source = render.renderedSource()
    const slides = renderedSlideSpans()
    const now = new Date()
    return reviewRows({
      comments: review.comments(),
      unsentReplies: review.pendingReplies(),
      unsent: [
        ...review.pending().map(comment => {
          const number = slideNumberOf(comment.slideKey)
          return { id: comment.id, label: targetLabel(number, comment.target, null, renderedTargetLines(comment.slideKey, comment.target)), body: comment.body, createdAt: comment.createdAt, slideIndex: number > 0 ? number - 1 : null, layout: null }
        }),
        ...review.layoutPending().map(comment => (
          { id: comment.id, label: layoutTargetLabel(comment.target), body: comment.body, createdAt: comment.createdAt, slideIndex: null, layout: comment.target }
        )),
      ],
      showResolved: review.showResolved(),
      replyingTo: review.replyDraft()?.commentId ?? null,
      slideOf: comment => slideIndexOfComment(source, slides, comment),
      layoutOf: layoutTargetOfComment,
    }).map(row => ({ ...row, time: formatReviewTime(row.createdAt, now), editing: isUnsentEditing(row, review.unsentEdit()?.id ?? null) }))
  })
  const reviewResolvedCount = createMemo(() => resolvedCount(review.comments()))

  // An agent seen waiting and now at work on what it was sent. crit can't
  // tell that from one whose session was closed, so a long silence (no
  // reply, no comment change, no edit to the deck) counts as gone and
  // brings the connect card back (`agentGoneQuiet`).
  const agentWorking = createMemo(() => review.availability().kind === 'agent-not-waiting' && review.agentSeen())
  let lastAgentActivity = Date.now()
  function noteAgentActivity(): void {
    lastAgentActivity = Date.now()
  }
  createEffect(() => {
    if (!agentWorking()) return
    noteAgentActivity()
    const timer = window.setInterval(() => {
      if (agentGoneQuiet(lastAgentActivity, Date.now())) review.forgetAgent()
    }, 10_000)
    return () => window.clearInterval(timer)
  })

  // The connect card, until an agent is seen waiting in this session (one
  // at work on a round it was sent is not a missing agent).
  const connectShown = createMemo(() => showsConnectGuide(review.availability(), review.agentSeen()) && review.busy() !== 'starting')
  const reviewStatus = createMemo(() => {
    // The card already asks for the agent; the line would only repeat it.
    if (connectShown() && review.availability().kind === 'agent-not-waiting') return ''
    return reviewStatusText(
      settings.messages(), review.availability(), review.unsentCount(), review.busy() === 'starting', review.agentSeen(), reviewPanelRows().length > 0,
    )
  })

  // `renderPayload`, when given, is applied together with the exact
  // `source` this same call just read — see `state/renderStore.ts`'s
  // `renderedSource` for why `applyRenderPayload` must always receive its
  // matching source directly, rather than this function setting
  // `editor.fullSource` off on its own and leaving the manifest to catch
  // up separately.
  async function refreshSource(preserveSelection: boolean, renderPayload?: RenderPayload): Promise<void> {
    const source = await deckIpc.readDeckSource()
    // A deck read fresh from disk (a newly opened deck, an external edit)
    // may not match any position kept so far.
    forgetSlidePositions()
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
    syncEditorFields({ kind: 'reset' })
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
  // `cmd`: the structural command `nextSource` applies, if any — the kept
  // editor states follow their slides through it.
  //
  // Resolves `true` once the change is rendered and saved, `false` if either
  // step failed (the error is already shown) — undo history records only a
  // change that actually landed.
  async function commitChange(
    nextSource: string,
    plan: SelectionPlan,
    { expectedDraft, cmd }: { expectedDraft?: { body: string; note: string }; cmd?: SlideCommand } = {},
  ): Promise<boolean> {
    const before = editor.editorSession()
    const finishSave = saves.begin(nextSource, expectedDraft ? 'draft' : 'structural')
    setActiveSaveCount(saves.pendingCount())
    let saved = false
    setErrorMessage(null)
    try {
      // A slide already isolated as broken (by where `cmd` leaves it, or
      // by its key) doesn't block this save: the change is rendered
      // without it and saved as written — the deck on disk is no worse
      // off. Any other slide not building does, the slide being edited
      // first of all (`saveDecision`); the save is then refused with that
      // error, as any draft that doesn't build is.
      const known = cmd ? brokenSlidesAfterCommand(render.brokenSlides(), cmd) : render.brokenSlides()
      const editedIndex = expectedDraft && before.kind === 'editing' ? before.index : null
      const slideCount = splitSlides(nextSource).length
      const result = await renderIsolating(nextSource, error => saveDecision(error, known, editedIndex, slideCount) === 'isolate')
      if (result.kind === 'failed') throw new RenderFailure(result.error)
      render.applyRenderPayload(result.payload, nextSource, result.broken)
      await deckIpc.saveDeckSource(nextSource)
      editor.setFullSource(nextSource)
      const ranges = splitSlides(nextSource)
      editor.setSlideRanges(ranges)
      if (cmd) slideStates.shift(cmd)
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
      if (next !== now) {
        if (opensSameSlide(plan)) {
          syncEditorFields({ kind: 'same-slide' })
        } else {
          const left = before.kind === 'editing' ? before.index : null
          syncEditorFields({
            kind: 'switch',
            from: left !== null && cmd ? indexAfterCommand(left, cmd) : left,
            to: next.kind === 'editing' ? next.index : null,
          })
        }
      }
      setStatusMessage({ kind: 'saved' })
      saved = true
      return true
    } catch (err) {
      if (err instanceof RenderFailure) showBuildError(err.message)
      else setErrorMessage(String(err))
      return false
    } finally {
      finishSave(saved)
      setActiveSaveCount(saves.pendingCount())
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
    // Picking a slide means editing it: the whole-source editor is left
    // first — unless its typing can't be saved yet, which keeps it open
    // (and the selection where it was) rather than losing the typing.
    // Its save can move any slide, so the row clicked is found again in
    // the saved deck (`slideIndexAfterSourceSave`); a row the save
    // rewrote is not guessed at, and the selection stays where
    // `refreshSource` left it.
    if (editor.sourceOpen()) {
      const textsBefore = editor.slideRanges().map(range => range.text)
      if (!await closeSourceEditor()) return
      const found = slideIndexAfterSourceSave(index, textsBefore, editor.slideRanges().map(range => range.text))
      if (found === null || found === editor.selectedIndex()) return
      index = found
    }
    await pendingSlideTextEdit
    if (editor.isDirty() && !await handleSave()) return
    // Edits may have arrived while the save was in flight. Keep that draft
    // in its session instead of replacing it with another slide.
    if (editor.isDirty()) return
    const { rest: withoutNote, note } = extractNote(editor.slideRanges()[index]?.text ?? '')
    const { rest, config } = extractPageComment(withoutNote)
    const fields: SlideFields = { body: rest, note, config }
    const from = editor.selectedIndex()
    editor.setEditorSession({ kind: 'editing', index, saved: fields, draft: fields })
    syncEditorFields({ kind: 'switch', from, to: index })
  }

  async function handleSave(): Promise<boolean> {
    await pendingSlideTextEdit
    const range = editor.selectedRange()
    const index = editor.selectedIndex()
    if (!range || index === null) return false
    const body = editor.bodyDraft()
    const note = editor.noteDraft()
    const newSlideText = buildSlideText(editor.pageConfig(), body, note)
    const source = editor.fullSource()
    const nextSource = replaceSlideText(source, range, newSlideText)
    // Typed text can itself re-split the deck (a `---` line, an unclosed code
    // fence), shifting the positions every history step addresses slides by.
    const resplits = splitSlides(nextSource).length !== editor.slideRanges().length
    const saved = await commitChange(nextSource, { kind: 'keep' }, { expectedDraft: { body, note } })
    if (saved && resplits) forgetSlidePositions()
    return saved
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

  // Runs one slide operation against the current slides (the open slide's
  // unsaved draft included) through the same `commitChange` path every
  // structural operation uses, and reports the step that undoes it.
  // `planFor` picks which slide ends up open: the operation's own choice
  // (`selectionPlanFor`), or for an undo/redo the slide it changed.
  async function runStep(step: StructuralStep, planFor: (cmd: SlideCommand) => SelectionPlan): Promise<StepOutcome> {
    const texts = currentSlideTexts()
    const cmd = commandForStep(texts, step)
    if (validate(texts, cmd)) return { kind: 'rejected' }
    const inverse = inverseStep(texts, step)
    const ok = await commitChange(sourceFor(applyCommand(texts, cmd), cmd), planFor(cmd), { cmd })
    return ok ? { kind: 'done', inverse } : { kind: 'failed' }
  }

  // Structural operations and undo/redo run one at a time: each reads the
  // slides only once the previous one has landed. Run concurrently, both
  // would compute from the same slides, the later whole-file save would
  // silently overwrite the earlier, and the history would record a step for
  // a change that is no longer in the file.
  let structuralQueue: Promise<void> = Promise.resolve()
  function serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = structuralQueue.then(async () => { await pendingSlideTextEdit; return run() })
    structuralQueue = next.then(() => undefined, () => undefined)
    return next
  }

  // A new structural operation: runs it and records how to undo it.
  function perform(step: StructuralStep): Promise<StepOutcome['kind']> {
    return performStep(() => runStep(step, selectionPlanFor))
  }

  // Runs `run` once every earlier operation has landed, and records the
  // step that undoes it if it did. Resolves how it ended.
  function performStep(run: () => Promise<StepOutcome>): Promise<StepOutcome['kind']> {
    return serialized(async () => {
      const outcome = await run()
      if (outcome.kind === 'done') {
        history.record(outcome.inverse)
        separateTextHistory()
      }
      return outcome.kind
    })
  }

  // Writes a page-number step's frontmatter value and slide flags through
  // the same `commitChange` path as every structural operation. The open
  // slide stays open: the step never moves or removes a slide.
  async function runPageNumbersStep(step: PageNumbersStep): Promise<StepOutcome> {
    const texts = currentSlideTexts()
    const inverse = inversePageNumbersStep(texts, pageNumbersValue())
    const nextSource = setFrontmatterKey(rebuildSource(applyPageNumbersStep(texts, step)), PAGE_NUMBERS_KEY, step.value)
    const ok = await commitChange(nextSource, { kind: 'keep' })
    return ok ? { kind: 'done', inverse } : { kind: 'failed' }
  }

  // Writes several slides' `"layout"` at once through the same
  // `commitChange` path as every structural operation — the layout screen
  // moving a deleted layout's slides to another, or back when the deletion
  // fails — recording nothing (see `confirmLayoutDelete`, which runs it
  // under `serialized`; this doesn't queue by itself). The open slide stays open: no slide moves.
  // Resolves the pins that put the slides back, or `null` when nothing had
  // to change; throws when the commit fails.
  async function commitLayoutPins(step: LayoutPinsStep): Promise<LayoutPinsStep | null> {
    const texts = currentSlideTexts()
    const next = applyLayoutPinsStep(texts, step)
    if (next.every((text, i) => text === texts[i])) return null
    const inverse = inverseLayoutPinsStep(texts, step)
    if (!await commitChange(rebuildSource(next), { kind: 'keep' })) throw new Error(errorMessage() ?? settings.messages().deckChangeFailed)
    return inverse
  }

  // Edit menu's deck settings: writes the picked choice into the deck's
  // frontmatter as one undoable step, removing the key for peitho-core's
  // default. Page numbers
  // go through a `PageNumbersStep`, which also clears the slides' own
  // `page_number:false` when turning them off. Picking the choice already
  // in place does nothing. `payload` is the menu event's, read only once
  // earlier operations have landed, so the Line Breaks toggle flips what
  // the deck holds by then; one that isn't a pick the menu offers is
  // dropped.
  async function setDeckSetting(payload: unknown): Promise<void> {
    await performStep(async () => {
      const pick = resolveDeckSettingPick(payload, deckSettings())
      if (pick === null || pickChangesNothing(deckSettings(), pick)) return { kind: 'rejected' }
      const value = frontmatterValueOf(pick.key, pick.choice)
      return pick.key === 'page_numbers'
        ? runPageNumbersStep(pageNumbersStepFor(currentSlideTexts(), value))
        : runFrontmatterStep({ kind: 'frontmatter', key: pick.key, value })
    })
  }

  // Writes one frontmatter key through the same `commitChange` path as
  // every structural operation, the open slide's draft included. A step
  // that would leave the source as it is (a frontmatter block that isn't
  // closed, which `setFrontmatterKey` won't touch) records nothing.
  async function runFrontmatterStep(step: FrontmatterStep): Promise<StepOutcome> {
    const source = rebuildSource(currentSlideTexts())
    const nextSource = applyFrontmatterStep(source, step)
    if (nextSource === source) return { kind: 'rejected' }
    const inverse = inverseFrontmatterStep(source, step)
    const ok = await commitChange(nextSource, { kind: 'keep' })
    return ok ? { kind: 'done', inverse } : { kind: 'failed' }
  }

  // Edit > Undo (`undo`) / Redo (`redo`): the newest step on the timeline,
  // whatever has focus, queued behind any structural operation still
  // saving. A text marker whose group vim's `u` / `Ctrl-R` already moved
  // past is dropped on the way (`takeLive`).
  function replayHistory(direction: 'undo' | 'redo'): Promise<void> {
    return serialized(() => replayHistoryNow(direction))
  }
  async function replayHistoryNow(direction: 'undo' | 'redo'): Promise<void> {
    separateTextHistory()
    for (;;) {
      const step = history.take(direction, marker => textStepIsLive(marker, direction))
      if (step === null) return
      if (step.kind !== 'text') {
        await replayStructuralStep(step, direction)
        return
      }
      const outcome = await replayTextStep(step, direction)
      // The group turned out to be gone once its slide was open: on to the
      // next step, as if it had been skipped up front.
      if (outcome === 'gone') continue
      if (outcome === 'done') pushReplayed(step, direction)
      return
    }
  }

  // Puts the step that reverses a replayed one onto the other stack.
  function pushReplayed(opposite: HistoryStep, direction: 'undo' | 'redo'): void {
    if (direction === 'undo') history.pushRedo(opposite)
    else history.pushUndo(opposite)
    setStatusMessage({ kind: direction === 'undo' ? 'undone' : 'redone' })
  }

  // Whether `step`'s group is still the next one its editor would undo (or
  // redo): the open slide's editor as it is now, another slide's as kept
  // when the user left it. A slide with no kept state has none.
  function textStepIsLive(step: TextStep, direction: 'undo' | 'redo'): boolean {
    if (step.index >= editor.slideRanges().length) return false
    const view = codeEditorOf(step.field)
    const snapshot = step.index === editor.selectedIndex()
      ? view && snapshotCodeEditor(view)
      : slideStates.peek(step.index)?.[step.field]
    return snapshot !== undefined && canReplayCodeEditorGroup(snapshot, direction, step.seq)
  }

  // Opens `step`'s slide (saving the open one's draft first, as any switch
  // does) and undoes or redoes its group in that editor; the marker itself
  // is its own opposite. Keyboard focus stays where it is; the editor
  // scrolls the change into view. `forgotten`: that save re-split the deck,
  // so the history is gone, this step with it.
  async function replayTextStep(step: TextStep, direction: 'undo' | 'redo'): Promise<'done' | 'gone' | 'forgotten'> {
    const epoch = slidePositionsEpoch
    await selectSlide(step.index)
    if (epoch !== slidePositionsEpoch) return 'forgotten'
    const view = codeEditorOf(step.field)
    if (view === undefined || editor.selectedIndex() !== step.index) return 'gone'
    if (!replayCodeEditorGroup(view, direction, step.seq)) return 'gone'
    const session = editor.editorSession()
    if (step.layout && session.kind === 'editing' && session.index === step.index) {
      const layout = direction === 'undo' ? step.layout.before : step.layout.after
      editor.setEditorSession({ ...session, draft: { ...session.draft, config: { ...session.draft.config, layout } } })
    }
    return 'done'
  }

  // A slide operation's undo/redo opens the slide it changed
  // (`selectionForReplay`). On success the opposite step goes onto the
  // other stack; a failed commit puts the step back so it can be retried; a
  // rejected one means the history no longer matches the deck, so it is
  // dropped whole rather than left to misfire on the next press.
  function runReplayedStep(step: StructuralStep | PageNumbersStep | FrontmatterStep): Promise<StepOutcome> {
    switch (step.kind) {
      case 'page-numbers':
        return runPageNumbersStep(step)
      case 'frontmatter':
        return runFrontmatterStep(step)
      default:
        return runStep(step, cmd => selectionForReplay(step, cmd, editor.selectedIndex()))
    }
  }
  async function replayStructuralStep(step: StructuralStep | PageNumbersStep | FrontmatterStep, direction: 'undo' | 'redo'): Promise<void> {
    const isUndo = direction === 'undo'
    const outcome = await runReplayedStep(step)
    if (outcome.kind === 'done') {
      pushReplayed(outcome.inverse, direction)
    } else if (outcome.kind === 'failed') {
      if (isUndo) history.pushUndo(step)
      else history.pushRedo(step)
    } else {
      forgetSlidePositions()
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
      // Any button, so the slide list's keys after a right-click menu
      // operation act on the slides rather than type into the body editor.
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
      void loadLayoutPreviews()
    } else {
      void selectSlide(index)
      void openSlideMenu(index, event.clientX, event.clientY)
    }
  }

  // Opens the context menu on slide `index` at (`x`, `y`) and starts its
  // fit check — from a right-click, or from the error bar. Resolves once
  // the layout picker's previews are in.
  function openSlideMenu(index: number, x: number, y: number): Promise<void> {
    void checkLayoutFit(index, ui.openSlideContextMenu(index, x, y))
    return loadLayoutPreviews()
  }

  // The error bar's "choose a layout that fits": the context menu on slide
  // `index`, its picker expanded. Expanded only once the previews are in —
  // entered while it still shows "loading", the picker's branch never
  // renders the list that replaces it (confirmed with Playwright), so
  // this waits the way a user's own click on Change Layout usually does.
  // Skipped if the menu was closed or moved to another slide meanwhile.
  async function openLayoutPickerOn(index: number, at: { x: number; y: number }): Promise<void> {
    await openSlideMenu(index, at.x, at.y)
    const menu = ui.contextMenu()
    if (menu.kind === 'on-slide' && menu.index === index && !menu.layoutPickerOpen) ui.toggleLayoutPicker()
  }

  // Lands every queued structural operation and overlapping commit, then
  // saves the open slide's draft. Resolves whether deck.md now holds
  // everything: no save failed and no draft is left unsaved — then
  // `editor.fullSource()` is what's on disk. Structural actions may still be
  // queued without a dirty body, so the queue is drained first; never call
  // it from inside `serialized`, which would wait on itself.
  async function flushDeck(): Promise<boolean> {
    await pendingSlideTextEdit
    await structuralQueue
    await saves.drain()
    // The whole-deck source editor's typing too: it holds the slide's
    // draft as well when it was opened over one that couldn't be saved.
    if (editor.sourceOpen() && !await flushSourceEditor()) return false
    if (editor.isDirty()) await handleSave()
    return await saves.drain() && !editor.isDirty() && !editor.isSourceDirty()
  }

  // The deck source a layout file operation is checked against: the one on
  // disk, since only layout files are written and the deck reopens from
  // deck.md. Saves the open slide's draft first; throws when deck.md can't
  // be brought up to date, as a draft checked but never saved could approve
  // a layout the saved deck doesn't build with.
  async function persistedSource(): Promise<string> {
    if (!await flushDeck()) throw new Error(settings.messages().layoutDeckUnsaved)
    return editor.fullSource()
  }

  // The deck source as the user sees it: the open slide's unsaved draft
  // included.
  function liveSource(): string {
    return editor.isDirty() ? (currentDraftSource() ?? editor.fullSource()) : editor.fullSource()
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
    const source = liveSource()
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
    if (!await fetchLayoutPreviews()) ui.setLayoutPreviews([])
    layouts.bumpPreviewGeneration()
  }
  // Fetches the layout previews into the cache; resolves whether it could.
  async function fetchLayoutPreviews(): Promise<boolean> {
    try {
      const payload = await deckIpc.previewLayouts()
      ui.setLayoutPreviewCss(payload.css)
      ui.setLayoutPreviews(payload.previews)
      return true
    } catch {
      return false
    }
  }

  // ---- The layout screen (the header's Layouts mode) ----
  //
  // Its list is the "Change Layout" picker's: the same `preview_layouts`
  // previews, cached in `ui.layoutPreviews` until a layout file changes.
  // Every file operation (`engine::layout_files`) is followed by
  // `refreshLayouts` (an autosave by `reloadLayoutPreviews`), which
  // replaces that cache and re-renders the deck, so the slides' thumbnails
  // pick up a changed layout too; a change made outside Studio arrives
  // through the layout files' watcher (`syncLayoutFiles`).
  const layoutNames = createMemo<string[]>(() => (ui.layoutPreviews() ?? []).map(preview => preview.name))
  const slidesByLayout = createMemo(() => layoutUsage(slideEntries(), render.slideLayouts()))
  const layoutRowsShown = createMemo(() => layoutRows(layoutNames(), slidesByLayout(), settings.language(), layoutListGeneration(layouts.previewGeneration(), ui.viewportMode(), ui.phoneShape())))
  function layoutFragmentOf(name: string): string {
    return (ui.layoutPreviews() ?? []).find(preview => preview.name === name)?.fragment ?? ''
  }

  // The layout screen's columns, open or folded into its rail; the comments
  // column is there only with a deck open.
  const layoutColumns = createMemo<LayoutColumns>(() => ({
    files: ui.layoutFilesOpen(),
    editor: ui.layoutEditorOpen(),
    list: ui.layoutListOpen(),
    review: render.assetBaseUrl() ? ui.reviewOpen() : null,
  }))
  const layoutFilling = createMemo(() => layoutColumnFilling(layoutColumns()))

  // The comments column takes the rest of the row on the slides screen with
  // both the editor and the preview closed, and on the layout screen with
  // the editor and the list closed (`layoutColumnFilling`).
  const reviewFillsRow = createMemo(() => (ui.studioMode() === 'slides'
    ? !ui.previewOpen() && !ui.editorOpen()
    : layoutFilling() === 'review'))

  // A comment's row names a slide: from the layout screen, the slides
  // screen comes back to show it.
  async function selectSlideFromReview(index: number): Promise<void> {
    if (ui.studioMode() !== 'slides' && !await setStudioMode('slides')) return
    await selectSlide(index)
  }

  // A comment on a layout opens the layout screen on it; one on every
  // layout, the layout screen as it was; one on lines of a file (written in
  // the editor), that file.
  async function selectLayoutFromReview(target: LayoutCommentTarget): Promise<void> {
    if (ui.studioMode() !== 'layouts') {
      leaveScreen('layouts')
      await enterLayoutScreen()
    }
    if (target.kind === 'layout' && layoutNames().includes(target.name)) await selectLayout(target.name)
    if (target.kind === 'file') await openDeckFile(target.path)
  }

  // The layout files' fingerprint as last seen (`layout_files_stamp`),
  // compared whenever the files' watcher (`onLayoutFilesChanged`) or crit
  // reports something: a changed fingerprint refreshes the layouts, the
  // slides, the tree and the open tabs (`pullOpenFiles`). Studio's own
  // writes take their fingerprint as seen, so the watcher's report of them
  // changes nothing.
  // Every update counts up `layoutStampRevision`, so a read that was in
  // flight while a newer fingerprint was taken (an autosave's, say) can tell
  // and never puts the older one back.
  let layoutStamp: string | null = null
  let layoutStampRevision = 0
  function takeLayoutStamp(stamp: string): void {
    layoutStamp = stamp
    layoutStampRevision += 1
  }
  async function readLayoutStamp(): Promise<string | null> {
    try {
      return (await deckIpc.layoutFilesStamp()) ?? ''
    } catch {
      return null
    }
  }
  // Takes the files as they are now as seen — on opening a deck, and after
  // Studio changed them itself.
  async function noteLayoutFiles(): Promise<void> {
    const revision = layoutStampRevision
    const stamp = await readLayoutStamp()
    if (stamp !== null && revision === layoutStampRevision) takeLayoutStamp(stamp)
  }
  // Resolves whether the files had changed. A newer fingerprint taken while
  // this one was being read makes it stale: the files are read again
  // against that newer one.
  async function syncLayoutFiles(): Promise<boolean> {
    let stamp: string | null
    let previous: string | null
    do {
      const revision = layoutStampRevision
      stamp = await readLayoutStamp()
      if (stamp === null) return false
      if (revision !== layoutStampRevision) continue
      previous = layoutStamp
      takeLayoutStamp(stamp)
      break
    } while (true)
    if (!layoutFilesChanged(previous, stamp)) return false
    await Promise.all([
      reloadLayoutPreviews().then(showSavedLayoutPreview),
      renderPreview(liveSource()),
      refreshDeckFiles(),
    ])
    const name = shownLayout(layouts.selectedLayout(), layoutNames())
    if (name !== layouts.selectedLayout()) await openLayout(name)
    await pullOpenFiles()
    return true
  }

  // The deck's files for the tree, listed again; on failure the old list
  // stays.
  async function refreshDeckFiles(): Promise<void> {
    try {
      layouts.setFiles(await deckIpc.listDeckFiles())
    } catch {
      // The tree keeps what it showed.
    }
  }

  // Every open file, read again after a change on disk, into its tab
  // (`withExternalChange`): taken as it is when nothing was unsaved, else
  // kept beside the typing for the user to choose. A file gone from disk
  // closes its tab, or — holding typing — says it can't be saved. A tab
  // that couldn't be read is tried again.
  async function pullOpenFiles(): Promise<void> {
    // Read side by side: each tab takes its own answer as it lands.
    await Promise.all(layouts.tabs().tabs.map(pullOpenFile))
  }
  async function pullOpenFile(file: FileEditor): Promise<void> {
    if (file.kind === 'loading') return
    if (file.kind === 'unavailable') {
      layouts.fileLoading(file.path)
      await readIntoTab(file.path)
      return
    }
    let disk: string
    try {
      disk = await deckIpc.readDeckFile(file.path)
    } catch {
      layouts.fileGone(file.path, settings.messages().fileGone)
      if (layouts.fileOf(file.path) === undefined) layoutEditorStates.delete(file.path)
      return
    }
    // The file shown waits out an IME composition, whose text the editor
    // must not lose — checked once the file is read, as one may have
    // started meanwhile: the editor can't take the new text until it ends.
    if (file.path === layoutEditorShows && layoutEditorComposing()) {
      setTimeout(() => {
        const current = layouts.fileOf(file.path)
        if (current !== undefined) void pullOpenFile(current)
      }, 300)
      return
    }
    if (layouts.externalChange(file.path, disk) !== 'replaced') return
    replaceLayoutEditorText(file.path)
    if (layoutOfFile(file.path, layoutNames()) === layouts.selectedLayout()) resetDraftPreview()
  }

  // The conflict's two ways out: the file as it is on disk now (read
  // again), the typing set aside — Undo brings it back — or the typing,
  // saved over it next.
  async function loadExternalLayout(): Promise<void> {
    const shown = layouts.activeFile()
    if (shown?.kind !== 'ready' || shown.external === null || shown.saving) return
    let disk
    try {
      disk = await deckIpc.readDeckFile(shown.path)
    } catch (err) {
      layouts.setNotice(settings.messages().layoutActionFailed(err instanceof Error ? err.message : String(err)))
      return
    }
    clearTimeout(layoutAutosaveTimer)
    layouts.loadExternal(shown.path, disk)
    layouts.setNotice(null)
    replaceLayoutEditorText(shown.path)
    resetDraftPreview()
  }
  function keepLayoutDraft(): void {
    const path = layouts.activePath()
    if (path === null) return
    layouts.keepDraft(path)
    layouts.setNotice(null)
    scheduleLayoutAutosave()
  }

  // Fresh previews in place of the ones shown (the list keeps its rows
  // meanwhile, unlike `refreshLayouts`); on failure the old ones stay.
  async function reloadLayoutPreviews(): Promise<void> {
    if (await fetchLayoutPreviews()) layouts.bumpPreviewGeneration()
  }

  // The window was asked to close with a layout draft not saved yet
  // (`report_layout_draft`): saved, it closes; not, it says so, and the
  // next close discards the draft.
  async function closeAfterLayoutFlush(): Promise<void> {
    // The whole-deck source editor's draft first: one that doesn't build
    // keeps the window open, the error bar saying so over its reason —
    // and, as for a layout draft, the next close discards it.
    if (editor.sourceOpen() && !await flushSourceEditor()) {
      showBuildError(settings.messages().sourceCloseUnsaved(errorMessage() ?? ''))
      return
    }
    if (await flushLayoutEditor()) {
      await getCurrentWindow().close()
      return
    }
    const messages = settings.messages()
    const blocked = tabsBlocker(layouts.tabs())
    if (blocked !== null) showLayoutTab(blocked.path)
    // A conflict didn't fail to save: it waits for "load" or "keep mine".
    layouts.setNotice(blocked?.blocker === 'conflict' ? messages.layoutCloseConflict : messages.layoutCloseUnsaved)
  }

  // Leaving the layout screen saves its drafts first; resolves whether the
  // switch happened.
  async function setStudioMode(mode: StudioMode): Promise<boolean> {
    if (ui.studioMode() === 'layouts' && mode !== 'layouts' && !await leaveLayoutEditor()) return false
    leaveScreen(mode)
    if (mode === 'layouts') void enterLayoutScreen()
    return true
  }

  // What a screen switch closes: the layout menu, the PC / Phone switch's
  // menu (both screens show the switch; its menu belongs to the one it was
  // opened on) and the comment box, whose target is on the screen being
  // left.
  function leaveScreen(mode: StudioMode): void {
    if (ui.studioMode() !== mode) review.closeBox()
    ui.setStudioMode(mode)
    layouts.closeMenu()
    ui.closeCommentMenu()
    ui.closePhoneShapeMenu()
  }

  async function enterLayoutScreen(): Promise<void> {
    // The list starts as wide as the editor: their shared width is known
    // only once the screen shows, so it's measured on its first frame.
    measureWidthsNextFrame(['[data-layout-editor]', '[data-layout-list]'], shared => {
      layouts.settleListWidth(initialLayoutListWidth(shared, COLUMN_WIDTH_BOUNDS))
    })
    await Promise.all([loadLayoutPreviews(), refreshDeckFiles()])
    const name = shownLayout(layouts.selectedLayout(), layoutNames())
    if (name !== layouts.selectedLayout() || layouts.tabs().tabs.length === 0) await openLayout(name)
  }

  // Shows layout `name` and opens its files in the editor's tabs. Tabs
  // already open keep their drafts; any typing waiting for its pause is
  // saved now rather than later. The layout shown with both files open
  // stays as it is; with one closed, a click opens it again.
  async function selectLayout(name: string): Promise<void> {
    const paths = layoutFilePaths(name)
    if (name === layouts.selectedLayout() && allTabsOpen(layouts.tabs(), [paths.html, paths.css])) return
    if (layouts.editorDirty()) void flushLayoutEditor()
    await openLayout(name)
  }

  // Selects layout `name` (`null` for none) and opens its HTML and CSS as
  // tabs, showing `show` — by default the same kind of file as the one
  // shown now (its CSS when a layout's CSS is shown), else its HTML.
  async function openLayout(name: string | null, show?: string): Promise<void> {
    resetDraftPreview()
    layouts.setSelectedLayout(name)
    layouts.setNotice(null)
    if (name === null) return
    const paths = layoutFilePaths(name)
    const active = layouts.activePath()
    const sameKind = active !== null && layoutOfFile(active, layoutNames()) !== null && fileLanguage(active) === 'css' ? paths.css : paths.html
    await openEditorFiles([paths.html, paths.css], show ?? sameKind)
    // Tabs already open may hold a draft of this layout: draw it again.
    scheduleDraftPreview()
  }

  // Opens `paths` as tabs with `show` shown, and reads those not open yet.
  async function openEditorFiles(paths: readonly string[], show: string): Promise<void> {
    const joined = layouts.openFiles(paths, show)
    await Promise.all(joined.map(readIntoTab))
  }
  async function readIntoTab(path: string): Promise<void> {
    try {
      layouts.fileLoaded(path, await deckIpc.readDeckFile(path))
    } catch (err) {
      layouts.fileUnavailable(path, err instanceof Error ? err.message : String(err))
    }
  }

  // A file picked in the tree (or named by a comment): a layout's own file
  // selects that layout too, so the list and the large preview follow; any
  // other file (`css/base.css`) opens beside them, the selection kept.
  async function openDeckFile(path: string): Promise<void> {
    const name = layoutOfFile(path, layoutNames())
    if (name !== null && name !== layouts.selectedLayout()) {
      if (layouts.editorDirty()) void flushLayoutEditor()
      await openLayout(name, path)
      return
    }
    await openEditorFiles([path], path)
  }

  // A click on a tree row: a folder opens or closes; a text file opens.
  function clickTreeRow(path: string): void {
    const entry = layouts.files().find(file => file.path === path)
    if (entry === undefined) return
    if (entry.kind === 'dir') layouts.toggleFolder(path)
    else if (entry.editable) void openDeckFile(path)
  }

  // A tab picked: shown, and when it's a layout's file, that layout is
  // selected in the list (its other file isn't opened again).
  function showLayoutTab(path: string): void {
    layouts.showFile(path)
    const name = layoutOfFile(path, layoutNames())
    if (name === null || name === layouts.selectedLayout()) return
    resetDraftPreview()
    layouts.setSelectedLayout(name)
    layouts.setNotice(null)
    scheduleDraftPreview()
  }

  // A tab closed: its typing is saved first; one that can't be (refused,
  // or changed on disk meanwhile) stays open, shown, with the reason. A
  // file gone from disk closes, its draft discarded: there's nowhere left
  // to save it, and its message says closing discards it.
  async function closeLayoutTab(path: string): Promise<void> {
    const file = layouts.fileOf(path)
    if (file === undefined) return
    if (!canCloseFile(file)) await flushLayoutEditor()
    const current = layouts.fileOf(path) ?? file
    const blocker = canCloseFile(current) ? null : leaveBlocker(current)
    if (blocker !== null) {
      showLayoutTab(path)
      const messages = settings.messages()
      layouts.setNotice(blocker === 'conflict' ? messages.layoutConflictFirst : messages.layoutSaveFirst)
      return
    }
    layouts.closeFile(path)
    layoutEditorStates.delete(path)
  }

  // After a layout file changed: fresh previews, the slides re-rendered
  // against the deck's new layouts, the tree listed again, and `select`
  // (or the layout shown, or the first) shown — the open tabs read again,
  // keeping unsaved edits.
  async function refreshLayouts(select: string | null): Promise<void> {
    void noteLayoutFiles()
    ui.setLayoutPreviews(null)
    await Promise.all([loadLayoutPreviews(), refreshDeckFiles()])
    await renderPreview(liveSource())
    const name = shownLayout(select ?? layouts.selectedLayout(), layoutNames())
    if (name !== layouts.selectedLayout()) await openLayout(name)
    await pullOpenFiles()
  }

  // Runs one layout-file operation with the screen's buttons disabled,
  // showing its refusal on the screen. Resolves whether it went through.
  async function runLayoutAction(action: () => Promise<void>): Promise<boolean> {
    if (layouts.busy()) return false
    layouts.setBusy(true)
    layouts.setNotice(null)
    try {
      await action()
      return true
    } catch (err) {
      layouts.setNotice(settings.messages().layoutActionFailed(err instanceof Error ? err.message : String(err)))
      return false
    } finally {
      layouts.setBusy(false)
    }
  }

  function layoutNameProblemText(problem: LayoutNameProblem | null, messages: Messages): string {
    switch (problem) {
      case null: return ''
      case 'empty': return messages.layoutNameEmpty
      case 'too-long': return messages.layoutNameTooLong
      case 'invalid': return messages.layoutNameInvalid
      case 'start': return messages.layoutNameStart
      case 'taken': return messages.layoutNameTaken
    }
  }
  // Nothing is said about a name not typed yet: the form opens empty.
  const newLayoutProblem = createMemo(() => {
    if (layouts.newLayoutName() === '') return ''
    return layoutNameProblemText(layouts.newLayoutNameProblem(layoutNames()), settings.messages())
  })

  // The new layout opens in the editor, so the one open now is saved first,
  // and edits to it that can't be saved keep it from being created, as in
  // `selectLayout`.
  async function createLayout(): Promise<void> {
    if (layouts.newLayoutNameProblem(layoutNames()) !== null) return
    if (!await leaveLayoutEditor()) return
    let created = ''
    const ok = await runLayoutAction(async () => {
      const source = await persistedSource()
      created = await deckIpc.createLayout(source, layouts.newLayoutName(), layouts.newLayoutTemplate() || null)
    })
    if (!ok) return
    layouts.closeNewLayout()
    await refreshLayouts(created)
    setStatusMessage({ kind: 'layout-created', layout: created })
  }

  // Copies layout `name` and opens the copy.
  async function duplicateLayout(name: string | null): Promise<void> {
    if (name === null) return
    if (!await leaveLayoutEditor()) return
    let copy = ''
    if (!await runLayoutAction(async () => { copy = await deckIpc.duplicateLayout(await persistedSource(), name) })) return
    await refreshLayouts(copy)
    setStatusMessage({ kind: 'layout-created', layout: copy })
  }

  // Pins the slide open in the slides screen to layout `name`, through the same Undo-able path as the context menu's
  // Change Layout — after the same fit check, so a layout the slide doesn't
  // fit is refused with peitho-core's reason instead of a build error.
  async function applyLayout(name: string | null): Promise<void> {
    const index = editor.selectedIndex()
    if (name === null || index === null) return
    await runLayoutAction(async () => {
      let verdicts: LayoutVerdict[] | null = null
      try {
        verdicts = await deckIpc.checkSlideLayouts(liveSource(), index)
      } catch {
        // Unavailable: `commitChange` renders before it saves anyway.
      }
      const availability = availabilityOf(settledFitCheck(verdicts), name)
      if (availability.kind === 'mismatch') throw new Error(settings.messages().layoutMismatch(name, availability.reason))
      const change = await changeSlideLayout(index, name)
      switch (change) {
        case 'done':
          setStatusMessage({ kind: 'layout-applied', layout: name })
          return
        case 'unchanged':
          layouts.setNotice(settings.messages().layoutAlreadyApplied(name))
          return
        case 'failed':
          // `commitChange` has put peitho-core's reason in the error bar.
          throw new Error(errorMessage() ?? settings.messages().deckChangeFailed)
        case 'rejected':
          throw new Error(settings.messages().deckChangeFailed)
        default: {
          const _exhaustive: never = change
          throw new Error(`Unhandled slide change: ${String(_exhaustive)}`)
        }
      }
    })
  }

  function startLayoutDelete(name: string | null): void {
    if (name === null) return
    layouts.setNotice(null)
    layouts.beginDelete(name, layoutNames(), slidesByLayout().get(name) ?? [])
  }

  // The layout list's right-click menu: on a row, it acts on that layout
  // (not necessarily the one shown); on empty space, it offers New Layout.
  // With a slide open in the slides screen, Apply waits on the same fit
  // check as the slide menu's Change Layout.
  function openLayoutMenu(name: string | null, event: MouseEvent): void {
    event.preventDefault()
    if (name === null) {
      layouts.openMenuOnList(event.clientX, event.clientY)
      return
    }
    const index = editor.selectedIndex()
    checkLayoutMenuFit(layouts.openMenuOnLayout(name, event.clientX, event.clientY, index !== null), index)
  }

  // A right-click on the selected layout's large preview: the layout menu,
  // headed by a comment on what was right-clicked — the slot, as a
  // left-click there (`clickSelectedPreview`) — then the layout's own
  // Apply, Duplicate and Delete.
  function openSelectedPreviewMenu(event: MouseEvent): void {
    event.preventDefault()
    const name = layouts.selectedLayout()
    if (name === null) return
    const slot = layoutThumbnailContextClickOf(event)?.slot ?? null
    const index = editor.selectedIndex()
    checkLayoutMenuFit(layouts.openMenuOnPreview(name, slot, event.clientX, event.clientY, index !== null), index)
  }

  // Settles the layout menu's fit check (`requestId`, `null` for none) for
  // the slide at `index`.
  function checkLayoutMenuFit(requestId: number | null, index: number | null): void {
    if (requestId === null || index === null) return
    deckIpc.checkSlideLayouts(liveSource(), index)
      .then(verdicts => { layouts.settleMenuFit(requestId, verdicts) })
      .catch(() => { layouts.settleMenuFit(requestId, null) })
  }

  const layoutMenuEntries = createMemo<ContextMenuEntry[]>(() => {
    const messages = settings.messages()
    const context = { hasSlide: editor.selectedIndex() !== null, layoutCount: layoutNames().length, busy: layouts.busy() }
    const items = layoutMenuItems(layouts.menu(), context)
    const actions = items.map(item => item.action)
    return items.map((item, index) => ({
      action: item.action,
      label: layoutMenuLabel(item.action, messages),
      enabled: item.enabled,
      title: layoutMenuTitle(item.reason, messages),
      danger: item.action === 'delete',
      icon: menuItemIcon(item.action),
      separatorBefore: setApartFromComment(actions, index),
    }))
  })

  function runLayoutMenuAction(action: LayoutMenuAction): void {
    const menu = layouts.menu()
    const name = layoutMenuTarget(menu)
    const slot = layoutMenuSlot(menu)
    const at = layoutMenuPosition(menu)
    layouts.closeMenu()
    switch (action) {
      case 'new-layout':
        layouts.openNewLayout()
        focusNewLayoutName()
        return
      case 'apply':
        void applyLayout(name)
        return
      case 'edit':
        if (name !== null) void selectLayout(name)
        return
      case 'duplicate':
        void duplicateLayout(name)
        return
      case 'delete':
        startLayoutDelete(name)
        focusDeleteLayoutDialog()
        return
      // On what the menu was open on: every layout (empty space), the
      // layout (a row), or the slot right-clicked (the large preview).
      case 'comment':
        if (menu.kind === 'on-list') openLayoutCommentBox({ kind: 'all-layouts' }, at)
        else if (menu.kind === 'on-layout') openLayoutCommentBox({ kind: 'layout', name: menu.name }, at)
        else if (menu.kind === 'on-preview') openLayoutCommentBox(layoutClickTarget(menu.name, slot), at)
        return
      default: {
        const _exhaustive: never = action
        return _exhaustive
      }
    }
  }

  // Keeps the PC / Phone switch's shape menu on-screen: it opens rightwards
  // from the switch, which on the layout screen can sit near the window's
  // right edge (the list narrowed, the comments column closed).
  createEffect(() => {
    if (ui.phoneShapeMenuOpen()) keepShownPopupsInWindow('[data-phone-shape-menu]')
  })

  // Keeps the layout menu on-screen, as the slide menu's effect above does.
  let layoutMenuEl: HTMLElement | undefined
  createEffect(() => {
    if (layouts.menu().kind === 'closed') return
    requestAnimationFrame(() => {
      const menu = layouts.menu()
      if (!layoutMenuEl || menu.kind === 'closed') return
      const rect = layoutMenuEl.getBoundingClientRect()
      const at = clampMenuPosition(
        { x: menu.x, y: menu.y },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
        8,
      )
      if (at.x !== menu.x || at.y !== menu.y) layouts.moveMenu(at)
    })
  })

  // Deletes the layout the delete flow is about: checks first that the deck
  // still builds with its slides moved and without the layout, then moves
  // them and deletes the files. The move is part of the deletion, which
  // can't be undone (like adding the image layout), so it records no undo
  // step: undoing it would pin the slides back to a layout whose file is
  // gone — a render that fails on every press. An older step that would do
  // the same makes the whole history stale, so it is forgotten.
  //
  // The check, the move, the file deletion and moving the slides back run
  // as one unit behind earlier operations (`serialized`): an Undo pressed
  // meanwhile waits until it's over, so it can neither be overwritten by
  // the move back nor shift the slides the move back addresses by position.
  async function confirmLayoutDelete(): Promise<void> {
    const flow = layouts.confirmDeleteFlow()
    if (flow === null || flow.kind !== 'deleting') return
    const { name, slides, replacement } = flow
    let historyCleared = false
    const ok = await runLayoutAction(async () => {
      await persistedSource()
      historyCleared = await serialized(() => deleteLayoutNow(name, slides, replacement))
    })
    layouts.finishDelete()
    if (!ok) return
    await refreshLayouts(null)
    setStatusMessage({ kind: historyCleared ? 'layout-deleted-history-cleared' : 'layout-deleted', layout: name })
  }

  // `confirmLayoutDelete`'s unit under the queue, on the saved deck: a
  // draft typed since the flush would be checked but not be on disk, so it
  // refuses instead. Resolves whether the undo history was forgotten.
  async function deleteLayoutNow(name: string, slides: readonly number[], replacement: string | null): Promise<boolean> {
    if (editor.isDirty()) throw new Error(settings.messages().layoutDeckUnsaved)
    const texts = currentSlideTexts()
    const original = rebuildSource(texts)
    const step = replacement === null || slides.length === 0 ? null : layoutPinsStepFor(slides, replacement)
    const repinned = step === null ? original : rebuildSource(applyLayoutPinsStep(texts, step))
    await deckIpc.checkLayoutRemoval(original, repinned, name)
    const moveBack = step === null ? null : await commitLayoutPins(step)
    try {
      await deckIpc.deleteLayout(rebuildSource(currentSlideTexts()), name)
    } catch (err) {
      // The layout stays, so its slides go back to it: the deletion as a
      // whole didn't happen. The refusal is what's shown, not this.
      if (moveBack !== null) await commitLayoutPins(moveBack).catch(() => null)
      throw err
    }
    if (!historyPinsLayout(history.history(), name)) return false
    history.clear()
    return true
  }

  // One autosave round (`queueLayoutSave`): every tab with a draft to save
  // (`autosavePaths`), one after another. Never rejects: a refusal is its
  // tab's error. Once written, the files' fingerprint is taken as seen —
  // the watcher's report of this write changes nothing — and the list and
  // the slides are drawn again from the saved files, without reading them
  // back into the editor, which already holds them (and keeps its cursor,
  // focus and undo history).
  async function saveOpenFiles(): Promise<void> {
    for (const path of autosavePaths(layouts.tabs())) await saveOpenFile(path)
  }
  async function saveOpenFile(path: string): Promise<void> {
    const file = layouts.fileOf(path)
    if (file?.kind !== 'ready' || !shouldAutosave(file)) return
    const text = file.draft
    layouts.fileSaving(path)
    let stamp: string
    try {
      // `saved` goes along: a file the agent wrote meanwhile — even during
      // this save's own build check — is refused rather than overwritten.
      stamp = await deckIpc.saveDeckFile(await persistedSource(), path, text, file.saved)
    } catch (err) {
      const message = String(err)
      if (isFileChangedOnDisk(message)) {
        layouts.fileSaveInterrupted(path)
        await pullOpenFiles()
        // Only the layout's other file may have changed (the save checks
        // the pair): this one read back as it was, so its draft is still
        // to save — tried again rather than left waiting for a keystroke.
        const after = layouts.fileOf(path)
        if (after !== undefined && shouldAutosave(after)) scheduleLayoutAutosave()
        return
      }
      layouts.fileSaveFailed(path, message, text)
      return
    }
    if (typeof stamp === 'string') takeLayoutStamp(stamp)
    layouts.fileSaved(path, text)
    const layout = layoutOfFile(path, layoutNames())
    setStatusMessage(layout === null ? { kind: 'file-saved', path } : { kind: 'layout-saved', layout })
    void reloadLayoutPreviews().then(showSavedLayoutPreview)
    void renderPreview(liveSource())
    void refreshDeckFiles()
  }

  // Once fresh previews are in and nothing was typed since, the selected
  // layout's preview draws its saved files again rather than the last draft
  // render — which a later change to another file (the deck's base CSS)
  // would leave stale.
  function showSavedLayoutPreview(): void {
    if (!layouts.editorDirty()) resetDraftPreview()
  }

  const deleteView = createMemo<LayoutDeleteView>(() => layouts.deleteFlow().kind)
  const deleteText = createMemo(() => {
    const flow = layouts.deleteFlow()
    if (flow.kind === 'idle') return ''
    const messages = settings.messages()
    const label = layoutDisplayName(flow.name, settings.language())
    return flow.kind === 'confirming' || flow.slides.length === 0
      ? messages.deleteLayoutConfirm(label)
      : messages.deleteLayoutMoveSlides(label, flow.slides.length)
  })
  const deleteChoices = createMemo(() =>
    replacementChoices(layouts.deleteFlow(), layoutNames()).map(name => ({ name, label: layoutDisplayName(name, settings.language()) })))
  const deleteReplacement = createMemo(() => {
    const flow = layouts.deleteFlow()
    return flow.kind === 'choosing-replacement' || flow.kind === 'deleting' ? flow.replacement ?? '' : ''
  })
  const layoutEditorMessage = createMemo(() => {
    const shown = layouts.activeFile()
    if (shown?.kind === 'unavailable') return shown.message
    if (shown?.kind === 'ready') return shown.error ?? ''
    return ''
  })
  const layoutEditorSaving = createMemo(() => {
    const shown = layouts.activeFile()
    return shown?.kind === 'ready' && shown.saving
  })
  const layoutEditorShownDirty = createMemo(() => {
    const shown = layouts.activeFile()
    return shown !== undefined && isFileDirty(shown)
  })
  // The editor's tabs, the tree's rows and which open files hold typing,
  // as the screen shows them.
  const layoutTabViews = createMemo(() => layouts.tabs().tabs.map(tab => ({ path: tab.path, name: fileName(tab.path) })))
  const layoutOpenPaths = createMemo(() => layouts.tabs().tabs.map(tab => tab.path))
  const layoutDirtyPaths = createMemo(() => layouts.tabs().tabs.filter(isFileDirty).map(tab => tab.path))
  const fileTreeRowsShown = createMemo(() => fileTreeRows(layouts.files(), layouts.collapsedFolders()))
  const collapsedFolderList = createMemo(() => [...layouts.collapsedFolders()])
  const layoutEditorName = createMemo(() => {
    const path = layouts.activePath()
    return path !== null && fileLanguage(path) === 'css' ? 'layout-css' : 'layout-html'
  })
  const selectedLayoutRow = createMemo(() => layoutRowsShown().find(row => row.name === layouts.selectedLayout()) ?? null)

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
  // actual current keys instead. The new slide also always names a layout
  // when there's one to name (`newSlideConfig`): the previous slide's own
  // `"layout"`, or else the one its last successful render was built on,
  // found by its key (or position, while that still pairs up — see
  // `lastRenderedLayoutOf`), since the deck may have changed since.
  async function addSlide(index: number): Promise<void> {
    const texts = currentSlideTexts()
    const insertAt = Math.min(index + 1, texts.length)
    const key = uniqueSlideKey(slugifyTitle('New Slide'), existingSlideKeys())
    const { config: previousConfig } = extractPageComment(texts[index] ?? '')
    const previousLayout = lastRenderedLayoutOf(previousConfig.key, index, texts.length, slideEntries(), render.slideLayouts())
    const config = newSlideConfig(previousConfig, key, previousLayout, render.headingLayouts())
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
  // Resolves how the change ended: `unchanged` when the slide already had
  // every field as `updates` asks, so nothing ran.
  async function updateSlideConfig(index: number, updates: Partial<PageConfig>): Promise<SlideChange> {
    const slideText = currentSlideText(index)
    if (updatePageComment(slideText, updates) === slideText) return 'unchanged'
    // Recorded as a field patch, not a whole-text replace, so undoing it
    // later keeps text typed into the slide in between.
    return perform({ kind: 'config', index, patch: updates })
  }

  async function changeSlideLayout(index: number, layout: string): Promise<SlideChange> {
    const from = slideConfigOf(index).layout
    if (from?.startsWith('studio-canvas-') && from !== layout && !layout.startsWith('studio-canvas-')) {
      if (previewImageBusy()) return 'unchanged'
      const before = currentSlideText(index)
      const epoch = slidePositionsEpoch
      setPreviewImageBusy(true)
      try {
        const canvas = await imageIpc.createImageCanvas(syncedSource(currentSlideTexts()), layout, 0, [], [], from)
        if (slidePositionsEpoch !== epoch || currentSlideText(index) !== before) return 'unchanged'
        return await updateSlideConfig(index, { layout: canvas.layout })
      } catch (err) { setErrorMessage(String(err)); return 'unchanged' }
      finally { setPreviewImageBusy(false) }
    }
    return updateSlideConfig(index, { layout })
  }

  async function toggleSlideDraft(index: number): Promise<void> {
    await updateSlideConfig(index, { draft: slideConfigOf(index).draft !== true })
  }

  async function toggleSlideSkip(index: number): Promise<void> {
    await updateSlideConfig(index, { skip: slideConfigOf(index).skip !== true })
  }

  // `page_number` is only ever `false` or absent: peitho-core refuses
  // `true`, so showing the number again removes the field.
  async function toggleSlidePageNumber(index: number): Promise<void> {
    await updateSlideConfig(index, { page_number: slideConfigOf(index).page_number === false ? undefined : false })
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
        forgetSlidePositions()
        editor.setFullSource(source)
        editor.setSlideRanges(ranges)
        const i = editor.selectedIndex()
        if (i !== null && i < ranges.length) {
          const { rest: withoutNote, note } = extractNote(ranges[i].text)
          const { rest, config } = extractPageComment(withoutNote)
          editor.setEditorSession(session => withRefreshedSaved(session, { body: rest, note, config }))
        }
        syncSourceEditorFromDisk(source)
        await renderPreview(source, { persisted: true })
        setStatusMessage({ kind: 'merged-external-change' })
        return
      }
    }
    await refreshSource(true)
    syncSourceEditorFromDisk(editor.fullSource())
    await renderPreview(editor.fullSource(), { persisted: true })
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
  async function changeVimMode(on: boolean): Promise<boolean> {
    try {
      settings.applyChanged(await settingsIpc.updateSettings({ vimMode: on }))
      return true
    } catch (err) {
      setErrorMessage(settings.messages().vimModeSaveFailed(String(err)))
      return false
    }
  }

  onMount(() => {
    void refreshRecentDecks()
    const blockInputDuringUpdate = (event: Event) => {
      if (updateBlocksEditing(updateStatus())) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    const updateInputEvents = ['keydown', 'beforeinput', 'paste', 'drop']
    for (const event of updateInputEvents) window.addEventListener(event, blockInputDuringUpdate, true)
    onCleanup(() => { for (const event of updateInputEvents) window.removeEventListener(event, blockInputDuringUpdate, true) })
    const unlistenUpdates = updateIpc.onChanged(applyUpdateStatus)
    const unlistenUpdateExit = updateIpc.onBeforeExit(token => {
      void (async () => {
        let saved = false
        try {
          saved = await flushDeck() && await flushLayoutEditor()
        } finally {
          await updateIpc.acknowledgeSave(token, saved).catch(() => {})
        }
      })()
    })
    void updateIpc.getStatus().then(status => { if (!heardUpdate) setUpdateStatus(status) }).catch(() => {})
    onCleanup(() => { unlistenUpdates(); unlistenUpdateExit() })
    void loadSettings()
    void loadSystemLocales()

    // A window spawned by `open_deck_window_impl` (native "Open Deck…"/
    // "Open Recent", or the deck header's variant switcher) has a deck
    // waiting for it in Rust-side `PendingDecks` — that takes priority
    // over the dev-convenience env var, which only matters for a window
    // with nothing else assigned to it.
    void (async () => {
      const pending = await deckIpc.takePendingDeck()
      if (pending) {
        await dispatch({ type: 'open-requested', path: pending })
        // `main` (the app's own launch/welcome window) can now also
        // receive a `pending` path directly — Finder's first double-click
        // since launch reuses it instead of opening a redundant second
        // window (see `finder_open_target` in peitho.rs) — and unlike a
        // `deck-N` window spawned solely to show one pending deck, `main`
        // isn't disposable: closing it on a bad path (a moved/deleted
        // file) would leave the app with no window and no visible error
        // at all, which `todo/finder-file-association.md`'s acceptance
        // criteria rule out.
        if (deck.deckLifecycle().kind !== 'open' && getCurrentWindow().label !== 'main') {
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

    // The deck's layout files changed on disk (the agent at work, or
    // Studio's own save, which `syncLayoutFiles` tells apart).
    const unlistenLayoutFiles = deckIpc.onLayoutFilesChanged(() => {
      void syncLayoutFiles().then(changed => { if (changed) noteAgentActivity() })
    })
    // A close asked for the layout draft to be saved first.
    const unlistenLayoutClose = deckIpc.onLayoutFlushBeforeClose(() => { void closeAfterLayoutFlush() })

    const unlistenFileChanged = deckIpc.onDeckFileChanged(() => {
      // An agent editing the deck is an agent at work.
      noteAgentActivity()
      void handleExternalChange()
    })

    // Native "File > New Deck…" (see `build_menu` in lib.rs) still needs
    // this app's own name-entry modal, so it round-trips through here.
    // "Open Deck…"/"Open Recent" are handled entirely Rust-side now (a
    // native folder-picker dialog + `open_deck_window_impl`), since neither
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
    // `src-tauri/src/edit_menu.rs`): a focused plain text field (a section
    // header's name) gets its own text undo; anything else, the body and
    // notes editors included, walks the timeline. That waits while the
    // settings panel or the phone shape menu is open, like every other
    // shortcut in `onKeyDown` — except that WebKit keeps focus in the body
    // through the clicks that open the phone shape menu, and undoing the
    // typing there must still work: the focused editor undoes on its own,
    // as vim's `u` would.
    const onMenuHistory = (direction: 'undo' | 'redo') => {
      if (replayFocusedFieldHistory(direction)) return
      // The layout editors' typing isn't on the timeline, nor is the
      // whole-deck source editor's: it undoes there.
      if (isFocusWithin('[data-layout-editor-host]') || isFocusWithin('[data-editor="source"]')) {
        replayFocusedCodeEditorHistory(direction)
        return
      }
      if (settings.panelOpen()) return
      if (ui.phoneShapeMenuOpen()) {
        replayFocusedCodeEditorHistory(direction)
        return
      }
      void replayHistory(direction)
    }
    const unlistenFileDrop = imageIpc.onFileDrop(drop => { void dropFiles(drop) })
    // Whatever crit reports — the agent's next round, a reply, the round
    // reaching the agent, the session ending — is read back whole.
    const unlistenReview = critIpc.onReviewEvent(() => {
      noteAgentActivity()
      void refreshReview()
      void syncLayoutFiles()
    })
    const unlistenMenuUndo = deckIpc.onMenuUndo(() => { onMenuHistory('undo') })
    const unlistenMenuRedo = deckIpc.onMenuRedo(() => { onMenuHistory('redo') })

    // Edit menu's deck settings (see `setDeckSetting`), sent to the focused
    // window only. The items are disabled while no deck is open, but a pick
    // that still arrives then is dropped.
    const unlistenMenuDeckSetting = deckIpc.onMenuDeckSetting(payload => {
      if (deck.deckPath() === null) return
      void setDeckSetting(payload)
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (updateBlocksEditing(updateStatus())) { event.preventDefault(); return }
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
      // The layout screen's modals: Escape cancels, as their Cancel button
      // does (not while a delete runs).
      if (event.key === 'Escape' && ui.studioMode() === 'layouts' && layouts.newLayoutOpen()) {
        event.preventDefault()
        layouts.closeNewLayout()
        return
      }
      if (event.key === 'Escape' && ui.studioMode() === 'layouts' && (layouts.deleteFlow().kind === 'confirming' || layouts.deleteFlow().kind === 'choosing-replacement')) {
        event.preventDefault()
        layouts.cancelDeleteFlow()
        return
      }
      // Like the slide menu just below: also when focus stayed in an editor
      // through the right-click (see vim-mode.e2e.ts).
      if (event.key === 'Escape' && layouts.menu().kind !== 'closed') {
        event.preventDefault()
        layouts.closeMenu()
        return
      }
      if (event.key === 'Escape' && ui.contextMenu().kind !== 'closed') {
        event.preventDefault()
        ui.closeContextMenu()
        return
      }
      if (isTypingInField()) return
      if (document.activeElement?.closest('[data-panel="preview"]')) return
      // The slide shortcuts (arrows, Delete, Cmd+X/C/V…) would act on slides
      // out of sight while the layout screen shows.
      if (ui.studioMode() === 'layouts') return
      // Cmd+Z / Cmd+Shift+Z aren't handled here: left alone, they reach the
      // Edit menu's Undo/Redo accelerators, the one path for both keyboard
      // and mouse (see `onMenuHistory` above).
      const key = event.key.toLowerCase()
      if ((['Delete', 'Backspace'].includes(event.key) || (event.metaKey || event.ctrlKey) && ['x', 'c', 'v'].includes(key)) && !document.activeElement?.closest('[data-panel="slides"]')) return
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
    // Escape closes an open right-click menu before anything under it hears
    // the key: an editor keeps focus through the right-click, and vim would
    // take the Escape too (leaving insert or visual mode).
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (ui.commentMenu().kind === 'closed' && layouts.menu().kind === 'closed' && ui.contextMenu().kind === 'closed') return
      event.preventDefault()
      event.stopPropagation()
      ui.closeCommentMenu()
      layouts.closeMenu()
      ui.closeContextMenu()
    }
    window.addEventListener('keydown', onKeyDownCapture, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', closeSectionEditorOnOutsidePress, true)
    const unsuppressNativeContextMenu = suppressNativeContextMenu()

    onCleanup(() => {
      unsuppressNativeContextMenu()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', onKeyDownCapture, true)
      window.removeEventListener('mousedown', closeSectionEditorOnOutsidePress, true)
      unlistenFileChanged()
      unlistenLayoutFiles()
      unlistenLayoutClose()
      unlistenMenuNew()
      unlistenMenuSettings()
      unlistenSettingsChanged()
      unlistenClipboard()
      unlistenFileDrop()
      unlistenReview()
      unlistenMenuUndo()
      unlistenMenuRedo()
      unlistenMenuDeckSetting()
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
        studioMode={ui.studioMode()}
        onStudioMode={setStudioMode}
      />

      <ScriptTrustBanner
        language={settings.language()}
        shown={trustBannerShown(scriptTrust())}
        pending={scriptTrust().kind === 'trusting'}
        onTrust={() => void trustDeckScripts()}
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
        {/* The slides screen: its four panels, hidden (not unmounted) while
            the layout screen shows, so the editors keep their state. */}
        <div data-slides-screen className={ui.studioMode() === 'slides' ? 'contents' : 'hidden'}>
        <div data-panel-rail="" className="panel-rail" hidden={ui.slidesOpen() && ui.editorOpen() && ui.previewOpen() && (ui.reviewOpen() || !render.assetBaseUrl())}>
          <PanelToggle panel="slides" language={settings.language()} hidden={ui.slidesOpen()} open={false} onToggle={() => ui.setSlidesOpen(true)} />
          <PanelToggle panel="editor" language={settings.language()} hidden={ui.editorOpen()} open={false} onToggle={() => ui.setEditorOpen(true)} />
          <PanelToggle panel="preview" language={settings.language()} hidden={ui.previewOpen()} open={false} onToggle={() => ui.setPreviewOpen(true)} />
          <PanelToggle panel="review" language={settings.language()} hidden={ui.reviewOpen() || !render.assetBaseUrl()} open={false} onToggle={() => ui.setReviewOpen(true)} />
        </div>
        <div data-panel="slides" hidden={!ui.slidesOpen()} className="studio-panel">
          <PanelToggle panel="slides" language={settings.language()} open={true} onToggle={() => { ui.closeContextMenu(); ui.setSlidesOpen(!ui.slidesOpen()) }} />
          <div id="panel-slides" className={ui.slidesOpen() ? 'panel-content' : 'hidden'}>
            <SlideList
              language={settings.language()}
              deckOpen={deck.deckPath() !== null}
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
              commentCountOf={review.commentCountOf}
              onContextMenu={openContextMenu}
              onDragStart={startSlideDrag}
              onSelectSlide={index => selectSlide(index)}
              onSectionNameInput={onSectionNameInput}
              onSectionTimeInput={onSectionTimeInput}
              onCommitSectionEdit={closeSectionEditor}
            />
          </div>
        </div>

        <div
          hidden={!ui.slidesOpen()}
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startColumnResize(ui.slideListWidth, ui.setSlideListWidth, 1)}
        />

        <div data-panel="editor" hidden={!ui.editorOpen()} className="studio-panel" style={ui.editorOpen() && !ui.previewOpen() ? 'flex: 1; min-width: 0' : ''}>
          <PanelToggle panel="editor" language={settings.language()} open={true} onToggle={() => ui.setEditorOpen(!ui.editorOpen())} />
          <div id="panel-editor"
            className={ui.editorOpen() ? 'panel-content border-r border-border' : 'hidden'}
            style={ui.previewOpen() ? `width: ${ui.editorWidth()}px` : 'width: 100%'}
          >
            <SlideEditor
              language={settings.language()}
              hasSelection={editor.selectedRange() !== null}
              onBodyHost={onBodyEditorHost}
              onNoteHost={onNoteEditorHost}
              sourceOffered={sourceEditorOffered(editor.sourceEditing(), render.outcome().kind === 'failed')}
              sourceOpen={editor.sourceOpen()}
              onToggleSource={toggleSourceEditor}
              onSourceHost={onSourceEditorHost}
            />
          </div>
        </div>

        <div
          hidden={!ui.editorOpen() || !ui.previewOpen()}
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startColumnResize(ui.editorWidth, ui.setEditorWidth, 1)}
        />

        <div data-panel="preview" hidden={!ui.previewOpen()} className="studio-panel preview-panel">
          <PanelToggle panel="preview" language={settings.language()} open={true} onToggle={() => { ui.closePhoneShapeMenu(); review.closeBox(); ui.setPreviewOpen(!ui.previewOpen()) }} />
          <div id="panel-preview" className={ui.previewOpen() ? 'panel-content' : 'hidden'}>
            <SlidePreview
              language={settings.language()}
              selectedSlideKey={selectedSlideKey()}
              hasDeck={Boolean(render.assetBaseUrl())}
              buildError={buildError()}
              buildErrorScope={buildErrorScope()}
              canvasFragmentOf={render.previewFragmentOf}
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
              deviceWidth={previewDeviceWidth()}
              scaleLabel={previewScaleLabel()}
              onPreviewHost={el => observeInnerSize(el, ui.setPreviewArea)}
              pins={placedPins()}
              onCommentClick={openCommentBox}
              onCommentMenu={openSlidePreviewMenu}
              onPinClick={showPinnedThread}
              onTextEdit={startSlideTextEdit}
              onAddImages={(files, slot) => { void addImagesToPreview(files, slot) }}
              onImagePosition={positionPreviewImage}
              imageBusy={previewImageBusy()}
              onPasteElement={tryPasteElement}
              onPasteShortcut={gesture => { void pasteElementShortcut(gesture) }}
              onTextAction={(target, action) => { void runElementAction(action, { hit: { ...target, kind: target.heading ? 'heading' : 'paragraph' }, textSlot: target.slot, pin: null, at: { x: 0, y: 0 } }) }}
              onImageClipboard={(slot, action) => { void runElementAction(action, { hit: null, pin: null, at: { x: 0, y: 0 }, image: { slot, order: [] } }) }}
              onRemoveImage={slot => { void removePreviewImage(slot) }}
            />
          </div>
        </div>

        </div>
        {/* The layout screen's rail, leftmost like the slides screen's: a
            folded column's icon reopens it, the comments column's too. */}
        <div data-layout-panel-rail="" className="panel-rail" hidden={ui.studioMode() !== 'layouts' || !layoutRailShown(layoutColumns())}>
          <PanelToggle panel="files" language={settings.language()} hidden={ui.layoutFilesOpen()} open={false} onToggle={() => ui.setLayoutFilesOpen(true)} />
          <PanelToggle panel="layout-editor" language={settings.language()} hidden={ui.layoutEditorOpen()} open={false} onToggle={() => ui.setLayoutEditorOpen(true)} />
          <PanelToggle panel="layouts" language={settings.language()} hidden={ui.layoutListOpen()} open={false} onToggle={() => ui.setLayoutListOpen(true)} />
          <PanelToggle panel="review" language={settings.language()} hidden={ui.reviewOpen() || !render.assetBaseUrl()} open={false} onToggle={() => ui.setReviewOpen(true)} />
        </div>
        <LayoutScreen
          language={settings.language()}
          hidden={ui.studioMode() !== 'layouts'}
          filesOpen={ui.layoutFilesOpen()}
          editorOpen={ui.layoutEditorOpen()}
          listOpen={ui.layoutListOpen()}
          filling={layoutFilling()}
          onCloseFiles={() => ui.setLayoutFilesOpen(false)}
          onCloseEditor={() => ui.setLayoutEditorOpen(false)}
          onCloseList={() => { ui.closePhoneShapeMenu(); layouts.closeMenu(); ui.setLayoutListOpen(false) }}
          treeRows={fileTreeRowsShown()}
          collapsedFolders={collapsedFolderList()}
          treeWidth={layouts.treeWidth()}
          onTreeResize={startColumnResize(layouts.treeWidth, layouts.setTreeWidth, 1)}
          onTreeRowClick={clickTreeRow}
          tabs={layoutTabViews()}
          activePath={layouts.activePath()}
          openPaths={layoutOpenPaths()}
          dirtyPaths={layoutDirtyPaths()}
          onShowTab={showLayoutTab}
          onCloseTab={path => void closeLayoutTab(path)}
          editorName={layoutEditorName()}
          onEditorHost={el => { layoutEditor = createLayoutCodeEditor(el) }}
          editorReady={layouts.activeFile()?.kind === 'ready'}
          editorMessage={layoutEditorMessage()}
          editorDirty={layoutEditorShownDirty()}
          editorSaving={layoutEditorSaving()}
          editorConflict={layouts.editorConflict()}
          onLoadExternal={() => void loadExternalLayout()}
          onKeepDraft={keepLayoutDraft}
          rows={layoutRowsShown()}
          selectedName={layouts.selectedLayout()}
          selectedLabel={selectedLayoutRow()?.label ?? ''}
          selectedEnglishName={selectedLayoutRow()?.englishName ?? ''}
          selectedUsage={selectedLayoutRow()?.usage ?? 0}
          selectedPreviewStyle={selectedPreviewStyle()}
          onSelectedPreviewHost={onSelectedPreviewHost}
          onSelectedPreviewClick={clickSelectedPreview}
          onRowClick={name => void selectLayout(name)}
          onRowPress={noteLayoutRowPress}
          onContextMenu={openLayoutMenu}
          onSelectedPreviewMenu={openSelectedPreviewMenu}
          onThumbnailHost={mountLayoutThumbnail}
          canvasOf={layoutCanvasOf}
          onListBodyHost={el => observeInnerSize(el, layouts.setThumbnailRoom)}
          previewError={draftPreviewError(layouts.draftPreview(), layouts.selectedLayout())}
          listWidth={layouts.listWidth()}
          onListResize={startColumnResize(layouts.listWidth, layouts.setListWidth, -1)}
          viewportMode={ui.viewportMode()}
          onToggleViewportMode={ui.toggleViewportMode}
          phoneShape={ui.phoneShape()}
          phoneShapeMenuOpen={ui.phoneShapeMenuOpen()}
          onTogglePhoneShapeMenu={ui.togglePhoneShapeMenu}
          onClosePhoneShapeMenu={ui.closePhoneShapeMenu}
          onSelectPhoneShape={ui.selectPhoneShape}
          busy={layouts.busy()}
          notice={layouts.notice()}
          newLayoutOpen={layouts.newLayoutOpen()}
          newLayoutName={layouts.newLayoutName()}
          newLayoutTemplate={layouts.newLayoutTemplate()}
          newLayoutProblem={newLayoutProblem()}
          onNewLayoutName={layouts.setNewLayoutName}
          onNewLayoutTemplate={layouts.setNewLayoutTemplate}
          onCreateLayout={() => void createLayout()}
          onCancelNewLayout={layouts.closeNewLayout}
          deleteView={deleteView()}
          deleteText={deleteText()}
          replacementChoices={deleteChoices()}
          replacement={deleteReplacement()}
          canConfirmDelete={canConfirmDelete(layouts.deleteFlow())}
          onPickReplacement={name => layouts.chooseReplacement(name, layoutNames())}
          onConfirmDelete={() => void confirmLayoutDelete()}
          onCancelDelete={layouts.cancelDeleteFlow}
        />
        {/* The comments column, rightmost: a fourth column rather than a
            strip under the preview, so the threads get the window's full
            height. Hidden with the panel until a deck is open. Shared by
            both screens — one column, one open/closed state, the same
            threads — and outside both, so the layout screen has it too
            (groundwork for todo/archive/layout-review-comments.md). While the layout
            screen shows, its own rail holds the toggle to reopen it. */}
        <div
          hidden={!render.assetBaseUrl() || !ui.reviewOpen()}
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startColumnResize(ui.reviewPanelWidth, ui.setReviewPanelWidth, -1)}
        />

        <div hidden={!render.assetBaseUrl() || !ui.reviewOpen()} data-panel="review" className="studio-panel" style={reviewFillsRow() ? 'flex: 1; min-width: 0' : ''}>
          <PanelToggle panel="review" language={settings.language()} open={true} onToggle={() => ui.setReviewOpen(!ui.reviewOpen())} />
          <div id="panel-review"
            className={ui.reviewOpen() ? 'panel-content border-l border-border' : 'hidden'}
            style={reviewFillsRow() ? 'width: 100%' : `width: ${ui.reviewPanelWidth()}px`}
          >
            <ReviewPanel
              language={settings.language()}
              shown={Boolean(render.assetBaseUrl())}
              status={reviewStatus()}
              canSend={review.availability().kind === 'ready'}
              sending={review.busy() === 'sending'}
              sendCount={review.sendCount()}
              working={agentWorking()}
              onReconnect={review.forgetAgent}
              error={review.error()}
              rows={reviewPanelRows()}
              resolvedCount={reviewResolvedCount()}
              showResolved={review.showResolved()}
              resolvedToggleLabel={review.showResolved() ? settings.messages().hideResolved : settings.messages().showResolved(reviewResolvedCount())}
              onToggleResolved={review.toggleShowResolved}
              onSelectSlide={index => void selectSlideFromReview(index)}
              onSelectLayout={target => void selectLayoutFromReview(target)}
              highlightedThread={highlightedThread()}
              replyText={review.replyDraft()?.text ?? ''}
              onSend={() => void sendReview()}
              onDiscard={review.discard}
              editText={review.unsentEdit()?.text ?? ''}
              onStartEdit={id => {
                review.startEdit(id)
                focusUnsentEdit()
              }}
              onEditInput={review.setEditText}
              onEditSave={review.commitEdit}
              onEditCancel={review.cancelEdit}
              onStartReply={commentId => review.editReply(commentId, '')}
              onReplyInput={review.setReplyText}
              onReplyAdd={review.commitReply}
              onReplyCancel={review.cancelReply}
              onResolve={id => void resolveReviewComment(id)}
              connectShown={connectShown()}
              connectPrompt={connectPrompt()}
              connectCommand={connectCommand()}
              copied={connectCopied()}
              onCopyPrompt={() => void copyConnectText('prompt')}
              onCopyCommand={() => void copyConnectText('command')}
            />
          </div>
        </div>
      </div>
      )}

      <StatusBar
        language={settings.language()}
        errorMessage={shownErrorMessage()}
        errorMessageCopied={errorMessageCopied()}
        imageSlotFix={shownFix().kind}
        imageLayoutAdding={ui.imageLayoutAdding()}
        statusMessage={statusText(settings.messages(), statusMessage())}
        onCopyErrorMessage={() => void copyErrorMessage()}
        onImageSlotFix={applyImageSlotFix}
      />

      <CommentBox
        language={settings.language()}
        open={review.box().kind !== 'closed'}
        label={commentBoxLabel()}
        draft={review.boxDraft()}
        left={commentBoxAt().x}
        top={commentBoxAt().y}
        onDraftInput={review.setBoxDraft}
        onCancel={review.closeBox}
        onAdd={addComment}
      />

      <ContextMenu
        name="comment"
        hidden={ui.commentMenu().kind === 'closed'}
        position={commentMenuPosition(ui.commentMenu())}
        items={commentMenuEntries()}
        onMenuRef={el => { commentMenuEl = el }}
        onClose={ui.closeCommentMenu}
        onAction={action => runCommentMenuAction(action as CommentMenuAction)}
      />

      <ContextMenu
        name="layout"
        hidden={layouts.menu().kind === 'closed'}
        position={layoutMenuPosition(layouts.menu())}
        items={layoutMenuEntries()}
        onMenuRef={el => { layoutMenuEl = el }}
        onClose={layouts.closeMenu}
        onAction={action => runLayoutMenuAction(action as LayoutMenuAction)}
      />

      <SlideContextMenu
        language={settings.language()}
        hidden={ui.contextMenu().kind === 'closed'}
        position={contextMenuPositionOf(ui.contextMenu())}
        menuItems={currentMenuItems()}
        image={previewMenuImage()}
        elementMenu={previewElementMenu()}
        canvasMenu={previewCanvasMenu()}
        canPasteElement={Boolean(elementClipboard() && elementClipboard()?.deckPath === deck.deckPath())}
        onPasteElement={() => { void pasteElement() }}
        onAddImage={() => { ui.closeContextMenu(); document.querySelector<HTMLInputElement>('[data-preview-image-input]')?.dispatchEvent(new Event('studio-add-image')) }}
        onElementAction={action => { void runElementAction(action) }}
        imageBusy={previewImageBusy()}
        onImageOrder={runImageOrderAction}
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
        onTogglePageNumber={() => { void toggleSlidePageNumber(contextMenuIndexOf(ui.contextMenu())!); ui.closeContextMenu() }}
        onMoveUp={() => { void moveSlide(contextMenuIndexOf(ui.contextMenu())!, -1); ui.closeContextMenu() }}
        onMoveDown={() => { void moveSlide(contextMenuIndexOf(ui.contextMenu())!, 1); ui.closeContextMenu() }}
        onCommentSlide={commentOnSlideFromMenu}
      />
        </>
      )}

      <NewDeckModal
        language={settings.language()}
        isOpen={deck.newDeckModalOpen()}
        name={deck.newDeckName()}
        parentDir={deck.newDeckParentDir()}
        settings={deck.newDeckSettings()}
        isBusy={deck.isBusy()}
        errorMessage={errorMessage()}
        onNameChange={name => void dispatch({ type: 'name-changed', name })}
        onSettingChange={pick => void dispatch({ type: 'setting-changed', pick })}
        onCancel={() => { setErrorMessage(null); void dispatch({ type: 'create-cancelled' }) }}
        onConfirm={() => void dispatch({ type: 'create-confirmed' })}
      />

      <div role="status" data-update-notice hidden={!showUpdateNotice(updateStatus())}
        className="fixed bottom-10 right-4 z-30 max-w-sm rounded-lg border border-border bg-popover text-popover-foreground p-3 shadow-lg">
        <p className="text-sm font-medium">{updateStatusText(updateStatus(), settings.language())}</p>
        <p className="text-xs whitespace-pre-wrap mt-2" hidden={!updateStatus().security}>{updateStatus().security ?? ''}</p>
        <p role="alert" className="text-xs text-destructive mt-2" hidden={!updateStatus().error}>{updateStatus().error ?? ''}</p>
        <div className="flex gap-3 mt-2 text-sm">
          <button type="button" hidden={!canPrepareUpdate(updateStatus())} onClick={() => void runUpdateAction('prepare')} className="underline">{updateMessages(settings.language()).prepare}</button>
          <button type="button" hidden={updateStatus().security !== null} onClick={() => void runUpdateAction('dismiss')}>{updateMessages(settings.language()).later}</button>
        </div>
      </div>
      <div role="alert" hidden={!updateBlocksEditing(updateStatus())} className="fixed top-0 right-0 bottom-0 left-0 z-50 bg-popover text-popover-foreground flex items-center justify-center">
        <p>{updateStatusText(updateStatus(), settings.language())}</p>
      </div>
      <SettingsPanel
        isOpen={settings.panelOpen()}
        language={settings.language()}
        vimMode={settings.settings().vimMode}
        autoCheckUpdates={settings.settings().autoCheckUpdates}
        autoUpdate={settings.settings().autoUpdate}
        onUpdateSettingChange={changeUpdateSetting}
        onClose={closeSettings}
        onChangeLanguage={language => void changeLanguage(language)}
        onVimModeChange={changeVimMode}
      />
    </div>
  )
}
