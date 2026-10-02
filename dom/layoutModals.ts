// Keyboard focus for the layout screen's modals (`components/LayoutScreen.tsx`).
// Opening one from the right-click menu doesn't by itself take focus from
// whatever had it — often the layout editor, which would keep taking vim
// keys behind the backdrop — so it moves focus into the modal.

/** Focuses New Layout's name field. Call right after the modal is asked to
 * show: it waits a frame, since a hidden element can't take focus. */
export function focusNewLayoutName(): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-new-layout-name]')?.focus()
  })
}

/** Focuses the delete modal's first control that can take it — the
 * replacement picker when slides use the layout, else Cancel. */
export function focusDeleteLayoutDialog(): void {
  requestAnimationFrame(() => {
    const controls = document.querySelectorAll<HTMLElement>('[data-delete-layout-panel] select, [data-delete-layout-panel] button')
    for (const control of controls) {
      if (control.offsetParent !== null && !control.hasAttribute('disabled')) {
        control.focus()
        return
      }
    }
  })
}
