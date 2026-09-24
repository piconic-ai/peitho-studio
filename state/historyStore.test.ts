import { describe, expect, test } from 'bun:test'
import { createRoot } from '@barefootjs/client'
import { createHistoryStore } from './historyStore'
import { EMPTY_HISTORY, type HistoryStep } from '../domain/editorHistory'

const UNDO_INSERT: HistoryStep = { kind: 'slides', cmd: { type: 'delete', index: 1 } }
const REDO_INSERT: HistoryStep = { kind: 'slides', cmd: { type: 'insert', at: 1, text: '# New Slide' } }
const UNDO_LAYOUT: HistoryStep = { kind: 'config', index: 0, patch: { layout: 'cover' } }

describe('history store', () => {
  test('spec: Given a recorded operation, when undo is taken, then the step leaves the undo stack right away', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.record(UNDO_INSERT)

      expect(store.takeUndo()).toEqual(UNDO_INSERT)
      // A second Cmd+Z pressed before the first commit finished finds nothing.
      expect(store.takeUndo()).toBeNull()
    })
  })

  test('spec: Given an undo that finished, when its redo step is pushed and redo is taken, then the redo step comes back', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.record(UNDO_INSERT)
      store.takeUndo()
      store.pushRedo(REDO_INSERT)

      expect(store.takeRedo()).toEqual(REDO_INSERT)
      expect(store.history().redo).toEqual([])
    })
  })

  test('spec: Given something to redo, when a new operation is recorded, then redo is no longer possible', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.pushRedo(REDO_INSERT)

      store.record(UNDO_LAYOUT)

      expect(store.takeRedo()).toBeNull()
      expect(store.history().undo).toEqual([UNDO_LAYOUT])
    })
  })

  test('spec: Given an undo whose commit failed, when the step is put back, then it can be undone again', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.record(UNDO_LAYOUT)
      const step = store.takeUndo()!

      store.pushUndo(step)

      expect(store.takeUndo()).toEqual(UNDO_LAYOUT)
    })
  })

  test('spec: Given a history, when the deck is reloaded from disk, then everything is forgotten', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.record(UNDO_INSERT)
      store.pushRedo(REDO_INSERT)

      store.clear()

      expect(store.history()).toEqual(EMPTY_HISTORY)
    })
  })

  test('adversarial: taking from an empty store leaves it empty', () => {
    createRoot(() => {
      const store = createHistoryStore()
      expect(store.takeUndo()).toBeNull()
      expect(store.takeRedo()).toBeNull()
      expect(store.history()).toEqual(EMPTY_HISTORY)
    })
  })

  test('adversarial: two stores never share history', () => {
    createRoot(() => {
      const a = createHistoryStore()
      const b = createHistoryStore()
      a.record(UNDO_INSERT)
      expect(b.takeUndo()).toBeNull()
    })
  })
})
