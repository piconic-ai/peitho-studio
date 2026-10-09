import { describe, expect, test } from 'bun:test'
import { brokenSlideIndex, renderFailureMessage, savedSectionDraft, sectionStartByIndex, type ManifestSection, type RenderErrorPayload } from './render'

function renderError(overrides: Partial<RenderErrorPayload> = {}): RenderErrorPayload {
  return {
    kind: 'Arity',
    line: 12,
    originFile: null,
    message: "slot 'code' got 2 item(s), but layout 'title-body-code' allows 0..1",
    help: 'use a layout with two code slots or remove one code block',
    headline: "slide 2 ('arch'), line 12: slot 'code' got 2 item(s), but layout 'title-body-code' allows 0..1",
    slide: { number: 2, key: 'arch' },
    ...overrides,
  }
}

function section(name: string, startIndex: number): ManifestSection {
  return { name, startIndex, endIndex: startIndex + 1, plannedDurationMs: 60_000 }
}

describe('savedSectionDraft', () => {
  test('spec: starts from the section\'s saved name and planned time in milliseconds', () => {
    expect(savedSectionDraft({ name: 'Intro', startIndex: 0, endIndex: 2, plannedDurationMs: 90_000 }))
      .toEqual({ name: 'Intro', timeMs: 90_000 })
  })

  test('adversarial: an empty name and a zero-length section are carried over as-is', () => {
    expect(savedSectionDraft({ name: '', startIndex: 4, endIndex: 4, plannedDurationMs: 0 }))
      .toEqual({ name: '', timeMs: 0 })
  })
})

describe('sectionStartByIndex', () => {
  test('spec: indexes each section under its startIndex', () => {
    const sections = [section('Intro', 0), section('Middle', 3)]
    expect(sectionStartByIndex(sections)).toEqual({ 0: section('Intro', 0), 3: section('Middle', 3) })
  })

  test('spec: a slide index with no section starting there has no entry', () => {
    const result = sectionStartByIndex([section('Intro', 0)])
    expect(result[1]).toBeUndefined()
  })

  test('adversarial: an empty section list yields an empty record', () => {
    expect(sectionStartByIndex([])).toEqual({})
  })

  test('adversarial: two sections claiming the same startIndex — the later one wins (last write)', () => {
    const first = section('First', 0)
    const second = section('Second', 0)
    expect(sectionStartByIndex([first, second])).toEqual({ 0: second })
  })
})

describe('renderFailureMessage', () => {
  test('spec: given a build error with help, the message is the headline and the help on a second line, as peitho-core prints it', () => {
    expect(renderFailureMessage(renderError())).toBe(
      "slide 2 ('arch'), line 12: slot 'code' got 2 item(s), but layout 'title-body-code' allows 0..1\n  = help: use a layout with two code slots or remove one code block",
    )
  })

  test('spec: given an error outside peitho-core (no help), the message is the headline alone', () => {
    const error = renderError({ kind: 'Other', line: null, slide: null, help: '', headline: 'layouts/cover.html: no <section> element', message: 'layouts/cover.html: no <section> element' })
    expect(renderFailureMessage(error)).toBe('layouts/cover.html: no <section> element')
  })

  test('spec: the headline is taken as peitho-core built it — a line-only or file-prefixed one is not re-derived here', () => {
    expect(renderFailureMessage(renderError({ slide: null, headline: 'line 3: invalid deck frontmatter: unknown field `fontss`', help: 'use only the supported keys' })))
      .toBe('line 3: invalid deck frontmatter: unknown field `fontss`\n  = help: use only the supported keys')
    expect(renderFailureMessage(renderError({ originFile: 'deck.md', headline: 'deck.md:3: invalid deck frontmatter', help: 'h' })))
      .toBe('deck.md:3: invalid deck frontmatter\n  = help: h')
  })

  test('adversarial: an empty headline with help still yields the help tail', () => {
    expect(renderFailureMessage(renderError({ headline: '', help: 'h' }))).toBe('\n  = help: h')
  })

  test('adversarial: everything empty yields an empty message, not "undefined"', () => {
    expect(renderFailureMessage(renderError({ headline: '', help: '', message: '' }))).toBe('')
  })
})

describe('brokenSlideIndex', () => {
  test('spec: given an error on slide 2 of 3, the slide list index is 1', () => {
    expect(brokenSlideIndex(renderError(), 3)).toBe(1)
  })

  test('spec: given an error on the first slide, the index is 0', () => {
    expect(brokenSlideIndex(renderError({ slide: { number: 1, key: null } }), 1)).toBe(0)
  })

  test('spec: given an error not about a slide (frontmatter, include), there is nothing to select', () => {
    expect(brokenSlideIndex(renderError({ slide: null }), 3)).toBeNull()
  })

  test('adversarial: a slide number past the source\'s slide count selects nothing rather than guessing', () => {
    expect(brokenSlideIndex(renderError({ slide: { number: 4, key: null } }), 3)).toBeNull()
  })

  test('adversarial: a deck with no slides selects nothing whatever the error says', () => {
    expect(brokenSlideIndex(renderError({ slide: { number: 1, key: null } }), 0)).toBeNull()
  })

  test('adversarial: a slide number of 0 or below (not a 1-based count) selects nothing', () => {
    expect(brokenSlideIndex(renderError({ slide: { number: 0, key: null } }), 3)).toBeNull()
    expect(brokenSlideIndex(renderError({ slide: { number: -1, key: null } }), 3)).toBeNull()
  })

  test('adversarial: a fractional slide number is not an index', () => {
    expect(brokenSlideIndex(renderError({ slide: { number: 1.5, key: null } }), 3)).toBeNull()
  })
})
