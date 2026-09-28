import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { applyTextChange, editorTextChange, imageParagraphInsertion, insertionRangeAfterWait, normalizeLineBreaks } from './editorText'

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

describe('imageParagraphInsertion', () => {
  // The text after the insertion, with `|` where the cursor lands.
  const insertAt = (doc: string, from: number, to: number, paths: string[]): string | null => {
    const insertion = imageParagraphInsertion(doc, from, to, paths)
    if (insertion === null) return null
    const next = applyTextChange(doc, insertion)
    return `${next.slice(0, insertion.cursor)}|${next.slice(insertion.cursor)}`
  }

  test('spec: Given the caret at the end of a paragraph, when an image is inserted, then it becomes its own paragraph after a blank line', () => {
    const doc = '# Title\n\nSome text'
    expect(insertAt(doc, doc.length, doc.length, ['img/a.png'])).toBe('# Title\n\nSome text\n\n![](img/a.png)|')
  })

  test('spec: Given the caret in the middle of a line, when an image is inserted, then the line is split around the image paragraph', () => {
    expect(insertAt('before after', 7, 7, ['img/a.png'])).toBe('before \n\n![](img/a.png)|\n\nafter')
  })

  test('spec: Given the caret at the start of a line under a paragraph, when an image is inserted, then exactly one blank line surrounds it', () => {
    expect(insertAt('first\nsecond', 6, 6, ['img/a.png'])).toBe('first\n\n![](img/a.png)|\n\nsecond')
  })

  test('spec: Given the caret on a blank line between paragraphs, when an image is inserted, then no extra blank lines pile up', () => {
    expect(insertAt('first\n\n\nsecond', 7, 7, ['img/a.png'])).toBe('first\n\n![](img/a.png)|\n\nsecond')
  })

  test('spec: Given several images dropped at once, when inserted, then each is its own paragraph in the order given', () => {
    expect(insertAt('text', 4, 4, ['img/a.png', 'img/b.jpg'])).toBe('text\n\n![](img/a.png)\n\n![](img/b.jpg)|')
  })

  test('spec: Given a selection, when an image is pasted, then the selection is replaced by the image paragraph', () => {
    expect(insertAt('keep REPLACE keep', 5, 12, ['img/a.png'])).toBe('keep \n\n![](img/a.png)|\n\n keep')
  })

  test('adversarial: Given an empty body, when an image is inserted, then only the image is there, with no blank lines around it', () => {
    expect(insertAt('', 0, 0, ['img/a.png'])).toBe('![](img/a.png)|')
  })

  test('adversarial: Given the caret at the very start, when an image is inserted, then no blank line is added above it', () => {
    expect(insertAt('text', 0, 0, ['img/a.png'])).toBe('![](img/a.png)|\n\ntext')
  })

  test('adversarial: Given no images, when inserted, then nothing changes', () => {
    expect(imageParagraphInsertion('text', 2, 2, [])).toBeNull()
  })

  test('adversarial: Given positions out of range, reversed, or not numbers, when inserted, then they are clamped and put in order', () => {
    expect(insertAt('abc', 99, 99, ['i.png'])).toBe('abc\n\n![](i.png)|')
    expect(insertAt('abc', -5, -1, ['i.png'])).toBe('![](i.png)|\n\nabc')
    expect(insertAt('abcd', 3, 1, ['i.png'])).toBe('a\n\n![](i.png)|\n\nd')
    expect(insertAt('abc', Number.NaN, Number.NaN, ['i.png'])).toBe('![](i.png)|\n\nabc')
    expect(insertAt('abc', 1.7, 1.7, ['i.png'])).toBe('a\n\n![](i.png)|\n\nbc')
  })

  test('adversarial: Given CRLF line breaks, when an image is inserted, then existing blank lines are recognized and a CRLF is never split', () => {
    expect(insertAt('a\r\n\r\nb', 5, 5, ['i.png'])).toBe('a\r\n\r\n![](i.png)|\n\nb')
    // Between "\r" and "\n": moves back before the pair.
    expect(insertAt('a\r\nb', 2, 2, ['i.png'])).toBe('a\n\n![](i.png)|\n\r\nb')
  })

  test('adversarial: Given the caret inside an emoji, when an image is inserted, then the emoji is not split', () => {
    const doc = 'a😀b'
    const insertion = imageParagraphInsertion(doc, 2, 2, ['i.png'])
    expect(insertion?.from).toBe(1)
    expect(applyTextChange(doc, insertion!)).toContain('😀')
  })

  test('adversarial: Given a body that is only a page comment, when an image is inserted after it, then the comment stays on its own line', () => {
    const doc = '<!-- {"key":"a"} -->\n'
    expect(insertAt(doc, doc.length, doc.length, ['i.png'])).toBe('<!-- {"key":"a"} -->\n\n![](i.png)|')
  })

  test('property: Given any text and caret, when an image is inserted, then the image is its own paragraph and the text before it is kept', () => {
    fc.assert(fc.property(fc.string(), fc.nat(), (doc, pos) => {
      const clean = normalizeLineBreaks(doc)
      const insertion = imageParagraphInsertion(clean, pos, pos, ['img/x.png'])
      if (insertion === null) return false
      const next = applyTextChange(clean, insertion)
      const image = '![](img/x.png)'
      const at = insertion.cursor - image.length
      const beforeOk = at === 0 || next.slice(0, at).endsWith('\n\n')
      const afterOk = insertion.cursor === next.length || next.slice(insertion.cursor).startsWith('\n\n')
      return next.slice(at, insertion.cursor) === image && beforeOk && afterOk && next.slice(0, insertion.from) === clean.slice(0, insertion.from)
    }))
  })
})

describe('insertionRangeAfterWait', () => {
  test('spec: Given the text did not change while the image was imported, when inserting, then it goes where it was dropped', () => {
    expect(insertionRangeAfterWait({ doc: 'abc', from: 1, to: 1 }, { doc: 'abc', from: 3, to: 3 })).toEqual({ from: 1, to: 1 })
  })

  test('spec: Given the user typed while the image was imported, when inserting, then it goes where the cursor is now', () => {
    expect(insertionRangeAfterWait({ doc: 'abc', from: 1, to: 1 }, { doc: 'abcd', from: 4, to: 4 })).toEqual({ from: 4, to: 4 })
  })

  test('adversarial: Given empty texts on both sides, when inserting, then the saved place is used', () => {
    expect(insertionRangeAfterWait({ doc: '', from: 0, to: 0 }, { doc: '', from: 0, to: 0 })).toEqual({ from: 0, to: 0 })
  })
})
