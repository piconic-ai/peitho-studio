import { describe, expect, test } from 'bun:test'
import {
  MAX_ISOLATIONS, NO_BROKEN_SLIDES, brokenSlidesAfterCommand, brokenSlidesAfterEdit, brokenSlidesSummary, isolateSlide, originalByteOffset, restoreEditAnnotations, saveDecision, sourceSaveDecision, startIsolation, withSlidesDrafted,
  type BrokenSlides, type SourceEdit,
} from './brokenSlides'

/** The attempt `withSlidesDrafted` builds, or `null` when it gives up. */
function drafted(source: string, indexes: number[]): string | null {
  return withSlidesDrafted(source, new Set(indexes))?.attempt ?? null
}

function utf8(text: string): number {
  return new TextEncoder().encode(text).length
}
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
    const attempt = drafted(DECK, [1])
    expect(attempt).not.toBeNull()
    expect(drafts(attempt ?? '')).toEqual([false, true, false])
    expect(attempt).toBe('# One\n\n---\n\n<!-- {"key":"two","draft":true} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n')
  })

  test('spec: Given a slide with no PageComment, when it is drafted, then the comment takes the blank line that opened it so later line numbers stay the file\'s own', () => {
    const attempt = drafted(DECK, [2]) ?? ''
    expect(attempt).toBe('# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n<!-- {"draft":true} -->\n# Three\n')
    expect(attempt.split('\n').length).toBe(DECK.split('\n').length)
  })

  test('spec: Given the first slide at the very top of the file, when it is drafted, then the comment is put on a line of its own above it', () => {
    expect(drafted(DECK, [0])).toBe('<!-- {"draft":true} -->\n# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n')
  })

  test('spec: Given a first slide after frontmatter, when it is drafted, then the frontmatter is left alone', () => {
    const source = '---\ntitle: Deck\n---\n\n# One\n\n---\n\n# Two\n'
    expect(drafted(source, [0])).toBe('---\ntitle: Deck\n---\n<!-- {"draft":true} -->\n# One\n\n---\n\n# Two\n')
  })

  test('spec: Given two broken slides, when both are drafted, then both carry the mark and every other slide does not', () => {
    const attempt = drafted(DECK, [0, 2])
    expect(drafts(attempt ?? '')).toEqual([true, false, true])
  })

  test('spec: Given a skipped slide, when it is drafted, then skip goes — peitho-core refuses a slide that is both', () => {
    const source = '# One\n\n---\n\n<!-- {"skip":true,"page_number":false,"key":"two"} -->\n# Two\n'
    const attempt = drafted(source, [1]) ?? ''
    expect(extractPageComment(splitSlides(attempt)[1].text).config).toEqual({ key: 'two', draft: true })
  })

  test('spec: Given a slide that starts a section, when it is drafted, then its section marker goes and the frontmatter time is resynced to the sections left', () => {
    const source = '---\ntime: 3m\n---\n<!-- {"section":"A","time":"1m"} -->\n# One\n\n---\n\n<!-- {"section":"B","time":"2m"} -->\n# Two\n\n---\n\n# Three\n'
    const attempt = drafted(source, [0]) ?? ''
    expect(extractPageComment(splitSlides(attempt)[0].text).config).toEqual({ draft: true })
    expect(readFrontmatterKey(attempt, 'time')).toBe('2m')
    expect(attempt.split('\n').length).toBe(source.split('\n').length)
  })

  test('spec: Given the only section is on the drafted slide, when it is drafted, then the frontmatter time is left as it is (a deck with no sections may keep one)', () => {
    const source = '---\ntime: 1m\n---\n<!-- {"section":"A","time":"1m"} -->\n# One\n\n---\n\n# Two\n'
    expect(readFrontmatterKey(drafted(source, [0]) ?? '', 'time')).toBe('1m')
  })

  test('spec: Given a deck whose frontmatter has no time, when a section slide is drafted, then no time is added', () => {
    const source = '---\ntitle: T\n---\n<!-- {"section":"A","time":"1m"} -->\n# One\n\n---\n\n<!-- {"section":"B","time":"2m"} -->\n# Two\n'
    expect(readFrontmatterKey(drafted(source, [0]) ?? '', 'time')).toBeNull()
  })

  test('spec: a drafted slide keeps its draft siblings as they were', () => {
    const source = '<!-- {"draft":true} -->\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n'
    expect(drafts(drafted(source, [1]) ?? '')).toEqual([true, true, false])
  })

  test('adversarial: Given a slide that is a draft already, when it is asked for, then null — marking it changes nothing', () => {
    const source = '# One\n\n---\n\n<!-- {"draft":true} -->\n# Two\n'
    expect(drafted(source, [1])).toBeNull()
  })

  test('adversarial: Given every slide, then null — peitho-core refuses an all-draft deck', () => {
    expect(drafted(DECK, [0, 1, 2])).toBeNull()
  })

  test('adversarial: Given the only non-draft slide of a deck with drafts, then null', () => {
    const source = '<!-- {"draft":true} -->\n# One\n\n---\n\n# Two\n'
    expect(drafted(source, [1])).toBeNull()
  })

  test('adversarial: an empty source has nothing to draft', () => {
    expect(drafted('', [0])).toBeNull()
    expect(drafted('', [])).toBeNull()
  })

  test('adversarial: an index past the end drafts nothing and leaves the source as it is', () => {
    expect(drafted(DECK, [3])).toBe(DECK)
    expect(drafted(DECK, [-1])).toBe(DECK)
  })

  test('adversarial: a slide whose PageComment is empty (`<!-- {} -->`) has it rewritten, not a second one added — two PageComments are a parse error to peitho-core', () => {
    const source = '# One\n\n---\n\n<!-- {} -->\n# Two\n'
    expect(drafted(source, [1])).toBe('# One\n\n---\n\n<!-- {"draft":true} -->\n# Two\n')
  })

  test('adversarial: a slide whose PageComment is malformed gets a fresh comment rather than a crash', () => {
    const source = '# One\n\n---\n\n<!-- {not json} -->\n# Two\n'
    const attempt = drafted(source, [1]) ?? ''
    expect(attempt).toContain('<!-- {"draft":true} -->')
    expect(attempt).toContain('<!-- {not json} -->')
  })

  test('adversarial: a `---` inside a code fence is not a slide boundary, so the drafted slide is the one asked for', () => {
    const source = '# One\n\n```\n---\n```\n\n---\n\n# Two\n'
    expect(drafts(drafted(source, [1]) ?? '')).toEqual([false, true])
  })
})

