import { describe, expect, test } from 'bun:test'
import { arm, move, dropTarget, cancel, type DragState } from './drag'

describe('arm', () => {
  test('spec: arming captures the row index and the mousedown point', () => {
    expect(arm(2, 100, 200)).toEqual({ kind: 'armed', index: 2, startX: 100, startY: 200 })
  })
})

describe('move', () => {
  test('spec: idle ignores every move', () => {
    const idle: DragState = { kind: 'idle' }
    expect(move(idle, 999, 999, 3)).toBe(idle)
  })

  test('spec: armed stays armed under the 4px threshold', () => {
    const armed = arm(0, 100, 100)
    expect(move(armed, 102, 100, 1)).toBe(armed)
  })

  test('spec: armed promotes to dragging once past the 4px threshold', () => {
    const armed = arm(0, 100, 100)
    expect(move(armed, 105, 100, 1)).toEqual({ kind: 'dragging', index: 0, startY: 100, gap: 1, deltaY: 0 })
  })

  test('spec: dragging refreshes gap and deltaY on further moves', () => {
    const dragging: DragState = { kind: 'dragging', index: 0, startY: 100, gap: 1, deltaY: 5 }
    expect(move(dragging, 100, 140, 3)).toEqual({ kind: 'dragging', index: 0, startY: 100, gap: 3, deltaY: 40 })
  })

  test('adversarial: distance exactly at the threshold already counts as dragging (the check is `< threshold`, not `<=`)', () => {
    const armed = arm(0, 100, 100)
    expect(move(armed, 104, 100, 1).kind).toBe('dragging')
  })

  test('adversarial: a diagonal move can cross the threshold without either axis alone doing so', () => {
    const armed = arm(0, 100, 100)
    // dx=3, dy=3 -> hypot ~4.24, over the 4px threshold, but each axis alone is under it
    expect(move(armed, 103, 103, 2).kind).toBe('dragging')
  })

  test('adversarial: deltaY can go negative when the cursor moves above the start point', () => {
    const dragging: DragState = { kind: 'dragging', index: 2, startY: 200, gap: 2, deltaY: 0 }
    expect(move(dragging, 0, 150, 0)).toEqual({ kind: 'dragging', index: 2, startY: 200, gap: 0, deltaY: -50 })
  })
})

describe('dropTarget', () => {
  test('spec: dragging resolves the gap into a destination index via gapToIndex', () => {
    expect(dropTarget({ kind: 'dragging', index: 3, startY: 0, gap: 0, deltaY: 0 })).toEqual({ from: 3, to: 0 })
  })

  test('adversarial: idle has no drop target', () => {
    expect(dropTarget({ kind: 'idle' })).toBeNull()
  })

  test('adversarial: armed (never crossed the threshold) has no drop target', () => {
    expect(dropTarget(arm(1, 0, 0))).toBeNull()
  })

  test('adversarial: dropping back into the row\'s own gap resolves to its own index (a no-op left to the caller)', () => {
    expect(dropTarget({ kind: 'dragging', index: 2, startY: 0, gap: 2, deltaY: 0 })).toEqual({ from: 2, to: 2 })
  })
})

describe('cancel', () => {
  test('spec: cancel always returns idle', () => {
    expect(cancel()).toEqual({ kind: 'idle' })
  })
})
