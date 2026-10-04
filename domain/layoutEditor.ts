// The layout screen's HTML/CSS editor for the selected layout: loading its
// files, the text being typed, saving it back on its own (autosave), and
// the files changing on disk under it (the Coding Agent editing them).

export type LayoutField = 'html' | 'css'

export interface LayoutTexts {
  html: string
  css: string
}

/** The editor for one layout.
 * - `loading`: its files are being read.
 * - `unavailable`: they couldn't be (`message` says why) — the built-in
 *   layout of a deck with no `layouts/`, say, which isn't a file to edit.
 * - `ready`: `saved` is what's on disk as far as the editor knows, `draft`
 *   what's in the editor; `saving` while a save runs, and `error` the last
 *   save's refusal (a layout that doesn't parse, say), cleared by the next
 *   edit. `external` is what the files became on disk while the draft held
 *   unsaved typing (`withExternalChange`), until the user picks one side
 *   (`withExternalLoaded` / `keptDraft`); `null` for no such conflict. */
export type LayoutEditor =
  | { kind: 'none' }
  | { kind: 'loading'; name: string }
  | { kind: 'unavailable'; name: string; message: string }
  | { kind: 'ready'; name: string; saved: LayoutTexts; draft: LayoutTexts; saving: boolean; error: string | null; external: LayoutTexts | null }

export const NO_LAYOUT_EDITOR: LayoutEditor = { kind: 'none' }

/** How long typing must pause before the draft is saved on its own: longer
 * than the live preview's pause (250ms), so the save's build check doesn't
 * run between keystrokes. */
export const LAYOUT_AUTOSAVE_DELAY_MS = 1000

/** A layout's files as read (`read_layout`) as the editor's texts: a
 * missing CSS file is blank CSS (saving blank CSS creates no file). */
export function layoutTextsOf(files: { html: string; css: string | null }): LayoutTexts {
  return { html: files.html, css: files.css ?? '' }
}

function sameTexts(a: LayoutTexts, b: LayoutTexts): boolean {
  return a.html === b.html && a.css === b.css
}

/** The editor once layout `name`'s files are read. */
export function loadedEditor(name: string, files: { html: string; css: string | null }): LayoutEditor {
  const texts = layoutTextsOf(files)
  return { kind: 'ready', name, saved: texts, draft: texts, saving: false, error: null, external: null }
}

/** Whether `editor` holds typing not saved yet. */
export function isEditorDirty(editor: LayoutEditor): boolean {
  return editor.kind === 'ready' && !sameTexts(editor.draft, editor.saved)
}

/** `editor` with `field` typed to `text`. An edit clears the last save's
 * error; anything but a ready editor is left as it is. */
export function withTyped(editor: LayoutEditor, field: LayoutField, text: string): LayoutEditor {
  if (editor.kind !== 'ready' || editor.draft[field] === text) return editor
  return { ...editor, draft: { ...editor.draft, [field]: text }, error: null }
}

/** Whether the draft should be saved now, on its own: it holds unsaved
 * typing, no save is running (one at a time, so an older save can't land
 * after a newer one), its last save wasn't refused (only a new edit tries
 * again), and the files didn't change on disk under it (the user picks a
 * side first — saving would overwrite that change unseen). */
export function shouldAutosave(editor: LayoutEditor): boolean {
  return editor.kind === 'ready' && isEditorDirty(editor) && !editor.saving && editor.error === null && editor.external === null
}

/** `editor` with a save of its draft starting. */
export function savingEditor(editor: LayoutEditor): LayoutEditor {
  return editor.kind === 'ready' ? { ...editor, saving: true, error: null } : editor
}

/** `editor` once `texts` (the draft the save sent) are on disk. Typing
 * that arrived during the save stays in the draft, still unsaved. A save
 * for another layout (the selection moved on) changes nothing. */
export function savedEditor(editor: LayoutEditor, name: string, texts: LayoutTexts): LayoutEditor {
  if (editor.kind !== 'ready' || editor.name !== name) return editor
  return { ...editor, saved: texts, saving: false, error: null }
}

/** `editor` once a save of layout `name` was refused with `message`. */
export function saveFailedEditor(editor: LayoutEditor, name: string, message: string): LayoutEditor {
  if (editor.kind !== 'ready' || editor.name !== name) return editor
  return { ...editor, saving: false, error: message }
}

/** What a change on disk to layout `name`'s files did to the editor:
 * - `ignored`: the editor isn't open on that layout's files.
 * - `unchanged`: the files hold what the editor last saved — Studio's own
 *   write coming back, or a change to another layout.
 * - `caught-up`: the files now hold exactly the draft (a save of it, or
 *   someone writing the same text); it counts as saved.
 * - `replaced`: nothing was unsaved, so the editor takes the new files —
 *   the caller puts them in the code editors.
 * - `conflict`: the draft holds unsaved typing (or a save is running, or
 *   was refused) — kept, with the files' new text beside it for the user
 *   to choose from. */
export type ExternalChangeOutcome = 'ignored' | 'unchanged' | 'caught-up' | 'replaced' | 'conflict'

/** `editor` once layout `name`'s files were read as `disk` after a change
 * on disk, and what that did (`ExternalChangeOutcome`). Neither side is
 * ever dropped unseen. */
export function withExternalChange(editor: LayoutEditor, name: string, disk: LayoutTexts): { editor: LayoutEditor; outcome: ExternalChangeOutcome } {
  if (editor.kind !== 'ready' || editor.name !== name) return { editor, outcome: 'ignored' }
  if (sameTexts(disk, editor.saved)) {
    return { editor: editor.external === null ? editor : { ...editor, external: null }, outcome: 'unchanged' }
  }
  if (sameTexts(disk, editor.draft)) {
    return { editor: { ...editor, saved: disk, error: null, external: null }, outcome: 'caught-up' }
  }
  if (!isEditorDirty(editor) && !editor.saving) {
    return { editor: { ...editor, saved: disk, draft: disk, error: null, external: null }, outcome: 'replaced' }
  }
  return { editor: { ...editor, external: disk }, outcome: 'conflict' }
}

/** The conflict settled for the files on disk: `editor` takes `disk` (read
 * again when the user chose), the draft set aside. */
export function withExternalLoaded(editor: LayoutEditor, name: string, disk: LayoutTexts): LayoutEditor {
  if (editor.kind !== 'ready' || editor.name !== name) return editor
  return { ...editor, saved: disk, draft: disk, error: null, external: null }
}

/** The conflict settled for the draft: what's on disk is now the files'
 * new text, so the draft, still unsaved against it, is saved over it next. */
export function keptDraft(editor: LayoutEditor): LayoutEditor {
  if (editor.kind !== 'ready' || editor.external === null) return editor
  return { ...editor, saved: editor.external, external: null }
}

/** What keeps the editor from being left (another layout opened, the
 * other screen, the window closed) once any pending save has run:
 * `conflict` while the files changed on disk under the draft, `unsaved`
 * while the draft still couldn't be saved (refused), `null` for nothing. */
export function leaveBlocker(editor: LayoutEditor): 'conflict' | 'unsaved' | null {
  if (editor.kind !== 'ready') return null
  if (editor.external !== null) return 'conflict'
  return isEditorDirty(editor) ? 'unsaved' : null
}

/** The layout `editor` is for, or `null`. */
export function editorLayoutName(editor: LayoutEditor): string | null {
  return editor.kind === 'none' ? null : editor.name
}

/** What the editor's two text fields show. */
export function editorDraft(editor: LayoutEditor): LayoutTexts {
  return editor.kind === 'ready' ? editor.draft : { html: '', css: '' }
}
