import { describe, expect, test } from 'bun:test'
import {
  MAX_ISOLATIONS, NO_BROKEN_SLIDES, brokenSlidesAfterCommand, brokenSlidesSummary, isolateSlide, saveDecision, startIsolation, withSlidesDrafted,
  type BrokenSlides,
} from './brokenSlides'
import type { RenderErrorPayload } from './render'
import { extractPageComment, splitSlides } from './slides'
import { readFrontmatterKey } from './frontmatter'

/** peitho-core's refusal of slide `number` (1-based, drafts counted). */
function slideError(number: number, key: string | null = null, overrides: Partial<RenderErrorPayload> = {}): RenderErrorPayload {
  return {
    kind: 'Arity',
    line: 4,
    originFile: null,
    message: "slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
    help: 'use a layout with a body slot or remove one paragraph',
    headline: `slide ${String(number)}${key === null ? '' : ` ('${key}')`}, line 4: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1`,
    slide: { number, key },
    ...overrides,
  }
}

const DECK = '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n'

/** The `draft` flag of each slide of `source`, in order. */
function drafts(source: string): boolean[] {
  return splitSlides(source).map(range => extractPageComment(range.text).config.draft === true)
}

describe('withSlidesDrafted', () => {
  test('spec: Given a three-slide deck, when the middle slide is drafted, then only it carries "draft":true and the rest of the text is untouched', () => {
    const attempt = withSlidesDrafted(DECK, new Set([1]))
    expect(attempt).not.toBeNull()
    expect(drafts(attempt ?? '')).toEqual([false, true, false])
    expect(attempt).toBe('# One\n\n---\n\n<!-- {"key":"two","draft":true} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n')
  })

  test('spec: Given a slide with no PageComment, when it is drafted, then the comment takes the blank line that opened it so later line numbers stay the file\'s own', () => {
    const attempt = withSlidesDrafted(DECK, new Set([2])) ?? ''
    expect(attempt).toBe('# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n<!-- {"draft":true} -->\n# Three\n')
    expect(attempt.split('\n').length).toBe(DECK.split('\n').length)
  })

  test('spec: Given the first slide at the very top of the file, when it is drafted, then the comment is put on a line of its own above it', () => {
    expect(withSlidesDrafted(DECK, new Set([0]))).toBe('<!-- {"draft":true} -->\n# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n')
  })

  test('spec: Given a first slide after frontmatter, when it is drafted, then the frontmatter is left alone', () => {
    const source = '---\ntitle: Deck\n---\n\n# One\n\n---\n\n# Two\n'
    expect(withSlidesDrafted(source, new Set([0]))).toBe('---\ntitle: Deck\n---\n<!-- {"draft":true} -->\n# One\n\n---\n\n# Two\n')
  })

  test('spec: Given two broken slides, when both are drafted, then both carry the mark and every other slide does not', () => {
    const attempt = withSlidesDrafted(DECK, new Set([0, 2]))
    expect(drafts(attempt ?? '')).toEqual([true, false, true])
  })

  test('spec: Given a skipped slide, when it is drafted, then skip goes — peitho-core refuses a slide that is both', () => {
    const source = '# One\n\n---\n\n<!-- {"skip":true,"page_number":false,"key":"two"} -->\n# Two\n'
    const attempt = withSlidesDrafted(source, new Set([1])) ?? ''
    expect(extractPageComment(splitSlides(attempt)[1].text).config).toEqual({ key: 'two', draft: true })
  })

  test('spec: Given a slide that starts a section, when it is drafted, then its section marker goes and the frontmatter time is resynced to the sections left', () => {
    const source = '---\ntime: 3m\n---\n<!-- {"section":"A","time":"1m"} -->\n# One\n\n---\n\n<!-- {"section":"B","time":"2m"} -->\n# Two\n\n---\n\n# Three\n'
    const attempt = withSlidesDrafted(source, new Set([0])) ?? ''
    expect(extractPageComment(splitSlides(attempt)[0].text).config).toEqual({ draft: true })
    expect(readFrontmatterKey(attempt, 'time')).toBe('2m')
    expect(attempt.split('\n').length).toBe(source.split('\n').length)
  })

  test('spec: Given the only section is on the drafted slide, when it is drafted, then the frontmatter time is left as it is (a deck with no sections may keep one)', () => {
    const source = '---\ntime: 1m\n---\n<!-- {"section":"A","time":"1m"} -->\n# One\n\n---\n\n# Two\n'
    expect(readFrontmatterKey(withSlidesDrafted(source, new Set([0])) ?? '', 'time')).toBe('1m')
  })

  test('spec: Given a deck whose frontmatter has no time, when a section slide is drafted, then no time is added', () => {
    const source = '---\ntitle: T\n---\n<!-- {"section":"A","time":"1m"} -->\n# One\n\n---\n\n<!-- {"section":"B","time":"2m"} -->\n# Two\n'
    expect(readFrontmatterKey(withSlidesDrafted(source, new Set([0])) ?? '', 'time')).toBeNull()
  })

  test('spec: a drafted slide keeps its draft siblings as they were', () => {
    const source = '<!-- {"draft":true} -->\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n'
    expect(drafts(withSlidesDrafted(source, new Set([1])) ?? '')).toEqual([true, true, false])
  })

  test('adversarial: Given a slide that is a draft already, when it is asked for, then null — marking it changes nothing', () => {
    const source = '# One\n\n---\n\n<!-- {"draft":true} -->\n# Two\n'
    expect(withSlidesDrafted(source, new Set([1]))).toBeNull()
  })

  test('adversarial: Given every slide, then null — peitho-core refuses an all-draft deck', () => {
    expect(withSlidesDrafted(DECK, new Set([0, 1, 2]))).toBeNull()
  })

  test('adversarial: Given the only non-draft slide of a deck with drafts, then null', () => {
    const source = '<!-- {"draft":true} -->\n# One\n\n---\n\n# Two\n'
    expect(withSlidesDrafted(source, new Set([1]))).toBeNull()
  })

  test('adversarial: an empty source has nothing to draft', () => {
    expect(withSlidesDrafted('', new Set([0]))).toBeNull()
    expect(withSlidesDrafted('', new Set())).toBeNull()
  })

  test('adversarial: an index past the end drafts nothing and leaves the source as it is', () => {
    expect(withSlidesDrafted(DECK, new Set([3]))).toBe(DECK)
    expect(withSlidesDrafted(DECK, new Set([-1]))).toBe(DECK)
  })

  test('adversarial: a slide whose PageComment is malformed gets a fresh comment rather than a crash', () => {
    const source = '# One\n\n---\n\n<!-- {not json} -->\n# Two\n'
    const attempt = withSlidesDrafted(source, new Set([1])) ?? ''
    expect(attempt).toContain('<!-- {"draft":true} -->')
    expect(attempt).toContain('<!-- {not json} -->')
  })

  test('adversarial: a `---` inside a code fence is not a slide boundary, so the drafted slide is the one asked for', () => {
    const source = '# One\n\n```\n---\n```\n\n---\n\n# Two\n'
    expect(drafts(withSlidesDrafted(source, new Set([1])) ?? '')).toEqual([false, true])
  })
})

