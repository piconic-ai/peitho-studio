// Numbers each group of typing in a CodeMirror editor's undo history, so
// the app's timeline (`domain/editorHistory.ts`'s text markers) can say
// "undo group 12 of this editor" and check whether that group is still the
// next one to undo (`domain/textHistory.ts`).
//
// The numbered copy is kept per `EditorState`, not per editor: a slide's
// state is put aside when the user leaves it and put back later
// (`dom/editorSlideStates.ts`, `restoreCodeEditor`), and its numbers have
// to come back with it. Every transaction's resulting state gets its own
// copy, so an old state still answers for itself.
//
// Uses only `@codemirror/state` / `@codemirror/commands`, never an
// `EditorView`, so it runs (and is tested) without a DOM.

import { type EditorState, Transaction } from '@codemirror/state'
import { redoDepth, undoDepth } from '@codemirror/commands'
import {
  EMPTY_TEXT_HISTORY,
  advanceTextHistory,
  canRedoTextGroup,
  canUndoTextGroup,
  type TextHistoryEvent,
  type TextHistoryMirror,
} from '../domain/textHistory'

const mirrors = new WeakMap<EditorState, TextHistoryMirror>()

// One sequence for the whole window (each window is its own page), so a
// number never names groups in two editors or two slides.
let nextSeq = 0

/** The numbered groups `state` can undo and redo. A state never seen here
 * (a fresh one) has none. */
export function textHistoryOf(state: EditorState): TextHistoryMirror {
  return mirrors.get(state) ?? EMPTY_TEXT_HISTORY
}

/** What `tr` did to the undo history. Vim's `u` / `Ctrl-R` run the same
 * undo/redo commands as the app does, so they count the same way. */
export function textHistoryEventKind(tr: Transaction): TextHistoryEvent['kind'] {
  if (tr.isUserEvent('undo')) return 'undo'
  if (tr.isUserEvent('redo')) return 'redo'
  if (tr.docChanged && tr.annotation(Transaction.addToHistory) !== false) return 'change'
  return 'other'
}

/** Numbers `tr`'s resulting state from its starting one, and returns the
 * number of the group `tr` started, or `null` when it started none. Call it
 * for every transaction an editor applies, in order. */
export function trackTextHistory(tr: Transaction): number | null {
  const event: TextHistoryEvent = {
    kind: textHistoryEventKind(tr),
    undoDepthBefore: undoDepth(tr.startState),
    undoDepthAfter: undoDepth(tr.state),
    redoDepthAfter: redoDepth(tr.state),
  }
  const { mirror, newGroup } = advanceTextHistory(textHistoryOf(tr.startState), event, nextSeq)
  mirrors.set(tr.state, mirror)
  if (!newGroup) return null
  return nextSeq++
}

/** Gives `to` the numbered groups of `from` — for a state derived from
 * `from` outside any editor (`restoreCodeEditor` reconfiguring a kept
 * state), whose history is the same. */
export function carryTextHistory(from: EditorState, to: EditorState): void {
  mirrors.set(to, textHistoryOf(from))
}

/** Whether the group numbered `seq` is the next one `state` would undo
 * (`'undo'`) or redo (`'redo'`). */
export function canReplayTextGroup(state: EditorState, direction: 'undo' | 'redo', seq: number): boolean {
  const mirror = textHistoryOf(state)
  return direction === 'undo' ? canUndoTextGroup(mirror, seq) : canRedoTextGroup(mirror, seq)
}
