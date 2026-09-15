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
