import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  EMPTY_HISTORY,
  MAX_HISTORY_DEPTH,
  applyFrontmatterStep,
  applyLayoutPinsStep,
  inverseLayoutPinsStep,
  layoutPinsStepFor,
  layoutPinnedSlide,
  applyPageNumbersStep,
  commandForStep,
  hiddenPageNumberSlides,
  historyPinsLayout,
  stepPinsLayout,
  inverseFrontmatterStep,
  inversePageNumbersStep,
  pageNumbersStepFor,
  inverseCommand,
  inverseConfigPatch,
  inverseStep,
  pushRedo,
  pushUndo,
  record,
  selectionForReplay,
  slideConfigOfText,
  takeLive,
  takeRedo,
  takeUndo,
  type EditorHistory,
  type FrontmatterStep,
  type HistoryStep,
  type PageNumbersStep,
  type StructuralStep,
  type TextStep,
} from './editorHistory'
import { applyCommand, validate, type SlideCommand } from './slideCommands'

const DELETE_0: HistoryStep = { kind: 'slides', cmd: { type: 'delete', index: 0 } }
const MOVE_1_0: HistoryStep = { kind: 'slides', cmd: { type: 'move', from: 1, to: 0 } }
const LAYOUT_OFF: HistoryStep = { kind: 'config', index: 0, patch: { layout: undefined } }

/** Runs `step` against `texts` the way Studio.tsx does, returning the new
 * list and the step that undoes it. */
function perform(texts: string[], step: StructuralStep): { texts: string[]; inverse: StructuralStep } {
  const cmd = commandForStep(texts, step)
  const rejection = validate(texts, cmd)
  if (rejection) throw new Error(`rejected: ${rejection.reason}`)
  return { texts: applyCommand(texts, cmd), inverse: inverseStep(texts, step) }
}

describe('history stacks: functional requirements', () => {
  test('spec: Given one recorded operation, when it is undone, then it moves onto the redo stack', () => {
    const history = record(EMPTY_HISTORY, DELETE_0)

    const taken = takeUndo(history)

    expect(taken?.step).toEqual(DELETE_0)
    expect(pushRedo(taken!.history, MOVE_1_0)).toEqual({ undo: [], redo: [MOVE_1_0] })
  })

  test('spec: Given an undone operation, when it is redone, then it moves back onto the undo stack', () => {
    const history: EditorHistory = { undo: [], redo: [MOVE_1_0] }

    const taken = takeRedo(history)

    expect(taken?.step).toEqual(MOVE_1_0)
    expect(pushUndo(taken!.history, DELETE_0)).toEqual({ undo: [DELETE_0], redo: [] })
  })

  test('spec: Given several recorded operations, when undo is pressed repeatedly, then they come back newest first', () => {
    let history = EMPTY_HISTORY
    for (const step of [DELETE_0, MOVE_1_0, LAYOUT_OFF]) history = record(history, step)

    const order: HistoryStep[] = []
    for (let taken = takeUndo(history); taken; taken = takeUndo(taken.history)) order.push(taken.step)

    expect(order).toEqual([LAYOUT_OFF, MOVE_1_0, DELETE_0])
  })

  test('spec: Given something to redo, when a new operation is recorded, then the redo history is discarded', () => {
    const history: EditorHistory = { undo: [DELETE_0], redo: [MOVE_1_0] }

    expect(record(history, LAYOUT_OFF)).toEqual({ undo: [DELETE_0, LAYOUT_OFF], redo: [] })
  })

  test('spec: Given something to redo, when a redo step is pushed back onto undo, then the remaining redo history is kept', () => {
    const history: EditorHistory = { undo: [], redo: [MOVE_1_0] }

    expect(pushUndo(history, DELETE_0).redo).toEqual([MOVE_1_0])
  })

  test('adversarial: undo and redo on an empty history do nothing', () => {
    expect(takeUndo(EMPTY_HISTORY)).toBeNull()
    expect(takeRedo(EMPTY_HISTORY)).toBeNull()
  })

  test('adversarial: the input history is never mutated', () => {
    const history: EditorHistory = { undo: [DELETE_0], redo: [MOVE_1_0] }
    record(history, LAYOUT_OFF)
    takeUndo(history)
    takeRedo(history)
    pushUndo(history, LAYOUT_OFF)
    pushRedo(history, LAYOUT_OFF)
    expect(history).toEqual({ undo: [DELETE_0], redo: [MOVE_1_0] })
  })
})

