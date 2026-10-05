// The layout screen's editor: the files open in it as tabs (a layout's HTML
// or CSS, or a CSS file every slide shares, like `css/base.css`), and for
// each one loading it, the text being typed, saving it back on its own
// (autosave), and the file changing on disk under it (the Coding Agent
// editing it). Pure.

/** One open file.
 * - `loading`: it's being read.
 * - `unavailable`: it couldn't be (`message` says why).
 * - `ready`: `saved` is what's on disk as far as the editor knows, `draft`
 *   what's in the editor; `saving` while a save runs, and `error` the last
 *   save's refusal (a layout that doesn't parse, say), cleared by the next
 *   edit. `external` is what the file became on disk while the draft held
 *   unsaved typing (`withExternalChange`), until the user picks one side
 *   (`withExternalLoaded` / `keptDraft`); `null` for no such conflict.
 *   `gone` while the file is no longer on disk and the draft held typing
 *   (`tabGone`): the draft can't be saved, only closed to discard it. */
export type FileEditor =
  | { kind: 'loading'; path: string }
  | { kind: 'unavailable'; path: string; message: string }
  | { kind: 'ready'; path: string; saved: string; draft: string; saving: boolean; error: string | null; external: string | null; gone: boolean }

/** The open files in tab order, and the one shown (`null` with none). */
export interface EditorTabs {
  tabs: readonly FileEditor[]
  active: string | null
}

export const NO_TABS: EditorTabs = { tabs: [], active: null }

/** How long typing must pause before the draft is saved on its own: longer
 * than the live preview's pause (250ms), so the save's build check doesn't
 * run between keystrokes. */
export const FILE_AUTOSAVE_DELAY_MS = 1000

/** The text `save_deck_file` refuses with when the file no longer holds
 * what the editor last read or wrote (`LAYOUT_CHANGED_ON_DISK` in
 * `engine::layout_files`): someone else wrote it during the save. */
export const FILE_CHANGED_ON_DISK = 'the layout\'s files changed on disk since they were read'

/** Whether a save's refusal (`message`, as shown) is the file having
 * changed on disk meanwhile rather than the draft itself. */
export function isFileChangedOnDisk(message: string): boolean {
  return message.includes(FILE_CHANGED_ON_DISK)
}

// ---- One file ----

/** The editor once `path` is read as `text`. */
export function loadedFile(path: string, text: string): FileEditor {
  return { kind: 'ready', path, saved: text, draft: text, saving: false, error: null, external: null, gone: false }
}

/** Whether `file` holds typing not saved yet. */
export function isFileDirty(file: FileEditor): boolean {
  return file.kind === 'ready' && file.draft !== file.saved
}

/** `file` with its text typed to `text`. An edit clears the last save's
 * error; anything but a ready file is left as it is. */
export function withTyped(file: FileEditor, text: string): FileEditor {
  if (file.kind !== 'ready' || file.draft === text) return file
  return { ...file, draft: text, error: null }
}

/** Whether the draft should be saved now, on its own: it holds unsaved
 * typing, no save is running (one at a time, so an older save can't land
 * after a newer one), its last save wasn't refused (only a new edit tries
 * again), and the file didn't change on disk under it (the user picks a
 * side first — saving would overwrite that change unseen). */
export function shouldAutosave(file: FileEditor): boolean {
  return file.kind === 'ready' && isFileDirty(file) && !file.saving && file.error === null && file.external === null
}

/** `file` with a save of its draft starting. */
export function savingFile(file: FileEditor): FileEditor {
  return file.kind === 'ready' ? { ...file, saving: true, error: null } : file
}

/** `file` once `text` (the draft the save sent) is on disk. Typing that
 * arrived during the save stays in the draft, still unsaved. */
export function savedFile(file: FileEditor, text: string): FileEditor {
  return file.kind === 'ready' ? { ...file, saved: text, saving: false, error: null } : file
}

/** `file` once a save sending `sent` was refused with `message`. The
 * refusal is the draft's only while the draft is still what was sent:
 * typing during the save (a fix, say) leaves no error behind, so the newer
 * text is saved next. */
export function saveFailedFile(file: FileEditor, message: string, sent: string): FileEditor {
  return file.kind === 'ready' ? { ...file, saving: false, error: file.draft === sent ? message : null } : file
}

