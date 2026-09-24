// Keyboard focus for the settings panel (`components/SettingsPanel.tsx`).
//
// The panel is a modal, but opening it doesn't by itself take focus from
// whatever had it: a slide editor or section field behind the panel would
// keep receiving typing, and Edit > Undo would keep undoing its text. So
// opening moves focus onto the panel, and closing hands it back.

// The element focused when the panel opened, restored on close.
let returnFocusTo: HTMLElement | null = null

/** Moves focus onto the open settings panel, remembering what had it.
 * Call right after the panel is shown (a hidden element can't take focus). */
export function focusSettingsPanel(): void {
  const active = document.activeElement
  returnFocusTo = active instanceof HTMLElement && active !== document.body ? active : null
  document.querySelector<HTMLElement>('[data-settings-panel-close]')?.focus()
}

/** Gives focus back to whatever had it when the panel opened, if it is
 * still in the page. */
export function restoreFocusAfterSettingsPanel(): void {
  const target = returnFocusTo
  returnFocusTo = null
  if (target?.isConnected) target.focus()
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}
