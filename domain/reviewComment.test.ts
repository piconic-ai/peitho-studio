import { describe, expect, test } from 'bun:test'
import type { CritDeckSession, ReviewComment } from './critReview'
import { messagesFor } from './messages'
import type { ManifestSlide } from './render'
import {
  liveReplies,
  agentCommentBody, annotatedSpan, charSpanOfByteSpan, commentCountsBySlide, commentTargetOf, excerpt, lineRangeOf, locateQuote,
  agentCritCommand, newReviewComment, trimSpan, parseSourceSpan, previewPinsOf, relocateTarget, reviewRows, reviewStatusText, sendAvailability, slideIndexOfLine, slideSpans, targetKindOf, targetLabel,
  utf8OffsetToIndex, type CommentTarget, type PendingComment,
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

  test('adversarial: Given the Markdown is gone from its slide but the same text is on another, Then it is not taken from there', () => {
    const source = '# Other\n\n---\n\n# Title\n'
    const first = { start: 0, end: source.indexOf('---') }
    expect(relocateTarget(source, first, heading)).toBeNull()
  })

  test('adversarial: Given no slide span, Then the whole source is searched', () => {
    const source = '# Other\n\n---\n\n# Title\n'
    expect(relocateTarget(source, null, heading)).toEqual({ start: source.lastIndexOf('Title'), end: source.lastIndexOf('Title') + 5 })
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

describe('trimSpan', () => {
  test('spec: Given a slide\'s text with blank lines around it, Then only its content is left', () => {
    const source = '---\n\n# Hi\n\ntext\n\n---'
    const span = trimSpan(source, { start: 4, end: source.length - 3 })
    expect(source.slice(span.start, span.end)).toBe('# Hi\n\ntext')
  })

  test('adversarial: Given an all-blank or empty span, Then it shrinks to nothing at its start', () => {
    expect(trimSpan('a \n\n b', { start: 1, end: 5 })).toEqual({ start: 5, end: 5 })
    expect(trimSpan('abc', { start: 2, end: 2 })).toEqual({ start: 2, end: 2 })
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

  test('adversarial: Given its Markdown left its slide for another one, When it is sent, Then its lines stay on its own slide, as its label says', () => {
    const text = '# Other\n\n---\n\n# Title\n'
    const first = { start: 0, end: text.indexOf('---') }
    const comment = newReviewComment(pending({ kind: 'heading', text: 'Title', quote: 'Title', offsetInSlide: 2 }), text, first, 1)
    expect(comment).toMatchObject({ startLine: 1, endLine: 1, quote: '', body: '[Slide 1 › heading "Title"] Make it bigger' })
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

const manifestSlide = (key: string, index: number): ManifestSlide => ({
  index, key, src: '', hasNotes: false, skip: false, revealSteps: 1, text: { title: key, body: '', code: '' },
})

describe('slideSpans', () => {
  test('spec: Given two rendered slides, Then each has its manifest key and its text\'s span', () => {
    const source = '---\nlang: en\n---\n# One\n\n---\n\n# Two\n'
    const spans = slideSpans(source, [manifestSlide('one', 0), manifestSlide('two', 1)])
    expect(spans.map(s => s.key)).toEqual(['one', 'two'])
    expect(source.slice(spans[0].span.start, spans[0].span.end)).toBe('# One\n\n')
    expect(source.slice(spans[1].span.start, spans[1].span.end)).toBe('\n# Two\n')
  })

  test('adversarial: Given a draft slide between rendered ones, Then it keeps its own key and the next slide keeps its manifest key', () => {
    const source = '# One\n\n---\n\n<!-- {"key":"wip","draft":true} -->\n# Draft\n\n---\n\n# Two\n'
    expect(slideSpans(source, [manifestSlide('one', 0), manifestSlide('two', 1)]).map(s => s.key)).toEqual(['one', 'wip', 'two'])
  })

  test('adversarial: Given a draft slide without a key, Then it is filed under its placeholder key', () => {
    const source = '# One\n\n---\n\n<!-- {"draft":true} -->\n# Draft\n'
    expect(slideSpans(source, [manifestSlide('one', 0)]).map(s => s.key)).toEqual(['one', 'placeholder:1'])
  })

  test('adversarial: Given an empty deck, Then there are no slides', () => {
    expect(slideSpans('', [])).toEqual([])
  })
})

describe('commentTargetOf', () => {
  const source = '# Title\n\n- same\n\n---\n\n# Next\n\n- same\n'
  const second = { start: source.indexOf('# Next'), end: source.length }

  test('spec: Given a click on an annotated list item, Then the target is that item, placed within its slide', () => {
    const hit = { kind: 'listItem' as const, text: 'same', byteSpan: byteSpanOf(source.slice(second.start), 'same'), quote: 'same' }
    hit.byteSpan = { start: hit.byteSpan.start + second.start, end: hit.byteSpan.end + second.start }
    expect(commentTargetOf(source, second, hit)).toEqual({ kind: 'listItem', text: 'same', quote: 'same', offsetInSlide: '# Next\n\n- '.length })
  })

  test('spec: Given a click on nothing annotated, Then the target is the whole slide', () => {
    expect(commentTargetOf(source, second, null)).toEqual({ kind: 'slide', text: '', quote: '', offsetInSlide: 0 })
  })

  test('adversarial: Given byte spans that don\'t match the source (an included deck), Then the item is found by its Markdown in its slide', () => {
    const hit = { kind: 'listItem' as const, text: 'same', byteSpan: { start: 0, end: 4 }, quote: 'same' }
    expect(commentTargetOf(source, second, hit)).toMatchObject({ kind: 'listItem', offsetInSlide: '# Next\n\n- '.length })
  })

  test('adversarial: Given a Markdown that is nowhere in the source, Then the target is the whole slide', () => {
    const hit = { kind: 'paragraph' as const, text: 'x', byteSpan: null, quote: 'nowhere' }
    expect(commentTargetOf(source, second, hit).kind).toBe('slide')
  })

  test('adversarial: Given an annotated element with an empty Markdown, Then the target is the whole slide', () => {
    expect(commentTargetOf(source, second, { kind: 'paragraph', text: '', byteSpan: { start: 0, end: 0 }, quote: '' }).kind).toBe('slide')
  })

  test('adversarial: Given no slide span, Then the element is placed from the start of the source', () => {
    const hit = { kind: 'heading' as const, text: 'Title', byteSpan: { start: 2, end: 7 }, quote: 'Title' }
    expect(commentTargetOf(source, null, hit)).toMatchObject({ kind: 'heading', offsetInSlide: 2 })
  })
})

describe('sendAvailability', () => {
  const found = (agentWaiting: boolean): CritDeckSession => ({ kind: 'found', id: 's', port: 1, file: 'deck.md', reviewRound: 1, agentWaiting })

  test('spec: Given an agent waiting and unsent comments, Then they can be sent', () => {
    expect(sendAvailability(found(true), 2, false)).toEqual({ kind: 'ready' })
  })

  test('spec: Given the agent is not waiting, Then sending waits for it, whatever is unsent', () => {
    expect(sendAvailability(found(false), 2, false)).toEqual({ kind: 'agent-not-waiting' })
    expect(sendAvailability(found(false), 0, false)).toEqual({ kind: 'agent-not-waiting' })
  })

  test.each([
    ['nothing unsent', found(true), 0, false, 'nothing-to-send'],
    ['a send in flight', found(true), 3, true, 'sending'],
    ['no session', { kind: 'none' } as CritDeckSession, 1, false, 'no-session'],
    ['a session not yet asked for', null, 1, false, 'no-session'],
    ['several sessions', { kind: 'ambiguous', ids: ['a', 'b'] } as CritDeckSession, 1, false, 'several-sessions'],
    ['a send in flight with no session', null, 1, true, 'sending'],
  ])('adversarial: Given %s, Then it is %s', (_label, session, unsent, sending, kind) => {
    expect(sendAvailability(session, unsent, sending).kind as string).toBe(kind)
  })
})

describe('reviewStatusText / agentCritCommand', () => {
  const en = messagesFor('en')

  test('spec: Given no agent waits, Then the status says what to ask the agent to run', () => {
    expect(reviewStatusText(en, { kind: 'agent-not-waiting' }, 1, false, 'crit --no-open deck.md')).toContain('`crit --no-open deck.md`')
  })

  test.each([
    ['ready', 0, false, en.agentWaiting],
    ['sending', 1, false, en.sendingToAgent],
    ['nothing-to-send', 0, false, en.commentHint],
    ['no-session', 0, false, en.commentHint],
    ['no-session', 2, false, en.sendNeedsSession],
    ['several-sessions', 1, false, en.sendNeedsOneSession],
    ['ready', 1, true, en.startingReview],
  ] as const)('spec: Given %s with %d unsent (starting: %p), Then the status is %p', (kind, unsent, starting, text) => {
    expect(reviewStatusText(en, { kind }, unsent, starting, 'x')).toBe(text)
  })

  test('spec: Given a deck path, Then the agent runs crit on its file name', () => {
    expect(agentCritCommand('/decks/talk/deck.md')).toBe('crit --no-open deck.md')
  })

  test('adversarial: Given a file name with spaces or quotes, Then it is quoted for the shell', () => {
    expect(agentCritCommand('/d/my talk.md')).toBe("crit --no-open 'my talk.md'")
    expect(agentCritCommand("/d/it's.md")).toBe("crit --no-open 'it'\\''s.md'")
  })

  test('adversarial: Given no deck path or one ending in a slash, Then it falls back to deck.md', () => {
    expect(agentCritCommand(null)).toBe('crit --no-open deck.md')
    expect(agentCritCommand('/decks/')).toBe('crit --no-open deck.md')
  })

  test('adversarial: Given a Windows-style path, Then the file name is still found', () => {
    expect(agentCritCommand('C:\\decks\\deck.md')).toBe('crit --no-open deck.md')
  })
})

describe('previewPinsOf', () => {
  const target: CommentTarget = { kind: 'heading', text: 'Hi', quote: 'Hi', offsetInSlide: 0 }
  const unsent = (id: string, slideKey: string, pin: { x: number; y: number } | null): PendingComment => ({ id, slideKey, target, pin, body: 'b' })
  const inCrit = (id: string, body: string, resolved = false): ReviewComment => ({
    id, lines: { start: 1, end: 1 }, body, quote: null, author: 'Peitho Studio', resolved, replies: [],
  })

  test('spec: Given a sent comment, an unsent one and the box being written on this slide, Then all three pins show, numbered in that order', () => {
    const pins = previewPinsOf(
      'a',
      [inCrit('c1', '[Slide 1] sent')],
      { '[Slide 1] sent': [{ slideKey: 'a', pin: { x: 0.1, y: 0.2 } }] },
      [unsent('p1', 'a', { x: 0.3, y: 0.4 })],
      { kind: 'open', slideKey: 'a', target, pin: { x: 0.5, y: 0.6 }, at: { x: 0, y: 0 } },
    )
    expect(pins).toEqual([
      { id: 'sent:c1', x: 0.1, y: 0.2, number: 1, sent: true },
      { id: 'p1', x: 0.3, y: 0.4, number: 2, sent: false },
      { id: 'writing', x: 0.5, y: 0.6, number: 3, sent: false },
    ])
  })

  test('adversarial: Given comments on other slides, resolved ones, ones without a pin, and no selection, Then none of them shows', () => {
    const sentPins = { gone: [{ slideKey: 'a', pin: { x: 0, y: 0 } }], other: [{ slideKey: 'b', pin: { x: 0, y: 0 } }] }
    const comments = [inCrit('c1', 'gone', true), inCrit('c2', 'other'), inCrit('c3', 'unknown body')]
    const pending = [unsent('p1', 'b', { x: 0, y: 0 }), unsent('p2', 'a', null)]
    expect(previewPinsOf('a', comments, sentPins, pending, { kind: 'closed' })).toEqual([])
    expect(previewPinsOf(null, comments, sentPins, pending, { kind: 'closed' })).toEqual([])
  })

  test('adversarial: Given two sent comments with the same body, Then each keeps its own pin, in crit\'s order', () => {
    const sentPins = { '[Slide 1] Fix': [{ slideKey: 'a', pin: { x: 0.1, y: 0.1 } }, { slideKey: 'a', pin: { x: 0.9, y: 0.9 } }] }
    const pins = previewPinsOf('a', [inCrit('c1', '[Slide 1] Fix'), inCrit('c2', '[Slide 1] Fix')], sentPins, [], { kind: 'closed' })
    expect(pins.map(p => [p.id, p.x])).toEqual([['sent:c1', 0.1], ['sent:c2', 0.9]])
  })

  test('adversarial: Given the first of two same-bodied comments had no pin, Then the second still gets its own', () => {
    const sentPins = { same: [{ slideKey: 'a', pin: null }, { slideKey: 'a', pin: { x: 0.9, y: 0.9 } }] }
    const pins = previewPinsOf('a', [inCrit('c1', 'same'), inCrit('c2', 'same')], sentPins, [], { kind: 'closed' })
    expect(pins.map(p => p.id)).toEqual(['sent:c2'])
  })

  test('adversarial: Given a comment body like an object property name, Then it is not taken for a known pin', () => {
    expect(previewPinsOf('a', [inCrit('c1', 'constructor')], {}, [], { kind: 'closed' })).toEqual([])
  })
})

describe('liveReplies', () => {
  const comment = (id: string): ReviewComment => ({ id, lines: null, body: 'b', quote: null, author: 'a', resolved: false, replies: [] })

  test('spec: Given replies to comments crit has and to one it lost, Then only the former are live, in order', () => {
    const replies = [{ id: 'r1', commentId: 'c1', body: 'a' }, { id: 'r2', commentId: 'gone', body: 'b' }, { id: 'r3', commentId: 'c2', body: 'c' }]
    expect(liveReplies(replies, [comment('c1'), comment('c2')]).map(r => r.id)).toEqual(['r1', 'r3'])
  })

  test('adversarial: Given no comments or no replies, Then nothing is live', () => {
    expect(liveReplies([{ id: 'r1', commentId: 'c1', body: 'a' }], [])).toEqual([])
    expect(liveReplies([], [comment('c1')])).toEqual([])
  })
})

describe('reviewRows', () => {
  const thread = (id: string, resolved: boolean, replies: { id: string; body: string }[] = []): ReviewComment => ({
    id, lines: { start: 1, end: 1 }, body: `[Slide 1] ${id}`, quote: null, author: 'Peitho Studio', resolved,
    replies: replies.map(r => ({ ...r, author: 'Agent' })),
  })

  test('spec: Given a thread with the agent\'s reply, an unsent reply to it and an unsent comment, Then the panel reads them in that order', () => {
    const rows = reviewRows(
      [thread('c1', false, [{ id: 'r1', body: 'Done' }])],
      [{ id: 'reply-1', commentId: 'c1', body: 'Still small' }],
      [{ id: 'p1', label: 'Slide 2 › heading "Hi"', body: 'Bolder' }],
    )
    expect(rows.map(r => [r.kind, r.id, r.author, r.body])).toEqual([
      ['comment', 'c1', 'Peitho Studio', '[Slide 1] c1'],
      ['reply', 'c1', 'Agent', 'Done'],
      ['unsent-reply', 'reply-1', 'Peitho Studio', 'Still small'],
      ['unsent-comment', 'p1', 'Peitho Studio', '[Slide 2 › heading "Hi"] Bolder'],
    ])
  })

  test('spec: Given a resolved thread before an open one, Then open threads come first and the resolved one is marked on every row', () => {
    const rows = reviewRows([thread('c1', true, [{ id: 'r1', body: 'ok' }]), thread('c2', false)], [], [])
    expect(rows.map(r => [r.id, r.resolved])).toEqual([['c2', false], ['c1', true], ['c1', true]])
  })

  test('adversarial: Given nothing at all, Then there are no rows', () => {
    expect(reviewRows([], [], [])).toEqual([])
  })

  test('adversarial: Given an unsent reply to a comment crit no longer has, Then it is listed after the threads, on its own, to be discarded', () => {
    const rows = reviewRows([thread('c1', false)], [{ id: 'reply-1', commentId: 'gone', body: 'x' }], [{ id: 'p1', label: 'Slide 1', body: 'z' }])
    expect(rows.map(r => [r.kind, r.id, r.resolved])).toEqual([['comment', 'c1', false], ['unsent-reply', 'reply-1', false], ['unsent-comment', 'p1', false]])
  })

  test('adversarial: Given every row, Then their keys are distinct', () => {
    const rows = reviewRows(
      [thread('c1', false, [{ id: 'r1', body: 'a' }, { id: 'r2', body: 'b' }]), thread('c2', false, [{ id: 'r1', body: 'c' }])],
      [{ id: 'reply-1', commentId: 'c1', body: 'x' }, { id: 'reply-2', commentId: 'c2', body: 'y' }, { id: 'reply-3', commentId: 'gone', body: 'w' }],
      [{ id: 'p1', label: 'Slide 1', body: 'z' }],
    )
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length)
  })
})