describe('withSlidesDrafted: edits', () => {
  test('spec: Given a slide with a PageComment, when it is drafted, then the one edit is the comment rewritten in place, in bytes', () => {
    const { edits } = withSlidesDrafted(DECK, new Set([1])) ?? { edits: [] }
    const at = utf8('# One\n\n---\n\n<!-- {"key":"two"')
    expect(edits).toEqual([{ at, removed: 0, inserted: utf8(',"draft":true') }])
  })

  test('spec: Given a slide without a PageComment, when it is drafted, then the edit is the comment inserted, nothing removed', () => {
    const { edits } = withSlidesDrafted(DECK, new Set([2])) ?? { edits: [] }
    expect(edits).toEqual([{ at: utf8('# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n'), removed: 0, inserted: utf8('<!-- {"draft":true} -->') }])
  })

  test('spec: Given two drafted slides and a frontmatter time resync, then the edits come in source order, the frontmatter\'s first', () => {
    const source = '---\ntime: 3m\n---\n<!-- {"section":"A","time":"1m"} -->\n# One\n\n---\n\n<!-- {"section":"B","time":"2m"} -->\n# Two\n\n---\n\n# Three\n'
    const { attempt, edits } = withSlidesDrafted(source, new Set([0, 2])) ?? { attempt: '', edits: [] }
    // The second edit starts past the `"` both comments open their first
    // key with: the common prefix is as long as it can be.
    expect(edits.map(edit => edit.at)).toEqual([utf8('---\ntime: '), utf8('---\ntime: 3m\n---\n<!-- {"'), utf8(source.slice(0, source.indexOf('# Three') - 1))])
    // `3m` to `2m`: only the digit differs.
    expect(edits[0]).toEqual({ at: utf8('---\ntime: '), removed: 1, inserted: 1 })
    // Each edit replays onto the source to give the attempt.
    let rebuilt = source
    for (const edit of [...edits].reverse()) {
      const before = new TextEncoder().encode(rebuilt)
      const after = new TextEncoder().encode(attempt)
      const shift = edits.filter(other => other.at < edit.at).reduce((sum, other) => sum + other.inserted - other.removed, 0)
      rebuilt = new TextDecoder().decode(new Uint8Array([...before.slice(0, edit.at), ...after.slice(edit.at + shift, edit.at + shift + edit.inserted), ...before.slice(edit.at + edit.removed)]))
    }
    expect(rebuilt).toBe(attempt)
  })

  test('spec: bytes, not characters — text before the slide that is multibyte counts as UTF-8', () => {
    const source = '# 日本語\n\n---\n\n# Two\n\nBROKEN\n'
    const { edits } = withSlidesDrafted(source, new Set([1])) ?? { edits: [] }
    expect(edits[0].at).toBe(utf8('# 日本語\n\n---\n'))
    expect(edits[0].at).not.toBe('# 日本語\n\n---\n'.length)
  })

  test('adversarial: nothing drafted means no edits', () => {
    expect(withSlidesDrafted(DECK, new Set([7]))?.edits).toEqual([])
  })
})

