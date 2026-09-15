// Which layouts the right-clicked slide's content fits, for the "Change
// Layout" picker — so a layout peitho-core would reject for this slide is
// marked before it's chosen, and choosing it anyway explains why instead of
// closing the menu on a build error in the status bar.

/** Mirrors `engine::layout_fit::LayoutFit` (src-tauri) as serialized by
 * the `check_slide_layouts` command. `reason` is peitho-core's own message,
 * e.g. "unassigned content remains for missing 'body' slot". */
export type LayoutFit =
  | { kind: 'fits' }
  | { kind: 'mismatch'; reason: string }

export interface LayoutVerdict {
  layout: string
  fit: LayoutFit
}

/** What the picker knows about the slide's fit. `requestId` ties a
 * `checking` state to the one `check_slide_layouts` call whose answer it's
 * waiting for, so a slower answer for an earlier right-click can't land on
 * a later one. `unavailable` covers every case with nothing to judge by —
 * the check failed (e.g. the deck doesn't parse), or the slide is a draft
 * peitho-core never dispatches. */
export type LayoutFitCheck =
  | { kind: 'checking'; requestId: number }
  | { kind: 'checked'; verdicts: readonly LayoutVerdict[] }
  | { kind: 'unavailable' }

/** Whether one picker entry can be chosen right now. */
export type LayoutAvailability =
  | { kind: 'selectable' }
  | { kind: 'checking' }
  | { kind: 'mismatch'; reason: string }

/** The `check_slide_layouts` answer as a settled check — `null` (nothing to
 * judge, or the call failed) becomes `unavailable`. */
export function settledFitCheck(verdicts: readonly LayoutVerdict[] | null): LayoutFitCheck {
  return verdicts === null ? { kind: 'unavailable' } : { kind: 'checked', verdicts }
}

/** `layout`'s availability under `check`. Never blocks a layout the check
 * has no verdict for — an `unavailable` check, or a layout missing from the
 * verdicts (the picker's layout list and the check are fetched separately)
 * stays selectable, leaving peitho-core's own build to catch a mismatch as
 * it did before this check existed. */
export function availabilityOf(check: LayoutFitCheck, layout: string): LayoutAvailability {
  switch (check.kind) {
    case 'checking':
      return { kind: 'checking' }
    case 'unavailable':
      return { kind: 'selectable' }
    case 'checked': {
      const fit = check.verdicts.find(verdict => verdict.layout === layout)?.fit
      return fit?.kind === 'mismatch' ? { kind: 'mismatch', reason: fit.reason } : { kind: 'selectable' }
    }
    default: {
      const _exhaustive: never = check
      return _exhaustive
    }
  }
}

/** The inline message shown when a layout the slide doesn't fit is chosen. */
export function mismatchNotice(layout: string, reason: string): string {
  return `"${layout}" doesn't fit this slide: ${reason}`
}

/** Whether `layout`'s picker entry is shown as choosable (not dimmed). */
export function isSelectable(check: LayoutFitCheck, layout: string): boolean {
  return availabilityOf(check, layout).kind === 'selectable'
}

/** The picker entry's hover text: the mismatch notice for a layout the
 * slide doesn't fit, otherwise just the layout's name (the entry's own
 * label truncates long names). */
export function entryTitle(check: LayoutFitCheck, layout: string): string {
  const availability = availabilityOf(check, layout)
  return availability.kind === 'mismatch' ? mismatchNotice(layout, availability.reason) : layout
}