describe('isolateSlide', () => {
  test('spec: Given a fresh isolation, when slide 2 fails, then slide 2 is isolated and the attempt renders without it', () => {
    const next = isolateSlide(startIsolation(DECK), slideError(2, 'two'))
    expect(next).not.toBeNull()
    expect(next?.source).toBe(DECK)
    expect([...(next?.broken.keys() ?? [])]).toEqual([1])
    expect(drafts(next?.attempt ?? '')).toEqual([false, true, false])
  })

  test('spec: Given slide 2 isolated, when slide 3 fails too, then both are isolated, each with its own error', () => {
    const first = isolateSlide(startIsolation(DECK), slideError(2, 'two'))
    const second = first === null ? null : isolateSlide(first, slideError(3, 'three'))
    expect([...(second?.broken.keys() ?? [])]).toEqual([1, 2])
    expect(second?.broken.get(1)?.slide?.key).toBe('two')
    expect(second?.broken.get(2)?.slide?.key).toBe('three')
    expect(drafts(second?.attempt ?? '')).toEqual([false, true, true])
  })

  test('spec: the first and the last slide can be isolated', () => {
    expect(drafts(isolateSlide(startIsolation(DECK), slideError(1))?.attempt ?? '')).toEqual([true, false, false])
    expect(drafts(isolateSlide(startIsolation(DECK), slideError(3))?.attempt ?? '')).toEqual([false, false, true])
  })

  test('spec: an existing draft slide before the broken one keeps its own position in the numbering', () => {
    const source = '<!-- {"draft":true} -->\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n'
    const next = isolateSlide(startIsolation(source), slideError(3))
    expect([...(next?.broken.keys() ?? [])]).toEqual([2])
    expect(drafts(next?.attempt ?? '')).toEqual([true, false, true])
  })

  test('adversarial: an error about no slide (frontmatter, an include) gives up', () => {
    expect(isolateSlide(startIsolation(DECK), slideError(2, null, { slide: null }))).toBeNull()
  })

  test('adversarial: slide number 0 and a number past the deck give up', () => {
    expect(isolateSlide(startIsolation(DECK), slideError(0))).toBeNull()
    expect(isolateSlide(startIsolation(DECK), slideError(4))).toBeNull()
    expect(isolateSlide(startIsolation(DECK), slideError(2.5))).toBeNull()
  })

  test('adversarial: the same slide failing again after being isolated gives up — no progress, no endless loop', () => {
    const first = isolateSlide(startIsolation(DECK), slideError(2, 'two'))
    expect(first).not.toBeNull()
    expect(isolateSlide(first ?? startIsolation(DECK), slideError(2, 'two'))).toBeNull()
  })

  test('adversarial: a slide that is a draft in the source gives up', () => {
    const source = '# One\n\n---\n\n<!-- {"draft":true} -->\n# Two\n'
    expect(isolateSlide(startIsolation(source), slideError(2))).toBeNull()
  })

  test('adversarial: isolating the last buildable slide gives up', () => {
    const source = '# One\n\n---\n\n# Two\n'
    const first = isolateSlide(startIsolation(source), slideError(1))
    expect(first).not.toBeNull()
    expect(isolateSlide(first ?? startIsolation(source), slideError(2))).toBeNull()
  })

  test('adversarial: an empty source gives up', () => {
    expect(isolateSlide(startIsolation(''), slideError(1))).toBeNull()
  })

  test(`adversarial: the ${String(MAX_ISOLATIONS + 1)}th slide to fail gives up, so a deck broken all over costs a bounded number of renders`, () => {
    const slides = Array.from({ length: MAX_ISOLATIONS + 2 }, (_, i) => `# Slide ${String(i + 1)}\n`)
    const source = slides.join('\n---\n\n')
    let isolation = startIsolation(source)
    for (let number = 1; number <= MAX_ISOLATIONS; number++) {
      const next = isolateSlide(isolation, slideError(number))
      expect(next).not.toBeNull()
      isolation = next ?? isolation
    }
    expect(isolation.broken.size).toBe(MAX_ISOLATIONS)
    expect(isolateSlide(isolation, slideError(MAX_ISOLATIONS + 1))).toBeNull()
  })

  test('purity: the isolation handed in is not changed', () => {
    const start = startIsolation(DECK)
    isolateSlide(start, slideError(2, 'two'))
    expect(start.broken.size).toBe(0)
    expect(start.attempt).toBe(DECK)
  })
})

