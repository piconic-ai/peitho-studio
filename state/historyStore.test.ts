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

      expect(store.take('undo')).toEqual(UNDO_INSERT)
      // A second Cmd+Z pressed before the first commit finished finds nothing.
      expect(store.take('undo')).toBeNull()
    })
  })

  test('spec: Given an undo that finished, when its redo step is pushed and redo is taken, then the redo step comes back', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.record(UNDO_INSERT)
      store.take('undo')
      store.pushRedo(REDO_INSERT)

      expect(store.take('redo')).toEqual(REDO_INSERT)
      expect(store.history().redo).toEqual([])
    })
  })

  test('spec: Given something to redo, when a new operation is recorded, then redo is no longer possible', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.pushRedo(REDO_INSERT)

      store.record(UNDO_LAYOUT)

      expect(store.take('redo')).toBeNull()
      expect(store.history().undo).toEqual([UNDO_LAYOUT])
    })
  })

  test('spec: Given an undo whose commit failed, when the step is put back, then it can be undone again', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.record(UNDO_LAYOUT)
      const step = store.take('undo')!

      store.pushUndo(step)

      expect(store.take('undo')).toEqual(UNDO_LAYOUT)
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
      expect(store.take('undo')).toBeNull()
      expect(store.take('redo')).toBeNull()
      expect(store.history()).toEqual(EMPTY_HISTORY)
    })
  })

  test('spec: Given text markers the editor already took back, when undo is taken, then they are dropped and the step below comes back', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.record(UNDO_LAYOUT)
      store.record({ kind: 'text', index: 0, field: 'body', seq: 1 })

      expect(store.take('undo', () => false)).toEqual(UNDO_LAYOUT)
      expect(store.history()).toEqual(EMPTY_HISTORY)
    })
  })

  test('adversarial: Given only text markers the editor already took back, when undo is taken, then nothing comes back and they are gone', () => {
    createRoot(() => {
      const store = createHistoryStore()
      store.record({ kind: 'text', index: 0, field: 'note', seq: 4 })

      expect(store.take('undo', () => false)).toBeNull()
      expect(store.history()).toEqual(EMPTY_HISTORY)
    })
  })

  test('adversarial: two stores never share history', () => {
    createRoot(() => {
      const a = createHistoryStore()
      const b = createHistoryStore()
      a.record(UNDO_INSERT)
      expect(b.take('undo')).toBeNull()
    })
  })
})