/** `file` once a save found it changed on disk meanwhile: nothing was
 * written and the draft has no error of its own — the change is read next
 * (`withExternalChange`). */
export function saveInterruptedFile(file: FileEditor): FileEditor {
  return file.kind === 'ready' ? { ...file, saving: false, error: null } : file
}

/** What a change on disk did to an open file:
 * - `ignored`: it isn't ready (still loading, or couldn't be read).
 * - `unchanged`: the file holds what the editor last saved — Studio's own
 *   write coming back, or a change to another file.
 * - `caught-up`: the file now holds exactly the draft (a save of it, or
 *   someone writing the same text); it counts as saved.
 * - `replaced`: nothing was unsaved, so the editor takes the new text —
 *   the caller puts it in the code editor.
 * - `conflict`: the draft holds unsaved typing (or a save is running, or
 *   was refused) — kept, with the file's new text beside it for the user
 *   to choose from. */
export type ExternalChangeOutcome = 'ignored' | 'unchanged' | 'caught-up' | 'replaced' | 'conflict'

/** `file` once it was read as `disk` after a change on disk, and what that
 * did (`ExternalChangeOutcome`). Neither side is ever dropped unseen. */
export function withExternalChange(file: FileEditor, disk: string): { file: FileEditor; outcome: ExternalChangeOutcome } {
  if (file.kind !== 'ready') return { file, outcome: 'ignored' }
  // Back on disk after it was gone (the draft held typing then): caught up
  // when it holds exactly the draft, else the user picks a side — however
  // empty either text is. No saved text is made up for it meanwhile.
  if (file.gone) {
    const back = { ...file, gone: false, error: null }
    return disk === file.draft
      ? { file: { ...back, saved: disk, external: null }, outcome: 'caught-up' }
      : { file: { ...back, external: disk }, outcome: 'conflict' }
  }
  if (disk === file.saved) return { file: file.external === null ? file : { ...file, external: null }, outcome: 'unchanged' }
  if (disk === file.draft) return { file: { ...file, saved: disk, error: null, external: null }, outcome: 'caught-up' }
  if (!isFileDirty(file) && !file.saving) return { file: { ...file, saved: disk, draft: disk, error: null, external: null }, outcome: 'replaced' }
  return { file: { ...file, external: disk }, outcome: 'conflict' }
}

/** The conflict settled for the file on disk: `file` takes `disk` (read
 * again when the user chose), the draft set aside. */
export function withExternalLoaded(file: FileEditor, disk: string): FileEditor {
  return file.kind === 'ready' ? { ...file, saved: disk, draft: disk, error: null, external: null } : file
}

/** The conflict settled for the draft: what's on disk is now the file's new
 * text, so the draft, still unsaved against it, is saved over it next. */
export function keptDraft(file: FileEditor): FileEditor {
  if (file.kind !== 'ready' || file.external === null) return file
  return { ...file, saved: file.external, external: null }
}

/** What keeps `file` from being left (its tab closed, the other screen,
 * the window closed) once any pending save has run: `conflict` while it
 * changed on disk under the draft, `unsaved` while the draft still
 * couldn't be saved (refused), `null` for nothing. */
export function leaveBlocker(file: FileEditor): 'conflict' | 'unsaved' | null {
  if (file.kind !== 'ready') return null
  if (file.external !== null) return 'conflict'
  return isFileDirty(file) ? 'unsaved' : null
}

/** What the code editor shows for `file`. */
export function fileDraft(file: FileEditor | undefined): string {
  return file?.kind === 'ready' ? file.draft : ''
}

// ---- The tabs ----

/** The open file at `path`, if any. */
export function tabOf(tabs: EditorTabs, path: string | null): FileEditor | undefined {
  return path === null ? undefined : tabs.tabs.find(tab => tab.path === path)
}

/** The file shown. */
export function activeTab(tabs: EditorTabs): FileEditor | undefined {
  return tabOf(tabs, tabs.active)
}

/** `tabs` with each of `paths` open — a file not open yet joins at the end,
 * loading — and `show` (one of them, or any open file) shown. Opening a
 * file already open keeps it as it is (its draft, its undo history). The
 * paths to read are those that joined (`newlyOpened`). */
