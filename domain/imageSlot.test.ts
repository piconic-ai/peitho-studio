import { describe, expect, test } from 'bun:test'
import { IMAGE_LAYOUT, imageLayoutPin, imageSlotFixFor, imageSlotFixLabel, parseImageSlotError, shownImageSlotFix, type ImageSlotFix } from './imageSlot'
import type { LayoutVerdict } from './layoutFit'
import { messagesFor } from './messages'

// Real peitho-core output (v1.34.0), as `render_draft` rejects with it.
const SINGLE_LAYOUT_ERROR =
  "slide 3 ('new-slide-2'), line 25: no slot accepts image in layout 'title-body-code'\n  = help: add exactly one slot with accepts=\"image\" or remove the image"
const MULTI_LAYOUT_ERROR =
  "slide 2 ('what'), line 9: no layout matches this slide\ncover: no slot accepts image in layout 'cover'\nstatement: no slot accepts image in layout 'statement'\n  = help: adjust the slide content or pick a layout explicitly with <!-- {\"layout\":\"…\"} -->"

const fits = (layout: string): LayoutVerdict => ({ layout, fit: { kind: 'fits' } })
const mismatch = (layout: string): LayoutVerdict => ({ layout, fit: { kind: 'mismatch', reason: `no slot accepts image in layout '${layout}'` } })

describe('parseImageSlotError', () => {
  test('spec: Given the error for a deck with one layout, when read, then it names the slide by its position in the deck', () => {
    expect(parseImageSlotError(SINGLE_LAYOUT_ERROR, 5)).toEqual({ index: 2 })
  })

  test('spec: Given the error for a deck with several layouts, when read, then the per-layout lines still count', () => {
    expect(parseImageSlotError(MULTI_LAYOUT_ERROR, 5)).toEqual({ index: 1 })
  })

  test('spec: Given the other headline shapes peitho-core writes, when read, then each still names the slide', () => {
    const tail = ": no slot accepts image in layout 'a'"
    expect(parseImageSlotError(`slide 1${tail}`, 1)).toEqual({ index: 0 })
    expect(parseImageSlotError(`slide 4, line 2${tail}`, 4)).toEqual({ index: 3 })
    expect(parseImageSlotError(`slide 2 ('k')${tail}`, 2)).toEqual({ index: 1 })
    expect(parseImageSlotError(`part.md:7, slide 2 ('k')${tail}`, 2)).toEqual({ index: 1 })
    expect(parseImageSlotError(`Error: slide 2 ('k')${tail}`, 2)).toEqual({ index: 1 })
  })

  test('adversarial: Given no error, an empty one, or a different layout error, when read, then it is not an image slot error', () => {
    expect(parseImageSlotError(null, 3)).toBeNull()
    expect(parseImageSlotError('', 3)).toBeNull()
    expect(parseImageSlotError("slide 1 ('a'), line 2: unassigned content remains for missing 'body' slot", 3)).toBeNull()
    expect(parseImageSlotError("slide 1 ('a'): slide matches multiple layouts: a, b", 3)).toBeNull()
    expect(parseImageSlotError("slide 1 ('a'), line 2: multiple slots accept image in layout 'x': a, b", 3)).toBeNull()
  })

  test('adversarial: Given the error names no slide, when read, then there is no slide to fix', () => {
    expect(parseImageSlotError("line 4: no slot accepts image in layout 'a'", 3)).toBeNull()
    expect(parseImageSlotError("no slot accepts image in layout 'a'", 3)).toBeNull()
    // The number is only looked for in the headline, not in the detail lines.
    expect(parseImageSlotError("no layout matches\nslide 2: no slot accepts image in layout 'a'", 3)).toBeNull()
  })

  test('adversarial: Given a slide number outside the deck, when read, then it is ignored rather than trusted', () => {
    const tail = ", line 2: no slot accepts image in layout 'a'"
    expect(parseImageSlotError(`slide 0${tail}`, 3)).toBeNull()
    expect(parseImageSlotError(`slide 4${tail}`, 3)).toBeNull()
    expect(parseImageSlotError(`slide 1${tail}`, 0)).toBeNull()
    expect(parseImageSlotError(`slide 99999999999999999999${tail}`, Number.MAX_SAFE_INTEGER)).toBeNull()
  })

  test("adversarial: Given a key or layout name holding quotes and the word slide, when read, then the headline's own number wins", () => {
    const message = "slide 2 ('it's slide 9'), line 3: no slot accepts image in layout 'o'neil, slide 7'"
    expect(parseImageSlotError(message, 9)).toEqual({ index: 1 })
  })
})

