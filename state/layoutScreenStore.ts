import { createMemo, createSignal } from '@barefootjs/client'
import {
  DELETE_IDLE, cancelDelete, confirmDelete, pickReplacement, startDelete, type DeleteFlow,
} from '../domain/layoutDelete'
import {
  NO_TABS, activeTab, anyTabDirty, closeTab, keptDraft, newlyOpened, openTabs, saveFailedFile, saveInterruptedFile, savedFile, savingFile, showTab,
  tabGone, tabLoaded, tabOf, tabUnavailable, updateTab, withExternalChange, withExternalLoaded, withTyped,
  type EditorTabs, type ExternalChangeOutcome,
} from '../domain/fileEditor'
import { toggledFolder, type DeckFileEntry } from '../domain/deckFiles'
import { type LayoutNameProblem, layoutNameProblem } from '../domain/layoutScreen'
import {
  LAYOUT_MENU_CLOSED, openOnLayout, openOnPreview, openOnList, withLayoutMenuFit, withLayoutMenuPosition, type LayoutMenu,
} from '../domain/layoutMenu'
import type { LayoutVerdict } from '../domain/layoutFit'
import type { Size } from '../domain/geometry'
import {
  NO_DRAFT_PREVIEW, draftPreviewFailed, draftPreviewRendered, requestDraftPreview, resetDraftPreview,
  type DraftPreview, type RenderedDraft,
} from '../domain/layoutDraftPreview'

// The list's width until the screen is first laid out
// (`settleListWidth`): only ever seen if it can't be measured.
const LIST_WIDTH = 280

// The file tree's width until dragged: room for a layout's file name.
const TREE_WIDTH = 200

/** The layout screen's own state (Studio's "Layouts" mode): which layout is
 * shown, the file tree, the editor's tabs, the New Layout form, a delete in
 * progress, and a notice for the last refused operation. Which *mode* the window is
 * in lives in `uiStore` with the rest of the window's chrome.
 *
 * State only, like `uiStore`: the IPC calls these transitions follow
 * (reading, writing and deleting layout files) are made from `Studio.tsx`,
 * which also owns the slide operations a delete or an Apply runs through.
 * A factory, so every window and every test gets its own instance. */
