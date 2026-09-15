// DOM helpers for the section header in `components/SlideList.tsx`: a
// name input and minutes/seconds spinners.

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