describe('imageSlotFixFor', () => {
  test('spec: Given another layout of the deck fits the slide, when a fix is chosen, then the error bar offers the layout picker', () => {
    expect(imageSlotFixFor(2, 'title-body-code', [mismatch('title-body-code'), fits('photo')])).toEqual({ kind: 'pick-layout', index: 2 })
  })

  test('spec: Given no layout of the deck fits the slide, when a fix is chosen, then the error bar offers to add the image layout', () => {
    expect(imageSlotFixFor(0, undefined, [mismatch('title-body-code')])).toEqual({ kind: 'add-image-layout', index: 0 })
    expect(imageSlotFixFor(1, 'cover', [mismatch('cover'), mismatch('statement')])).toEqual({ kind: 'add-image-layout', index: 1 })
  })

  test('adversarial: Given the fit check could not answer, when a fix is chosen, then nothing is offered', () => {
    expect(imageSlotFixFor(0, undefined, null)).toEqual({ kind: 'none' })
  })

  test('adversarial: Given the slide already fits the layout it is pinned to, when a fix is chosen, then nothing is offered (the error is stale)', () => {
    expect(imageSlotFixFor(0, 'photo', [mismatch('cover'), fits('photo')])).toEqual({ kind: 'none' })
  })

  test('adversarial: Given the deck already has the image layout and the slide does not fit it, when a fix is chosen, then adding it again is not offered', () => {
    expect(imageSlotFixFor(0, undefined, [mismatch('title-body-code'), mismatch(IMAGE_LAYOUT)])).toEqual({ kind: 'none' })
  })

  test('adversarial: Given an empty verdict list, when a fix is chosen, then adding the image layout is offered', () => {
    expect(imageSlotFixFor(0, undefined, [])).toEqual({ kind: 'add-image-layout', index: 0 })
  })
})

describe('shownImageSlotFix', () => {
  const pick: ImageSlotFix = { kind: 'pick-layout', index: 2 }

  test('spec: Given the error is still about the fix\'s slide, when shown, then the fix stays', () => {
    expect(shownImageSlotFix({ index: 2 }, pick)).toEqual(pick)
  })

  test('adversarial: Given the error went away or moved to another slide, when shown, then the fix is hidden', () => {
    expect(shownImageSlotFix(null, pick)).toEqual({ kind: 'none' })
    expect(shownImageSlotFix({ index: 1 }, pick)).toEqual({ kind: 'none' })
    expect(shownImageSlotFix({ index: 2 }, { kind: 'none' })).toEqual({ kind: 'none' })
  })
})

describe('imageLayoutPin', () => {
  test('spec: Given a slide pinned to another layout, when the image layout is added, then it is re-pinned to it', () => {
    expect(imageLayoutPin('title-body-code')).toEqual({ layout: IMAGE_LAYOUT })
  })

  test('adversarial: Given an unpinned slide or one already naming the image layout, when the image layout is added, then its settings stay', () => {
    expect(imageLayoutPin(undefined)).toBeNull()
    expect(imageLayoutPin(IMAGE_LAYOUT)).toBeNull()
  })

  test('adversarial: Given an empty pin, when the image layout is added, then it is still replaced', () => {
    expect(imageLayoutPin('')).toEqual({ layout: IMAGE_LAYOUT })
  })
})

describe('imageSlotFixLabel', () => {
  test('spec: Given each fix, when labelled in each language, then the button says what it does', () => {
    for (const language of ['en', 'ja'] as const) {
      const messages = messagesFor(language)
      expect(imageSlotFixLabel(messages, 'pick-layout', false)).toBe(messages.imageSlotPickLayout)
      expect(imageSlotFixLabel(messages, 'add-image-layout', false)).toBe(messages.imageSlotAddLayout)
    }
  })

  test('spec: Given the image layout being added, when labelled, then the button says so', () => {
    for (const language of ['en', 'ja'] as const) {
      const messages = messagesFor(language)
      expect(imageSlotFixLabel(messages, 'add-image-layout', true)).toBe(messages.imageSlotAddingLayout)
    }
  })

  test('adversarial: Given no fix, or a pick while adding, when labelled, then adding changes nothing it does not name', () => {
    expect(imageSlotFixLabel(messagesFor('en'), 'none', false)).toBeNull()
    expect(imageSlotFixLabel(messagesFor('en'), 'none', true)).toBeNull()
    expect(imageSlotFixLabel(messagesFor('en'), 'pick-layout', true)).toBe(messagesFor('en').imageSlotPickLayout)
  })
})