describe('originalByteOffset', () => {
  const edits: SourceEdit[] = [{ at: 10, removed: 2, inserted: 5 }, { at: 30, removed: 0, inserted: 20 }]

  test('spec: an offset before every edit is its own', () => {
    expect(originalByteOffset(0, edits)).toBe(0)
    expect(originalByteOffset(10, edits)).toBe(10)
  })

  test('spec: an offset after an edit moves back by what the edit grew', () => {
    expect(originalByteOffset(15, edits)).toBe(12)
    expect(originalByteOffset(20, edits)).toBe(17)
  })

  test('spec: edits accumulate — an offset after both moves back by both', () => {
    // The second edit sits at 30 + 3 = 33 in the attempt, 20 bytes long.
    expect(originalByteOffset(53, edits)).toBe(30)
    expect(originalByteOffset(60, edits)).toBe(37)
  })

  test('spec: an offset at either end of an edit is where the edit sits — a span ending where a drafted slide starts keeps its end', () => {
    expect(originalByteOffset(15, edits)).toBe(12)
    expect(originalByteOffset(33, edits)).toBe(30)
    expect(originalByteOffset(53, edits)).toBe(30)
  })

  test('adversarial: an offset strictly inside an edit has no place in the source', () => {
    expect(originalByteOffset(11, edits)).toBeNull()
    expect(originalByteOffset(14, edits)).toBeNull()
    expect(originalByteOffset(34, edits)).toBeNull()
    expect(originalByteOffset(52, edits)).toBeNull()
  })

  test('adversarial: no edits is the identity', () => {
    expect(originalByteOffset(42, [])).toBe(42)
  })
})

