import type { PreviewClick } from './reviewComment'
import { extractNote, extractPageComment, splitSlides } from './slides'
import { imageSlotContent, removeSlideText, textEditFor, type SlideTextEdit } from './slideEdit'
import { editorTextChange, type TextInsertion } from './editorText'

type ElementAction = { markdown: string; image: boolean } & (
  | { kind: 'slot'; slot: string }
  | { kind: 'text'; change: TextInsertion | null }
)

/** Resolve clipboard content and deletion together against the rendered body. */
export function elementActionFor(click: PreviewClick, source: string, index: number, body: string): ElementAction | null {
  const range = splitSlides(source)[index]
  if (!range || extractPageComment(extractNote(range.text).rest).rest !== body.trim()) return null
  if (click.image) {
    const markdown = imageSlotContent(body, click.image.slot)
    return markdown === null ? null : { kind: 'slot', slot: click.image.slot, markdown, image: true }
  }
  if (!click.hit?.byteSpan) return null
  const rawBody = extractPageComment(extractNote(range.text, true).rest, true).rest
  const edit = textEditFor({ ...click.hit, kind: 'text', byteSpan: click.hit.byteSpan, heading: click.hit.kind === 'heading' }, source, body, range.start + range.text.indexOf(rawBody), rawBody)
  return edit ? textElementAction(edit, click.textSlot) : null
}

function textElementAction(edit: SlideTextEdit, slot: string | undefined): ElementAction {
  const markdown = (edit.heading ? '# ' : '') + edit.value
  if (slot) return { kind: 'slot', slot, markdown, image: false }
  const change = editorTextChange(edit.body, removeSlideText(edit))
  return { kind: 'text', markdown, image: false, change: change ? { ...change, cursor: change.from } : null }
}
