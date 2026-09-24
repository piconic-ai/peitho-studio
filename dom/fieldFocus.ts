// DOM helpers for where keyboard focus sits: which undo an Edit-menu Undo
// means, and moving focus off a field when the slide list is pressed.

import { replayFocusedCodeEditorHistory } from './codeEditor'

/** The focused plain text field (an `<input>` or `<textarea>`), or `null`. */
function focusedTextField(): HTMLInputElement | HTMLTextAreaElement | null {
  const active = document.activeElement
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null
}

/** The focused element that takes typing: a plain text field, or the
 * `contenteditable` content of a CodeMirror editor (the slide body and
 * notes, `dom/codeEditor.ts`). `null` when focus is elsewhere. */
function focusedTypingElement(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return null
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active.isContentEditable ? active : null
}

/** Whether keyboard focus is in a field that takes typing, where a plain
 * key (an arrow, Delete) edits text instead of acting on slides. */
export function isTypingInField(): boolean {
  return focusedTypingElement() !== null
}

/** Runs the focused field's own text undo/redo when one has focus, and
 * returns whether it did: CodeMirror's history for the slide body and
 * notes, the webview's for any other text field.
 *
 * Edit > Undo/Redo (and Cmd+Z / Cmd+Shift+Z) no longer reach the native
 * text undo on their own (see `src-tauri/src/edit_menu.rs`), so a field's
 * typing is undone from here. When this returns `false`, the caller undoes
 * a slide operation instead. */
export function replayFocusedFieldHistory(direction: 'undo' | 'redo'): boolean {
  if (replayFocusedCodeEditorHistory(direction)) return true
  if (focusedTextField() === null) return false
  // Deprecated, but still the only way a page can reach the browser's own
  // text undo stack; WebKit and Chromium both support it from script.
  document.execCommand(direction)
  return true
}

/** Blurs a focused field outside the slide list's rows (the slide body or
 * notes editor).
 *
 * Call it from a row's `mousedown`. The rows `preventDefault()` their
 * `mousedown` for the hand-rolled drag, which also cancels the focus change
 * a press would otherwise make, and WebKit never moves focus onto a clicked
 * `<button>` anyway. Without this, focus stays in the editor after a
 * thumbnail click or drag, so Cmd+Z goes to the editor's text undo
 * instead of undoing the reorder (see `replayFocusedFieldHistory`).
 *
 * A field inside a row (the section header's inputs) is left alone: the
 * header saves and closes through its own outside-press handling
 * (`dom/sectionHeader.ts`). */
export function blurEditorFieldOnRowPress(): void {
  const active = focusedTypingElement()
  if (active === null || active.closest('[data-slide-row]')) return
  active.blur()
}
