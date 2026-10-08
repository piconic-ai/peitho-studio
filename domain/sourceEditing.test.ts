import { describe, expect, test } from 'bun:test'
import {
  SOURCE_EDITING_CLOSED, isSourceDirty, openSourceEditing, sourceEditorOffered, sourceReadFromDisk, sourceSaved, typeInSource,
} from './sourceEditing'

const SOURCE = '---\nfontss: x\n---\n\n# One\n'

describe('openSourceEditing / typeInSource / isSourceDirty', () => {
  test('spec: Given the editor opened on the deck source, Then it shows that text and has nothing to save', () => {
    const editing = openSourceEditing(SOURCE)
    expect(editing).toEqual({ kind: 'open', draft: SOURCE, saved: SOURCE })
    expect(isSourceDirty(editing)).toBe(false)
  })

  test('spec: Given typing, When the text differs from disk, Then the editor is dirty', () => {
    const editing = typeInSource(openSourceEditing(SOURCE), SOURCE.replace('fontss: x\n', ''))
    expect(isSourceDirty(editing)).toBe(true)
    if (editing.kind === 'open') expect(editing.saved).toBe(SOURCE)
  })

  test('spec: typing back to exactly the saved text is not dirty', () => {
    const editing = typeInSource(typeInSource(openSourceEditing(SOURCE), 'x'), SOURCE)
    expect(isSourceDirty(editing)).toBe(false)
  })

  test('adversarial: typing into a closed editor changes nothing (a late onChange from a hidden editor)', () => {
    expect(typeInSource(SOURCE_EDITING_CLOSED, 'anything')).toEqual(SOURCE_EDITING_CLOSED)
    expect(isSourceDirty(SOURCE_EDITING_CLOSED)).toBe(false)
  })

  test('adversarial: an empty source opens and an empty draft is a real (dirty) edit', () => {
    expect(isSourceDirty(openSourceEditing(''))).toBe(false)
    expect(isSourceDirty(typeInSource(openSourceEditing(SOURCE), ''))).toBe(true)
  })
})

describe('sourceSaved', () => {
  test('spec: Given the draft was written to disk, Then nothing is left to save', () => {
    const fixed = SOURCE.replace('fontss: x\n', '')
    const editing = sourceSaved(typeInSource(openSourceEditing(SOURCE), fixed), fixed)
    expect(isSourceDirty(editing)).toBe(false)
  })

  test('spec: Given typing moved on during the save, Then the newer draft stays dirty against what was saved', () => {
    const fixed = SOURCE.replace('fontss: x\n', '')
    const editing = sourceSaved(typeInSource(openSourceEditing(SOURCE), fixed + '\nmore'), fixed)
    expect(isSourceDirty(editing)).toBe(true)
    if (editing.kind === 'open') expect(editing.saved).toBe(fixed)
  })

  test('adversarial: a save reported to a closed editor changes nothing', () => {
    expect(sourceSaved(SOURCE_EDITING_CLOSED, 'x')).toEqual(SOURCE_EDITING_CLOSED)
  })
})

describe('sourceReadFromDisk', () => {
  test('spec: Given no typing, When disk changes outside, Then the editor follows disk', () => {
    expect(sourceReadFromDisk(openSourceEditing(SOURCE), '# New\n')).toEqual({ kind: 'open', draft: '# New\n', saved: '# New\n' })
  })

  test('spec: Given typing, When disk changes outside, Then the typing is kept and is dirty against the new disk text', () => {
    const editing = sourceReadFromDisk(typeInSource(openSourceEditing(SOURCE), '# Mine\n'), '# Theirs\n')
    expect(editing).toEqual({ kind: 'open', draft: '# Mine\n', saved: '# Theirs\n' })
    expect(isSourceDirty(editing)).toBe(true)
  })

  test('adversarial: disk changing to exactly the typed text leaves nothing to save', () => {
    const editing = sourceReadFromDisk(typeInSource(openSourceEditing(SOURCE), '# Same\n'), '# Same\n')
    // `saved` follows disk, `draft` is kept: equal, so the next save is a no-op.
    expect(editing).toEqual({ kind: 'open', draft: '# Same\n', saved: '# Same\n' })
    expect(isSourceDirty(editing)).toBe(false)
  })

  test('adversarial: a closed editor ignores disk changes', () => {
    expect(sourceReadFromDisk(SOURCE_EDITING_CLOSED, 'x')).toEqual(SOURCE_EDITING_CLOSED)
  })
})

describe('sourceEditorOffered', () => {
  test('spec: Given a deck that builds and a closed editor, Then the toggle is not offered', () => {
    expect(sourceEditorOffered(SOURCE_EDITING_CLOSED, false)).toBe(false)
  })

  test('spec: Given a deck that does not build, Then the toggle is offered', () => {
    expect(sourceEditorOffered(SOURCE_EDITING_CLOSED, true)).toBe(true)
  })

  test('spec: Given the editor is open, Then the toggle stays offered even once the deck builds again (to leave it)', () => {
    expect(sourceEditorOffered(openSourceEditing(SOURCE), false)).toBe(true)
  })
})
