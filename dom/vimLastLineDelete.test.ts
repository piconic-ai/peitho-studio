// Runs `deletesLastLine` against CodeMirror's real state and change sets,
// with the selection the vim engine sets before an operator runs.
import { describe, expect, test } from 'bun:test'
import { EditorSelection, EditorState } from '@codemirror/state'
import { deletesLastLine } from './vimLastLineDelete'

/** Whether deleting `from`..`to` in `doc`, with `anchor`..`head` selected,
 * counts as `dd` of the last line. */
function check(doc: string, [anchor, head]: [number, number], ...deletes: [number, number][]): boolean {
  const state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })
  const changes = state.changes(deletes.map(([from, to]) => ({ from, to })))
  return deletesLastLine(state, changes)
}

describe('deletesLastLine', () => {
  test('Given the last line selected, when it is deleted with the newline before it, then it counts', () => {
    // 'aaa\nbbb': `G dd` selects 'bbb' (4..7) and deletes 3..7.
    expect(check('aaa\nbbb', [4, 7], [3, 7])).toBe(true)
  })

  test('Given an empty line before the last one, when the last line is deleted with the newline before it, then it counts', () => {
    expect(check('aaa\n\nbbb', [5, 8], [4, 8])).toBe(true)
  })

  test('Given the selection runs backwards, when the last line is deleted with the newline before it, then it still counts', () => {
    expect(check('aaa\nbbb', [7, 4], [3, 7])).toBe(true)
  })

  test('Given an empty line through the end selected (3dd, dG), when the same text is deleted, then it does not count', () => {
    // 'aaa\n\nccc': `2G 2dd` selects from the empty line (4) to the end.
    expect(check('aaa\n\nccc', [4, 8], [3, 8])).toBe(false)
  })

  test('Given a line in the middle, when it is deleted, then it does not count', () => {
    expect(check('aaa\nbbb\nccc', [4, 7], [4, 8])).toBe(false)
  })

  test('Given the last line selected, when only the line itself is deleted, then it does not count', () => {
    expect(check('aaa\nbbb', [4, 7], [4, 7])).toBe(false)
  })

  test('Given the last line selected, when the delete stops short of the end, then it does not count', () => {
    expect(check('aaa\nbbb', [4, 7], [3, 6])).toBe(false)
  })

  test('Given the last line selected, when a second change comes with the delete, then it does not count', () => {
    expect(check('aaa\nbbb', [4, 7], [0, 1], [3, 7])).toBe(false)
  })

  test('Given the last line selected, when text is inserted in its place, then it does not count', () => {
    const state = EditorState.create({ doc: 'aaa\nbbb', selection: EditorSelection.single(4, 7) })
    expect(deletesLastLine(state, state.changes({ from: 3, to: 7, insert: 'x' }))).toBe(false)
  })

  test('Given a single line, when it is deleted, then it does not count', () => {
    expect(check('aaa', [0, 3], [0, 3])).toBe(false)
  })

  test('Given an empty text, when nothing changes, then it does not count', () => {
    expect(check('', [0, 0])).toBe(false)
  })

  test('Given a trailing newline, when the empty line after it is deleted with the newline, then it counts', () => {
    // The register is then '\n', which the rewrite leaves as '\n'.
    expect(check('aaa\n', [4, 4], [3, 4])).toBe(true)
  })
})
