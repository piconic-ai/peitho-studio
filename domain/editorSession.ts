import { indexAfterMove } from './slides'

// This file starts as just the SelectionPlan slice of §2.1's design in
// todo/studio-tsx-refactoring.md — Step 6 needs it to give
// `commitChange`'s selection-follow behavior a typed shape, before the
// full EditorSession ADT + reconcileAfterCommit (Step 9) exist.

/** How a change to the slide list should move the editor's selection,
 * named by the caller's *intent* rather than expressed as a raw target
 * index — so a reorder can't accidentally be confused for a delete, and
 * the index math for each case lives in one place instead of being
 * re-derived at every `commitChange` call site. */
export type SelectionPlan =
  | { kind: 'keep' }
  | { kind: 'follow-move'; from: number; to: number }
  | { kind: 'select'; index: number }
  | { kind: 'clamp-after-delete'; deleted: number }

/** Resolves a `SelectionPlan` against the *current* selection and the
 * slide count *after* the change. Each plan clamps differently on
 * out-of-range input, matching what its call site actually needs:
 * `keep`/`follow-move` fall back to the *first* slide (the selection was
 * never meant to move, so there's no better guess than the top of the
 * list), while `select`/`clamp-after-delete` clamp to the *last* slide
 * (they name a specific target index that can only overshoot when it was
 * the list's own last position, e.g. deleting the final slide) — the two
 * aren't interchangeable, so don't collapse them into one helper. */
export function selectionAfter(plan: SelectionPlan, current: number | null, count: number): number | null {
  switch (plan.kind) {
    case 'keep':
      return current !== null && current < count ? current : firstOrNull(count)
    case 'follow-move':
      return current === null ? plan.to : indexAfterMove(current, plan.from, plan.to)
    case 'select':
      return count > 0 ? Math.min(plan.index, count - 1) : null
    case 'clamp-after-delete':
      return count > 0 ? Math.min(plan.deleted, count - 1) : null
    default: {
      const _exhaustive: never = plan
      throw new Error(`Unhandled SelectionPlan: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

function firstOrNull(count: number): number | null {
  return count > 0 ? 0 : null
}
