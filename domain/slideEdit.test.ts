import { expect, test } from 'bun:test'
import { literalSlideText, slideInlineCode, looseBodyEdit, removeImageSlot, slotTextInsertion, textEditFor, textEditInsertion } from './slideEdit'

test('Japanese text edits locate the annotated bytes in the selected body and preserve heading syntax', () => {
  const body = '# 売上\n\n本文'
  const source = `<!-- {"key":"s"} -->\n${body}`
  const start = new TextEncoder().encode(source.slice(0, source.indexOf('売上'))).length
  const edit = textEditFor({ kind: 'text', heading: true, text: '売上', quote: '売上', byteSpan: { start, end: start + 6 } }, source, body, source.indexOf(body))!
  const insertion = textEditInsertion(edit, body, '成長率')!
  expect(body.slice(0, insertion.from) + insertion.insert + body.slice(insertion.to)).toBe('# 成長率\n\n本文')
  expect(textEditInsertion(edit, body, '')).toBeNull()
  expect(textEditInsertion(edit, body + 'changed', 'New')).toBeNull()
})

test('an empty left or right column gets routed content without a body slot', () => {
  const body = '# Title'
  expect(slotTextInsertion(body, 'left', 'blocks', '左の文章')?.insert).toContain('::: {slot=left}\n\n左の文章\n\n:::')
  expect(slotTextInsertion(body, 'right', 'list', 'One\nTwo')?.insert).toContain('- One\n- Two')
  expect(slotTextInsertion(body, 'subtitle', 'inline', 'Subtitle')?.insert).toContain('## Subtitle')
  expect(slotTextInsertion(body, 'image', 'image', 'text')).toBeNull()
})

test('stale or include-expanded annotations do not replace an unrelated matching quote', () => {
  expect(textEditFor({ kind: 'text', quote: 'same', text: 'same', byteSpan: { start: 0, end: 4 } }, 'different source', '# same', 0)).toBeNull()
})

test('removing an image preserves text and other images and refuses ordinary slots', () => {
  const image = (slot: string) => `::: {slot=${slot}}\n\n![](img/photo.png)\n\n:::`
  const body = `# Title\n\n${image('studio-image-1')}\n\n${image('studio-image-2')}`
  expect(removeImageSlot(body, 'studio-image-1')).toBe(`# Title\n\n\n${image('studio-image-2')}`)
  expect(removeImageSlot(body, 'studio-image-3')).toBeNull()
  expect(removeImageSlot(body, 'body')).toBeNull()
})

test('missing-body list content can be explicitly placed in a column without losing it', () => {
  const body = '# Title\n\n- One\n- Two'
  const edit = looseBodyEdit(body, 'left', 'blocks')!
  expect(edit.value).toBe('- One\n- Two')
  const insertion = textEditInsertion(edit, body, edit.value)!
  expect(body.slice(0, insertion.from) + insertion.insert).toBe('# Title\n\n::: {slot=left}\n\n- One\n- Two\n\n:::\n')
  expect(looseBodyEdit('# Title', 'left', 'blocks')).toBeNull()
  expect(looseBodyEdit('# Title\n\n::: {slot=right}\n\nKeep\n\n:::', 'left', 'blocks')).toBeNull()
  expect(looseBodyEdit(body, 'subtitle', 'inline')).toBeNull()
})


test('canvas text preserves literal Markdown characters rather than introducing syntax', () => {
  expect(literalSlideText('a * b <tag> [text] # title')).toBe('a \\* b \\<tag\\> \\[text\\] \\# title')
  expect(literalSlideText('日本語')).toBe('日本語')
  expect(literalSlideText('')).toBe('')
  expect(literalSlideText('\\')).toBe('\\\\')
})

test('inline code retains its formatting including embedded backticks and boundary spaces', () => {
  expect(slideInlineCode('foo')).toBe('`foo`')
  expect(slideInlineCode('`foo`')).toBe('`` `foo` ``')
  expect(slideInlineCode(' foo ')).toBe('`  foo  `')
  expect(slideInlineCode('a``b')).toBe('```a``b```')
})
