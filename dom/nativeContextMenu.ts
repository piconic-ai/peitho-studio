// Keeps the webview's own right-click menu (Look Up, Translate, Share, ...)
// from appearing where the app has no menu of its own.

/** Whether the element takes typing, where the native menu (Cut/Copy/Paste,
 * spelling) is still useful. */
function takesTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

/** Suppresses the native context menu for every right-click that no app
 * handler claimed (`preventDefault()` already called) and that didn't land
 * in a typing field. Returns the cleanup function.
 *
 * Registered on `window` in the bubble phase, so the app's own
 * `onContextMenu` handlers have already run. The target comes from
 * `composedPath()` because a Shadow DOM canvas retargets `event.target`
 * to its host. */
export function suppressNativeContextMenu(): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return
    if (takesTyping(event.composedPath()[0] ?? event.target)) return
    event.preventDefault()
  }
  window.addEventListener('contextmenu', onContextMenu)
  return () => window.removeEventListener('contextmenu', onContextMenu)
}
