import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  PAGE_NUMBERS_KEY,
  pageNumbersShown,
  pageNumbersValueOf,
  parsePageNumbersMode,
  readFrontmatterKey,
  setFrontmatterKey,
} from './frontmatter'
import { readPageNumbersExamples, writePageNumbersExamples } from './frontmatter.examples'
import { splitSlides } from './slides'
import { isExhaustivelyAccountedFor } from './spec'

describe('page-number setting examples', () => {
  test.each(readPageNumbersExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_title, example) => {
      expect(parsePageNumbersMode(readFrontmatterKey(example.state, PAGE_NUMBERS_KEY))).toEqual(example.expect)
    },
  )

  test.each(writePageNumbersExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_title, example) => {
      expect(setFrontmatterKey(example.state, PAGE_NUMBERS_KEY, pageNumbersValueOf(example.event))).toBe(example.expect)
    },
  )

  test('spec: every example is either automated or carries a manual reason', () => {
    expect(isExhaustivelyAccountedFor(readPageNumbersExamples)).toBe(true)
    expect(isExhaustivelyAccountedFor(writePageNumbersExamples)).toBe(true)
  })
})

describe('readFrontmatterKey', () => {
  test('spec: reads a key\'s value', () => {
    expect(readFrontmatterKey('---\npage_numbers: current\n---\n# T\n', 'page_numbers')).toBe('current')
  })

  test('spec: a missing key reads as null', () => {
    expect(readFrontmatterKey('---\ntime: 1m\n---\n# T\n', 'page_numbers')).toBeNull()
  })

  test('adversarial: no frontmatter, or an unclosed block, reads as null', () => {
    expect(readFrontmatterKey('# T\npage_numbers: current\n', 'page_numbers')).toBeNull()
    expect(readFrontmatterKey('---\npage_numbers: current\n# T\n', 'page_numbers')).toBeNull()
  })

  test('adversarial: the empty source and the empty key read as null', () => {
    expect(readFrontmatterKey('', 'page_numbers')).toBeNull()
    expect(readFrontmatterKey('---\n: x\n---\n', '')).toBeNull()
  })

  test('adversarial: whitespace around the colon and the value is ignored', () => {
    expect(readFrontmatterKey('---\npage_numbers :  current  \n---\n', 'page_numbers')).toBe('current')
  })

  test('adversarial: single and double quotes are removed', () => {
    expect(readFrontmatterKey("---\npage_numbers: 'current_of_total'\n---\n", 'page_numbers')).toBe('current_of_total')
    expect(readFrontmatterKey('---\npage_numbers: "current"\n---\n', 'page_numbers')).toBe('current')
  })

  test('adversarial: a trailing comment is not part of the value', () => {
    expect(readFrontmatterKey('---\npage_numbers: current # shown bottom right\n---\n', 'page_numbers')).toBe('current')
  })

  test('adversarial: the first of two same-named keys wins', () => {
    expect(readFrontmatterKey('---\npage_numbers: current\npage_numbers: both\n---\n', 'page_numbers')).toBe('current')
  })

  test('adversarial: CRLF line endings don\'t leak a \\r into the value', () => {
    expect(readFrontmatterKey('---\r\npage_numbers: current\r\n---\r\n# T\r\n', 'page_numbers')).toBe('current')
  })

  test('adversarial: an indented (nested) key or a longer key sharing the prefix doesn\'t match', () => {
    expect(readFrontmatterKey('---\ncode_images:\n  page_numbers: current\n---\n', 'page_numbers')).toBeNull()
    expect(readFrontmatterKey('---\npage_numbers_extra: current\n---\n', 'page_numbers')).toBeNull()
  })

  test('adversarial: a key with nothing after the colon reads as the empty string', () => {
    expect(readFrontmatterKey('---\npage_numbers:\n---\n', 'page_numbers')).toBe('')
  })

  test('adversarial: a key that looks like a regular expression is matched literally', () => {
    expect(readFrontmatterKey('---\npageXnumbers: current\n---\n', 'page.numbers')).toBeNull()
    expect(readFrontmatterKey('---\npage.numbers: current\n---\n', 'page.numbers')).toBe('current')
  })

  test('adversarial: slide text after the block is never searched', () => {
    expect(readFrontmatterKey('---\ntime: 1m\n---\npage_numbers: current\n', 'page_numbers')).toBeNull()
  })
})

