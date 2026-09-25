import { createSignal } from '@barefootjs/client'
import {
  EMPTY_HISTORY,
  type EditorHistory,
  type HistoryStep,
  type TextStep,
  pushRedo,
  pushUndo,
  record,
  takeLive,
} from '../domain/editorHistory'

/** The window's undo/redo timeline (`domain/editorHistory.ts`): slide
 * operations and markers for the text editors' typing, in one order. Lives
 * only as long as the window: nothing here is persisted.
 *
 * `take` pops synchronously, before the caller's commit is
 * awaited, so a second Cmd+Z pressed while the first is still saving can't
 * take the same step again. The caller then pushes the opposite step on
 * success, or puts the taken one back on failure. */
export function createHistoryStore() {
  const [history, setHistory] = createSignal<EditorHistory>(EMPTY_HISTORY)

  return {
    history,
    /** Records a new operation's undo step, discarding any redo history. */
    record(undoStep: HistoryStep): void {
      setHistory(h => record(h, undoStep))
    },
    /** Takes the newest undo (or redo) step that can still run, dropping
     * the text markers above it that `isLive` says can't (`takeLive`). */
    take(direction: 'undo' | 'redo', isLive: (step: TextStep) => boolean = () => true): HistoryStep | null {
      const taken = takeLive(history(), direction, isLive)
      if (taken.history !== history()) setHistory(taken.history)
      return taken.step
    },
    pushUndo(step: HistoryStep): void {
      setHistory(h => pushUndo(h, step))
    },
    pushRedo(step: HistoryStep): void {
      setHistory(h => pushRedo(h, step))
    },
    /** Forgets everything — for when the deck is (re)loaded from disk, since
     * steps address slides by position. */
    clear(): void {
      setHistory(EMPTY_HISTORY)
    },
  }
}
