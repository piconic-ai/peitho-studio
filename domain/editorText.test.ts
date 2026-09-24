import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { applyTextChange, editorTextChange, normalizeLineBreaks } from './editorText'

describe('normalizeLineBreaks', () => {
  test('spec: given Windows and old Mac line breaks, when normalized, then every break is \\n', () => {
    expect(normalizeLineBreaks('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  test('spec: given text with only \\n breaks, when normalized, then it is unchanged', () => {
    expect(normalizeLineBreaks('# Title\n\n- item\n')).toBe('# Title\n\n- item\n')
  })

  test('adversarial: given an empty string, when normalized, then it stays empty', () => {
    expect(normalizeLineBreaks('')).toBe('')
  })

  test('adversarial: given "\\r\\r\\n", when normalized, then it is two breaks, not three', () => {
    expect(normalizeLineBreaks('\r\r\n')).toBe('\n\n')
  })
})

describe('editorTextChange', () => {
  test('spec: given the editor already shows the draft, when compared, then nothing needs to change', () => {
    expect(editorTextChange('# Slide One\n', '# Slide One\n')).toBeNull()
  })

  test('spec: given another slide was selected, when compared, then the differing middle is replaced', () => {
    expect(editorTextChange('# Slide One\n', '# Slide Two\n')).toEqual({ from: 8, to: 11, insert: 'Two' })
  })

  test('spec: given a save that appended text, when compared, then only the appended text is inserted', () => {
    expect(editorTextChange('# Title', '# Title\n\nmore')).toEqual({ from: 7, to: 7, insert: '\n\nmore' })
  })

  test('spec: given a save that removed a line, when compared, then only that line is deleted', () => {
    expect(editorTextChange('a\nb\nc', 'a\nc')).toEqual({ from: 2, to: 4, insert: '' })
  })

  test('adversarial: given an empty editor, when a draft arrives, then the whole draft is inserted', () => {
    expect(editorTextChange('', 'hello')).toEqual({ from: 0, to: 0, insert: 'hello' })
  })

  test('adversarial: given an empty draft, when compared, then the whole editor text is deleted', () => {
    expect(editorTextChange('hello', '')).toEqual({ from: 0, to: 5, insert: '' })
  })

  test('adversarial: given both empty, when compared, then nothing needs to change', () => {
    expect(editorTextChange('', '')).toBeNull()
  })

  test('adversarial: given a draft that differs only in \\r\\n line breaks, when compared, then nothing needs to change', () => {
    expect(editorTextChange('a\nb\n', 'a\r\nb\r\n')).toBeNull()
  })

  test('adversarial: given a repeated character, when one is added, then the insert overlaps neither side twice', () => {
    expect(editorTextChange('aa', 'aaa')).toEqual({ from: 2, to: 2, insert: 'a' })
  })

  test('adversarial: given two emoji that share a high surrogate, when swapped, then the whole emoji is replaced', () => {
    // 😀 is 😀 and 😁 is 😁: a naive prefix would stop
    // between the two halves of the pair.
    expect(editorTextChange('x😀y', 'x😁y')).toEqual({ from: 1, to: 3, insert: '😁' })
  })

  test('adversarial: given two characters that share a low surrogate, when swapped, then the whole character is replaced', () => {
    // 𐀀 is 𐀀 and 𑀀 is 𑀀: a naive suffix would stop
    // between the two halves of the pair.
    expect(editorTextChange('a𐀀', 'a𑀀')).toEqual({ from: 1, to: 3, insert: '𑀀' })
  })

  test('adversarial: given Japanese text, when a word changes, then only that word is replaced', () => {
    expect(editorTextChange('# 日本語のスライド', '# 英語のスライド')).toEqual({ from: 2, to: 4, insert: '英' })
  })

  test('property: applying the change to the editor text always yields the normalized draft', () => {
    const text = fc.string({ unit: fc.constantFrom('a', 'b', '\n', '\r', '😀', '😁', '日') })
    fc.assert(fc.property(text, text, (current, next) => {
      const editorText = normalizeLineBreaks(current)
      const change = editorTextChange(editorText, next)
      const result = change === null ? editorText : applyTextChange(editorText, change)
      expect(result).toBe(normalizeLineBreaks(next))
    }))
  })

  test('property: a change never splits a surrogate pair', () => {
    const text = fc.string({ unit: fc.constantFrom('a', '😀', '😁', '𐀀', '𑀀') })
    fc.assert(fc.property(text, text, (current, next) => {
      const change = editorTextChange(current, next)
      if (change === null) return
      for (const at of [change.from, change.to]) {
        const code = current.charCodeAt(at)
        expect(code >= 0xdc00 && code <= 0xdfff).toBe(false)
      }
    }))
  })
})

describe('applyTextChange', () => {
  test('spec: given a replacement, when applied, then the range is swapped for the insert', () => {
    expect(applyTextChange('# Slide One', { from: 8, to: 11, insert: 'Two' })).toBe('# Slide Two')
  })

  test('adversarial: given an empty range at the end, when applied, then the insert is appended', () => {
    expect(applyTextChange('ab', { from: 2, to: 2, insert: 'c' })).toBe('abc')
  })

  test('adversarial: given an empty text and an empty change, when applied, then it stays empty', () => {
    expect(applyTextChange('', { from: 0, to: 0, insert: '' })).toBe('')
  })
})