describe('history stacks: non-functional requirements', () => {
  test('bounded memory: Given a full undo stack, when one more operation is recorded, then the oldest one is dropped', () => {
    let history = EMPTY_HISTORY
    for (let i = 0; i < MAX_HISTORY_DEPTH; i++) history = record(history, { kind: 'slides', cmd: { type: 'delete', index: i } })

    history = record(history, LAYOUT_OFF)

    expect(history.undo).toHaveLength(MAX_HISTORY_DEPTH)
    expect(history.undo[0]).toEqual({ kind: 'slides', cmd: { type: 'delete', index: 1 } })
    expect(history.undo[MAX_HISTORY_DEPTH - 1]).toEqual(LAYOUT_OFF)
  })

  test('bounded memory: the redo stack is capped the same way', () => {
    let history = EMPTY_HISTORY
    for (let i = 0; i < MAX_HISTORY_DEPTH + 5; i++) history = pushRedo(history, DELETE_0)
    expect(history.redo).toHaveLength(MAX_HISTORY_DEPTH)
  })
})

describe('inverseCommand', () => {
  test('spec: the inverse of an insert deletes the inserted slide', () => {
    expect(inverseCommand(['a', 'b'], { type: 'insert', at: 1, text: 'new' })).toEqual({ type: 'delete', index: 1 })
  })

  test('spec: the inverse of a delete re-inserts the deleted text at the same position', () => {
    expect(inverseCommand(['a', 'b', 'c'], { type: 'delete', index: 1 })).toEqual({ type: 'insert', at: 1, text: 'b' })
  })

  test('spec: the inverse of a move moves the slide back', () => {
    expect(inverseCommand(['a', 'b', 'c'], { type: 'move', from: 2, to: 0 })).toEqual({ type: 'move', from: 0, to: 2 })
  })

  test('spec: the inverse of a replace restores the previous text', () => {
    expect(inverseCommand(['a', 'b'], { type: 'replace', index: 0, text: 'A' })).toEqual({ type: 'replace', index: 0, text: 'a' })
  })

  test('adversarial: an out-of-range delete/replace inverts to an empty text instead of throwing', () => {
    expect(inverseCommand([], { type: 'delete', index: 3 })).toEqual({ type: 'insert', at: 3, text: '' })
    expect(inverseCommand(['a'], { type: 'replace', index: -1, text: 'x' })).toEqual({ type: 'replace', index: -1, text: '' })
  })

  test('adversarial: a move onto its own position inverts to itself', () => {
    expect(inverseCommand(['a', 'b'], { type: 'move', from: 1, to: 1 })).toEqual({ type: 'move', from: 1, to: 1 })
  })

  test('property: applying a valid command and then its inverse gives back the original list', () => {
    const texts = fc.array(fc.string(), { minLength: 1, maxLength: 8 })
    const withCommand = texts.chain(list => fc.tuple(
      fc.constant(list),
      fc.oneof(
        fc.record({ type: fc.constant('insert' as const), at: fc.integer({ min: 0, max: list.length }), text: fc.string() }),
        fc.record({ type: fc.constant('delete' as const), index: fc.integer({ min: 0, max: list.length - 1 }) }),
        fc.record({ type: fc.constant('move' as const), from: fc.integer({ min: 0, max: list.length - 1 }), to: fc.integer({ min: 0, max: list.length - 1 }) }),
        fc.record({ type: fc.constant('replace' as const), index: fc.integer({ min: 0, max: list.length - 1 }), text: fc.string() }),
      ) as fc.Arbitrary<SlideCommand>,
    ))
    fc.assert(fc.property(withCommand, ([list, cmd]) => {
      fc.pre(validate(list, cmd) === null)
      const after = applyCommand(list, cmd)
      expect(applyCommand(after, inverseCommand(list, cmd))).toEqual(list)
    }))
  })
})

describe('inverseConfigPatch', () => {
  test('spec: a changed field is restored to its previous value', () => {
    expect(inverseConfigPatch({ key: 'k', layout: 'cover' }, { layout: 'statement' })).toEqual({ layout: 'cover' })
  })

  test('spec: a field the slide did not have is removed again', () => {
    const inverse = inverseConfigPatch({ key: 'k' }, { draft: true })
    expect('draft' in inverse).toBe(true)
    expect(inverse.draft).toBeUndefined()
  })

  test('spec: section and time are restored together', () => {
    expect(inverseConfigPatch({ section: 'Intro', time: '1m' }, { section: undefined, time: undefined }))
      .toEqual({ section: 'Intro', time: '1m' })
  })

  test('adversarial: an empty patch inverts to an empty patch', () => {
    expect(inverseConfigPatch({ layout: 'cover' }, {})).toEqual({})
  })

  test('adversarial: fields the patch does not name are left out, even when the slide has them', () => {
    expect(Object.keys(inverseConfigPatch({ key: 'k', layout: 'cover', skip: true }, { skip: false }))).toEqual(['skip'])
  })
})

describe('slideConfigOfText', () => {
  test('spec: reads the PageComment of a slide with a speaker note', () => {
    expect(slideConfigOfText('<!-- {"layout":"cover"} -->\n# T\n\n<!--\nnote\n-->\n')).toEqual({ layout: 'cover' })
  })

  test('adversarial: a slide with no PageComment, an empty text, or malformed JSON has an empty config', () => {
    expect(slideConfigOfText('# T\n')).toEqual({})
    expect(slideConfigOfText('')).toEqual({})
    expect(slideConfigOfText('<!-- {not json -->\n# T')).toEqual({})
  })
})