describe('setFrontmatterKey', () => {
  test('spec: replaces an existing key in place', () => {
    expect(setFrontmatterKey('---\na: 1\nb: 2\n---\n# T\n', 'a', '3')).toBe('---\na: 3\nb: 2\n---\n# T\n')
  })

  test('spec: adds a missing key just before the closing ---', () => {
    expect(setFrontmatterKey('---\na: 1\n---\n# T\n', 'b', '2')).toBe('---\na: 1\nb: 2\n---\n# T\n')
  })

  test('spec: null removes the key', () => {
    expect(setFrontmatterKey('---\na: 1\nb: 2\n---\n# T\n', 'a', null)).toBe('---\nb: 2\n---\n# T\n')
  })

  test('adversarial: removing a key that isn\'t there, or from a deck with no frontmatter, changes nothing', () => {
    expect(setFrontmatterKey('---\na: 1\n---\n# T\n', 'b', null)).toBe('---\na: 1\n---\n# T\n')
    expect(setFrontmatterKey('# T\n', 'b', null)).toBe('# T\n')
  })

  test('adversarial: an unclosed block is left untouched, whether setting or removing', () => {
    const source = '---\na: 1\n# T\n'
    expect(setFrontmatterKey(source, 'b', '2')).toBe(source)
    expect(setFrontmatterKey(source, 'a', null)).toBe(source)
  })

  test('adversarial: the empty source gets a block of its own', () => {
    expect(setFrontmatterKey('', 'a', '1')).toBe('---\na: 1\n---\n')
  })

  test('adversarial: the empty key changes nothing', () => {
    expect(setFrontmatterKey('# T\n', '', '1')).toBe('# T\n')
  })

  test('adversarial: an empty value is written as a bare key', () => {
    expect(setFrontmatterKey('---\na: 1\n---\n', 'b', '')).toBe('---\na: 1\nb:\n---\n')
  })

  test('adversarial: removing the only key removes the whole block, so peitho never sees an empty ---/--- pair', () => {
    const next = setFrontmatterKey('---\npage_numbers: current\n---\n# T\n\n---\n\n# U\n', 'page_numbers', null)
    expect(next).toBe('# T\n\n---\n\n# U\n')
    // Both slides are still slides: the old closing `---` didn't turn into
    // a slide separator in front of the first one.
    expect(splitSlides(next).map(r => r.text.trim())).toEqual(['# T', '# U'])
  })

  test('adversarial: a block left with only blank lines is removed too', () => {
    expect(setFrontmatterKey('---\n\npage_numbers: current\n\n---\n# T\n', 'page_numbers', null)).toBe('# T\n')
  })

  test('adversarial: a block left with only comment lines is removed too, since peitho reads a comment-only block as null, not a mapping', () => {
    expect(setFrontmatterKey('---\n# Deck notes\npage_numbers: current\n---\n# T\n', 'page_numbers', null)).toBe('# T\n')
    expect(setFrontmatterKey('---\r\n  # indented\r\n\r\npage_numbers: current\r\n---\r\n# T\r\n', 'page_numbers', null)).toBe('# T\r\n')
  })

  test('adversarial: a comment next to a remaining key keeps the block', () => {
    expect(setFrontmatterKey('---\n# Deck notes\ntime: 1m\npage_numbers: current\n---\n# T\n', 'page_numbers', null))
      .toBe('---\n# Deck notes\ntime: 1m\n---\n# T\n')
  })

  test('adversarial: only the first of two same-named keys is replaced or removed', () => {
    const source = '---\na: 1\na: 2\n---\n'
    expect(setFrontmatterKey(source, 'a', '3')).toBe('---\na: 3\na: 2\n---\n')
    expect(setFrontmatterKey(source, 'a', null)).toBe('---\na: 2\n---\n')
  })

  test('adversarial: indented lines under a key go with it', () => {
    const source = '---\ncode_images:\n  theme: dark\npage_numbers: current\n---\n'
    expect(setFrontmatterKey(source, 'code_images', null)).toBe('---\npage_numbers: current\n---\n')
    expect(setFrontmatterKey(source, 'code_images', 'x')).toBe('---\ncode_images: x\npage_numbers: current\n---\n')
  })

  test('adversarial: CRLF sources keep CRLF on the replaced, added, and new-block lines', () => {
    expect(setFrontmatterKey('---\r\na: 1\r\n---\r\n# T\r\n', 'a', '2')).toBe('---\r\na: 2\r\n---\r\n# T\r\n')
    expect(setFrontmatterKey('---\r\na: 1\r\n---\r\n# T\r\n', 'b', '2')).toBe('---\r\na: 1\r\nb: 2\r\n---\r\n# T\r\n')
    expect(setFrontmatterKey('# T\r\n', 'a', '1')).toBe('---\r\na: 1\r\n---\r\n# T\r\n')
    expect(setFrontmatterKey('---\r\na: 1\r\nb: 2\r\n---\r\n# T\r\n', 'a', null)).toBe('---\r\nb: 2\r\n---\r\n# T\r\n')
  })

  test('property: setting then reading a key gives the value back', () => {
    const value = fc.stringMatching(/^[a-z_0-9]{1,12}$/)
    const source = fc.constantFrom('', '# T\n', '---\ntime: 1m\n---\n# T\n', '---\npage_numbers: both\n---\n# T\n')
    fc.assert(fc.property(source, value, (s, v) => readFrontmatterKey(setFrontmatterKey(s, 'page_numbers', v), 'page_numbers') === v))
  })

  test('property: setting then removing a key leaves no trace of it and keeps every slide', () => {
    const value = fc.stringMatching(/^[a-z_0-9]{1,12}$/)
    const source = fc.constantFrom('# T\n', '---\ntime: 1m\n---\n# T\n\n---\n\n# U\n')
    fc.assert(fc.property(source, value, (s, v) => {
      const removed = setFrontmatterKey(setFrontmatterKey(s, 'page_numbers', v), 'page_numbers', null)
      return readFrontmatterKey(removed, 'page_numbers') === null && splitSlides(removed).length === splitSlides(s).length
    }))
  })
})

