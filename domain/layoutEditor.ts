// The layout screen's HTML/CSS editor for the selected layout: loading its
// files, the text being typed, and saving it back.

export type LayoutField = 'html' | 'css'

export interface LayoutTexts {
  html: string
  css: string
}

/** The editor for one layout.
 * - `loading`: its files are being read.
 * - `unavailable`: they couldn't be (`message` says why) — the built-in
 *   layout of a deck with no `layouts/`, say, which isn't a file to edit.
 * - `ready`: `saved` is what's on disk, `draft` what's in the editor;
 *   `saving` while a save runs, and `error` the last save's refusal (a
 *   layout that doesn't parse, say), cleared by the next edit or save. */
export type LayoutEditor =
  | { kind: 'none' }
  | { kind: 'loading'; name: string }
  | { kind: 'unavailable'; name: string; message: string }
  | { kind: 'ready'; name: string; saved: LayoutTexts; draft: LayoutTexts; saving: boolean; error: string | null }

export const NO_LAYOUT_EDITOR: LayoutEditor = { kind: 'none' }

/** The editor once layout `name`'s files are read; a missing CSS file is
 * blank CSS (saving blank CSS creates no file). */
export function loadedEditor(name: string, files: { html: string; css: string | null }): LayoutEditor {
  const texts = { html: files.html, css: files.css ?? '' }
  return { kind: 'ready', name, saved: texts, draft: texts, saving: false, error: null }
}

/** Whether `editor` holds typing not saved yet. */
export function isEditorDirty(editor: LayoutEditor): boolean {
  return editor.kind === 'ready' && (editor.draft.html !== editor.saved.html || editor.draft.css !== editor.saved.css)
}

/** `editor` with `field` typed to `text`. An edit clears the last save's
 * error; anything but a ready editor is left as it is. */
export function withTyped(editor: LayoutEditor, field: LayoutField, text: string): LayoutEditor {
  if (editor.kind !== 'ready' || editor.draft[field] === text) return editor
  return { ...editor, draft: { ...editor.draft, [field]: text }, error: null }
}

/** `editor` with its draft put back to what's saved. */
export function reverted(editor: LayoutEditor): LayoutEditor {
  return editor.kind === 'ready' ? { ...editor, draft: editor.saved, error: null } : editor
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

/** The layout `editor` is for, or `null`. */
export function editorLayoutName(editor: LayoutEditor): string | null {
  return editor.kind === 'none' ? null : editor.name
}

/** What the editor's two text fields show. */
export function editorDraft(editor: LayoutEditor): LayoutTexts {
  return editor.kind === 'ready' ? editor.draft : { html: '', css: '' }
}