export function openTabs(tabs: EditorTabs, paths: readonly string[], show: string): EditorTabs {
  const joined = [...new Set(paths)].filter(path => tabOf(tabs, path) === undefined).map(path => ({ kind: 'loading' as const, path }))
  const next = [...tabs.tabs, ...joined]
  return { tabs: next, active: next.some(tab => tab.path === show) ? show : tabs.active }
}

/** Those of `paths` `before` didn't have open and `after` does — the files
 * an `openTabs` started loading. */
export function newlyOpened(before: EditorTabs, after: EditorTabs): string[] {
  return after.tabs.filter(tab => tabOf(before, tab.path) === undefined).map(tab => tab.path)
}

/** `tabs` showing `path`, when it's open. */
export function showTab(tabs: EditorTabs, path: string): EditorTabs {
  return tabOf(tabs, path) === undefined || tabs.active === path ? tabs : { ...tabs, active: path }
}

/** `tabs` without `path`. Closing the shown tab shows its right neighbour,
 * else its left one, else none. */
export function closeTab(tabs: EditorTabs, path: string): EditorTabs {
  const at = tabs.tabs.findIndex(tab => tab.path === path)
  if (at < 0) return tabs
  const rest = tabs.tabs.filter(tab => tab.path !== path)
  if (tabs.active !== path) return { tabs: rest, active: tabs.active }
  return { tabs: rest, active: (rest[at] ?? rest[at - 1])?.path ?? null }
}

/** `tabs` with the file at `path` replaced by `change(file)`. */
export function updateTab(tabs: EditorTabs, path: string, change: (file: FileEditor) => FileEditor): EditorTabs {
  const file = tabOf(tabs, path)
  if (file === undefined) return tabs
  const next = change(file)
  return next === file ? tabs : { ...tabs, tabs: tabs.tabs.map(tab => (tab.path === path ? next : tab)) }
}

/** `tabs` once `path` was read as `text` — dropped when its tab was closed
 * while it was read. */
export function tabLoaded(tabs: EditorTabs, path: string, text: string): EditorTabs {
  return updateTab(tabs, path, file => (file.kind === 'loading' ? loadedFile(path, text) : file))
}

/** `tabs` once `path` couldn't be read (`message` says why). */
export function tabUnavailable(tabs: EditorTabs, path: string, message: string): EditorTabs {
  return updateTab(tabs, path, file => (file.kind === 'loading' ? { kind: 'unavailable', path, message } : file))
}

/** `tabs` once open file `path` turned out to be gone from disk (deleted,
 * or its layout removed): a tab with nothing unsaved closes; one holding
 * typing stays, `message` saying why it can't be saved, so nothing typed is
 * lost unseen. */
export function tabGone(tabs: EditorTabs, path: string, message: string): EditorTabs {
  const file = tabOf(tabs, path)
  if (file === undefined) return tabs
  if (!isFileDirty(file)) return closeTab(tabs, path)
  return updateTab(tabs, path, current => (current.kind === 'ready' ? { ...current, saving: false, error: message, gone: true } : current))
}

/** Whether open `file` can be closed now: it holds nothing that would be
 * lost (`leaveBlocker`), or it's gone from disk — then closing it is how
 * the user discards the draft that can no longer be saved. */
export function canCloseFile(file: FileEditor): boolean {
  return leaveBlocker(file) === null || (file.kind === 'ready' && file.gone)
}

/** Whether any open file holds typing not saved yet. */
export function anyTabDirty(tabs: EditorTabs): boolean {
  return tabs.tabs.some(isFileDirty)
}

/** What keeps the editor as a whole from being left: the first open file
 * with a conflict, else the first with unsaved typing (`leaveBlocker`);
 * `null` for nothing. */
export function tabsBlocker(tabs: EditorTabs): { path: string; blocker: 'conflict' | 'unsaved' } | null {
  for (const blocker of ['conflict', 'unsaved'] as const) {
    const file = tabs.tabs.find(tab => leaveBlocker(tab) === blocker)
    if (file !== undefined) return { path: file.path, blocker }
  }
  return null
}

/** The open files to save now on their own (`shouldAutosave`), in tab
 * order. */
export function autosavePaths(tabs: EditorTabs): string[] {
  return tabs.tabs.filter(shouldAutosave).map(tab => tab.path)
}
