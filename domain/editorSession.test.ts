import { describe, expect, test } from 'bun:test'
import { selectionAfter, isDirty, reconcileAfterCommit, withRefreshedSaved, withDraftBody, withDraftNote, type SelectionPlan, type EditorSession, type SlideFields } from './editorSession'
import { type SlideRange } from './slides'

const range = (text: string): SlideRange => ({ start: 0, end: text.length, text })
const fields = (overrides: Partial<SlideFields> = {}): SlideFields => ({ body: '', note: '', config: {}, ...overrides })
const editing = (index: number, saved: SlideFields, draft: SlideFields = saved): EditorSession => ({ kind: 'editing', index, saved, draft })

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

describe('isDirty', () => {
  test('spec: dirty when the draft body or note differs from saved', () => {
    expect(isDirty(editing(0, fields({ body: 'a' }), fields({ body: 'b' })))).toBe(true)
    expect(isDirty(editing(0, fields({ note: 'x' }), fields({ note: 'y' })))).toBe(true)
  })

  test('spec: not dirty when the draft matches saved', () => {
    expect(isDirty(editing(0, fields({ body: 'a', note: 'x' })))).toBe(false)
  })

  test('adversarial: `none` is never dirty', () => {
    expect(isDirty({ kind: 'none' })).toBe(false)
  })

  test('adversarial: a config-only difference is not dirty — config changes go through updateSlideConfig, not this draft path', () => {
    const saved = fields({ config: { draft: false } })
    const draft = fields({ config: { draft: true } })
    expect(isDirty(editing(0, saved, draft))).toBe(false)
  })
})

describe('withRefreshedSaved', () => {
  test('spec: replaces saved while leaving the live draft untouched', () => {
    const session = editing(0, fields({ body: 'old' }), fields({ body: 'user is mid-edit' }))
    const result = withRefreshedSaved(session, fields({ body: 'refreshed from disk' }))
    expect(result).toEqual(editing(0, fields({ body: 'refreshed from disk' }), fields({ body: 'user is mid-edit' })))
  })

  test('adversarial: a no-op on `none` — there is no draft to preserve', () => {
    expect(withRefreshedSaved({ kind: 'none' }, fields({ body: 'x' }))).toEqual({ kind: 'none' })
  })
})

describe('withDraftBody / withDraftNote', () => {
  test('spec: update only their own field on the draft, leaving saved and the other field alone', () => {
    const session = editing(0, fields({ body: 'saved-body', note: 'saved-note' }), fields({ body: 'draft-body', note: 'draft-note' }))
    expect(withDraftBody(session, 'typed')).toEqual(
      editing(0, fields({ body: 'saved-body', note: 'saved-note' }), fields({ body: 'typed', note: 'draft-note' })),
    )
    expect(withDraftNote(session, 'typed note')).toEqual(
      editing(0, fields({ body: 'saved-body', note: 'saved-note' }), fields({ body: 'draft-body', note: 'typed note' })),
    )
  })

  test('adversarial: a no-op on `none` — there is no draft to type into', () => {
    expect(withDraftBody({ kind: 'none' }, 'x')).toEqual({ kind: 'none' })
    expect(withDraftNote({ kind: 'none' }, 'x')).toEqual({ kind: 'none' })
  })
})

describe('reconcileAfterCommit', () => {
  test('spec: nothing moved during the gap — selection follows the plan, saved refreshes from the new ranges, and an unchanged draft syncs to it', () => {
    const before = editing(0, fields({ body: 'old' }), fields({ body: 'new' }))
    const ranges = [range('new body text')]
    const result = reconcileAfterCommit(before, before, ranges, { kind: 'keep' })
    expect(result).toEqual(editing(0, fields({ body: 'new body text' })))
  })

  test('spec: `expected` is used verbatim for body/note instead of re-parsing the ranges, while config still comes from the parsed range', () => {
    const before = editing(0, fields({ body: 'old', config: { key: 'a' } }))
    const ranges = [range('<!-- {"key":"a"} -->\nreparsed body would differ from expected')]
    const result = reconcileAfterCommit(before, before, ranges, { kind: 'keep' }, { body: 'exact body', note: 'exact note' })
    expect(result).toEqual(editing(0, fields({ body: 'exact body', note: 'exact note', config: { key: 'a' } })))
  })

  test('adversarial: a draft that changed during the gap is preserved, not clobbered by the fresh saved value', () => {
    const before = editing(0, fields({ body: 'old' }), fields({ body: 'old' }))
    const now = editing(0, fields({ body: 'old' }), fields({ body: 'user typed more' }))
    const ranges = [range('old')]
    const result = reconcileAfterCommit(before, now, ranges, { kind: 'keep' })
    expect(result).toEqual(editing(0, fields({ body: 'old' }), fields({ body: 'user typed more' })))
  })

  test('adversarial: a selection that moved during the gap is returned untouched — the commit\'s own plan is discarded entirely', () => {
    const before = editing(0, fields({ body: 'a' }))
    const now = editing(1, fields({ body: 'b' }))
    const ranges = [range('a'), range('b')]
    const result = reconcileAfterCommit(before, now, ranges, { kind: 'keep' })
    expect(result).toBe(now)
  })

  test('adversarial: an empty post-commit slide list resets the session to `none`', () => {
    const before = editing(0, fields({ body: 'a' }))
    const result = reconcileAfterCommit(before, before, [], { kind: 'clamp-after-delete', deleted: 0 })
    expect(result).toEqual({ kind: 'none' })
  })

  test('adversarial: starting from `none` on both sides still reconciles into `editing` when the plan resolves to a real slide', () => {
    const before: EditorSession = { kind: 'none' }
    const ranges = [range('<!-- {"key":"new"} -->\n# New slide')]
    const result = reconcileAfterCommit(before, before, ranges, { kind: 'select', index: 0 })
    expect(result.kind).toBe('editing')
  })

  test('adversarial: `before`/`now` both `none` but the plan resolves out of range still lands on `none`, not a crash', () => {
    const before: EditorSession = { kind: 'none' }
    const result = reconcileAfterCommit(before, before, [], { kind: 'select', index: 0 })
    expect(result).toEqual({ kind: 'none' })
  })
})