describe('commandForStep', () => {
  test('spec: a slides step runs its own command', () => {
    expect(commandForStep(['a'], DELETE_0)).toEqual({ type: 'delete', index: 0 })
  })

  test('spec: a config step rewrites only that slide\'s PageComment, keeping its current body', () => {
    const texts = ['<!-- {"key":"a","layout":"cover"} -->\n# Edited since', '# B']
    expect(commandForStep(texts, { kind: 'config', index: 0, patch: { layout: 'statement' } }))
      .toEqual({ type: 'replace', index: 0, text: '<!-- {"key":"a","layout":"statement"} -->\n# Edited since' })
  })

  test('adversarial: a config step past the end of the list yields a replace that validate rejects', () => {
    const cmd = commandForStep(['a'], { kind: 'config', index: 5, patch: { skip: true } })
    expect(validate(['a'], cmd)).toEqual({ reason: 'index-out-of-range' })
  })

  test('adversarial: a config step on an empty text still produces a slide with the PageComment', () => {
    expect(commandForStep([''], { kind: 'config', index: 0, patch: { draft: true } }))
      .toEqual({ type: 'replace', index: 0, text: '<!-- {"draft":true} -->' })
  })
})

describe('undo/redo round trips (functional requirements)', () => {
  const COVER = '<!-- {"key":"cover","layout":"cover"} -->\n# Cover'
  const BODY = '<!-- {"key":"body"} -->\n# Body'

  test('spec: Given a layout change, when it is undone and redone, then the slide goes back and forth between the two layouts', () => {
    const start = [COVER, BODY]
    const changed = perform(start, { kind: 'config', index: 0, patch: { layout: 'statement' } })
    expect(slideConfigOfText(changed.texts[0]).layout).toBe('statement')

    const undone = perform(changed.texts, changed.inverse)
    expect(undone.texts).toEqual(start)

    const redone = perform(undone.texts, undone.inverse)
    expect(redone.texts).toEqual(changed.texts)
  })

  test('spec: Given a layout change followed by typing into that slide, when the layout change is undone, then the typed text stays', () => {
    const changed = perform([COVER], { kind: 'config', index: 0, patch: { layout: 'statement' } })
    const typed = [changed.texts[0].replace('# Cover', '# Cover, retitled')]

    const undone = perform(typed, changed.inverse)

    expect(undone.texts[0]).toBe('<!-- {"key":"cover","layout":"cover"} -->\n# Cover, retitled')
  })

  test('spec: Given a slide marked draft, when that is undone, then the draft flag is removed again', () => {
    const changed = perform([BODY], { kind: 'config', index: 0, patch: { draft: true } })

    const undone = perform(changed.texts, changed.inverse)

    expect(undone.texts).toEqual([BODY])
  })

  test('spec: Given a deleted slide, when the delete is undone, then the slide is back in its old position', () => {
    const deleted = perform([COVER, BODY, '# End'], { kind: 'slides', cmd: { type: 'delete', index: 1 } })

    expect(perform(deleted.texts, deleted.inverse).texts).toEqual([COVER, BODY, '# End'])
  })

  test('spec: Given a new slide someone then typed into, when the insert is undone and redone, then redo brings back the typed text', () => {
    const inserted = perform([COVER], { kind: 'slides', cmd: { type: 'insert', at: 1, text: '# New Slide' } })
    const typed = [inserted.texts[0], '# New Slide\n\ntyped after inserting']

    const undone = perform(typed, inserted.inverse)
    expect(undone.texts).toEqual([COVER])

    expect(perform(undone.texts, undone.inverse).texts).toEqual(typed)
  })

  test('spec: Given a reorder, when it is undone, then the slides are back in their old order', () => {
    const moved = perform(['a', 'b', 'c'], { kind: 'slides', cmd: { type: 'move', from: 0, to: 2 } })

    expect(perform(moved.texts, moved.inverse).texts).toEqual(['a', 'b', 'c'])
  })

  test('adversarial: an undo whose slide no longer exists is rejected instead of applied', () => {
    const inserted = perform(['a'], { kind: 'slides', cmd: { type: 'insert', at: 1, text: 'b' } })
    // The deck shrank from outside (an external edit) since the insert.
    const shrunk = ['a']

    expect(validate(shrunk, commandForStep(shrunk, inserted.inverse))).not.toBeNull()
  })
})

const TEXT_A: TextStep = { kind: 'text', index: 0, field: 'body', seq: 1 }
const TEXT_B: TextStep = { kind: 'text', index: 1, field: 'note', seq: 2 }
const TEXT_C: TextStep = { kind: 'text', index: 0, field: 'body', seq: 3 }

