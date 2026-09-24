import { createSignal } from '@barefootjs/client'
import {
  EMPTY_HISTORY,
  type EditorHistory,
  type HistoryStep,
  pushRedo,
  pushUndo,
  record,
  takeRedo,
  takeUndo,
} from '../domain/editorHistory'

/** The window's structural undo/redo history (`domain/editorHistory.ts`).
 * Lives only as long as the window: nothing here is persisted.
 *
 * `takeUndo`/`takeRedo` pop synchronously, before the caller's commit is
 * awaited, so a second Cmd+Z pressed while the first is still saving can't
 * take the same step again. The caller then pushes the opposite step on
 * success, or puts the taken one back on failure. */
export function createHistoryStore() {
  const [history, setHistory] = createSignal<EditorHistory>(EMPTY_HISTORY)

  function takeFrom(take: typeof takeUndo): HistoryStep | null {
    const taken = take(history())
    if (!taken) return null
    setHistory(taken.history)
    return taken.step
  }

  return {
    history,
    /** Records a new operation's undo step, discarding any redo history. */
    record(undoStep: HistoryStep): void {
      setHistory(h => record(h, undoStep))
    },
    takeUndo(): HistoryStep | null {
      return takeFrom(takeUndo)
    },
    takeRedo(): HistoryStep | null {
      return takeFrom(takeRedo)
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

export type HistoryStore = ReturnType<typeof createHistoryStore>
