import { describe, expect, test } from 'bun:test'
import { applyCommand, needsTimeResync, selectionPlanFor, validate, type SlideCommand } from './slideCommands'

const ALL_KINDS: SlideCommand[] = [
  { type: 'insert', at: 1, text: 'x' },
  { type: 'delete', index: 1 },
  { type: 'move', from: 0, to: 1 },
  { type: 'replace', index: 1, text: 'x' },
]

describe('applyCommand', () => {
  test('spec: insert splices a slide in at `at`', () => {
    expect(applyCommand(['a', 'b'], { type: 'insert', at: 1, text: 'new' })).toEqual(['a', 'new', 'b'])
  })

  test('spec: delete removes the slide at `index`', () => {
    expect(applyCommand(['a', 'b', 'c'], { type: 'delete', index: 1 })).toEqual(['a', 'c'])
  })

  test('spec: move relocates the slide from `from` to `to`', () => {
    expect(applyCommand(['a', 'b', 'c'], { type: 'move', from: 2, to: 0 })).toEqual(['c', 'a', 'b'])
  })

  test('spec: replace overwrites the slide at `index`', () => {
    expect(applyCommand(['a', 'b'], { type: 'replace', index: 0, text: 'A' })).toEqual(['A', 'b'])
  })

  test('adversarial: the input array is never mutated', () => {
    const texts = ['a', 'b', 'c']
    applyCommand(texts, { type: 'delete', index: 0 })
    expect(texts).toEqual(['a', 'b', 'c'])
  })

  test('adversarial: inserting at the end of the list appends', () => {
    expect(applyCommand(['a'], { type: 'insert', at: 1, text: 'b' })).toEqual(['a', 'b'])
  })

  test('adversarial: moving a slide to its own position is a no-op', () => {
    expect(applyCommand(['a', 'b', 'c'], { type: 'move', from: 1, to: 1 })).toEqual(['a', 'b', 'c'])
  })
})

describe('needsTimeResync', () => {
  test('spec: move is the only command that never changes section totals', () => {
    for (const cmd of ALL_KINDS) {
      expect(needsTimeResync(cmd)).toBe(cmd.type !== 'move')
    }
  })
})

describe('selectionPlanFor', () => {
  test('spec: insert selects the newly inserted slide', () => {
    expect(selectionPlanFor({ type: 'insert', at: 2, text: 'x' })).toEqual({ kind: 'select', index: 2 })
  })

  test('spec: delete clamps to where the deleted slide was', () => {
    expect(selectionPlanFor({ type: 'delete', index: 1 })).toEqual({ kind: 'clamp-after-delete', deleted: 1 })
  })

  test('spec: move follows the dragged slide', () => {
    expect(selectionPlanFor({ type: 'move', from: 0, to: 2 })).toEqual({ kind: 'follow-move', from: 0, to: 2 })
  })

  test('spec: replace never moves the selection', () => {
    expect(selectionPlanFor({ type: 'replace', index: 1, text: 'x' })).toEqual({ kind: 'keep' })
  })
})

describe('validate', () => {
  test('spec: every command is accepted against a list it fits inside', () => {
    for (const cmd of ALL_KINDS) {
      expect(validate(['a', 'b', 'c'], cmd)).toBeNull()
    }
  })

  test('adversarial: delete rejects removing the last remaining slide', () => {
    expect(validate(['a'], { type: 'delete', index: 0 })).toEqual({ reason: 'last-slide' })
  })

  test('adversarial: delete/replace/move reject an out-of-range index', () => {
    expect(validate(['a', 'b'], { type: 'delete', index: 2 })).toEqual({ reason: 'index-out-of-range' })
    expect(validate(['a', 'b'], { type: 'replace', index: -1, text: 'x' })).toEqual({ reason: 'index-out-of-range' })
    expect(validate(['a', 'b'], { type: 'move', from: 0, to: 2 })).toEqual({ reason: 'index-out-of-range' })
    expect(validate(['a', 'b'], { type: 'move', from: -1, to: 0 })).toEqual({ reason: 'index-out-of-range' })
  })

  test('adversarial: insert accepts `at` equal to the list length (append) but rejects past it', () => {
    expect(validate(['a', 'b'], { type: 'insert', at: 2, text: 'x' })).toBeNull()
    expect(validate(['a', 'b'], { type: 'insert', at: 3, text: 'x' })).toEqual({ reason: 'index-out-of-range' })
    expect(validate(['a', 'b'], { type: 'insert', at: -1, text: 'x' })).toEqual({ reason: 'index-out-of-range' })
  })

  test('adversarial: an empty list still accepts an insert at 0', () => {
    expect(validate([], { type: 'insert', at: 0, text: 'x' })).toBeNull()
  })
})
