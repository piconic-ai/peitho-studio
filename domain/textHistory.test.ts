import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  EMPTY_TEXT_HISTORY,
  advanceTextHistory,
  canRedoTextGroup,
  canUndoTextGroup,
  type TextHistoryEvent,
  type TextHistoryMirror,
} from './textHistory'

function change(before: number, after: number): TextHistoryEvent {
  return { kind: 'change', undoDepthBefore: before, undoDepthAfter: after, redoDepthAfter: 0 }
}

function undoEvent(before: number, after: number, redoAfter: number): TextHistoryEvent {
  return { kind: 'undo', undoDepthBefore: before, undoDepthAfter: after, redoDepthAfter: redoAfter }
}

function redoEvent(before: number, after: number, redoAfter: number): TextHistoryEvent {
  return { kind: 'redo', undoDepthBefore: before, undoDepthAfter: after, redoDepthAfter: redoAfter }
}

function other(depth: number, redo: number): TextHistoryEvent {
  return { kind: 'other', undoDepthBefore: depth, undoDepthAfter: depth, redoDepthAfter: redo }
}

describe('text history mirror: functional requirements', () => {
  test('spec: Given an empty history, when a change starts a new group, then the group gets the next number and is reported as new', () => {
    const result = advanceTextHistory(EMPTY_TEXT_HISTORY, change(0, 1), 7)

    expect(result).toEqual({ mirror: { live: [7], undone: [] }, newGroup: true })
  })

  test('spec: Given a group, when typing goes on into the same group, then no new group is reported and the number stays', () => {
    const mirror: TextHistoryMirror = { live: [7], undone: [] }

    const result = advanceTextHistory(mirror, change(1, 1), 8)

    expect(result).toEqual({ mirror: { live: [7], undone: [] }, newGroup: false })
  })

  test('spec: Given two groups, when one is undone, then the newest moves over to the redo side', () => {
    const mirror: TextHistoryMirror = { live: [1, 2], undone: [] }

    const { mirror: next } = advanceTextHistory(mirror, undoEvent(2, 1, 1), 3)

    expect(next).toEqual({ live: [1], undone: [2] })
  })

  test('spec: Given an undone group, when it is redone, then it moves back to the undo side', () => {
    const mirror: TextHistoryMirror = { live: [1], undone: [2] }

    const { mirror: next } = advanceTextHistory(mirror, redoEvent(1, 2, 0), 3)

    expect(next).toEqual({ live: [1, 2], undone: [] })
  })

  test('spec: Given an undone group, when a new change is typed, then nothing is left to redo', () => {
    const mirror: TextHistoryMirror = { live: [1], undone: [2] }

    const result = advanceTextHistory(mirror, change(1, 2), 3)

    expect(result.mirror).toEqual({ live: [1, 3], undone: [] })
  })

  test('spec: Given an undone group, when typing joins the group below, then nothing is left to redo either', () => {
    const mirror: TextHistoryMirror = { live: [1], undone: [2] }

    const result = advanceTextHistory(mirror, change(1, 1), 3)

    expect(result).toEqual({ mirror: { live: [1], undone: [] }, newGroup: false })
  })

  test('spec: Given three groups, when vim\'s "3u" undoes them one by one, then all three end up on the redo side, newest last taken', () => {
    let mirror: TextHistoryMirror = { live: [1, 2, 3], undone: [] }

    for (const [before, redo] of [[3, 1], [2, 2], [1, 3]]) {
      mirror = advanceTextHistory(mirror, undoEvent(before, before - 1, redo), 9).mirror
    }

    expect(mirror).toEqual({ live: [], undone: [3, 2, 1] })
    expect(canRedoTextGroup(mirror, 1)).toBe(true)
  })

  test('spec: Given a selection move or a change kept out of the history, when the depths stay the same, then the mirror is unchanged', () => {
    const mirror: TextHistoryMirror = { live: [1, 2], undone: [3] }

    const result = advanceTextHistory(mirror, other(2, 1), 4)

    expect(result).toEqual({ mirror, newGroup: false })
  })

  test('spec: Given a history at CodeMirror\'s limit, when a new group pushes the depth down, then the new group is added and the oldest ones are dropped', () => {
    // CodeMirror cuts a branch past `minDepth + 20` back to `minDepth + 1`
    // in the same step that adds the new group.
    const mirror: TextHistoryMirror = { live: [1, 2, 3, 4, 5], undone: [] }

    const result = advanceTextHistory(mirror, change(5, 3), 6)

    expect(result).toEqual({ mirror: { live: [4, 5, 6], undone: [] }, newGroup: true })
  })

  test('spec: Given the newest group, when a change kept out of the history wipes it out, then that group is dropped from the newest end', () => {
    const mirror: TextHistoryMirror = { live: [1, 2], undone: [3] }

    const { mirror: next } = advanceTextHistory(mirror, other(1, 0), 4)

    expect(next).toEqual({ live: [1], undone: [] })
  })
})