export function createLayoutScreenStore() {
  const [selectedLayout, setSelectedLayout] = createSignal<string | null>(null)

  // The list column's width (`dom/columnResize.ts`), session-only like the
  // slides screen's; the editor, left of it, takes the rest of the row.
  // Worked out once, the first time the screen is laid out
  // (`initialLayoutListWidth`); a drag sets it from then on.
  const [listWidth, setListWidthValue] = createSignal(LIST_WIDTH)
  let listWidthSettled = false
  /** The divider dragged to `width`. */
  function setListWidth(width: number): void {
    listWidthSettled = true
    setListWidthValue(width)
  }
  /** The screen laid out, with `width` worked out for the list (`null`
   * for none yet): taken only the first time, and never over a drag. */
  function settleListWidth(width: number | null): void {
    if (listWidthSettled || width === null) return
    listWidthSettled = true
    setListWidthValue(width)
  }

  // The file tree column's width (`dom/columnResize.ts`), session-only.
  const [treeWidth, setTreeWidth] = createSignal(TREE_WIDTH)

  // The deck's files as last listed (`list_deck_files`), and the tree's
  // folders the user closed (every folder starts open).
  const [files, setFiles] = createSignal<DeckFileEntry[]>([])
  const [collapsedFolders, setCollapsedFolders] = createSignal<ReadonlySet<string>>(new Set())
  function toggleFolder(path: string): void {
    setCollapsedFolders(collapsed => toggledFolder(collapsed, path))
  }

  // The list column's body's size under its switch (`dom/elementSize.ts`),
  // which the selected layout's large preview fits inside
  // (`selectedPreviewRoom`); `null` until measured.
  const [thumbnailRoom, setThumbnailRoom] = createSignal<Size | null>(null)

  // Bumped whenever a fresh set of layout previews arrives, so the list's
  // rows get new keys and redraw their thumbnails (see `layoutRows`).
  const [previewGeneration, setPreviewGeneration] = createSignal(0)
  function bumpPreviewGeneration(): void {
    setPreviewGeneration(generation => generation + 1)
  }

  // The New Layout form: closed, or open with what's typed and which
  // template it starts from (`''` for the blank one).
  const [newLayoutOpen, setNewLayoutOpen] = createSignal(false)
  const [newLayoutName, setNewLayoutName] = createSignal('')
  const [newLayoutTemplate, setNewLayoutTemplate] = createSignal('')
  function openNewLayout(): void {
    setNewLayoutName('')
    setNewLayoutTemplate('')
    setNewLayoutOpen(true)
  }
  function closeNewLayout(): void {
    setNewLayoutOpen(false)
  }
  /** What's wrong with the typed name for a deck with layouts `existing`,
   * `null` when nothing is. */
  function newLayoutNameProblem(existing: readonly string[]): LayoutNameProblem | null {
    return layoutNameProblem(newLayoutName(), existing)
  }

  const [deleteFlow, setDeleteFlow] = createSignal<DeleteFlow>(DELETE_IDLE)
  function beginDelete(name: string, names: readonly string[], slides: readonly number[]): void {
    setDeleteFlow(startDelete(name, names, slides))
  }
  function chooseReplacement(choice: string, names: readonly string[]): void {
    setDeleteFlow(flow => pickReplacement(flow, choice, names))
  }
  /** Confirms the delete and returns it, or `null` when it can't be yet. */
  function confirmDeleteFlow(): DeleteFlow | null {
    const confirmed = confirmDelete(deleteFlow())
    if (confirmed.kind !== 'deleting') return null
    setDeleteFlow(confirmed)
    return confirmed
  }
  function cancelDeleteFlow(): void {
    setDeleteFlow(cancelDelete)
  }
  /** Ends a delete that ran (whether it went through or was refused). */
  function finishDelete(): void {
    setDeleteFlow(DELETE_IDLE)
  }

  // The editor's tabs (`domain/fileEditor.ts`): every open file, each with
  // its own draft, save and conflict, and the one shown.
  const [tabs, setTabs] = createSignal<EditorTabs>(NO_TABS)
  const editorDirty = createMemo(() => anyTabDirty(tabs()))
  const activeFile = createMemo(() => activeTab(tabs()))
  const activePath = createMemo(() => tabs().active)
  /** Whether the shown file changed on disk under unsaved typing, until the
   * user picks a side (`loadExternal` / `keepDraft`). */
  const editorConflict = createMemo(() => {
    const file = activeFile()
    return file?.kind === 'ready' && file.external !== null
  })
  /** Opens `paths` as tabs (one already open stays as it is) and shows
   * `show`; returns the paths that joined, to be read (`fileLoaded`). */
  function openFiles(paths: readonly string[], show: string): string[] {
    const before = tabs()
    const next = openTabs(before, paths, show)
    setTabs(next)
    return newlyOpened(before, next)
  }
  function showFile(path: string): void {
    setTabs(current => showTab(current, path))
  }
  function closeFile(path: string): void {
    setTabs(current => closeTab(current, path))
  }
  function fileOf(path: string) {
    return tabOf(tabs(), path)
  }
  /** `path` read as `text` — dropped when its tab was closed meanwhile. */
  function fileLoaded(path: string, text: string): void {
    setTabs(current => tabLoaded(current, path, text))
  }
  /** A tab that couldn't be read, about to be read again. */
  function fileLoading(path: string): void {
    setTabs(current => updateTab(current, path, file => (file.kind === 'unavailable' ? { kind: 'loading', path } : file)))
  }
  function fileUnavailable(path: string, message: string): void {
    setTabs(current => tabUnavailable(current, path, message))
  }
  /** `path` found gone from disk (`tabGone`). */
  function fileGone(path: string, message: string): void {
    setTabs(current => tabGone(current, path, message))
  }
  function typeInFile(path: string, text: string): void {
    setTabs(current => updateTab(current, path, file => withTyped(file, text)))
  }
  /** `path` read as `disk` after a change on disk; returns what that did
   * to its tab (`withExternalChange`). */
  function externalChange(path: string, disk: string): ExternalChangeOutcome {
    const file = tabOf(tabs(), path)
    if (file === undefined) return 'ignored'
    const next = withExternalChange(file, disk)
    setTabs(current => updateTab(current, path, () => next.file))
    return next.outcome
  }
  /** A conflict settled for the file on disk, as read again (`disk`). */
  function loadExternal(path: string, disk: string): void {
    setTabs(current => updateTab(current, path, file => withExternalLoaded(file, disk)))
  }
  /** A conflict settled for the unsaved typing. */
  function keepDraft(path: string): void {
    setTabs(current => updateTab(current, path, keptDraft))
  }
  function fileSaving(path: string): void {
    setTabs(current => updateTab(current, path, savingFile))
  }
  function fileSaved(path: string, text: string): void {
    setTabs(current => updateTab(current, path, file => savedFile(file, text)))
  }
  function fileSaveFailed(path: string, message: string, sent: string): void {
    setTabs(current => updateTab(current, path, file => saveFailedFile(file, message, sent)))
  }
  function fileSaveInterrupted(path: string): void {
    setTabs(current => updateTab(current, path, saveInterruptedFile))
  }

  // The layout list's right-click menu (`domain/layoutMenu.ts`). Each open
  // on a layout with a slide to apply it to numbers its fit check, so a
  // late answer for an earlier right-click can't land on this one.
  const [menu, setMenu] = createSignal<LayoutMenu>(LAYOUT_MENU_CLOSED)
  let lastMenuFitRequest = 0
  /** Opens the menu on layout `name`; with `checkFit`, returns the id the
   * fit check's answer must carry (`settleMenuFit`), else `null`. */
  function openMenuOnLayout(name: string, x: number, y: number, checkFit: boolean): number | null {
    const requestId = checkFit ? ++lastMenuFitRequest : null
    setMenu(openOnLayout(name, x, y, requestId))
    return requestId
  }
  /** Opens the menu on layout `name`'s large preview, right-clicked in
   * `slot` (`null` for none); the fit check as `openMenuOnLayout`'s. */
  function openMenuOnPreview(name: string, slot: string | null, x: number, y: number, checkFit: boolean): number | null {
    const requestId = checkFit ? ++lastMenuFitRequest : null
    setMenu(openOnPreview(name, slot, x, y, requestId))
    return requestId
  }
  function openMenuOnList(x: number, y: number): void {
    setMenu(openOnList(x, y))
  }
  function settleMenuFit(requestId: number, verdicts: readonly LayoutVerdict[] | null): void {
    setMenu(current => withLayoutMenuFit(current, requestId, verdicts))
  }
  function moveMenu(at: { x: number; y: number }): void {
    setMenu(current => withLayoutMenuPosition(current, at))
  }
  function closeMenu(): void {
    setMenu(LAYOUT_MENU_CLOSED)
  }

  // The layout editor's live preview (`domain/layoutDraftPreview.ts`).
  const [draftPreview, setDraftPreview] = createSignal<DraftPreview>(NO_DRAFT_PREVIEW)
  /** Starts a draft preview of `name`; returns the number its answer must
   * carry. */
  function requestPreview(name: string): number {
    const next = requestDraftPreview(draftPreview(), name)
    setDraftPreview(next.state)
    return next.seq
  }
  function previewRendered(seq: number, rendered: RenderedDraft): void {
    setDraftPreview(current => draftPreviewRendered(current, seq, rendered))
  }
  function previewFailed(seq: number, message: string): void {
    setDraftPreview(current => draftPreviewFailed(current, seq, message))
  }
  function resetPreview(): void {
    setDraftPreview(resetDraftPreview)
  }

  // True while a create/duplicate/delete/apply runs: their buttons are
  // disabled meanwhile, so a second click can't start another beside it.
  const [busy, setBusy] = createSignal(false)
  // The last refused operation's reason, shown on the screen itself (the
  // status bar's error line sits below the slides screen's concerns).
  const [notice, setNotice] = createSignal<string | null>(null)

  return {
    selectedLayout, setSelectedLayout,
    listWidth, setListWidth, settleListWidth,
    treeWidth, setTreeWidth, files, setFiles, collapsedFolders, toggleFolder,
    thumbnailRoom, setThumbnailRoom,
    previewGeneration, bumpPreviewGeneration,
    newLayoutOpen, newLayoutName, setNewLayoutName, newLayoutTemplate, setNewLayoutTemplate,
    openNewLayout, closeNewLayout, newLayoutNameProblem,
    deleteFlow, beginDelete, chooseReplacement, confirmDeleteFlow, cancelDeleteFlow, finishDelete,
    tabs, editorDirty, activeFile, activePath, editorConflict,
    openFiles, showFile, closeFile, fileOf, fileLoaded, fileLoading, fileUnavailable, fileGone, typeInFile,
    fileSaving, fileSaved, fileSaveFailed, fileSaveInterrupted, externalChange, loadExternal, keepDraft,
    busy, setBusy, notice, setNotice,
    menu, openMenuOnLayout, openMenuOnPreview, openMenuOnList, settleMenuFit, moveMenu, closeMenu,
    draftPreview, requestPreview, previewRendered, previewFailed, resetPreview,
  }
}
