import { expect, test } from 'bun:test'
import { removeSlideText, imageSlotContent, literalSlideText, slideInlineCode, slideTextLines, looseBodyEdit, removeImageSlot, slotTextInsertion, textEditFor, textEditInsertion } from './slideEdit'

test('Japanese text edits locate the annotated bytes in the selected body and preserve heading syntax', () => {
  const body = '# 売上\n\n本文'
  const source = `<!-- {"key":"s"} -->\n${body}`
  const start = new TextEncoder().encode(source.slice(0, source.indexOf('売上'))).length
  const edit = textEditFor({ kind: 'text', heading: true, text: '売上', quote: '売上', byteSpan: { start, end: start + 6 } }, source, body, source.indexOf(body))!
  const insertion = textEditInsertion(edit, body, '成長率')!
  expect(body.slice(0, insertion.from) + insertion.insert + body.slice(insertion.to)).toBe('# 成長率\n\n本文')
  expect(textEditInsertion(edit, body, '')?.insert).toBe('\u00a0')
  expect(textEditInsertion(edit, body + 'changed', 'New')).toBeNull()
})

test('an empty left or right column gets routed content without a body slot', () => {
  const body = '# Title'
  expect(slotTextInsertion(body, 'left', 'blocks', '左の文章')?.insert).toContain('::: {slot=left}\n\n左の文章\n\n:::')
  expect(slotTextInsertion(body, 'right', 'list', 'One\nTwo')?.insert).toContain('- One\n- Two')
  expect(slotTextInsertion(body, 'subtitle', 'inline', 'Subtitle')?.insert).toContain('## Subtitle')
  expect(slotTextInsertion(body, 'image', 'image', 'text')).toBeNull()
})

test('re-entering an empty title replaces its heading without adding a body item', () => {
  for (const empty of ['#', '# \u00a0', '# ', '#    ', '\n# \u00a0']) {
    const body = empty + '\n\nExisting body'
    const insertion = slotTextInsertion(body, 'title', 'inline', 'New title')!
    const result = body.slice(0, insertion.from) + insertion.insert + body.slice(insertion.to)
    expect(result).toBe((empty.startsWith('\n') ? '\n' : '') + '# ' + (empty === '#    ' ? '   ' : '') + 'New title\n\nExisting body')
  }
  expect(slotTextInsertion('# Existing\n\nBody', 'title', 'inline', 'New')).toBeNull()
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

test('canvas blank lines stay inside one Markdown paragraph, including while typing', () => {
  expect(slideTextLines('First\n\nSecond')).toBe('First  \n\u00a0  \nSecond')
  expect(slideTextLines('First\n')).toBe('First  \n\u00a0')
  expect(slideTextLines('First\r\n \t\r\n\r\nSecond')).toBe('First  \n\u00a0  \n\u00a0  \nSecond')
  expect(slideTextLines('First\nSecond')).toBe('First  \nSecond')
  expect(slideTextLines('**Bold**\n\n`code`')).toBe('**Bold**  \n\u00a0  \n`code`')
})


test('deleting a text element removes list markers and empty slot fences but keeps headings editable', () => {
  const locate = (body: string, quote: string, heading = false) => textEditFor({ kind: 'text', text: quote, quote, heading, byteSpan: { start: body.indexOf(quote), end: body.indexOf(quote) + quote.length } }, body, body, 0)!
  expect(removeSlideText(locate('# Title\n\n- Item\n- Keep', 'Item'))).toBe('# Title\n\n\n- Keep')
  expect(removeSlideText(locate('# Title\n\n::: {slot=left}\n\nText\n\n:::', 'Text'))).toBe('# Title')
  expect(removeSlideText(locate('# Title\n\nBody', 'Title', true))).toBe('# \u00a0\n\nBody')
  expect(imageSlotContent('# Title\n\n::: {slot=studio-image-1}\n\n![Photo](img/a.png)\n\n:::', 'studio-image-1')).toBe('![Photo](img/a.png)')
  expect(imageSlotContent('# Title', 'studio-image-2')).toBeNull()
})

test('source annotations map through normalized blank lines without selecting an earlier identical paragraph', () => {
  const raw = '# Title\n\nsame\n\n\n::: {slot=studio-text-1}\n\nsame\n\n:::'
  const body = raw.replace(/\n{3,}/g, '\n\n')
  const source = '<!-- {"key":"cover"} -->\n' + raw
  const start = source.lastIndexOf('same')
  const edit = textEditFor({ kind: 'text', quote: 'same', text: 'same', byteSpan: { start, end: start + 4 } }, source, body, source.indexOf(raw), raw)!
  expect(edit.from).toBe(body.lastIndexOf('same'))
  expect(textEditInsertion(edit, body, 'updated')!.insert).toBe('updated')
})

test('deleting text preserves an unrelated slot example inside fenced code', () => {
  const body = '# Title\n\nRemove me\n\n```markdown\n::: {slot=left}\n\n:::\n```'
  const from = body.indexOf('Remove me')
  const edit = textEditFor({ kind: 'text', quote: 'Remove me', text: 'Remove me', byteSpan: { start: from, end: from + 9 } }, body, body, 0)!
  expect(removeSlideText(edit)).toBe(body.replace('Remove me', ''))
})

test('list editing covers the whole annotated list including markers, without touching other blocks', () => {
  const body = '# Title\n\n- One\n- Two\n\nKeep'
  const items = ['One', 'Two'].map(quote => ({ quote, byteSpan: { start: body.indexOf(quote), end: body.indexOf(quote) + quote.length } }))
  const edit = textEditFor({ kind: 'text', text: 'One', ...items[0], listItems: items }, body, body, 0)!
  expect(edit.value).toBe('- One\n- Two')
  const insertion = textEditInsertion(edit, body, '- One\n- Added\n- Two')!
  expect(body.slice(0, insertion.from) + insertion.insert + body.slice(insertion.to)).toBe('# Title\n\n- One\n- Added\n- Two\n\nKeep')
  const unlisted = textEditInsertion(edit, body, '- One\n\nTwo')!
  expect(body.slice(0, unlisted.from) + unlisted.insert + body.slice(unlisted.to)).toBe('# Title\n\n- One\n\nTwo\n\nKeep')
})