describe('saveDecision', () => {
  const known: BrokenSlides = new Map([[1, slideError(2, 'two')]])

  test('spec: Given slide 2 is known broken, when a save of another slide fails on slide 2, then it is isolated and the save goes on', () => {
    expect(saveDecision(slideError(2, 'two'), known, 0, 3)).toBe('isolate')
    expect(saveDecision(slideError(2, 'two'), known, null, 3)).toBe('isolate')
  })

  test('spec: Given a save fails on a slide not known broken, then it is blocked as any draft that does not build', () => {
    expect(saveDecision(slideError(3, 'three'), known, 0, 3)).toBe('block')
    expect(saveDecision(slideError(3, 'three'), NO_BROKEN_SLIDES, null, 3)).toBe('block')
  })

  test('spec: Given the user is editing the broken slide itself, when their typing still does not build, then it is blocked — their typing is not saved broken', () => {
    expect(saveDecision(slideError(2, 'two'), known, 1, 3)).toBe('block')
  })

  test('spec: Given the known slide moved (a slide inserted above it), when the error names its new position with the same key, then it is still isolated', () => {
    expect(saveDecision(slideError(3, 'two'), known, null, 4)).toBe('isolate')
  })

  test('adversarial: an error about no slide is blocked', () => {
    expect(saveDecision(slideError(2, 'two', { slide: null }), known, null, 3)).toBe('block')
  })

  test('adversarial: an error naming a slide past the deck is blocked, even with a known key', () => {
    expect(saveDecision(slideError(9, 'two'), known, null, 3)).toBe('block')
  })

  test('adversarial: a key match needs a key on both sides — a keyless error does not match a keyless known slide at another position', () => {
    const keyless: BrokenSlides = new Map([[1, slideError(2)]])
    expect(saveDecision(slideError(3), keyless, null, 4)).toBe('block')
  })

  test('adversarial: the edited slide wins over a key match', () => {
    expect(saveDecision(slideError(3, 'two'), known, 2, 4)).toBe('block')
  })
})

describe('brokenSlidesAfterCommand', () => {
  const known: BrokenSlides = new Map([[1, slideError(2, 'two')], [3, slideError(4, 'four')]])

  test('spec: an insert above shifts the known slides down by one', () => {
    expect([...brokenSlidesAfterCommand(known, { type: 'insert', at: 0, text: '' }).keys()]).toEqual([2, 4])
  })

  test('spec: deleting a known slide forgets it; the ones after it move up', () => {
    expect([...brokenSlidesAfterCommand(known, { type: 'delete', index: 1 }).keys()]).toEqual([2])
  })

  test('spec: a move follows the slide to its new row', () => {
    expect([...brokenSlidesAfterCommand(known, { type: 'move', from: 1, to: 2 }).keys()].sort()).toEqual([2, 3])
  })

  test('spec: a replace moves nothing', () => {
    expect([...brokenSlidesAfterCommand(known, { type: 'replace', index: 1, text: '' }).keys()]).toEqual([1, 3])
  })

  test('adversarial: nothing known stays nothing', () => {
    expect(brokenSlidesAfterCommand(NO_BROKEN_SLIDES, { type: 'delete', index: 0 }).size).toBe(0)
  })
})

describe('brokenSlidesSummary', () => {
  test('spec: counts the isolated slides and names the first one\'s error', () => {
    const broken: BrokenSlides = new Map([[4, slideError(5, 'five')], [1, slideError(2, 'two')]])
    expect(brokenSlidesSummary(broken)).toEqual({ count: 2, first: slideError(2, 'two') })
  })

  test('adversarial: none isolated is null, not a count of zero', () => {
    expect(brokenSlidesSummary(NO_BROKEN_SLIDES)).toBeNull()
  })
})
