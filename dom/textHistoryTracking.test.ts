// Runs the tracking against CodeMirror's real history (state only, no
// view), so the numbers are checked against what CodeMirror itself does
// with grouping, its depth limit, and changes kept out of the history.
import { describe, expect, test } from 'bun:test'
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import { history, isolateHistory, redo, undo } from '@codemirror/commands'
import { canReplayTextGroup, carryTextHistory, textHistoryEventKind, textHistoryOf, trackTextHistory } from './textHistoryTracking'

/** A stand-in for one editor: its state, and the group numbers its
 * transactions started. */
function editorOf(doc = '', minDepth?: number) {
  let state = EditorState.create({ doc, extensions: [history(minDepth === undefined ? {} : { minDepth })] })
  const groups: number[] = []
  let clock = 1_000
  function apply(tr: Transaction): void {
    state = tr.state
    const seq = trackTextHistory(tr)
    if (seq !== null) groups.push(seq)
  }
  const target = { get state() { return state }, dispatch: apply }
  return {
    get state() { return state },
    groups,
    /** Types `text` at the end, `ms` after the previous edit. */
    type(text: string, ms = 10): void {
      clock += ms
      apply(state.update({ changes: { from: state.doc.length, insert: text }, userEvent: 'input.type', annotations: Transaction.time.of(clock) }))
    },
    update(spec: TransactionSpec): void {
      apply(state.update(spec))
    },
    undo: () => undo(target),
    redo: () => redo(target),
  }
}

describe('trackTextHistory against CodeMirror: functional requirements', () => {
  test('spec: Given typing in quick succession, then it forms one group with one number', () => {
    const editor = editorOf()

    editor.type('a')
    editor.type('b')
    editor.type('c')

    expect(editor.groups).toHaveLength(1)
    expect(canReplayTextGroup(editor.state, 'undo', editor.groups[0])).toBe(true)
  })

  test('spec: Given typing after a pause, then it starts a second group with the next number', () => {
    const editor = editorOf()

    editor.type('a')
    editor.type('b', 1_000)

    expect(editor.groups).toHaveLength(2)
    expect(editor.groups[1]).toBeGreaterThan(editor.groups[0])
    expect(textHistoryOf(editor.state).live).toEqual(editor.groups)
  })

  test('spec: Given a history isolated between two quick keystrokes, then they form two groups', () => {
    const editor = editorOf()

    editor.type('a')
    editor.update({ annotations: isolateHistory.of('full') })
    editor.type('b')

    expect(editor.groups).toHaveLength(2)
  })

  test('spec: Given two groups, when one is undone (Cmd+Z or vim\'s "u"), then the older is next to undo and the newer is next to redo', () => {
    const editor = editorOf()
    editor.type('a')
    editor.type('b', 1_000)
    const [first, second] = editor.groups

    editor.undo()

    expect(editor.state.doc.toString()).toBe('a')
    expect(canReplayTextGroup(editor.state, 'undo', first)).toBe(true)
    expect(canReplayTextGroup(editor.state, 'undo', second)).toBe(false)
    expect(canReplayTextGroup(editor.state, 'redo', second)).toBe(true)
  })

  test('spec: Given an undone group, when it is redone, then it is next to undo again', () => {
    const editor = editorOf()
    editor.type('a')
    editor.undo()

    editor.redo()

    expect(canReplayTextGroup(editor.state, 'undo', editor.groups[0])).toBe(true)
    expect(canReplayTextGroup(editor.state, 'redo', editor.groups[0])).toBe(false)
  })

  test('spec: Given a change kept out of the history (a save response written back), then no group starts and the groups stay as they were', () => {
    const editor = editorOf('x')
    editor.type('a')

    editor.update({ changes: { from: 0, insert: '>' }, annotations: Transaction.addToHistory.of(false) })

    expect(editor.groups).toHaveLength(1)
    expect(canReplayTextGroup(editor.state, 'undo', editor.groups[0])).toBe(true)
  })

  test('spec: Given a state reconfigured outside the editor, when its groups are carried over, then the new state answers for them', () => {
    const editor = editorOf()
    editor.type('a')

    const derived = editor.state.update({ annotations: isolateHistory.of('full') }).state
    carryTextHistory(editor.state, derived)

    expect(canReplayTextGroup(derived, 'undo', editor.groups[0])).toBe(true)
  })

  test('spec: Given an earlier state kept aside, then it still answers for the groups it had then', () => {
    const editor = editorOf()
    editor.type('a')
    const kept = editor.state

    editor.undo()

    expect(canReplayTextGroup(kept, 'undo', editor.groups[0])).toBe(true)
    expect(canReplayTextGroup(editor.state, 'undo', editor.groups[0])).toBe(false)
  })
})

describe('trackTextHistory against CodeMirror: robustness', () => {
  test('adversarial: Given a fresh state never tracked, then it has no groups to undo or redo', () => {
    const state = EditorState.create({ doc: 'text', extensions: [history()] })

    expect(textHistoryOf(state)).toEqual({ live: [], undone: [] })
    expect(canReplayTextGroup(state, 'undo', 0)).toBe(false)
  })

  test('adversarial: Given a history past CodeMirror\'s depth limit, then the newest groups still line up with what CodeMirror undoes', () => {
    // CodeMirror keeps `minDepth` groups plus some slack, dropping the
    // oldest ones in a batch; a depth-based number would drift here.
    const editor = editorOf('', 3)
    for (let i = 0; i < 30; i++) editor.type(String(i % 10), 1_000)

    const live = textHistoryOf(editor.state).live
    expect(live).toEqual(editor.groups.slice(editor.groups.length - live.length))
    const before = editor.state.doc.toString()
    expect(canReplayTextGroup(editor.state, 'undo', editor.groups[editor.groups.length - 1])).toBe(true)
    editor.undo()
    expect(editor.state.doc.toString()).toBe(before.slice(0, -1))
    expect(canReplayTextGroup(editor.state, 'undo', editor.groups[editor.groups.length - 2])).toBe(true)
  })

  test('adversarial: Given a change kept out of the history that erases the newest group\'s text, then that group is gone and the one below is next', () => {
    const editor = editorOf()
    editor.type('a')
    editor.type('b', 1_000)
    const [first, second] = editor.groups

    editor.update({ changes: { from: 1, to: 2 }, annotations: Transaction.addToHistory.of(false) })

    expect(canReplayTextGroup(editor.state, 'undo', second)).toBe(false)
    expect(canReplayTextGroup(editor.state, 'undo', first)).toBe(true)
  })

  test('adversarial: Given selection moves and empty transactions, then they count as neither a change nor an undo', () => {
    const state = EditorState.create({ doc: 'ab', extensions: [history()] })

    expect(textHistoryEventKind(state.update({ selection: { anchor: 1 } }))).toBe('other')
    expect(textHistoryEventKind(state.update({}))).toBe('other')
    expect(textHistoryEventKind(state.update({ changes: { from: 0, insert: 'x' }, annotations: Transaction.addToHistory.of(false) }))).toBe('other')
    expect(textHistoryEventKind(state.update({ changes: { from: 0, insert: 'x' } }))).toBe('change')
  })
})