describe('parsePageNumbersMode', () => {
  test('spec: the two accepted values and an absent key', () => {
    expect(parsePageNumbersMode(null)).toEqual({ kind: 'none' })
    expect(parsePageNumbersMode('current')).toEqual({ kind: 'current' })
    expect(parsePageNumbersMode('current_of_total')).toEqual({ kind: 'current_of_total' })
  })

  test('adversarial: unknown values, the empty string, and other spellings are unknown, keeping the raw text', () => {
    for (const raw of ['both', '', 'Current', 'CURRENT_OF_TOTAL', 'false', 'true', ' current', 'none']) {
      expect(parsePageNumbersMode(raw)).toEqual({ kind: 'unknown', raw })
    }
  })
})

describe('pageNumbersValueOf / pageNumbersShown', () => {
  test('spec: none removes the key; the other choices write their own name', () => {
    expect(pageNumbersValueOf('none')).toBeNull()
    expect(pageNumbersValueOf('current')).toBe('current')
    expect(pageNumbersValueOf('current_of_total')).toBe('current_of_total')
  })

  test('spec: only the two accepted values show numbers — none and unknown don\'t', () => {
    expect(pageNumbersShown({ kind: 'current' })).toBe(true)
    expect(pageNumbersShown({ kind: 'current_of_total' })).toBe(true)
    expect(pageNumbersShown({ kind: 'none' })).toBe(false)
    expect(pageNumbersShown({ kind: 'unknown', raw: 'both' })).toBe(false)
  })

  test('property: every choice round-trips through the frontmatter', () => {
    for (const choice of ['none', 'current', 'current_of_total'] as const) {
      const source = setFrontmatterKey('---\ntime: 1m\n---\n# T\n', PAGE_NUMBERS_KEY, pageNumbersValueOf(choice))
      expect(parsePageNumbersMode(readFrontmatterKey(source, PAGE_NUMBERS_KEY))).toEqual({ kind: choice })
    }
  })
})