describe('text markers: functional requirements', () => {
  test('spec: Given a text marker, then its inverse is the same marker, so undo and redo both point at that group', () => {
    expect(inverseStep(['a', 'b'], TEXT_A)).toBe(TEXT_A)
  })

  test('spec: Given typing, a slide operation, and more typing, when undo is taken three times, then they come back newest first, text and slide operations alike', () => {
    let history = EMPTY_HISTORY
    for (const step of [TEXT_A, DELETE_0, TEXT_C]) history = record(history, step)

    const order: HistoryStep[] = []
    for (let taken = takeUndo(history); taken; taken = takeUndo(taken.history)) order.push(taken.step)

    expect(order).toEqual([TEXT_C, DELETE_0, TEXT_A])
  })
})

describe('takeLive: skipping text markers the editor already took back', () => {
  const allLive = () => true
  const noneLive = () => false

  test('spec: Given a live text marker on top, then it is taken', () => {
    const history = record(record(EMPTY_HISTORY, DELETE_0), TEXT_A)

    const taken = takeLive(history, 'undo', allLive)

    expect(taken).toEqual({ step: TEXT_A, history: { undo: [DELETE_0], redo: [] } })
  })

  test('spec: Given text markers vim already undid on top, then they are dropped and the next live one is taken', () => {
    const history: EditorHistory = { undo: [TEXT_A, TEXT_B, TEXT_C], redo: [] }

    const taken = takeLive(history, 'undo', step => step.seq === TEXT_A.seq)

    expect(taken).toEqual({ step: TEXT_A, history: { undo: [], redo: [] } })
  })

  test('spec: Given a stale text marker above a slide operation, then skipping stops at the slide operation', () => {
    const history: EditorHistory = { undo: [TEXT_A, DELETE_0, TEXT_C], redo: [] }

    const taken = takeLive(history, 'undo', noneLive)

    expect(taken).toEqual({ step: DELETE_0, history: { undo: [TEXT_A], redo: [] } })
  })

  test('spec: Given only stale text markers, then nothing is taken and all of them are dropped', () => {
    const history: EditorHistory = { undo: [TEXT_A, TEXT_C], redo: [MOVE_1_0] }

    const taken = takeLive(history, 'undo', noneLive)

    expect(taken).toEqual({ step: null, history: { undo: [], redo: [MOVE_1_0] } })
  })

  test('spec: Given redo, then it skips on the redo stack and leaves the undo stack alone', () => {
    const history: EditorHistory = { undo: [DELETE_0], redo: [TEXT_A, TEXT_C] }

    const taken = takeLive(history, 'redo', step => step === TEXT_A)

    expect(taken).toEqual({ step: TEXT_A, history: { undo: [DELETE_0], redo: [] } })
  })

  test('spec: Given a slide operation on top, then liveness is never asked about', () => {
    const history = record(EMPTY_HISTORY, DELETE_0)
    let asked = 0

    const taken = takeLive(history, 'undo', () => { asked++; return false })

    expect(taken.step).toEqual(DELETE_0)
    expect(asked).toBe(0)
  })

  test('adversarial: Given an empty history, then nothing is taken and the history stays empty', () => {
    expect(takeLive(EMPTY_HISTORY, 'undo', allLive)).toEqual({ step: null, history: EMPTY_HISTORY })
    expect(takeLive(EMPTY_HISTORY, 'redo', allLive)).toEqual({ step: null, history: EMPTY_HISTORY })
  })

  test('adversarial: Given a stack at its full depth of stale markers, then all are dropped in one call', () => {
    const undo = Array.from({ length: MAX_HISTORY_DEPTH }, (_, seq): HistoryStep => ({ kind: 'text', index: 0, field: 'body', seq }))

    const taken = takeLive({ undo, redo: [] }, 'undo', noneLive)

    expect(taken).toEqual({ step: null, history: EMPTY_HISTORY })
  })
})

