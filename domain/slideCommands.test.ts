import { describe, expect, test } from 'bun:test'
import { applyCommand, indexAfterCommand, needsTimeResync, selectionPlanFor, validate, type SlideCommand } from './slideCommands'

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

describe('indexAfterCommand', () => {
  test('spec: Given a slide inserted before, at, or after a position, then the slide at that position shifts down only when the insert lands at or before it', () => {
    const insertAt2: SlideCommand = { type: 'insert', at: 2, text: 'x' }
    expect(indexAfterCommand(1, insertAt2)).toBe(1)
    expect(indexAfterCommand(2, insertAt2)).toBe(3)
    expect(indexAfterCommand(3, insertAt2)).toBe(4)
  })

  test('spec: Given a slide deleted, then that slide has no position, slides after it move up one, and slides before it stay', () => {
    const delete1: SlideCommand = { type: 'delete', index: 1 }
    expect(indexAfterCommand(0, delete1)).toBe(0)
    expect(indexAfterCommand(1, delete1)).toBeNull()
    expect(indexAfterCommand(2, delete1)).toBe(1)
  })

  test('spec: Given a slide moved, then the moved slide lands on `to` and the slides it passed shift one place toward `from`', () => {
    const move0to2: SlideCommand = { type: 'move', from: 0, to: 2 }
    expect(indexAfterCommand(0, move0to2)).toBe(2)
    expect(indexAfterCommand(1, move0to2)).toBe(0)
    expect(indexAfterCommand(2, move0to2)).toBe(1)
    expect(indexAfterCommand(3, move0to2)).toBe(3)
    const move2to0: SlideCommand = { type: 'move', from: 2, to: 0 }
    expect(indexAfterCommand(2, move2to0)).toBe(0)
    expect(indexAfterCommand(0, move2to0)).toBe(1)
    expect(indexAfterCommand(1, move2to0)).toBe(2)
  })

  test('spec: Given a slide replaced, then no slide moves', () => {
    const replace1: SlideCommand = { type: 'replace', index: 1, text: 'x' }
    expect([0, 1, 2].map(i => indexAfterCommand(i, replace1))).toEqual([0, 1, 2])
  })

  test('spec: every position a command keeps names the same slide text before and after applyCommand', () => {
    const texts = ['a', 'b', 'c', 'd']
    const commands: SlideCommand[] = [
      { type: 'insert', at: 0, text: 'x' },
      { type: 'insert', at: 4, text: 'x' },
      { type: 'delete', index: 0 },
      { type: 'delete', index: 3 },
      { type: 'move', from: 3, to: 1 },
      { type: 'move', from: 1, to: 3 },
      { type: 'replace', index: 2, text: 'c' },
    ]
    for (const cmd of commands) {
      const after = applyCommand(texts, cmd)
      texts.forEach((text, i) => {
        const j = indexAfterCommand(i, cmd)
        if (j !== null) expect(after[j]).toBe(text)
      })
    }
  })

  test('adversarial: inserting at the end of the list moves nothing, and at 0 moves everything', () => {
    expect(indexAfterCommand(2, { type: 'insert', at: 3, text: 'x' })).toBe(2)
    expect(indexAfterCommand(0, { type: 'insert', at: 0, text: 'x' })).toBe(1)
  })

  test('adversarial: moving a slide onto its own position moves nothing', () => {
    const noop: SlideCommand = { type: 'move', from: 1, to: 1 }
    expect([0, 1, 2].map(i => indexAfterCommand(i, noop))).toEqual([0, 1, 2])
  })

  test('adversarial: a negative or non-integer position names no slide', () => {
    for (const cmd of ALL_KINDS) {
      expect(indexAfterCommand(-1, cmd)).toBeNull()
      expect(indexAfterCommand(0.5, cmd)).toBeNull()
      expect(indexAfterCommand(Number.NaN, cmd)).toBeNull()
    }
  })

  test('adversarial: a position past the last slide is shifted by the same arithmetic, not rejected', () => {
    expect(indexAfterCommand(99, { type: 'insert', at: 1, text: 'x' })).toBe(100)
    expect(indexAfterCommand(99, { type: 'delete', index: 1 })).toBe(98)
  })
})
