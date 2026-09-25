// A copy, as numbers, of the undo history of one CodeMirror editor state
// (`dom/codeEditor.ts`), so the app's own timeline of undoable steps
// (`domain/editorHistory.ts`) can point at one text group in it.
//
// CodeMirror stays the source of truth for the text itself: the app only
// keeps "the group numbered `seq`", and asks CodeMirror to undo once when
// that number is the newest undoable group here. So Cmd+Z and vim's own
// `u` / `Ctrl-R` move through the same single history and can't disagree.
//
// The depth CodeMirror reports can't serve as the number itself: once the
// history grows past `minDepth + 20` groups, CodeMirror drops the oldest
// ones, and every depth shifts.

/** The groups an editor state can undo (`live`) and redo (`undone`), each
 * oldest first, by their number. */
export interface TextHistoryMirror {
  readonly live: readonly number[]
  readonly undone: readonly number[]
}

export const EMPTY_TEXT_HISTORY: TextHistoryMirror = { live: [], undone: [] }

/** What one CodeMirror transaction did to the history, and the depths
 * (`undoDepth` / `redoDepth`) around it.
 *
 * - `change`: a text change the history records.
 * - `undo` / `redo`: one of CodeMirror's own undo/redo commands.
 * - `other`: anything else — a selection move, a change kept out of the
 *   history (`addToHistory: false`), a configuration change. */
export interface TextHistoryEvent {
  kind: 'change' | 'undo' | 'redo' | 'other'
  undoDepthBefore: number
  undoDepthAfter: number
  redoDepthAfter: number
}

/** Updates `mirror` for one transaction. `nextSeq` is the number a new
 * group gets; `newGroup` says whether it was used, so the caller can move
 * its counter on and add the group to its timeline.
 *
 * A `change` that leaves the depth as it was joined the newest group
 * (typing on, an IME conversion), so no new group starts. Any change
 * leaves nothing to redo, as in CodeMirror.
 *
 * The lists are then cut to CodeMirror's depths: a history past its limit
 * loses its oldest groups, and a change kept out of the history can wipe
 * out the newest ones (they had nothing left to undo). */
export function advanceTextHistory(
  mirror: TextHistoryMirror,
  event: TextHistoryEvent,
  nextSeq: number,
): { mirror: TextHistoryMirror; newGroup: boolean } {
  const undoDepth = depth(event.undoDepthAfter)
  const redoDepth = depth(event.redoDepthAfter)
  switch (event.kind) {
    case 'change': {
      const newGroup = event.undoDepthAfter !== event.undoDepthBefore
      const live = newGroup ? [...mirror.live, nextSeq] : mirror.live
      return { mirror: { live: newest(live, undoDepth), undone: [] }, newGroup }
    }
    case 'undo': {
      const [live, undone] = moveNewest(mirror.live, mirror.undone, undoDepth, redoDepth)
      return { mirror: { live, undone }, newGroup: false }
    }
    case 'redo': {
      const [undone, live] = moveNewest(mirror.undone, mirror.live, redoDepth, undoDepth)
      return { mirror: { live, undone }, newGroup: false }
    }
    case 'other':
      return { mirror: { live: oldest(mirror.live, undoDepth), undone: oldest(mirror.undone, redoDepth) }, newGroup: false }
    default: {
      const _exhaustive: never = event.kind
      throw new Error(`Unhandled TextHistoryEvent: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** Whether the group numbered `seq` is the one the next undo takes back. */
export function canUndoTextGroup(mirror: TextHistoryMirror, seq: number): boolean {
  return mirror.live.length > 0 && mirror.live[mirror.live.length - 1] === seq
}

/** Whether the group numbered `seq` is the one the next redo puts back. */
export function canRedoTextGroup(mirror: TextHistoryMirror, seq: number): boolean {
  return mirror.undone.length > 0 && mirror.undone[mirror.undone.length - 1] === seq
}

// Moves the newest group of `from` onto `to` (an undo or a redo), then cuts
// `from` from its newest end — taking one group back can drop others that
// had nothing left in them — and `to` from its oldest end, as CodeMirror
// does when that side is past its limit. Returns `[from, to]`.
function moveNewest(
  from: readonly number[],
  to: readonly number[],
  fromDepth: number,
  toDepth: number,
): [readonly number[], readonly number[]] {
  const moved = from.length > 0 ? [from[from.length - 1]] : []
  return [oldest(from.slice(0, from.length - moved.length), fromDepth), newest([...to, ...moved], toDepth)]
}

// The last `count` entries, dropping the oldest.
function newest(list: readonly number[], count: number): readonly number[] {
  return list.length > count ? list.slice(list.length - count) : list
}

// The first `count` entries, dropping the newest.
function oldest(list: readonly number[], count: number): readonly number[] {
  return list.length > count ? list.slice(0, count) : list
}

// A depth as a list length: a whole number, never below zero.
function depth(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
