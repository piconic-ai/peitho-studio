import { expect, test } from 'bun:test'
import { elementActionFor } from './elementAction'
import { applyTextChange } from './editorText'
import type { PreviewClick } from './reviewComment'

const body = '# Title\n\nKeep **formatting**'
const source = body + '\n'
const hit: PreviewClick = { hit: { kind: 'paragraph', text: 'Keep formatting', quote: 'Keep **formatting**', byteSpan: { start: 9, end: 28 } }, pin: null, at: { x: 0, y: 0 } }

test('text capability retains clipboard Markdown and an undoable minimal deletion', () => {
  const element = elementActionFor(hit, source, 0, body)
  expect(element?.markdown).toBe('Keep **formatting**')
  expect(element?.image).toBe(false)
  if (element?.kind !== 'text' || !element.change) throw new Error('Expected text deletion')
  expect(applyTextChange(body, element.change)).toBe('# Title')
  expect(element.change.cursor).toBe(element.change.from)
})

test('slot text removes the object while keeping its text clipboard identity', () => {
  expect(elementActionFor({ ...hit, textSlot: 'studio-text-1' }, source, 0, body)).toEqual({ kind: 'slot', slot: 'studio-text-1', markdown: 'Keep **formatting**', image: false })
})

test('stale bodies, missing slides and invalid annotations provide no action', () => {
  expect(elementActionFor(hit, source, 0, body + 'typing')).toBeNull()
  expect(elementActionFor(hit, source, 1, body)).toBeNull()
  expect(elementActionFor({ ...hit, hit: { ...hit.hit!, byteSpan: null } }, source, 0, body)).toBeNull()
  expect(elementActionFor({ ...hit, hit: { ...hit.hit!, quote: 'stale' } }, source, 0, body)).toBeNull()
})

test('images require actual slot content and take precedence over a text hit', () => {
  const imageBody = '# Title\n\n::: {slot=studio-image-1}\n\n![](img/a.png)\n\n:::'
  const click = { ...hit, image: { slot: 'studio-image-1', order: [] } }
  expect(elementActionFor(click, imageBody, 0, imageBody)).toEqual({ kind: 'slot', slot: 'studio-image-1', markdown: '![](img/a.png)', image: true })
  expect(elementActionFor(click, source, 0, body)).toBeNull()
})
