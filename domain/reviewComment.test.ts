import { describe, expect, test } from 'bun:test'
import type { ReviewComment } from './critReview'
import {
  agentCommentBody, annotatedSpan, charSpanOfByteSpan, commentCountsBySlide, excerpt, lineRangeOf, locateQuote,
  newReviewComment, parseSourceSpan, relocateTarget, slideIndexOfLine, targetKindOf, targetLabel, utf8OffsetToIndex,
  type CommentTarget, type PendingComment,
} from './reviewComment'

const bytes = (text: string) => new TextEncoder().encode(text).length

/** The byte span of the first `quote` in `source`, as peitho-core writes it. */
function byteSpanOf(source: string, quote: string) {
  const at = source.indexOf(quote)
  return { start: bytes(source.slice(0, at)), end: bytes(source.slice(0, at + quote.length)) }
}

describe('parseSourceSpan', () => {
  test('spec: Given "12-34", Then it is the byte span 12 to 34', () => {
    expect(parseSourceSpan('12-34')).toEqual({ start: 12, end: 34 })
  })

  test('spec: Given an empty span "5-5", Then it is kept', () => {
    expect(parseSourceSpan('5-5')).toEqual({ start: 5, end: 5 })
  })

  test.each([
    ['nothing', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['an end before the start', '9-3'],
    ['a negative number', '-1-3'],
    ['spaces', '1 - 3'],
    ['one number', '12'],
    ['a fraction', '1.5-3'],
    ['a number too large to be exact', '99999999999999999999-99999999999999999999'],
    ['trailing text', '1-3x'],
  ])('adversarial: Given %s, Then there is no span', (_label, value) => {
    expect(parseSourceSpan(value)).toBeNull()
  })
})

describe('utf8OffsetToIndex / charSpanOfByteSpan', () => {
  test('spec: Given ASCII only, Then bytes and indices agree', () => {
    expect(utf8OffsetToIndex('# Hello', 2)).toBe(2)
    expect(charSpanOfByteSpan('# Hello', { start: 2, end: 7 })).toEqual({ start: 2, end: 7 })
  })

  test('adversarial: Given Japanese (3 bytes each), Then the byte offset is converted to the character index', () => {
    const source = '見出し\n段落'
    expect(utf8OffsetToIndex(source, 9)).toBe(3)
    expect(charSpanOfByteSpan(source, { start: 10, end: 16 })).toEqual({ start: 4, end: 6 })
  })

  test('adversarial: Given an emoji (a surrogate pair, 4 bytes), Then the index after it counts two UTF-16 units', () => {
    const source = 'a😀b'
    expect(utf8OffsetToIndex(source, 5)).toBe(3)
    expect(source.slice(3)).toBe('b')
  })

  test('adversarial: Given a 2-byte character, Then offsets on either side of it land', () => {
    expect(utf8OffsetToIndex('é!', 2)).toBe(1)
  })

  test('adversarial: Given an offset inside a multibyte character, Then it lands nowhere', () => {
    expect(utf8OffsetToIndex('見', 1)).toBeNull()
    expect(utf8OffsetToIndex('😀', 2)).toBeNull()
  })

  test.each([
    ['past the end', 'abc', 4],
    ['negative', 'abc', -1],
    ['not an integer', 'abc', 1.5],
    ['on an empty string', '', 1],
  ])('adversarial: Given an offset %s, Then it lands nowhere', (_label, source, offset) => {
    expect(utf8OffsetToIndex(source, offset)).toBeNull()
  })

  test('adversarial: Given offset 0 of an empty string, Then it is index 0', () => {
    expect(utf8OffsetToIndex('', 0)).toBe(0)
  })

  test('adversarial: Given a span whose end is outside the source, Then there is no span', () => {
    expect(charSpanOfByteSpan('abc', { start: 1, end: 9 })).toBeNull()
  })
})

describe('annotatedSpan', () => {
  const source = '---\nlang: ja\n---\n\n# 見出し 🎉\n\n段落\n'

  test('spec: Given the byte span peitho-core wrote and its Markdown, Then it is that text in the source (frontmatter included)', () => {
    const span = annotatedSpan(source, byteSpanOf(source, '見出し 🎉'), '見出し 🎉')
    expect(span).not.toBeNull()
    expect(source.slice(span!.start, span!.end)).toBe('見出し 🎉')
  })

  test('adversarial: Given a span whose bytes are not the Markdown (an include-expanded source), Then there is no span', () => {
    expect(annotatedSpan(source, byteSpanOf(source, '段落'), '見出し 🎉')).toBeNull()
  })

  test('adversarial: Given a span in the middle of a character, Then there is no span', () => {
    expect(annotatedSpan(source, { start: 20, end: 22 }, '見')).toBeNull()
  })
})

describe('lineRangeOf', () => {
  const source = 'one\ntwo\nthree\n'

  test('spec: Given a span on the second line, Then it is line 2', () => {
    expect(lineRangeOf(source, { start: 4, end: 7 })).toEqual({ start: 2, end: 2 })
  })

  test('spec: Given a span over two lines, Then both lines are covered', () => {
    expect(lineRangeOf(source, { start: 4, end: 13 })).toEqual({ start: 2, end: 3 })
  })

  test('adversarial: Given a span that ends right after a line break, Then the next line is not included', () => {
    expect(lineRangeOf(source, { start: 0, end: 4 })).toEqual({ start: 1, end: 1 })
  })

  test('adversarial: Given CRLF line endings, Then lines are counted the same', () => {
    expect(lineRangeOf('a\r\nb\r\nc', { start: 3, end: 4 })).toEqual({ start: 2, end: 2 })
    expect(lineRangeOf('a\r\nb\r\nc', { start: 0, end: 3 })).toEqual({ start: 1, end: 1 })
  })

  test('adversarial: Given an empty span, Then it is the line it sits on', () => {
    expect(lineRangeOf(source, { start: 8, end: 8 })).toEqual({ start: 3, end: 3 })
  })

  test('adversarial: Given an empty source, Then it is line 1', () => {
    expect(lineRangeOf('', { start: 0, end: 0 })).toEqual({ start: 1, end: 1 })
  })

  test('adversarial: Given a span outside the source or reversed, Then it is clamped rather than thrown on', () => {
    expect(lineRangeOf(source, { start: 100, end: 200 })).toEqual({ start: 4, end: 4 })
    expect(lineRangeOf(source, { start: 5, end: 2 })).toEqual({ start: 2, end: 2 })
    expect(lineRangeOf(source, { start: -3, end: 2 })).toEqual({ start: 1, end: 1 })
  })

  test('adversarial: Given multibyte text before the span, Then lines still count by line breaks', () => {
    const text = '見出し\n😀 段落\n'
    expect(lineRangeOf(text, { start: text.indexOf('段落'), end: text.indexOf('段落') + 2 })).toEqual({ start: 2, end: 2 })
  })
})

describe('locateQuote', () => {
  const source = '- a\n- b\n- a\n'
  const whole = { start: 0, end: source.length }

  test('spec: Given one occurrence, Then it is found', () => {
    expect(locateQuote(source, 'b', whole, 0)).toEqual({ start: 6, end: 7 })
  })

  test('adversarial: Given the same Markdown twice, Then the occurrence nearest the hint is chosen', () => {
    expect(locateQuote(source, 'a', whole, 0)).toEqual({ start: 2, end: 3 })
    expect(locateQuote(source, 'a', whole, 11)).toEqual({ start: 10, end: 11 })
  })

  test('adversarial: Given a tie, Then the earlier occurrence wins', () => {
    expect(locateQuote(source, 'a', whole, 6)).toEqual({ start: 2, end: 3 })
  })

  test('adversarial: Given a range that excludes the only occurrence, Then nothing is found', () => {
    expect(locateQuote(source, 'b', { start: 8, end: source.length }, 0)).toBeNull()
  })

  test('adversarial: Given a quote that runs past the end of the range, Then it is not taken', () => {
    expect(locateQuote(source, '- b', { start: 0, end: 6 }, 0)).toBeNull()
  })

  test('adversarial: Given an empty quote or a missing one, Then nothing is found', () => {
    expect(locateQuote(source, '', whole, 0)).toBeNull()
    expect(locateQuote(source, 'zzz', whole, 0)).toBeNull()
  })
})

describe('relocateTarget', () => {
  const heading: CommentTarget = { kind: 'heading', text: 'Title', quote: 'Title', offsetInSlide: 2 }

  test('spec: Given lines were added before the slide, When the target is looked up again, Then it still points at its heading', () => {
    const before = '# Title\n'
    const after = 'New intro\n\n---\n\n# Title\n'
    const slide = { start: after.indexOf('# Title'), end: after.length }
    const span = relocateTarget(after, slide, heading)
    expect(after.slice(span!.start, span!.end)).toBe('Title')
    expect(lineRangeOf(after, span!)).toEqual({ start: 5, end: 5 })
    expect(before).not.toBe(after)
  })

  test('adversarial: Given the same Markdown on another slide too, Then the one in its own slide is chosen', () => {
    const source = '# Title\n\n---\n\n# Title\n'
    const second = { start: source.lastIndexOf('# Title'), end: source.length }
    expect(relocateTarget(source, second, heading)).toEqual({ start: second.start + 2, end: second.start + 7 })
  })

  test('adversarial: Given the Markdown moved to another slide, Then it is found there', () => {
    const source = '# Other\n\n---\n\n# Title\n'
    const first = { start: 0, end: source.indexOf('---') }
    expect(relocateTarget(source, first, heading)).toEqual({ start: source.lastIndexOf('Title'), end: source.lastIndexOf('Title') + 5 })
  })

  test('adversarial: Given the Markdown was edited away, Then there is nothing to point at', () => {
    expect(relocateTarget('# Renamed\n', { start: 0, end: 10 }, heading)).toBeNull()
  })

  test('adversarial: Given a whole-slide target, Then there is no element to point at', () => {
    expect(relocateTarget('# Title\n', null, { kind: 'slide', text: '', quote: '', offsetInSlide: 0 })).toBeNull()
  })
})

describe('targetKindOf', () => {
  test.each([
    ['H1', null, 'heading'],
    ['h3', 'SECTION', 'heading'],
    ['SPAN', 'H2', 'heading'],
    ['P', 'DIV', 'paragraph'],
    ['LI', 'UL', 'listItem'],
    ['TD', 'TR', 'tableCell'],
    ['TH', 'TR', 'tableCell'],
  ] as const)('spec: Given a %s inside %p, Then it is a %s', (tag, parent, kind) => {
    expect(targetKindOf(tag, parent)).toBe(kind)
  })

  test.each([
    ['a SPAN outside a heading', 'SPAN', 'P'],
    ['an image', 'IMG', 'P'],
    ['an empty tag name', '', null],
  ])('adversarial: Given %s, Then it counts as the whole slide', (_label, tag, parent) => {
    expect(targetKindOf(tag, parent)).toBe('slide')
  })
})

describe('excerpt / targetLabel', () => {
  test('spec: Given a heading, Then the label names the slide, the kind and its text', () => {
    expect(targetLabel(2, { kind: 'heading', text: 'Markdown is the source' })).toBe('Slide 2 › heading "Markdown is the source"')
  })

  test.each([
    ['paragraph', 'Some text', 'Slide 1 › paragraph "Some text"'],
    ['listItem', 'A point', 'Slide 1 › list item "A point"'],
    ['tableCell', '42', 'Slide 1 › table cell "42"'],
  ] as const)('spec: Given a %s, Then the label reads %p', (kind, text, label) => {
    expect(targetLabel(1, { kind, text })).toBe(label)
  })

  test('spec: Given the whole slide, Then the label is the slide alone', () => {
    expect(targetLabel(3, { kind: 'slide', text: 'ignored' })).toBe('Slide 3')
  })

  test('adversarial: Given long text, Then it is cut with an ellipsis', () => {
    const label = targetLabel(1, { kind: 'paragraph', text: 'x'.repeat(100) })
    expect(label).toBe(`Slide 1 › paragraph "${'x'.repeat(29)}…"`)
  })

  test('adversarial: Given text with line breaks and runs of spaces, Then it is shown on one line', () => {
    expect(excerpt('  one\n two\t\tthree  ')).toBe('one two three')
  })

  test('adversarial: Given emoji at the cut, Then no emoji is split in half', () => {
    const cut = excerpt('😀'.repeat(40), 5)
    expect(cut).toBe('😀😀😀😀…')
  })

  test('adversarial: Given empty text, Then the quotes are empty', () => {
    expect(targetLabel(1, { kind: 'paragraph', text: '' })).toBe('Slide 1 › paragraph ""')
  })

  test('adversarial: Given a maximum of zero, Then only the ellipsis is left', () => {
    expect(excerpt('abc', 0)).toBe('…')
  })
})

describe('agentCommentBody', () => {
  test('spec: Given a label and a comment, Then the agent reads the target first', () => {
    expect(agentCommentBody('Slide 2 › heading "Hi"', 'Make it bigger')).toBe('[Slide 2 › heading "Hi"] Make it bigger')
  })

  test('adversarial: Given surrounding whitespace, Then it is trimmed', () => {
    expect(agentCommentBody('Slide 1', '  Fix\n')).toBe('[Slide 1] Fix')
  })
})

describe('newReviewComment', () => {
  const source = '---\nlang: en\n---\n\n# Hello\n\nSome text\n\n---\n\n# Second\n'
  const firstSlide = { start: source.indexOf('# Hello'), end: source.indexOf('---', 20) }
  const pending = (target: CommentTarget): PendingComment => ({ id: 'p1', slideKey: 'hello', target, pin: null, body: 'Make it bigger' })

  test('spec: Given a comment on a heading, When it is sent, Then crit gets the heading\'s line, its Markdown and the labelled comment', () => {
    const comment = newReviewComment(pending({ kind: 'heading', text: 'Hello', quote: 'Hello', offsetInSlide: 2 }), source, firstSlide, 1)
    expect(comment).toEqual({
      startLine: 5, endLine: 5, body: '[Slide 1 › heading "Hello"] Make it bigger', quote: 'Hello', author: 'Peitho Studio',
    })
  })

  test('spec: Given a comment on the whole slide, When it is sent, Then it covers the slide\'s lines with no quote', () => {
    const comment = newReviewComment(pending({ kind: 'slide', text: '', quote: '', offsetInSlide: 0 }), source, firstSlide, 1)
    expect(comment).toMatchObject({ startLine: 5, endLine: 7, quote: '', body: '[Slide 1] Make it bigger' })
  })

  test('adversarial: Given the commented Markdown was edited away, When it is sent, Then it falls back to its slide', () => {
    const comment = newReviewComment(pending({ kind: 'paragraph', text: 'Gone', quote: 'Gone', offsetInSlide: 0 }), source, firstSlide, 1)
    expect(comment).toMatchObject({ startLine: 5, endLine: 7, quote: '', body: '[Slide 1 › paragraph "Gone"] Make it bigger' })
  })

  test('adversarial: Given its slide and Markdown are both gone, When it is sent, Then it lands on line 1 with its label', () => {
    const comment = newReviewComment(pending({ kind: 'paragraph', text: 'Gone', quote: 'Gone', offsetInSlide: 0 }), source, null, 4)
    expect(comment).toMatchObject({ startLine: 1, endLine: 1, quote: '' })
  })

  test('adversarial: Given a multi-line paragraph, When it is sent, Then both lines are covered', () => {
    const text = '# T\n\nline one\nline two\n'
    const comment = newReviewComment(pending({ kind: 'paragraph', text: 'line one line two', quote: 'line one\nline two', offsetInSlide: 5 }), text, { start: 0, end: text.length }, 1)
    expect(comment).toMatchObject({ startLine: 3, endLine: 4, quote: 'line one\nline two' })
  })
})

describe('slideIndexOfLine / commentCountsBySlide', () => {
  const source = '# One\n\n---\n\n# Two\ntext\n'
  const slides = [
    { key: 'one', span: { start: 0, end: source.indexOf('---') } },
    { key: 'two', span: { start: source.indexOf('# Two'), end: source.length } },
  ]
  const sent = (start: number, resolved = false): ReviewComment => ({
    id: `c${String(start)}`, lines: { start, end: start }, body: 'b', quote: null, author: 'Peitho Studio', resolved, replies: [],
  })

  test('spec: Given line 5 is in the second slide, Then that slide is found', () => {
    expect(slideIndexOfLine(source, slides.map(s => s.span), 5)).toBe(1)
  })

  test.each([
    ['line 0', 0],
    ['a negative line', -2],
    ['a line past the end', 99],
    ['a separator line between slides', 3],
  ])('adversarial: Given %s, Then no slide is found', (_label, line) => {
    expect(slideIndexOfLine(source, slides.map(s => s.span), line)).toBeNull()
  })

  test('spec: Given unsent comments and unresolved ones in crit, Then each slide counts its own', () => {
    expect(commentCountsBySlide(source, slides, [{ slideKey: 'one' }, { slideKey: 'one' }], [sent(5), sent(6)])).toEqual({ one: 2, two: 2 })
  })

  test('adversarial: Given resolved, whole-file and out-of-range comments, Then they are not counted', () => {
    const wholeFile: ReviewComment = { ...sent(1), lines: null }
    expect(commentCountsBySlide(source, slides, [], [sent(5, true), wholeFile, sent(99)])).toEqual({})
  })

  test('adversarial: Given no slides at all, Then only unsent comments are counted', () => {
    expect(commentCountsBySlide('', [], [{ slideKey: 'x' }], [sent(1)])).toEqual({ x: 1 })
  })
})
