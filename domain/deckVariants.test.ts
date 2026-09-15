import { describe, expect, test } from 'bun:test'
import { type DeckVariant, currentVariantLabelOf, toVariantSwitcher, variantLabel, variantOptionsOf } from './deckVariants'
import { variantSwitcherExamples } from './deckVariants.examples'
import { isExhaustivelyAccountedFor } from './spec'

const deck = (fileName: string, suffix: string | null, isCurrent = false): DeckVariant => ({
  path: `/d/${fileName}`, fileName, suffix, isCurrent,
})

describe('toVariantSwitcher examples', () => {
  test.each(variantSwitcherExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_name, example) => {
      expect(toVariantSwitcher(example.state)).toEqual(example.expect)
    },
  )

  test('spec: every example is either automated or manual with a reason', () => {
    expect(isExhaustivelyAccountedFor(variantSwitcherExamples)).toBe(true)
    for (const example of variantSwitcherExamples.manual) expect(example.manual?.reason.trim()).not.toBe('')
  })
})

describe('variantLabel', () => {
  test('spec: a suffixed deck is labeled by its suffix as-is, not limited to language codes', () => {
    expect(variantLabel(deck('deck.ja.md', 'ja'))).toBe('ja')
    expect(variantLabel(deck('deck.en-US.md', 'en-US'))).toBe('en-US')
    expect(variantLabel(deck('deck.v2.draft.md', 'v2.draft'))).toBe('v2.draft')
  })

  test('spec: the unsuffixed deck is labeled by its file name', () => {
    expect(variantLabel(deck('deck.md', null))).toBe('deck.md')
  })

  test('adversarial: an empty or whitespace-only suffix falls back to the file name', () => {
    expect(variantLabel(deck('deck..md', ''))).toBe('deck..md')
    expect(variantLabel(deck('deck. .md', ' '))).toBe('deck. .md')
  })

  test('adversarial: non-ASCII and HTML-like suffixes pass through untouched', () => {
    expect(variantLabel(deck('deck.日本語.md', '日本語'))).toBe('日本語')
    expect(variantLabel(deck('deck.<b>.md', '<b>'))).toBe('<b>')
  })
})

describe('toVariantSwitcher', () => {
  test('spec: keeps the order it was given (the Rust side already sorts)', () => {
    const switcher = toVariantSwitcher([deck('deck.md', null), deck('deck.zh.md', 'zh', true), deck('deck.de.md', 'de')])
    expect(switcher.kind === 'shown' && switcher.options.map(o => o.label)).toEqual(['deck.md', 'zh', 'de'])
  })

  test('adversarial: no entry marked current is hidden rather than guessing which deck is open', () => {
    expect(toVariantSwitcher([deck('deck.md', null), deck('deck.ja.md', 'ja')])).toEqual({ kind: 'hidden' })
  })

  test('adversarial: more than one entry marked current is hidden', () => {
    expect(toVariantSwitcher([deck('deck.md', null, true), deck('deck.ja.md', 'ja', true)])).toEqual({ kind: 'hidden' })
  })

  test('adversarial: a single entry that is not current is hidden', () => {
    expect(toVariantSwitcher([deck('deck.ja.md', 'ja')])).toEqual({ kind: 'hidden' })
  })

  test('adversarial: the current label falls back to the file name when its suffix is blank', () => {
    const switcher = toVariantSwitcher([deck('deck.md', null), deck('deck..md', '', true)])
    expect(switcher.kind === 'shown' && switcher.currentLabel).toBe('deck..md')
  })

  test('adversarial: does not mutate its input', () => {
    const variants = Object.freeze([Object.freeze(deck('deck.md', null, true)), Object.freeze(deck('deck.ja.md', 'ja'))])
    expect(() => toVariantSwitcher(variants)).not.toThrow()
  })
})

describe('currentVariantLabelOf / variantOptionsOf', () => {
  test('spec: a shown switcher projects its current label and options', () => {
    const switcher = toVariantSwitcher([deck('deck.md', null, true), deck('deck.ja.md', 'ja')])
    expect(currentVariantLabelOf(switcher)).toBe('deck.md')
    expect(variantOptionsOf(switcher).map(o => o.label)).toEqual(['deck.md', 'ja'])
  })

  test('adversarial: a hidden switcher projects an empty label and no options', () => {
    expect(currentVariantLabelOf({ kind: 'hidden' })).toBe('')
    expect(variantOptionsOf({ kind: 'hidden' })).toEqual([])
  })
})