describe('restoreEditAnnotations', () => {
  test('spec: Given fragments rendered from an attempt, then each annotation after the drafted slide points into the source as written', () => {
    // Slide Three's heading: in the source it starts after
    // `# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# `;
    // the attempt grew by `,"draft":true` (13 bytes) before it.
    const { edits } = withSlidesDrafted(DECK, new Set([1])) ?? { edits: [] }
    const start = utf8('# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# ')
    const fragments = {
      one: '<h1><span data-peitho-src="2-5" data-peitho-md="One">One</span></h1>',
      three: `<h1><span data-peitho-src="${String(start + 13)}-${String(start + 13 + 5)}" data-peitho-md="Three">Three</span></h1>`,
    }
    expect(restoreEditAnnotations(fragments, edits)).toEqual({
      one: '<h1><span data-peitho-src="2-5" data-peitho-md="One">One</span></h1>',
      three: `<h1><span data-peitho-src="${String(start)}-${String(start + 5)}" data-peitho-md="Three">Three</span></h1>`,
    })
    expect(DECK.slice(start, start + 5)).toBe('Three')
  })

  test('adversarial: an annotation inside an edit is dropped rather than pointed somewhere wrong', () => {
    const edits: SourceEdit[] = [{ at: 4, removed: 0, inserted: 10 }]
    expect(restoreEditAnnotations({ k: '<p data-peitho-src="6-8" data-peitho-md="x">x</p>' }, edits)).toEqual({ k: '<p>x</p>' })
  })

  test('adversarial: no edits hands the fragments back as they are — the same object, nothing rewritten', () => {
    const fragments = { k: '<p data-peitho-src="6-8" data-peitho-md="x">x</p>' }
    expect(restoreEditAnnotations(fragments, [])).toBe(fragments)
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

  test('spec: Given the user hands their typing to the agent (the edited slide saved as is), when the slide they edit does not build, then it is isolated and saved as typed', () => {
    expect(saveDecision(slideError(2, 'two'), known, 1, 3, 1)).toBe('isolate')
    expect(saveDecision(slideError(3, 'three'), NO_BROKEN_SLIDES, 2, 3, 2)).toBe('isolate')
  })

  test('spec: Given the user pins a slide to a layout it does not fit (saved as is), when that slide does not build, then it is isolated and the pin is saved', () => {
    expect(saveDecision(slideError(2, 'two'), NO_BROKEN_SLIDES, null, 3, 1)).toBe('isolate')
    expect(saveDecision(slideError(1, 'one'), NO_BROKEN_SLIDES, 2, 3, 0)).toBe('isolate')
  })

  test('adversarial: Given a slide saved as is, when the error names another slide not known broken, then it is still blocked — only that slide is saved broken', () => {
    expect(saveDecision(slideError(3, 'three'), known, 0, 3, 0)).toBe('block')
    expect(saveDecision(slideError(3, 'three'), NO_BROKEN_SLIDES, null, 3, 0)).toBe('block')
    expect(saveDecision(slideError(3, 'three'), NO_BROKEN_SLIDES, 2, 3, 0)).toBe('block')
  })

  test('adversarial: Given a slide saved as is, when the error names no slide or one past the deck, then there is nothing to isolate and it is blocked', () => {
    expect(saveDecision(slideError(2, 'two', { slide: null }), NO_BROKEN_SLIDES, 1, 3, 1)).toBe('block')
    expect(saveDecision(slideError(9, 'nine'), NO_BROKEN_SLIDES, 8, 3, 8)).toBe('block')
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

describe('startIsolation with known slides', () => {
  const known: BrokenSlides = new Map([[1, slideError(2, 'two')]])

  test('spec: Given slide 2 known broken, when a draft of the deck is isolated from it, then the attempt renders without slide 2 and the isolation carries it', () => {
    const isolation = startIsolation(DECK, known)
    expect(drafts(isolation.attempt)).toEqual([false, true, false])
    expect(isolation.broken).toEqual(known)
    expect(isolation.source).toBe(DECK)
    expect(isolation.edits).toHaveLength(1)
  })

  test('spec: Given no known slides, then the isolation is fresh — the attempt is the source itself', () => {
    expect(startIsolation(DECK)).toEqual({ source: DECK, attempt: DECK, edits: [], broken: NO_BROKEN_SLIDES })
    expect(startIsolation(DECK, NO_BROKEN_SLIDES).attempt).toBe(DECK)
  })

  test('spec: a known slide may still be isolated further — the next failing slide joins it', () => {
    const next = isolateSlide(startIsolation(DECK, known), slideError(3))
    expect(next).not.toBeNull()
    expect([...(next?.broken.keys() ?? [])]).toEqual([1, 2])
    expect(drafts(next?.attempt ?? '')).toEqual([false, true, true])
  })

  test('adversarial: a known slide the source no longer has is left out', () => {
    const isolation = startIsolation('# One\n', known)
    expect(isolation.attempt).toBe('# One\n')
    expect(isolation.broken.size).toBe(0)
  })

  test('adversarial: a known slide the source marks draft itself is left out, the others still drafted', () => {
    const source = '# One\n\n---\n\n<!-- {"draft":true} -->\n# Two\n\n---\n\n# Three\n'
    const isolation = startIsolation(source, new Map([[1, slideError(2)], [2, slideError(3)]]))
    expect([...isolation.broken.keys()]).toEqual([2])
    expect(drafts(isolation.attempt)).toEqual([false, true, true])
  })

  test('adversarial: Given every slide is known broken, then nothing would be left to build and the isolation starts fresh', () => {
    const isolation = startIsolation('# One\n\n---\n\n# Two\n', new Map([[0, slideError(1)], [1, slideError(2)]]))
    expect(isolation.broken.size).toBe(0)
    expect(drafts(isolation.attempt)).toEqual([false, false])
  })

  test('adversarial: an empty source with known slides starts fresh', () => {
    expect(startIsolation('', known).broken.size).toBe(0)
  })
})

describe('brokenSlidesAfterEdit', () => {
  const known: BrokenSlides = new Map([[0, slideError(1)], [2, slideError(3)], [4, slideError(5)]])

  test('spec: Given the typing did not re-split the deck, then the known slides stay where they are, the edited one forgotten', () => {
    expect([...brokenSlidesAfterEdit(known, 2, 5, 5).keys()]).toEqual([0, 4])
    expect([...brokenSlidesAfterEdit(known, 1, 5, 5).keys()]).toEqual([0, 2, 4])
  })

  test('spec: Given a `---` typed into slide 2, when the deck has one slide more, then the known slides after it move down by one', () => {
    const after = brokenSlidesAfterEdit(known, 1, 5, 6)
    expect([...after.keys()]).toEqual([0, 3, 5])
    expect(after.get(3)).toBe(known.get(2))
  })

  test('spec: Given an unclosed code fence in slide 2 swallowed the next slide, then that slide is forgotten and the ones after move up', () => {
    expect([...brokenSlidesAfterEdit(known, 1, 5, 4).keys()]).toEqual([0, 3])
  })

  test('spec: with no slide edited, known as it is', () => {
    expect(brokenSlidesAfterEdit(known, null, 5, 7)).toBe(known)
  })

  test('adversarial: Given the fence swallowed two slides, then both are forgotten and the one after them moves up by two', () => {
    const after = brokenSlidesAfterEdit(known, 1, 5, 3)
    expect([...after.keys()]).toEqual([0, 2])
    expect(after.get(2)).toBe(known.get(4))
  })

  test('adversarial: nothing known stays nothing', () => {
    expect(brokenSlidesAfterEdit(NO_BROKEN_SLIDES, 1, 5, 6).size).toBe(0)
  })

  test('purity: the map handed in is not changed', () => {
    const before = new Map(known)
    brokenSlidesAfterEdit(known, 1, 5, 6)
    expect(known).toEqual(before)
  })
})

describe('sourceSaveDecision', () => {
  const known: BrokenSlides = new Map([[1, slideError(2, 'two')]])

  test('spec: Given slide 2 known broken, when the source editor\'s text fails on it unchanged, then it is isolated', () => {
    const to = DECK.replace('# Three', '# Three edited')
    expect(sourceSaveDecision(slideError(2, 'two'), known, DECK, to)).toBe('isolate')
  })

  test('spec: Given the typing moved the known slide down, when the error names its new position, then it is still isolated', () => {
    const to = '# Zero\n\n---\n\n' + DECK
    expect(sourceSaveDecision(slideError(3, 'two'), known, DECK, to)).toBe('isolate')
  })

  test('spec: Given the user changed the known slide and it still does not build, then the save is blocked — their typing is not saved broken', () => {
    const to = DECK.replace('BROKEN', 'BROKEN still')
    expect(sourceSaveDecision(slideError(2, 'two'), known, DECK, to)).toBe('block')
  })

  test('spec: Given the error names a slide not known broken, then blocked', () => {
    expect(sourceSaveDecision(slideError(3), known, DECK, DECK)).toBe('block')
    expect(sourceSaveDecision(slideError(2, 'two'), NO_BROKEN_SLIDES, DECK, DECK)).toBe('block')
  })

  test('spec: blank lines around the slide do not make it another slide', () => {
    const to = DECK.replace('\n\n<!-- {"key":"two"} -->', '\n\n\n<!-- {"key":"two"} -->').replace('BROKEN\n\n---', 'BROKEN\n\n\n---')
    expect(sourceSaveDecision(slideError(2, 'two'), known, DECK, to)).toBe('isolate')
  })

  test('adversarial: an error about no slide, or a slide past the text being saved, is blocked', () => {
    expect(sourceSaveDecision(slideError(2, null, { slide: null }), known, DECK, DECK)).toBe('block')
    expect(sourceSaveDecision(slideError(9), known, DECK, DECK)).toBe('block')
  })

  test('adversarial: a known position the old source does not have matches nothing', () => {
    expect(sourceSaveDecision(slideError(2, 'two'), new Map([[7, slideError(8)]]), DECK, DECK)).toBe('block')
  })

  test('adversarial: empty sources on either side are blocked, not thrown', () => {
    expect(sourceSaveDecision(slideError(1), known, '', DECK)).toBe('block')
    expect(sourceSaveDecision(slideError(1), known, DECK, '')).toBe('block')
  })
})
