import { describe, expect, test } from 'bun:test'
import { selectionAfter, type SelectionPlan } from './editorSession'

describe('selectionAfter', () => {
  test('spec: `keep` leaves the selection where it was', () => {
    expect(selectionAfter({ kind: 'keep' }, 2, 4)).toBe(2)
  })

  test('spec: `follow-move` moves the selection to `to` when it was the dragged slide', () => {
    expect(selectionAfter({ kind: 'follow-move', from: 3, to: 0 }, 3, 4)).toBe(0)
  })

  test('spec: `follow-move` keeps a *different* open slide pinned to its own (shifted) position', () => {
    // bug-regression (fe4aa3f): dragging slide 3 to the front must not
    // drag the editor's selection there too when slide 1 is what's open.
    expect(selectionAfter({ kind: 'follow-move', from: 3, to: 0 }, 1, 4)).toBe(2)
  })

  test('spec: `select` moves the selection onto the newly inserted/pasted slide', () => {
    expect(selectionAfter({ kind: 'select', index: 2 }, 0, 5)).toBe(2)
  })

  test('spec: `clamp-after-delete` moves the selection to where the deleted slide was', () => {
    expect(selectionAfter({ kind: 'clamp-after-delete', deleted: 1 }, 1, 3)).toBe(1)
  })

  test('adversarial: `keep` falls back to the first slide once its old index is out of range', () => {
    expect(selectionAfter({ kind: 'keep' }, 99, 3)).toBe(0)
  })

  test('adversarial: `select`/`clamp-after-delete` clamp an out-of-range target to the last slide', () => {
    expect(selectionAfter({ kind: 'select', index: 99 }, 0, 3)).toBe(2)
    expect(selectionAfter({ kind: 'clamp-after-delete', deleted: 99 }, 0, 3)).toBe(2)
  })

  test('adversarial: every plan except `follow-move` returns null once the list is empty', () => {
    // `follow-move` is excluded: its contract only ever gets exercised
    // with an `indexAfterMove`-valid `current`/`from`/`to`, which can't
    // produce an empty list (a move never removes a slide) — unlike the
    // other three plans, it has no defined behavior to test out of range.
    const plans: SelectionPlan[] = [
      { kind: 'keep' },
      { kind: 'select', index: 0 },
      { kind: 'clamp-after-delete', deleted: 0 },
    ]
    for (const plan of plans) {
      expect(selectionAfter(plan, 0, 0)).toBeNull()
    }
  })

  test('adversarial: `keep`/`follow-move` fall back to the first slide when nothing was selected before', () => {
    expect(selectionAfter({ kind: 'keep' }, null, 4)).toBe(0)
    expect(selectionAfter({ kind: 'follow-move', from: 2, to: 0 }, null, 4)).toBe(0)
  })
})
