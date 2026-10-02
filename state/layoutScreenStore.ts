import { createMemo, createSignal } from '@barefootjs/client'
import {
  DELETE_IDLE, cancelDelete, confirmDelete, pickReplacement, startDelete, type DeleteFlow,
} from '../domain/layoutDelete'
import {
  NO_LAYOUT_EDITOR, editorLayoutName, isEditorDirty, loadedEditor, reverted, saveFailedEditor, savedEditor, savingEditor, withTyped,
  type LayoutEditor, type LayoutField, type LayoutTexts,
} from '../domain/layoutEditor'
import { type LayoutNameProblem, layoutNameProblem } from '../domain/layoutScreen'

const LIST_WIDTH = 220
const EDITOR_WIDTH = 420

/** The layout screen's own state (Studio's "Layouts" mode): which layout is
 * shown, the New Layout form, a delete in progress, the HTML/CSS editor,
 * and a notice for the last refused operation. Which *mode* the window is
 * in lives in `uiStore` with the rest of the window's chrome.
 *
 * State only, like `uiStore`: the IPC calls these transitions follow
 * (reading, writing and deleting layout files) are made from `Studio.tsx`,
 * which also owns the slide operations a delete or an Apply runs through.
 * A factory, so every window and every test gets its own instance. */
export function createLayoutScreenStore() {
  const [selectedLayout, setSelectedLayout] = createSignal<string | null>(null)

  // The list and editor columns' widths (`dom/columnResize.ts`), session-only
  // like the slides screen's.
  const [listWidth, setListWidth] = createSignal(LIST_WIDTH)
  const [editorWidth, setEditorWidth] = createSignal(EDITOR_WIDTH)

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

  const [editor, setEditor] = createSignal<LayoutEditor>(NO_LAYOUT_EDITOR)
  const editorDirty = createMemo(() => isEditorDirty(editor()))
  const [editorTab, setEditorTab] = createSignal<LayoutField>('html')
  function editorLoading(name: string): void {
    setEditor({ kind: 'loading', name })
  }
  function isLoading(name: string): boolean {
    return editor().kind === 'loading' && editorLayoutName(editor()) === name
  }
  /** The files read for `name` — dropped when the editor moved on to
   * another layout while they were read. */
  function editorLoaded(name: string, files: { html: string; css: string | null }): void {
    if (isLoading(name)) setEditor(loadedEditor(name, files))
  }
  function editorUnavailable(name: string, message: string): void {
    if (isLoading(name)) setEditor({ kind: 'unavailable', name, message })
  }
  function typeInEditor(field: LayoutField, text: string): void {
    setEditor(current => withTyped(current, field, text))
  }
  function revertEditor(): void {
    setEditor(reverted)
  }
  function editorSaving(): void {
    setEditor(savingEditor)
  }
  function editorSaved(name: string, texts: LayoutTexts): void {
    setEditor(current => savedEditor(current, name, texts))
  }
  function editorSaveFailed(name: string, message: string): void {
    setEditor(current => saveFailedEditor(current, name, message))
  }

  // True while a create/duplicate/delete/apply runs: their buttons are
  // disabled meanwhile, so a second click can't start another beside it.
  const [busy, setBusy] = createSignal(false)
  // The last refused operation's reason, shown on the screen itself (the
  // status bar's error line sits below the slides screen's concerns).
  const [notice, setNotice] = createSignal<string | null>(null)

  return {
    selectedLayout, setSelectedLayout,
    listWidth, setListWidth, editorWidth, setEditorWidth,
    previewGeneration, bumpPreviewGeneration,
    newLayoutOpen, newLayoutName, setNewLayoutName, newLayoutTemplate, setNewLayoutTemplate,
    openNewLayout, closeNewLayout, newLayoutNameProblem,
    deleteFlow, beginDelete, chooseReplacement, confirmDeleteFlow, cancelDeleteFlow, finishDelete,
    editor, editorDirty, editorTab, setEditorTab,
    editorLoading, editorLoaded, editorUnavailable, typeInEditor, revertEditor, editorSaving, editorSaved, editorSaveFailed,
    busy, setBusy, notice, setNotice,
  }
}
