// The body and notes editors' states of the slides the user has left, so
// coming back to a slide brings back its text history (undo/redo) and
// cursor instead of starting fresh (`components/Studio.tsx`'s
// `syncEditorFields`).
//
// Kept out of `state/` and out of any signal: a CodeMirror `EditorState`
// is nothing the UI reads reactively. One cache per `Studio`, made by the
// factory below — never a module-wide instance, since each window has its
// own deck.
//
// Keyed by slide position, not by the slide's `key`: a key derived from
// the heading changes as the user edits it. A command that moves slides
// around (insert, delete, move) has to `shift` the cache to match.

import { indexAfterCommand, type SlideCommand } from '../domain/slideCommands'

export interface EditorSlideStates<T> {
  /** Keeps `entry` as the state of the slide at `index`, replacing any. */
  store(index: number, entry: T): void
  /** Removes and returns the state kept for the slide at `index`. */
  take(index: number): T | undefined
  /** Moves every kept state to where its slide sits after `cmd`; the state
   * of a slide `cmd` deleted is dropped. */
  shift(cmd: SlideCommand): void
  /** Drops every kept state. */
  clear(): void
}

export function createEditorSlideStates<T>(): EditorSlideStates<T> {
  let states = new Map<number, T>()
  return {
    store(index, entry) {
      states.set(index, entry)
    },
    take(index) {
      const entry = states.get(index)
      states.delete(index)
      return entry
    },
    shift(cmd) {
      const shifted = new Map<number, T>()
      for (const [index, entry] of states) {
        const next = indexAfterCommand(index, cmd)
        if (next !== null) shifted.set(next, entry)
      }
      states = shifted
    },
    clear() {
      states = new Map()
    },
  }
}