describe('selectionForReplay: which slide an undo or redo opens', () => {
  test('spec: Given a layout change on another slide, when it is undone, then that slide is opened', () => {
    const step: StructuralStep = { kind: 'config', index: 2, patch: { layout: 'cover' } }

    expect(selectionForReplay(step, commandForStep(['a', 'b', 'c'], step), 0)).toEqual({ kind: 'select', index: 2 })
  })

  test('spec: Given a layout change on the open slide, when it is undone, then the open slide stays as it is', () => {
    const step: StructuralStep = { kind: 'config', index: 1, patch: { layout: 'cover' } }

    expect(selectionForReplay(step, commandForStep(['a', 'b'], step), 1)).toEqual({ kind: 'keep' })
  })

  test('spec: Given a reorder of a slide other than the open one, when it is undone, then the moved slide is opened where it lands', () => {
    const step: StructuralStep = { kind: 'slides', cmd: { type: 'move', from: 2, to: 0 } }

    expect(selectionForReplay(step, step.cmd, 1)).toEqual({ kind: 'select', index: 0 })
  })

  test('spec: Given a reorder of the open slide, when it is undone, then the open slide follows its move', () => {
    const step: StructuralStep = { kind: 'slides', cmd: { type: 'move', from: 1, to: 0 } }

    expect(selectionForReplay(step, step.cmd, 1)).toEqual({ kind: 'follow-move', from: 1, to: 0 })
  })

  test('spec: Given an insert or a delete, then the selection is the one the operation itself makes', () => {
    const insert: StructuralStep = { kind: 'slides', cmd: { type: 'insert', at: 1, text: 'x' } }
    const remove: StructuralStep = { kind: 'slides', cmd: { type: 'delete', index: 1 } }

    expect(selectionForReplay(insert, insert.cmd, 0)).toEqual({ kind: 'select', index: 1 })
    expect(selectionForReplay(remove, remove.cmd, 0)).toEqual({ kind: 'clamp-after-delete', deleted: 1 })
  })

  test('adversarial: Given no slide open, then a config change or a reorder still opens the affected slide', () => {
    const config: StructuralStep = { kind: 'config', index: 0, patch: { skip: true } }
    const move: StructuralStep = { kind: 'slides', cmd: { type: 'move', from: 0, to: 1 } }

    expect(selectionForReplay(config, commandForStep(['a'], config), null)).toEqual({ kind: 'select', index: 0 })
    expect(selectionForReplay(move, move.cmd, null)).toEqual({ kind: 'select', index: 1 })
  })
})

/** Runs a page-number step the way Studio.tsx does (slides only — the
 * frontmatter half is `setFrontmatterKey`, tested in frontmatter.test.ts),
 * returning the new slides and the step that undoes it. */
function performPageNumbers(texts: string[], currentValue: string | null, step: PageNumbersStep) {
  return { texts: applyPageNumbersStep(texts, step), inverse: inversePageNumbersStep(texts, currentValue) }
}

const HIDDEN = '<!-- {"page_number":false} -->\n# Cover'
const KEYED_HIDDEN = '<!-- {"key":"agenda","page_number":false} -->\n# Agenda'
const PLAIN = '# Body'

describe('page-number step: functional requirements', () => {
  test('spec: Given a deck showing numbers where the cover hides its own, when the user turns numbers off, then every slide\'s page_number:false is cleared', () => {
    const step = pageNumbersStepFor([HIDDEN, KEYED_HIDDEN, PLAIN], null)

    expect(step).toEqual({ kind: 'page-numbers', value: null, hidden: [] })
    expect(applyPageNumbersStep([HIDDEN, KEYED_HIDDEN, PLAIN], step)).toEqual(['# Cover', '<!-- {"key":"agenda"} -->\n# Agenda', PLAIN])
  })

  test('spec: Given a deck where the cover hides its number, when the user switches to "number / total", then the cover still hides it', () => {
    const step = pageNumbersStepFor([HIDDEN, PLAIN], 'current_of_total')

    expect(step).toEqual({ kind: 'page-numbers', value: 'current_of_total', hidden: [0] })
    expect(applyPageNumbersStep([HIDDEN, PLAIN], step)).toEqual([HIDDEN, PLAIN])
  })

  test('spec: Given numbers turned off (clearing two hidden slides), when that is undone, then the old setting and both slides\' page_number:false come back', () => {
    const before = [HIDDEN, KEYED_HIDDEN, PLAIN]
    const off = performPageNumbers(before, 'current', pageNumbersStepFor(before, null))

    const undone = performPageNumbers(off.texts, null, off.inverse)

    expect(off.inverse).toEqual({ kind: 'page-numbers', value: 'current', hidden: [0, 1] })
    expect(undone.texts).toEqual(before)
    // ...and redoing turns them off again.
    expect(undone.inverse).toEqual({ kind: 'page-numbers', value: null, hidden: [] })
    expect(applyPageNumbersStep(undone.texts, undone.inverse)).toEqual(off.texts)
  })

  test('spec: Given a deck with an unknown page_numbers value, when the user picks a mode and then undoes it, then the unknown value is what comes back', () => {
    const texts = [PLAIN]
    const { inverse } = performPageNumbers(texts, 'both', pageNumbersStepFor(texts, 'current'))

    expect(inverse.value).toBe('both')
  })

  test('spec: slides whose page_number doesn\'t change keep their text byte for byte', () => {
    const untouched = '<!--{"layout": "cover"}-->\n# Odd spacing'

    expect(applyPageNumbersStep([untouched, HIDDEN], { kind: 'page-numbers', value: null, hidden: [] })[0]).toBe(untouched)
  })
})

