// DOM helpers for where keyboard focus sits: whether an Edit-menu Undo
// belongs to a plain text field, and moving focus off a field when the
// slide list is pressed.

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

/** Runs the webview's own text undo/redo when a plain text field (an
 * `<input>` or `<textarea>`, such as a section header's name) has focus,
 * and returns whether it did.
 *
 * Edit > Undo/Redo (and Cmd+Z / Cmd+Shift+Z) no longer reach the native
 * text undo on their own (see `src-tauri/src/edit_menu.rs`), so such a
 * field's typing is undone from here. The slide body and notes editors
 * aren't plain fields: their typing is on the app's timeline, which the
 * caller walks when this returns `false`. */
export function replayFocusedFieldHistory(direction: 'undo' | 'redo'): boolean {
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
 * thumbnail click or drag, so the slide list's keys (arrows, Delete) type
 * into the editor instead (see `isTypingInField`).
 *
 * A field inside a row (the section header's inputs) is left alone: the
 * header saves and closes through its own outside-press handling
 * (`dom/sectionHeader.ts`). */
export function blurEditorFieldOnRowPress(): void {
  const active = focusedTypingElement()
  if (active === null || active.closest('[data-slide-row]')) return
  active.blur()
}
