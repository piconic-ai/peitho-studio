// Deleting a layout from the layout screen, as one state machine: an
// unused layout only needs a confirmation; a used one needs a layout to
// move its slides to first. The deck's only layout can't be deleted at all.

/** Where a delete stands.
 * - `confirming`: the layout is unused; Delete asks once.
 * - `choosing-replacement`: `slides` (deck positions) are on the layout;
 *   `replacement` is the layout picked to move them to, `null` until one
 *   is. It's never the layout being deleted.
 * - `deleting`: confirmed; the slides are being moved (`replacement`, when
 *   there are any) and the files deleted. */
export type DeleteFlow =
  | { kind: 'idle' }
  | { kind: 'confirming'; name: string }
  | { kind: 'choosing-replacement'; name: string; slides: readonly number[]; replacement: string | null }
  | { kind: 'deleting'; name: string; slides: readonly number[]; replacement: string | null }

export const DELETE_IDLE: DeleteFlow = { kind: 'idle' }

/** Starts deleting layout `name` of a deck with layouts `names`, `slides`
 * being the deck positions of the slides on it. Stays `idle` for a layout
 * the deck doesn't have, or its only one. */
export function startDelete(name: string, names: readonly string[], slides: readonly number[]): DeleteFlow {
  if (!names.includes(name) || names.length < 2) return DELETE_IDLE
  return slides.length === 0
    ? { kind: 'confirming', name }
    : { kind: 'choosing-replacement', name, slides: [...slides], replacement: null }
}

/** The layouts a used layout's slides can be moved to: every other one. */
export function replacementChoices(flow: DeleteFlow, names: readonly string[]): string[] {
  return flow.kind === 'choosing-replacement' ? names.filter(name => name !== flow.name) : []
}

/** `flow` with `choice` picked as the replacement — unchanged when it isn't
 * one of `replacementChoices` (the layout being deleted, or one the deck
 * lacks) or when no replacement is being chosen. */
export function pickReplacement(flow: DeleteFlow, choice: string, names: readonly string[]): DeleteFlow {
  if (flow.kind !== 'choosing-replacement' || !replacementChoices(flow, names).includes(choice)) return flow
  return { ...flow, replacement: choice }
}

/** Whether `flow` can be confirmed now: an unused layout always, a used
 * one once a replacement is picked. */
export function canConfirmDelete(flow: DeleteFlow): boolean {
  return flow.kind === 'confirming' || (flow.kind === 'choosing-replacement' && flow.replacement !== null)
}

/** The confirmed delete, or `flow` unchanged when it can't be confirmed. */
export function confirmDelete(flow: DeleteFlow): DeleteFlow {
  if (!canConfirmDelete(flow)) return flow
  if (flow.kind === 'confirming') return { kind: 'deleting', name: flow.name, slides: [], replacement: null }
  if (flow.kind === 'choosing-replacement') return { kind: 'deleting', name: flow.name, slides: flow.slides, replacement: flow.replacement }
  return flow
}

/** Cancels a delete not yet confirmed. One already running finishes. */
export function cancelDelete(flow: DeleteFlow): DeleteFlow {
  return flow.kind === 'deleting' ? flow : DELETE_IDLE
}

/** The layout a delete in progress (any stage) is about, or `null`. */
export function deletingName(flow: DeleteFlow): string | null {
  return flow.kind === 'idle' ? null : flow.name
}