describe('page-number step: adversarial', () => {
  test('adversarial: an empty hidden list on a deck with no hidden slides changes nothing', () => {
    expect(applyPageNumbersStep([PLAIN, '# Two'], { kind: 'page-numbers', value: 'current', hidden: [] })).toEqual([PLAIN, '# Two'])
  })

  test('adversarial: out-of-range, negative, and fractional positions name no slide and are ignored', () => {
    expect(applyPageNumbersStep([PLAIN], { kind: 'page-numbers', value: 'current', hidden: [5, -1, 0.5, Number.NaN] })).toEqual([PLAIN])
  })

  test('adversarial: a repeated position hides that slide once', () => {
    expect(applyPageNumbersStep([PLAIN], { kind: 'page-numbers', value: 'current', hidden: [0, 0] }))
      .toEqual(['<!-- {"page_number":false} -->\n# Body'])
  })

  test('adversarial: an empty deck and an empty slide don\'t break', () => {
    expect(applyPageNumbersStep([], { kind: 'page-numbers', value: null, hidden: [0] })).toEqual([])
    expect(applyPageNumbersStep([''], { kind: 'page-numbers', value: null, hidden: [] })).toEqual([''])
    expect(hiddenPageNumberSlides([])).toEqual([])
  })

  test('adversarial: a malformed PageComment counts as not hidden and is left alone when turning numbers off', () => {
    const malformed = '<!-- {"page_number":false -->\n# Broken'

    expect(hiddenPageNumberSlides([malformed])).toEqual([])
    expect(applyPageNumbersStep([malformed], { kind: 'page-numbers', value: null, hidden: [] })).toEqual([malformed])
  })

  test('adversarial: page_number:true (refused by peitho) is cleared, and doesn\'t count as hidden', () => {
    const shown = '<!-- {"page_number":true} -->\n# Shown'

    expect(hiddenPageNumberSlides([shown])).toEqual([])
    expect(applyPageNumbersStep([shown], { kind: 'page-numbers', value: 'current', hidden: [] })).toEqual(['# Shown'])
  })

  test('property: applying a step then its inverse gives back the original slides', () => {
    const slide = fc.constantFrom(HIDDEN, KEYED_HIDDEN, PLAIN, '<!-- {"key":"k"} -->\n# K')
    const value = fc.constantFrom(null, 'current', 'current_of_total')
    const hidden = fc.array(fc.integer({ min: -2, max: 8 }), { maxLength: 6 })
    fc.assert(fc.property(fc.array(slide, { maxLength: 6 }), value, value, hidden, (texts, current, next, positions) => {
      const step: PageNumbersStep = { kind: 'page-numbers', value: next, hidden: positions }
      const { texts: after, inverse } = performPageNumbers(texts, current, step)
      return JSON.stringify(applyPageNumbersStep(after, inverse)) === JSON.stringify(texts)
    }))
  })
})

/** Runs a frontmatter step against `source` the way Studio.tsx does,
 * returning the new source and the step that undoes it. */
function performFrontmatter(source: string, step: FrontmatterStep): { source: string; inverse: FrontmatterStep } {
  return { source: applyFrontmatterStep(source, step), inverse: inverseFrontmatterStep(source, step) }
}

describe('frontmatter step: functional requirements', () => {
  test('spec: Given lang: ja, when it is set to fr and undone, then the source is back byte for byte', () => {
    const source = '---\ntime: 1m\nlang: ja\n---\n# Title\n'
    const done = performFrontmatter(source, { kind: 'frontmatter', key: 'lang', value: 'fr' })
    expect(done.source).toBe('---\ntime: 1m\nlang: fr\n---\n# Title\n')
    expect(done.inverse).toEqual({ kind: 'frontmatter', key: 'lang', value: 'ja' })
    expect(applyFrontmatterStep(done.source, done.inverse)).toBe(source)
  })

  test('spec: Given the undo of a change, when it is redone, then the change is back', () => {
    const source = '# Title\n'
    const done = performFrontmatter(source, { kind: 'frontmatter', key: 'aspect_ratio', value: '4:3' })
    const undone = performFrontmatter(done.source, done.inverse)
    expect(undone.source).toBe(source)
    expect(applyFrontmatterStep(undone.source, undone.inverse)).toBe(done.source)
  })
})

