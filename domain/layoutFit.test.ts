import { describe, expect, test } from 'bun:test'
import { availabilityOf, entryTitle, isSelectable, layoutNoticeText, settledFitCheck, type LayoutFitCheck, type LayoutVerdict } from './layoutFit'
import { messagesFor } from './messages'

const en = messagesFor('en')
const ja = messagesFor('ja')

const verdicts: LayoutVerdict[] = [
  { layout: 'cover', fit: { kind: 'mismatch', reason: "unassigned content remains for missing 'body' slot" } },
  { layout: 'statement', fit: { kind: 'fits' } },
]

describe('settledFitCheck', () => {
  test('spec: verdicts become a checked state carrying them', () => {
    expect(settledFitCheck(verdicts)).toEqual({ kind: 'checked', verdicts })
  })

  test('spec: no verdicts at all (nothing to judge, or the call failed) is unavailable', () => {
    expect(settledFitCheck(null)).toEqual({ kind: 'unavailable' })
  })

  test('adversarial: an empty verdict list is still a completed check, not unavailable', () => {
    expect(settledFitCheck([])).toEqual({ kind: 'checked', verdicts: [] })
  })
})

describe('availabilityOf', () => {
  const checked: LayoutFitCheck = { kind: 'checked', verdicts }

  test('spec: a layout the slide fits is selectable', () => {
    expect(availabilityOf(checked, 'statement')).toEqual({ kind: 'selectable' })
  })

  test('spec: a layout the slide does not fit carries peitho-core\'s reason', () => {
    expect(availabilityOf(checked, 'cover')).toEqual({ kind: 'mismatch', reason: "unassigned content remains for missing 'body' slot" })
  })

  test('spec: every layout waits while the check is in flight', () => {
    const checking: LayoutFitCheck = { kind: 'checking', requestId: 1 }
    expect(availabilityOf(checking, 'cover')).toEqual({ kind: 'checking' })
    expect(availabilityOf(checking, 'statement')).toEqual({ kind: 'checking' })
  })

  test('adversarial: an unavailable check never blocks any layout', () => {
    expect(availabilityOf({ kind: 'unavailable' }, 'cover')).toEqual({ kind: 'selectable' })
  })

  test('adversarial: a layout absent from the verdicts stays selectable', () => {
    expect(availabilityOf(checked, 'poster')).toEqual({ kind: 'selectable' })
    expect(availabilityOf({ kind: 'checked', verdicts: [] }, 'cover')).toEqual({ kind: 'selectable' })
  })

  test('adversarial: layout names match exactly — no case folding, trimming, or prefix match', () => {
    expect(availabilityOf(checked, 'Cover')).toEqual({ kind: 'selectable' })
    expect(availabilityOf(checked, ' cover')).toEqual({ kind: 'selectable' })
    expect(availabilityOf(checked, 'cov')).toEqual({ kind: 'selectable' })
    expect(availabilityOf(checked, '')).toEqual({ kind: 'selectable' })
  })

  test('adversarial: with duplicate verdicts for one layout, the first one wins', () => {
    const duplicated: LayoutFitCheck = {
      kind: 'checked',
      verdicts: [{ layout: 'cover', fit: { kind: 'fits' } }, { layout: 'cover', fit: { kind: 'mismatch', reason: 'x' } }],
    }
    expect(availabilityOf(duplicated, 'cover')).toEqual({ kind: 'selectable' })
  })

  test('adversarial: an empty reason is still a mismatch', () => {
    const emptyReason: LayoutFitCheck = { kind: 'checked', verdicts: [{ layout: 'cover', fit: { kind: 'mismatch', reason: '' } }] }
    expect(availabilityOf(emptyReason, 'cover')).toEqual({ kind: 'mismatch', reason: '' })
  })
})

describe('isSelectable', () => {
  test('spec: only a layout the slide is known not to fit, or any layout mid-check, is dimmed', () => {
    const checked: LayoutFitCheck = { kind: 'checked', verdicts }
    expect(isSelectable(checked, 'statement')).toBe(true)
    expect(isSelectable(checked, 'cover')).toBe(false)
    expect(isSelectable({ kind: 'checking', requestId: 1 }, 'statement')).toBe(false)
  })

  test('adversarial: unavailable checks and unknown or empty names stay selectable', () => {
    expect(isSelectable({ kind: 'unavailable' }, 'cover')).toBe(true)
    expect(isSelectable({ kind: 'checked', verdicts }, 'poster')).toBe(true)
    expect(isSelectable({ kind: 'checked', verdicts }, '')).toBe(true)
  })
})

describe('entryTitle', () => {
  test('spec: a mismatched layout explains why; a fitting one is just its name', () => {
    const checked: LayoutFitCheck = { kind: 'checked', verdicts }
    expect(entryTitle(checked, 'cover', en)).toBe("\"cover\" doesn't fit this slide: unassigned content remains for missing 'body' slot")
    expect(entryTitle(checked, 'statement', en)).toBe('statement')
  })

  test('spec: Given the Japanese UI, when a mismatched layout is hovered, then the explanation is Japanese and peitho-core\'s reason is kept as is', () => {
    const checked: LayoutFitCheck = { kind: 'checked', verdicts }
    expect(entryTitle(checked, 'cover', ja)).toBe("「cover」はこのスライドに合いません: unassigned content remains for missing 'body' slot")
    expect(entryTitle(checked, 'statement', ja)).toBe('statement')
  })

  test('adversarial: mid-check, unavailable, and empty names fall back to the name itself', () => {
    expect(entryTitle({ kind: 'checking', requestId: 1 }, 'cover', en)).toBe('cover')
    expect(entryTitle({ kind: 'unavailable' }, 'cover', en)).toBe('cover')
    expect(entryTitle({ kind: 'unavailable' }, '', en)).toBe('')
  })
})

describe('layoutNoticeText', () => {
  test('spec: a mismatch names the layout and gives the reason', () => {
    expect(layoutNoticeText(en, { kind: 'mismatch', layout: 'cover', reason: "unassigned content remains for missing 'body' slot" }))
      .toBe("\"cover\" doesn't fit this slide: unassigned content remains for missing 'body' slot")
  })

  test('spec: Given a choice made before the check answered, when worded in each language, then it says the check is still running', () => {
    expect(layoutNoticeText(en, { kind: 'checking' })).toBe('Still checking which layouts fit this slide — try again in a moment.')
    expect(layoutNoticeText(ja, { kind: 'checking' })).toBe(ja.layoutChecking)
  })

  test('adversarial: empty strings and markup-like text pass through verbatim (rendered as text, never HTML)', () => {
    expect(layoutNoticeText(en, { kind: 'mismatch', layout: '', reason: '' })).toBe("\"\" doesn't fit this slide: ")
    expect(layoutNoticeText(en, { kind: 'mismatch', layout: '<b>x</b>', reason: "slot 'a' got 2 item(s)\nsecond line" }))
      .toBe("\"<b>x</b>\" doesn't fit this slide: slot 'a' got 2 item(s)\nsecond line")
  })
})
