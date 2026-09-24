// DOM helpers for the section header in `components/SlideList.tsx`: a
// name input and minutes/seconds spinners that save together.

/** Whether a `blur` only moves focus to another element of the same section
 * header (the element carrying `data-section-header`), such as Tab from the
 * minutes spinner to the seconds spinner, or a click on the other spinner's
 * arrow.
 *
 * A header saves only once focus leaves it. Saving on each input's own blur
 * re-renders the deck, and `state/renderStore.ts`'s `applyRenderPayload`
 * then resets every section draft to the saved values. A spinner step made
 * while that render was in flight (clicking the seconds arrow right after
 * changing the minutes) would be thrown away.
 *
 * Returns false when `relatedTarget` is null (focus went nowhere, or the
 * engine didn't report where), so the fallback is to save. */
export function isFocusMovingWithinSectionHeader(event: FocusEvent): boolean {
  const { target, relatedTarget } = event
  if (!(target instanceof Element) || !(relatedTarget instanceof Node)) return false
  return target.closest('[data-section-header]')?.contains(relatedTarget) ?? false
}

/** Rewrites an input's displayed text to `text` if it differs.
 *
 * A reactive `value={...}` binding writes to the DOM only when its computed
 * value changes. Text typed into an `<input type="number">` that normalizes
 * to the value already shown would otherwise stay on screen: `-1` or `000`
 * typed while the field shows `0`, or a field cleared while it shows `0`.
 * Call this from `change`, which fires once the user finishes typing, so
 * the field isn't rewritten mid-keystroke. */
export function showCanonicalValue(input: HTMLInputElement, text: string): void {
  if (input.value !== text) input.value = text
}

/** The editing header of the slide-list row at `rowIndex`, or null when
 * that row isn't showing one. */
export function sectionHeaderOfRow(rowIndex: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-slide-row="${String(rowIndex)}"] [data-section-header]`)
}

/** Focuses the name input of the header editing on row `rowIndex`.
 *
 * Not a `ref={el => el.focus()}` on the input: the input sits in a branch of
 * a keyed `.map()` row, and that branch's `ref` runs only when the row
 * first mounts, not each time the branch is entered, so the input was never
 * focused on opening the editor. Call this after the editor is shown. */
export function focusSectionNameInput(rowIndex: number): void {
  sectionHeaderOfRow(rowIndex)?.querySelector<HTMLInputElement>('input')?.focus()
}

/** What a `mousedown` did to the editing section `header`:
 *
 * - `inside`: it landed in the header (the other spinner, its arrows), so
 *   nothing happens.
 * - `blurred`: focus was in the header, and this blurred it, so the
 *   header's own `blur` handlers save and close it.
 * - `unfocused`: focus wasn't in the header (or the header isn't there), so
 *   the caller has to save and close it.
 *
 * Needed because a press doesn't always move focus: the slide list's rows
 * and the column dividers `preventDefault()` their `mousedown` for their
 * hand-rolled drags, which also cancels that focus change. Call it from a
 * capture-phase listener so it runs before those handlers. */
export function pressOutsideSectionHeader(event: MouseEvent, header: Element | null): 'inside' | 'blurred' | 'unfocused' {
  if (header && event.target instanceof Node && header.contains(event.target)) return 'inside'
  const active = document.activeElement
  if (header && active instanceof HTMLElement && header.contains(active)) {
    active.blur()
    return 'blurred'
  }
  return 'unfocused'
}