describe('frontmatter step: adversarial', () => {
  test('Given no frontmatter, when a key is added and undone, then the added block goes away again', () => {
    const source = '# Title\n'
    const done = performFrontmatter(source, { kind: 'frontmatter', key: 'breaks', value: 'true' })
    expect(done.source).toBe('---\nbreaks: true\n---\n# Title\n')
    expect(done.inverse).toEqual({ kind: 'frontmatter', key: 'breaks', value: null })
    expect(applyFrontmatterStep(done.source, done.inverse)).toBe(source)
  })

  test('Given the deck\'s only key, when it is set to the default (removed) and undone, then the block is rebuilt around it', () => {
    const source = '---\nlang: ja\n---\n# Title\n'
    const done = performFrontmatter(source, { kind: 'frontmatter', key: 'lang', value: null })
    expect(done.source).toBe('# Title\n')
    expect(applyFrontmatterStep(done.source, done.inverse)).toBe(source)
  })

  test('Given a removed key among others, when undone, then its value is back (at the end of the block)', () => {
    const source = '---\nlang: ja\ntime: 1m\n---\n# Title\n'
    const done = performFrontmatter(source, { kind: 'frontmatter', key: 'lang', value: null })
    expect(applyFrontmatterStep(done.source, done.inverse)).toBe('---\ntime: 1m\nlang: ja\n---\n# Title\n')
  })

  test('Given an absent key, when it is removed, then nothing changes and the inverse is a removal too', () => {
    const source = '---\ntime: 1m\n---\n# Title\n'
    const done = performFrontmatter(source, { kind: 'frontmatter', key: 'lang', value: null })
    expect(done.source).toBe(source)
    expect(done.inverse).toEqual({ kind: 'frontmatter', key: 'lang', value: null })
  })

  test('Given an unclosed frontmatter block, when a key is set, then the source is left as it is', () => {
    const source = '---\nlang: ja\n# Title\n'
    const done = performFrontmatter(source, { kind: 'frontmatter', key: 'lang', value: 'en' })
    expect(done.source).toBe(source)
    expect(applyFrontmatterStep(done.source, done.inverse)).toBe(source)
  })

  test('Given a key with an empty value, when it is replaced and undone, then the empty value comes back', () => {
    const source = '---\nlang:\n---\n# Title\n'
    const done = performFrontmatter(source, { kind: 'frontmatter', key: 'lang', value: 'ja' })
    expect(done.inverse.value).toBe('')
    expect(applyFrontmatterStep(done.source, done.inverse)).toBe(source)
  })

  test('property: undoing a step always puts back the key\'s value, whatever it was', () => {
    const value = fc.option(fc.constantFrom('en', 'ja', '4:3', 'true', 'x'), { nil: null })
    fc.assert(fc.property(value, value, (before, after) => {
      const source = applyFrontmatterStep('---\ntime: 1m\n---\n# Title\n', { kind: 'frontmatter', key: 'lang', value: before })
      const done = performFrontmatter(source, { kind: 'frontmatter', key: 'lang', value: after })
      const undone = applyFrontmatterStep(done.source, done.inverse)
      return inverseFrontmatterStep(undone, done.inverse).value === before
    }))
  })
})

describe('layout pins (moving a deleted layout\'s slides)', () => {
  const COVER = '<!-- {"key":"cover","layout":"title-slide"} -->\n# Cover'
  const INTRO = '<!-- {"key":"intro","layout":"title-body"} -->\n# Intro\n\nText.'
  const PLAIN = '# Plain'

  test('spec: Given slides on a layout being deleted, When they are re-pinned, Then each names the replacement and the other slides are untouched', () => {
    const texts = [COVER, INTRO, PLAIN]
    const next = applyLayoutPinsStep(texts, layoutPinsStepFor([1, 2], 'one-column-text'))
    expect(next[0]).toBe(COVER)
    expect(slideConfigOfText(next[1])).toEqual({ key: 'intro', layout: 'one-column-text' })
    expect(next[1]).toContain('# Intro\n\nText.')
    expect(slideConfigOfText(next[2]).layout).toBe('one-column-text')
  })

  test('spec: Given a re-pin, When it is reversed, Then every slide gets back exactly the layout field it had (none for a slide that had none)', () => {
    const texts = [COVER, INTRO, PLAIN]
    const step = layoutPinsStepFor([1, 2], 'one-column-text')
    const inverse = inverseLayoutPinsStep(texts, step)
    expect(inverse).toEqual({ kind: 'layout-pins', pins: [{ index: 1, layout: 'title-body' }, { index: 2, layout: undefined }] })
    const undone = applyLayoutPinsStep(applyLayoutPinsStep(texts, step), inverse)
    expect(undone.map(slideConfigOfText)).toEqual(texts.map(slideConfigOfText))
    expect(undone[1]).toBe(INTRO)
  })

  test('adversarial: Given a slide already on the replacement, Then its text stays byte for byte', () => {
    expect(applyLayoutPinsStep([INTRO], layoutPinsStepFor([0], 'title-body'))[0]).toBe(INTRO)
  })

  test('adversarial: Given positions that name no slide, Then they are ignored by the step and left out of its inverse', () => {
    const step = layoutPinsStepFor([5, -1, 0.5, Number.NaN], 'x')
    expect(applyLayoutPinsStep([INTRO], step)).toEqual([INTRO])
    expect(inverseLayoutPinsStep([INTRO], step).pins).toEqual([])
    expect(applyLayoutPinsStep([], layoutPinsStepFor([0], 'x'))).toEqual([])
  })

  test('adversarial: Given the same slide pinned twice, Then the last pin wins', () => {
    const step = { kind: 'layout-pins' as const, pins: [{ index: 0, layout: 'a' }, { index: 0, layout: 'b' }] }
    expect(slideConfigOfText(applyLayoutPinsStep([PLAIN], step)[0]).layout).toBe('b')
  })

  test('adversarial: Given no slides to move, Then the step changes nothing', () => {
    expect(applyLayoutPinsStep([COVER, PLAIN], layoutPinsStepFor([], 'x'))).toEqual([COVER, PLAIN])
  })
})

