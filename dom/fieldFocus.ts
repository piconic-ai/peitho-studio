// DOM helper for where keyboard focus sits when the slide list is pressed.

/** Blurs a focused text field outside the slide list's rows (the slide body
 * or note textarea).
 *
 * Call it from a row's `mousedown`. The rows `preventDefault()` their
 * `mousedown` for the hand-rolled drag, which also cancels the focus change
 * a press would otherwise make, and WebKit never moves focus onto a clicked
 * `<button>` anyway. Without this, focus stays in the textarea after a
 * thumbnail click or drag, so Cmd+Z goes to the textarea's native undo
 * instead of undoing the reorder (see `onKeyDown` in
 * `components/Studio.tsx`).
 *
 * A field inside a row (the section header's inputs) is left alone: the
 * header saves and closes through its own outside-press handling
 * (`dom/sectionHeader.ts`). */
export function blurEditorFieldOnRowPress(): void {
  const active = document.activeElement
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return
  if (active.closest('[data-slide-row]')) return
  active.blur()
}
