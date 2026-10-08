import { describe, expect, test } from 'bun:test'
import { isExhaustivelyAccountedFor } from './spec'
import type { ManifestSlide } from './render'
import { slideEntryBadge, slideStatusBadge, type SlideStatusFlags } from './slideStatus'
import { slideStatusBadgeExamples } from './slideStatus.examples'
import type { PlaceholderSlideEntry } from './slideList'
import type { RenderErrorPayload } from './render'

const brokenError: RenderErrorPayload = {
  kind: 'Arity', line: 8, originFile: null,
  message: "slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  help: 'use a layout with a body slot or remove one paragraph',
  headline: "slide 2 ('two'), line 8: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  slide: { number: 2, key: 'two' },
}

type PlaceholderFlags = Omit<PlaceholderSlideEntry, 'badge'>

function placeholder(overrides: Partial<PlaceholderFlags> = {}): PlaceholderFlags {
  return { kind: 'placeholder', sourceIndex: 1, title: 'Two', draft: false, error: null, key: 'placeholder:1', lastRenderedKey: null, ...overrides }
}

describe('slideEntryBadge', () => {
  test('spec: Given a slide isolated for not building, when its row is drawn, then it wears ERROR', () => {
    expect(slideEntryBadge(placeholder({ error: brokenError }))).toBe('error')
  })

  test('spec: Given a draft placeholder, then DRAFT; given one the manifest has not caught up with, then no badge', () => {
    expect(slideEntryBadge(placeholder({ draft: true }))).toBe('draft')
    expect(slideEntryBadge(placeholder())).toBeNull()
  })

  test('spec: Given a rendered slide, then its manifest skip flag decides, as slideStatusBadge does', () => {
    const slide: ManifestSlide = {
      index: 0, key: 'intro', src: '# Intro', hasNotes: false, skip: true, revealSteps: 1,
      text: { title: 'Intro', body: '', code: '' },
    }
    const rendered = { kind: 'rendered' as const, sourceIndex: 0, manifestIndex: 0, slide }
    expect(slideEntryBadge(rendered)).toBe('skip')
    expect(slideEntryBadge({ ...rendered, slide: { ...slide, skip: false } })).toBeNull()
  })

  test('adversarial: an isolated slide that is also a draft wears ERROR, the stronger statement', () => {
    expect(slideEntryBadge(placeholder({ draft: true, error: brokenError }))).toBe('error')
  })
})

describe('slideStatusBadge', () => {
  test.each(slideStatusBadgeExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_title, example) => {
      expect(slideStatusBadge(example.state)).toBe(example.expect)
    },
  )

  test('spec: every example is either automated or carries a manual reason', () => {
    expect(isExhaustivelyAccountedFor(slideStatusBadgeExamples)).toBe(true)
  })

  test('spec: a rendered ManifestSlide can be passed directly — its skip flag drives the badge', () => {
    const slide: ManifestSlide = {
      index: 0, key: 'intro', src: '# Intro', hasNotes: false, skip: true, revealSteps: 1,
      text: { title: 'Intro', body: '', code: '' },
    }
    expect(slideStatusBadge(slide)).toBe('skip')
    expect(slideStatusBadge({ ...slide, skip: false })).toBeNull()
  })

  test('spec: exhaustive over every true/false/unset combination — draft wins, then skip, else no badge', () => {
    const values = [true, false, undefined] as const
    for (const draft of values) {
      for (const skip of values) {
        const expected = draft === true ? 'draft' : skip === true ? 'skip' : null
        expect({ draft, skip, badge: slideStatusBadge({ draft, skip }) }).toEqual({ draft, skip, badge: expected })
      }
    }
  })

  test('adversarial: truthy non-boolean values (as a hand-edited PageComment could hold) never count as set', () => {
    // PageConfig comes from JSON.parse without runtime validation, so these
    // shapes really can arrive; peitho-core only accepts JSON booleans.
    const junk: unknown[] = ['true', 'yes', 1, {}, [], 'draft']
    for (const value of junk) {
      expect(slideStatusBadge({ draft: value, skip: value } as unknown as SlideStatusFlags)).toBeNull()
    }
  })

  test('adversarial: falsy non-boolean values and the empty string are also unset', () => {
    const junk: unknown[] = [null, 0, '', Number.NaN]
    for (const value of junk) {
      expect(slideStatusBadge({ draft: value, skip: value } as unknown as SlideStatusFlags)).toBeNull()
    }
  })

  test('adversarial: a junk draft value does not mask a real skip', () => {
    expect(slideStatusBadge({ draft: 'true', skip: true } as unknown as SlideStatusFlags)).toBe('skip')
  })
})

describe('slideStatusBadge (non-functional)', () => {
  test('robustness: never throws, whatever object shape it is handed', () => {
    const shapes: unknown[] = [{}, Object.create(null), { draft: Symbol('x') }, { skip: 10n }, { unrelated: true }]
    for (const shape of shapes) {
      expect(() => slideStatusBadge(shape as SlideStatusFlags)).not.toThrow()
    }
  })

  test('purity: does not mutate its input and returns the same answer on repeated calls', () => {
    const flags = Object.freeze({ draft: false, skip: true })
    const first = slideStatusBadge(flags)
    expect(slideStatusBadge(flags)).toBe(first)
    expect(flags).toEqual({ draft: false, skip: true })
  })
})