describe('stepPinsLayout / historyPinsLayout (forgetting history after a layout is deleted)', () => {
  const ON_QUOTE = '<!-- {"key":"a","layout":"quote"} -->\n# A'
  const PLAIN = '# Plain'

  test('text layout transitions pin both layouts on undo and redo stacks', () => {
    const text: TextStep = { kind: 'text', index: 0, field: 'body', seq: 1, layout: { before: 'two-column', after: 'studio-canvas-private' } }
    for (const layout of ['two-column', 'studio-canvas-private']) {
      expect(historyPinsLayout({ undo: [text], redo: [] }, layout)).toBe(true)
      expect(historyPinsLayout({ undo: [], redo: [text] }, layout)).toBe(true)
    }
    expect(stepPinsLayout(text, 'other')).toBe(false)
    expect(stepPinsLayout({ ...text, layout: undefined }, 'studio-canvas-private')).toBe(false)
  })

  test('spec: Given each kind of step that writes a layout, When it names the layout, Then it pins it', () => {
    expect(stepPinsLayout({ kind: 'config', index: 0, patch: { layout: 'quote' } }, 'quote')).toBe(true)
    expect(stepPinsLayout({ kind: 'slides', cmd: { type: 'insert', at: 0, text: ON_QUOTE } }, 'quote')).toBe(true)
    expect(stepPinsLayout({ kind: 'slides', cmd: { type: 'replace', index: 0, text: ON_QUOTE } }, 'quote')).toBe(true)
  })

  test('spec: Given a history with a step pinning the layout on either stack, Then the history pins it', () => {
    const pin: HistoryStep = { kind: 'config', index: 1, patch: { layout: 'quote' } }
    expect(historyPinsLayout({ undo: [DELETE_0, pin], redo: [] }, 'quote')).toBe(true)
    expect(historyPinsLayout({ undo: [DELETE_0], redo: [pin] }, 'quote')).toBe(true)
    expect(historyPinsLayout({ undo: [DELETE_0, MOVE_1_0, LAYOUT_OFF], redo: [] }, 'quote')).toBe(false)
  })

  test('adversarial: Given steps that write no layout or another one, Then they do not pin it', () => {
    const steps: HistoryStep[] = [
      LAYOUT_OFF,
      { kind: 'config', index: 0, patch: { layout: 'quote-copy' } },
      { kind: 'config', index: 0, patch: { draft: true } },
      { kind: 'slides', cmd: { type: 'insert', at: 0, text: PLAIN } },
      { kind: 'slides', cmd: { type: 'insert', at: 0, text: '<!-- not json -->\n# x' } },
      { kind: 'slides', cmd: { type: 'delete', index: 0 } },
      { kind: 'slides', cmd: { type: 'move', from: 0, to: 1 } },
      { kind: 'page-numbers', value: null, hidden: [] },
      { kind: 'frontmatter', key: 'layout', value: 'quote' },
      { kind: 'text', index: 0, field: 'body', seq: 1 },
    ]
    for (const step of steps) expect(stepPinsLayout(step, 'quote')).toBe(false)
  })

  test('adversarial: Given an empty history or an empty layout name, Then nothing pins it', () => {
    expect(historyPinsLayout(EMPTY_HISTORY, 'quote')).toBe(false)
    expect(historyPinsLayout({ undo: [LAYOUT_OFF], redo: [] }, '')).toBe(false)
  })
})

describe('layoutPinnedSlide', () => {
  test('spec: a config step that sets a slide\'s layout pins that slide', () => {
    expect(layoutPinnedSlide({ kind: 'config', index: 2, patch: { layout: 'title-body-image' } })).toBe(2)
    expect(layoutPinnedSlide({ kind: 'config', index: 0, patch: { layout: 'cover', draft: true } })).toBe(0)
  })

  test('spec: Undo clearing a layout (the field named, set to undefined) still pins that slide', () => {
    expect(layoutPinnedSlide({ kind: 'config', index: 1, patch: { layout: undefined } })).toBe(1)
  })

  test('adversarial: config steps that leave the layout alone, and slide commands, pin nothing', () => {
    expect(layoutPinnedSlide({ kind: 'config', index: 1, patch: { draft: true } })).toBeNull()
    expect(layoutPinnedSlide({ kind: 'config', index: 1, patch: {} })).toBeNull()
    expect(layoutPinnedSlide({ kind: 'slides', cmd: { type: 'replace', index: 1, text: '<!-- {"layout":"x"} -->\n# X\n' } })).toBeNull()
  })
})
