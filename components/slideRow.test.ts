import { describe, expect, test } from 'bun:test'
import { slideRowClass } from './slideRow'

const row = {
  index: 1,
  draggedIndex: null,
  dragOverGap: null,
  entryCount: 4,
  lastVisibleRow: 3,
  visibility: 'full',
} satisfies Parameters<typeof slideRowClass>[0]

describe('slide row appearance', () => {
  test('ordinary rows stay visible and draggable', () => {
    expect(slideRowClass(row)).toBe('cursor-grab')
    expect(slideRowClass({ ...row, visibility: 'header-only' })).toBe('cursor-grab')
  })

  test('the dragged row floats and the hovered gap is marked', () => {
    expect(slideRowClass({ ...row, draggedIndex: 1, dragOverGap: 1 }))
      .toBe('relative z-10 opacity-60 shadow-lg rounded-md border-t-2 border-t-primary cursor-grab')
  })

  test('the final gap belongs to the last visible row, including a folded header', () => {
    expect(slideRowClass({ ...row, draggedIndex: 0, dragOverGap: 4, lastVisibleRow: 1, visibility: 'header-only' }))
      .toBe('border-b-2 border-b-primary cursor-grab')
    expect(slideRowClass({ ...row, draggedIndex: 0, dragOverGap: 4 })).toBe('cursor-grab')
  })

  test('stale gaps without a drag do not draw drop markers', () => {
    expect(slideRowClass({ ...row, dragOverGap: 1 })).toBe('cursor-grab')
    expect(slideRowClass({ ...row, dragOverGap: 4, lastVisibleRow: 1 })).toBe('cursor-grab')
  })

  test('hidden and missing visibility remain distinct', () => {
    expect(slideRowClass({ ...row, visibility: 'hidden' })).toBe('hidden cursor-grab')
    expect(slideRowClass({ ...row, visibility: undefined })).toBe('cursor-grab')
    expect(slideRowClass({ ...row, index: 0, entryCount: 0, lastVisibleRow: null, dragOverGap: 0 }))
      .toBe('cursor-grab')
  })
})