describe('text history mirror: which group comes next', () => {
  test('spec: Given groups 1 and 2, then only 2 can be undone next', () => {
    const mirror: TextHistoryMirror = { live: [1, 2], undone: [] }

    expect(canUndoTextGroup(mirror, 2)).toBe(true)
    expect(canUndoTextGroup(mirror, 1)).toBe(false)
  })

  test('spec: Given groups 3 and 4 undone in that order, then only 4 can be redone next', () => {
    const mirror: TextHistoryMirror = { live: [], undone: [3, 4] }

    expect(canRedoTextGroup(mirror, 4)).toBe(true)
    expect(canRedoTextGroup(mirror, 3)).toBe(false)
  })

  test('spec: Given a group undone by vim\'s "u", then it no longer counts as undoable, and counts again once "Ctrl-R" redoes it', () => {
    let mirror: TextHistoryMirror = { live: [5], undone: [] }

    mirror = advanceTextHistory(mirror, undoEvent(1, 0, 1), 6).mirror
    expect(canUndoTextGroup(mirror, 5)).toBe(false)

    mirror = advanceTextHistory(mirror, redoEvent(0, 1, 0), 6).mirror
    expect(canUndoTextGroup(mirror, 5)).toBe(true)
  })

  test('adversarial: Given an empty history, then no group can be undone or redone', () => {
    expect(canUndoTextGroup(EMPTY_TEXT_HISTORY, 0)).toBe(false)
    expect(canRedoTextGroup(EMPTY_TEXT_HISTORY, 0)).toBe(false)
  })
})

describe('text history mirror: adversarial', () => {
  test('adversarial: Given an empty history, when an undo is reported anyway, then nothing moves and nothing breaks', () => {
    const result = advanceTextHistory(EMPTY_TEXT_HISTORY, undoEvent(0, 0, 0), 1)

    expect(result).toEqual({ mirror: EMPTY_TEXT_HISTORY, newGroup: false })
  })

  test('adversarial: Given nothing undone, when a redo is reported anyway, then nothing moves', () => {
    const mirror: TextHistoryMirror = { live: [1], undone: [] }

    const result = advanceTextHistory(mirror, redoEvent(1, 1, 0), 2)

    expect(result.mirror).toEqual({ live: [1], undone: [] })
  })

  test('adversarial: Given an undo that also wipes out the group below it, then both leave the undo side and only the undone one can be redone', () => {
    // CodeMirror maps the rest of the branch through an undone group's
    // stored mapping, which can leave a group below it empty.
    const mirror: TextHistoryMirror = { live: [1, 2, 3], undone: [] }

    const { mirror: next } = advanceTextHistory(mirror, undoEvent(3, 1, 1), 4)

    expect(next).toEqual({ live: [1], undone: [3] })
  })

  test('adversarial: Given depths that are negative, fractional or not numbers, then they count as their whole, non-negative part', () => {
    const mirror: TextHistoryMirror = { live: [1, 2], undone: [3] }

    expect(advanceTextHistory(mirror, { kind: 'other', undoDepthBefore: 2, undoDepthAfter: -1, redoDepthAfter: Number.NaN }, 4).mirror)
      .toEqual({ live: [], undone: [] })
    expect(advanceTextHistory(mirror, { kind: 'other', undoDepthBefore: 2, undoDepthAfter: 1.9, redoDepthAfter: Infinity }, 4).mirror)
      .toEqual({ live: [1], undone: [] })
  })

  test('adversarial: Given a mirror that knows fewer groups than the depth (older groups never seen), then the known ones stay and still line up at the newest end', () => {
    const mirror: TextHistoryMirror = { live: [9], undone: [] }

    const { mirror: next } = advanceTextHistory(mirror, change(40, 41), 10)

    expect(next.live).toEqual([9, 10])
    expect(canUndoTextGroup(next, 10)).toBe(true)
  })

  test('adversarial: the mirror passed in is never modified', () => {
    const mirror: TextHistoryMirror = Object.freeze({ live: Object.freeze([1, 2]), undone: Object.freeze([3]) })

    advanceTextHistory(mirror, change(2, 3), 4)
    advanceTextHistory(mirror, undoEvent(2, 1, 2), 4)
    advanceTextHistory(mirror, redoEvent(2, 3, 0), 4)

    expect(mirror).toEqual({ live: [1, 2], undone: [3] })
  })
})

describe('text history mirror: properties', () => {
  // A model of CodeMirror's two branches, as group numbers, driven by the
  // same kinds of steps the editor reports.
  const step = fc.oneof(
    fc.constant({ kind: 'new' as const }),
    fc.constant({ kind: 'join' as const }),
    fc.constant({ kind: 'undo' as const }),
    fc.constant({ kind: 'redo' as const }),
  )

  test('property: Given any run of new groups, joins, undos and redos, then the mirror always matches the model of CodeMirror\'s branches', () => {
    fc.assert(fc.property(fc.array(step, { maxLength: 60 }), steps => {
      let done: number[] = []
      let undone: number[] = []
      let mirror = EMPTY_TEXT_HISTORY
      let seq = 0
      for (const s of steps) {
        const before = done.length
        let kind: TextHistoryEvent['kind']
        if (s.kind === 'new') {
          done = [...done, seq]
          undone = []
          kind = 'change'
        } else if (s.kind === 'join') {
          if (done.length === 0) continue
          undone = []
          kind = 'change'
        } else if (s.kind === 'undo') {
          if (done.length === 0) continue
          undone = [...undone, done[done.length - 1]]
          done = done.slice(0, -1)
          kind = 'undo'
        } else {
          if (undone.length === 0) continue
          done = [...done, undone[undone.length - 1]]
          undone = undone.slice(0, -1)
          kind = 'redo'
        }
        const result = advanceTextHistory(mirror, { kind, undoDepthBefore: before, undoDepthAfter: done.length, redoDepthAfter: undone.length }, seq)
        mirror = result.mirror
        if (result.newGroup) seq++
        expect(mirror).toEqual({ live: done, undone })
      }
    }))
  })
})
