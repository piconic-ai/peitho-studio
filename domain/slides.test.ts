import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { isExhaustivelyAccountedFor } from './spec'
import { sectionTimeExamples } from './slides.examples'
import {
  msToMinutesSeconds,
  minutesSecondsToMs,
  withDurationPart,
  savableSectionTimeMs,
  MAX_DURATION_MS,
  MIN_SECTION_TIME_MS,
  type DurationPart,
  splitSlides,
  extractNote,
  injectNote,
  extractPageComment,
  buildSlideText,
  updatePageComment,
  slugifyTitle,
  uniqueSlideKey,
  newSlideConfig,
  indexAfterMove,
  clampFocusIndex,
  gapToIndex,
  extractHeadingText,
  parseDurationToMs,
  formatDurationMs,
  updateFrontmatterTime,
  joinSlideTexts,
  sumSectionTimesMs,
  stabilizeByKey,
} from './slides'

describe('splitSlides', () => {
  test('spec: splits three slides separated by thematic breaks', () => {
    const source = '# One\n\n---\n\n# Two\n\n---\n\n# Three\n'
    const ranges = splitSlides(source)
    expect(ranges).toHaveLength(3)
    expect(ranges[0].text.trim()).toBe('# One')
    expect(ranges[1].text.trim()).toBe('# Two')
    expect(ranges[2].text.trim()).toBe('# Three')
  })

  test('spec: skips YAML frontmatter before looking for slide breaks', () => {
    const source = '---\ntime: 1m\n---\n# One\n\n---\n\n# Two\n'
    const ranges = splitSlides(source)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).not.toContain('time: 1m')
  })

  test('adversarial: a `---` inside a fenced code block is not a slide boundary', () => {
    const source = '# One\n\n```\n---\n```\n\n---\n\n# Two\n'
    const ranges = splitSlides(source)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].text).toContain('```\n---\n```')
  })

  test('adversarial: a `---` inside a `~~~` fence is not a slide boundary', () => {
    const source = '# One\n\n~~~\n---\n~~~\n\n---\n\n# Two\n'
    const ranges = splitSlides(source)
    expect(ranges).toHaveLength(2)
  })

  test('adversarial: empty source produces no ranges', () => {
    expect(splitSlides('')).toEqual([])
  })

  test('adversarial: blank slides between separators are dropped', () => {
    const source = '# One\n\n---\n\n\n\n---\n\n# Two\n'
    const ranges = splitSlides(source)
    expect(ranges).toHaveLength(2)
  })

  test('adversarial: offsets round-trip back to the original text', () => {
    const source = '# One\n\n---\n\n# Two\nBody text.\n'
    const ranges = splitSlides(source)
    for (const range of ranges) {
      expect(source.slice(range.start, range.end)).toBe(range.text)
    }
  })
})

describe('extractNote / injectNote', () => {
  test('spec: pulls a plain HTML comment out as the note', () => {
    const { rest, note } = extractNote('# Title\n\n<!--\nSpeaker note here\n-->\n')
    expect(note).toBe('Speaker note here')
    expect(rest).toBe('# Title')
  })

  test('spec: injectNote re-attaches a note as a trailing comment', () => {
    expect(injectNote('# Title', 'Say hi')).toBe('# Title\n\n<!--\nSay hi\n-->\n')
  })

  test('adversarial: a JSON-shaped comment is not mistaken for the note', () => {
    const { rest, note } = extractNote('<!-- {"key":"a"} -->\n# Title\n')
    expect(note).toBe('')
    expect(rest).toBe('<!-- {"key":"a"} -->\n# Title')
  })

  test('adversarial: no comment at all leaves the body untouched', () => {
    const { rest, note } = extractNote('# Title\nBody only.\n')
    expect(note).toBe('')
    expect(rest).toBe('# Title\nBody only.')
  })

  test('adversarial: empty note round-trips to no comment via injectNote', () => {
    expect(injectNote('# Title', '')).toBe('# Title\n')
  })

  test('adversarial: only the first non-JSON comment is treated as the note', () => {
    const { rest, note } = extractNote('# Title\n\n<!--\nfirst\n-->\n\n<!--\nsecond\n-->\n')
    expect(note).toBe('first')
    expect(rest).toContain('second')
  })
})

describe('extractPageComment', () => {
  test('spec: parses a leading JSON PageComment', () => {
    const { rest, config } = extractPageComment('<!-- {"key":"cover","layout":"cover"} -->\n# Title\n')
    expect(config).toEqual({ key: 'cover', layout: 'cover' })
    expect(rest).toBe('# Title')
  })

  test('adversarial: no PageComment yields an empty config and byte-identical body', () => {
    const raw = '# Title\nBody.\n'
    const { rest, config } = extractPageComment(raw)
    expect(config).toEqual({})
    expect(rest).toBe(raw)
  })

  test('adversarial: malformed JSON is left in place rather than throwing', () => {
    const raw = '<!-- {not json} -->\n# Title\n'
    const { rest, config } = extractPageComment(raw)
    expect(config).toEqual({})
    expect(rest).toBe(raw)
  })

  test('adversarial: a note-shaped comment before the PageComment is not consumed', () => {
    // extractPageComment only recognizes a comment starting with `{` — a
    // plain-text comment earlier in the source must be skipped over, not
    // mistaken for (or block finding) the JSON one.
    const { rest, config } = extractPageComment('<!--\nplain note\n-->\n<!-- {"key":"a"} -->\n# Title\n')
    expect(config).toEqual({ key: 'a' })
    expect(rest).toContain('plain note')
    expect(rest).not.toContain('"key"')
  })
})

describe('buildSlideText', () => {
  test('spec: reassembles config + body + note in a fixed order', () => {
    const text = buildSlideText({ key: 'a' }, '# Title', 'note')
    expect(text).toBe('<!-- {"key":"a"} -->\n# Title\n\n<!--\nnote\n-->\n')
  })

  test('adversarial: an empty config omits the config comment entirely', () => {
    const text = buildSlideText({}, '# Title', '')
    expect(text).toBe('# Title\n')
  })

  test('adversarial: round-trips through extractPageComment + extractNote', () => {
    const original = buildSlideText({ key: 'a', time: '30s' }, '# Title\n\nBody.', 'Remember to smile')
    const { rest: withoutNote, note } = extractNote(original)
    const { rest, config } = extractPageComment(withoutNote)
    expect(config).toEqual({ key: 'a', time: '30s' })
    expect(note).toBe('Remember to smile')
    expect(rest).toBe('# Title\n\nBody.')
  })
})

describe('updatePageComment', () => {
  test('spec: merges updates into an existing PageComment', () => {
    const raw = '<!-- {"key":"a"} -->\n# Title\n'
    const updated = updatePageComment(raw, { section: 'Intro', time: '1m' })
    expect(JSON.parse(/<!--(.*)-->/.exec(updated)![1].trim())).toEqual({ key: 'a', section: 'Intro', time: '1m' })
  })

  test('spec: prepends a new PageComment when none exists', () => {
    const updated = updatePageComment('# Title\n', { key: 'a' })
    expect(updated.startsWith('<!-- {"key":"a"} -->\n')).toBe(true)
  })

  test('adversarial: boolean fields (draft/skip) round-trip correctly', () => {
    const updated = updatePageComment('<!-- {"key":"a"} -->\n# Title\n', { draft: true, skip: false })
    const config = JSON.parse(/<!--(.*)-->/.exec(updated)![1].trim()) as Record<string, unknown>
    expect(config.draft).toBe(true)
    expect(config.skip).toBe(false)
  })

  test('adversarial: an unrelated leading note comment is not treated as the PageComment', () => {
    const raw = '<!--\nplain note\n-->\n# Title\n'
    const updated = updatePageComment(raw, { key: 'a' })
    // No existing `{...}` comment found, so a new one is prepended and the
    // note comment must survive untouched.
    expect(updated).toContain('plain note')
    expect(updated.startsWith('<!-- {"key":"a"} -->\n')).toBe(true)
  })
})

describe('slugifyTitle', () => {
  test('spec: lowercases and hyphenates', () => {
    expect(slugifyTitle('New Slide')).toBe('new-slide')
  })

  test('adversarial: punctuation and repeated separators collapse to one hyphen', () => {
    expect(slugifyTitle('Q&A -- Wrap Up!!')).toBe('q-a-wrap-up')
  })

  test('adversarial: a title with no alphanumeric characters slugifies to empty', () => {
    expect(slugifyTitle('!!!')).toBe('')
  })
})

describe('uniqueSlideKey', () => {
  test('spec: returns the base key unchanged when it is free', () => {
    expect(uniqueSlideKey('new-slide', ['intro', 'outro'])).toBe('new-slide')
  })

  test('spec: appends -2, -3, ... past the first collision', () => {
    expect(uniqueSlideKey('new-slide', ['new-slide'])).toBe('new-slide-2')
    expect(uniqueSlideKey('new-slide', ['new-slide', 'new-slide-2'])).toBe('new-slide-3')
  })

  test('adversarial: an empty base key falls back to "slide"', () => {
    expect(uniqueSlideKey('', [])).toBe('slide')
  })

  test('adversarial: an empty base key that also collides still numbers from "slide"', () => {
    expect(uniqueSlideKey('', ['slide'])).toBe('slide-2')
  })
})

describe('newSlideConfig', () => {
  test('spec: carries over an explicit layout from the previous slide', () => {
    expect(newSlideConfig({ layout: 'cover' }, 'new-slide')).toEqual({ key: 'new-slide', layout: 'cover' })
  })

  test('adversarial: no layout on the previous slide means no layout field at all (not undefined)', () => {
    expect(newSlideConfig({}, 'new-slide')).toEqual({ key: 'new-slide' })
    expect('layout' in newSlideConfig({}, 'new-slide')).toBe(false)
  })

  test('adversarial: other fields on the previous slide (section, key, draft) are never carried over', () => {
    expect(newSlideConfig({ key: 'old', section: 'Intro', draft: true, layout: 'cover' }, 'new-slide'))
      .toEqual({ key: 'new-slide', layout: 'cover' })
  })
})

describe('clampFocusIndex', () => {
  test('spec: a valid in-range candidate is kept as-is', () => {
    expect(clampFocusIndex(2, 5)).toBe(2)
  })

  test('spec: a candidate at or past the new count falls back to the first slide', () => {
    expect(clampFocusIndex(5, 5)).toBe(0)
    expect(clampFocusIndex(99, 5)).toBe(0)
  })

  test('spec: a null candidate (e.g. not preserving selection) falls back to the first slide', () => {
    expect(clampFocusIndex(null, 3)).toBe(0)
  })

  test('adversarial: an empty list always yields null, valid-looking candidate or not', () => {
    expect(clampFocusIndex(0, 0)).toBe(null)
    expect(clampFocusIndex(null, 0)).toBe(null)
  })

  test('adversarial: a negative candidate is treated as invalid, not as a valid low index', () => {
    expect(clampFocusIndex(-1, 5)).toBe(0)
  })
})

describe('gapToIndex', () => {
  test('spec: a gap before or at the dragged row is unaffected by its own removal', () => {
    expect(gapToIndex(0, 3)).toBe(0)
    expect(gapToIndex(3, 3)).toBe(3)
  })

  test('spec: a gap after the dragged row shifts down by one once it is removed', () => {
    expect(gapToIndex(4, 3)).toBe(3)
    expect(gapToIndex(1, 0)).toBe(0)
  })

  test('adversarial: dropping into the row\'s own two surrounding gaps both resolve to a no-op index', () => {
    // Dragging row 2 and releasing on either gap immediately around it
    // (gap 2 = just before it, gap 3 = just after) should both mean
    // "put it back where it was" — reorderSlides' own `to !== index`
    // check is what actually skips the no-op commit; this just verifies
    // the index math funnels both gaps to the same place.
    expect(gapToIndex(2, 2)).toBe(2)
    expect(gapToIndex(3, 2)).toBe(2)
  })
})

describe('indexAfterMove', () => {
  test('spec: the moved slide follows itself to the drop target', () => {
    expect(indexAfterMove(0, 0, 2)).toBe(2)
    expect(indexAfterMove(3, 3, 0)).toBe(0)
  })

  test('spec: a later slide shifts down by one when an earlier slide moves past it', () => {
    // [A,B,C,D] -> move A(0) to 2 -> [B,C,A,D]: B(1)->0, C(2)->1, D(3)->3
    expect(indexAfterMove(1, 0, 2)).toBe(0)
    expect(indexAfterMove(2, 0, 2)).toBe(1)
    expect(indexAfterMove(3, 0, 2)).toBe(3)
  })

  test('spec: an earlier slide shifts up by one when a later slide moves in front of it', () => {
    // [A,B,C,D] -> move D(3) to 0 -> [D,A,B,C]: A(0)->1, B(1)->2, C(2)->3
    expect(indexAfterMove(0, 3, 0)).toBe(1)
    expect(indexAfterMove(1, 3, 0)).toBe(2)
    expect(indexAfterMove(2, 3, 0)).toBe(3)
  })

  test('adversarial: a from/to no-op leaves every index unchanged', () => {
    for (let i = 0; i < 4; i++) expect(indexAfterMove(i, 1, 1)).toBe(i)
  })

  test('adversarial: an index outside the moved range on either side of a forward move is untouched', () => {
    // [A,B,C,D,E] -> move B(1) to 3 -> [A,C,D,B,E]: E(4) stays 4, A(0) stays 0
    expect(indexAfterMove(4, 1, 3)).toBe(4)
    expect(indexAfterMove(0, 1, 3)).toBe(0)
  })
})

describe('extractHeadingText', () => {
  test('spec: finds the first ATX heading', () => {
    expect(extractHeadingText('# New Slide\n\nSome body text\n')).toBe('New Slide')
  })

  test('adversarial: a heading inside a fenced code block is ignored', () => {
    expect(extractHeadingText('```\n# not a heading\n```\n\n## Real Heading\n')).toBe('Real Heading')
  })

  test('adversarial: a heading-shaped line inside a PageComment/note HTML comment is ignored', () => {
    expect(extractHeadingText('<!-- {"key":"a"} -->\n<!--\n# not a heading\n-->\n# Real\n')).toBe('Real')
  })

  test('adversarial: no heading at all returns null', () => {
    expect(extractHeadingText('just some text\n')).toBe(null)
  })
})

describe('parseDurationToMs / formatDurationMs', () => {
  test.each([
    ['1m', 60_000],
    ['90s', 90_000],
    ['1m30s', 90_000],
    ['0s', 0],
  ])('spec: parses %s to %d ms', (input, expected) => {
    expect(parseDurationToMs(input)).toBe(expected)
  })

  test('adversarial: garbage input returns null rather than NaN', () => {
    expect(parseDurationToMs('not a duration')).toBeNull()
    expect(parseDurationToMs('')).toBeNull()
    expect(parseDurationToMs('m')).toBeNull()
    expect(parseDurationToMs('30')).toBeNull()
  })

  test('adversarial: surrounding whitespace is tolerated', () => {
    expect(parseDurationToMs('  1m30s  ')).toBe(90_000)
  })

  test.each([
    [60_000, '1m'],
    [90_000, '1m30s'],
    [0, '0s'],
    [59_500, '1m'],
  ])('spec: formats %d ms as %s', (ms, expected) => {
    expect(formatDurationMs(ms)).toBe(expected)
  })

  test('adversarial: parseDurationToMs and formatDurationMs round-trip', () => {
    for (const value of ['0s', '5s', '1m', '2m30s']) {
      const ms = parseDurationToMs(value)
      expect(ms).not.toBeNull()
      expect(formatDurationMs(ms as number)).toBe(value)
    }
  })
})

describe('msToMinutesSeconds', () => {
  test.each([
    [0, { minutes: 0, seconds: 0 }],
    [59_000, { minutes: 0, seconds: 59 }],
    [60_000, { minutes: 1, seconds: 0 }],
    [90_000, { minutes: 1, seconds: 30 }],
    [3_600_000, { minutes: 60, seconds: 0 }],
  ])('spec: splits %d ms into %o', (ms, expected) => {
    expect(msToMinutesSeconds(ms)).toEqual(expected)
  })

  test('spec: rounds to the nearest second, the same way formatDurationMs does', () => {
    expect(msToMinutesSeconds(59_500)).toEqual({ minutes: 1, seconds: 0 })
    expect(msToMinutesSeconds(1_499)).toEqual({ minutes: 0, seconds: 1 })
  })

  test('adversarial: a negative duration reads as zero, never as negative minutes/seconds', () => {
    expect(msToMinutesSeconds(-1)).toEqual({ minutes: 0, seconds: 0 })
    expect(msToMinutesSeconds(-90_000)).toEqual({ minutes: 0, seconds: 0 })
  })

  test('adversarial: NaN reads as zero', () => {
    expect(msToMinutesSeconds(Number.NaN)).toEqual({ minutes: 0, seconds: 0 })
  })

  test('adversarial: a sub-second fraction below half a second rounds down to zero, not negative zero', () => {
    const { minutes, seconds } = msToMinutesSeconds(-400)
    expect(Object.is(minutes, 0)).toBe(true)
    expect(Object.is(seconds, 0)).toBe(true)
  })

  test('adversarial: a duration past MAX_DURATION_MS (including Infinity) is capped there', () => {
    const cap = { minutes: MAX_DURATION_MS / 60_000, seconds: 0 }
    expect(msToMinutesSeconds(Number.MAX_SAFE_INTEGER)).toEqual(cap)
    expect(msToMinutesSeconds(Number.MAX_VALUE)).toEqual(cap)
    expect(msToMinutesSeconds(Number.POSITIVE_INFINITY)).toEqual(cap)
  })
})

describe('minutesSecondsToMs', () => {
  test.each([
    [0, 0, 0],
    [0, 59, 59_000],
    [1, 0, 60_000],
    [1, 30, 90_000],
  ])('spec: %d min %d s is %d ms', (minutes, seconds, expected) => {
    expect(minutesSecondsToMs(minutes, seconds)).toBe(expected)
  })

  test('spec: seconds past 59 carry into minutes (60s -> 1m0s)', () => {
    expect(minutesSecondsToMs(0, 60)).toBe(60_000)
    expect(msToMinutesSeconds(minutesSecondsToMs(1, 75))).toEqual({ minutes: 2, seconds: 15 })
  })

  test('spec: negative seconds borrow from minutes (2m, -1s -> 1m59s)', () => {
    expect(msToMinutesSeconds(minutesSecondsToMs(2, -1))).toEqual({ minutes: 1, seconds: 59 })
  })

  test('adversarial: a negative total clamps to 0, never to a negative duration or negative zero', () => {
    expect(minutesSecondsToMs(-1, 0)).toBe(0)
    expect(minutesSecondsToMs(0, -1)).toBe(0)
    expect(Object.is(minutesSecondsToMs(0, -0.4), 0)).toBe(true)
    expect(Object.is(minutesSecondsToMs(-0, -0), 0)).toBe(true)
  })

  test('adversarial: non-integer parts round the total to the nearest whole second', () => {
    expect(minutesSecondsToMs(1.5, 0)).toBe(90_000)
    expect(minutesSecondsToMs(0, 1.6)).toBe(2_000)
    expect(minutesSecondsToMs(0, 0.4)).toBe(0)
    expect(minutesSecondsToMs(0.1, 0)).toBe(6_000)
  })

  test('adversarial: a NaN part (an empty number input) counts as 0', () => {
    expect(minutesSecondsToMs(Number.NaN, 30)).toBe(30_000)
    expect(minutesSecondsToMs(2, Number.NaN)).toBe(120_000)
    expect(minutesSecondsToMs(Number.NaN, Number.NaN)).toBe(0)
  })

  test('adversarial: huge parts cap at MAX_DURATION_MS instead of overflowing past peitho-core\'s limit', () => {
    expect(minutesSecondsToMs(Number.MAX_SAFE_INTEGER, 0)).toBe(MAX_DURATION_MS)
    expect(minutesSecondsToMs(0, Number.MAX_SAFE_INTEGER)).toBe(MAX_DURATION_MS)
    expect(minutesSecondsToMs(Number.POSITIVE_INFINITY, 0)).toBe(MAX_DURATION_MS)
    expect(minutesSecondsToMs(Number.NEGATIVE_INFINITY, 59)).toBe(0)
  })

  test('adversarial: +Infinity minutes and -Infinity seconds (NaN when summed) count as 0, not NaN', () => {
    expect(minutesSecondsToMs(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)).toBe(0)
  })

  test('adversarial: MAX_DURATION_MS itself is a whole second that formats in plain digits and parses back', () => {
    expect(MAX_DURATION_MS % 1000).toBe(0)
    expect(MAX_DURATION_MS).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    expect(formatDurationMs(MAX_DURATION_MS)).toMatch(/^\d+m(\d+s)?$/)
    expect(parseDurationToMs(formatDurationMs(MAX_DURATION_MS))).toBe(MAX_DURATION_MS)
  })
})

describe('msToMinutesSeconds / minutesSecondsToMs round-trip', () => {
  test.each([0, 1_000, 59_000, 60_000, 90_000, 3_599_000, 3_600_000, MAX_DURATION_MS])(
    'spec: %d ms survives a split and a recombine unchanged',
    ms => {
      const { minutes, seconds } = msToMinutesSeconds(ms)
      expect(minutesSecondsToMs(minutes, seconds)).toBe(ms)
    },
  )

  test('adversarial: every whole-second duration up to MAX_DURATION_MS round-trips (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_DURATION_MS / 1000 }), totalSeconds => {
        const ms = totalSeconds * 1000
        const { minutes, seconds } = msToMinutesSeconds(ms)
        return minutesSecondsToMs(minutes, seconds) === ms
      }),
    )
  })

  test('adversarial: an off-grid duration comes back rounded to the whole second formatDurationMs would print', () => {
    for (const ms of [1, 499, 500, 59_999, 90_250]) {
      const { minutes, seconds } = msToMinutesSeconds(ms)
      expect(formatDurationMs(minutesSecondsToMs(minutes, seconds))).toBe(formatDurationMs(ms))
    }
  })
})

describe('savableSectionTimeMs', () => {
  test.each([
    [1_000, 1_000],
    [59_000, 59_000],
    [90_000, 90_000],
  ])('spec: a positive whole-second time %d ms is saved unchanged', (ms, expected) => {
    expect(savableSectionTimeMs(ms)).toBe(expected)
  })

  test('spec: a time of 0 is saved as MIN_SECTION_TIME_MS (1 second), since peitho-core rejects 0', () => {
    expect(MIN_SECTION_TIME_MS).toBe(1_000)
    expect(savableSectionTimeMs(0)).toBe(1_000)
  })

  test('adversarial: negative, NaN and sub-half-second times all save as 1 second', () => {
    expect(savableSectionTimeMs(-60_000)).toBe(1_000)
    expect(savableSectionTimeMs(Number.NaN)).toBe(1_000)
    expect(savableSectionTimeMs(499)).toBe(1_000)
  })

  test('adversarial: an off-grid time rounds to the nearest whole second before clamping', () => {
    expect(savableSectionTimeMs(1_500)).toBe(2_000)
    expect(savableSectionTimeMs(90_499)).toBe(90_000)
  })

  test('adversarial: a time past MAX_DURATION_MS (including Infinity) saves as MAX_DURATION_MS', () => {
    expect(savableSectionTimeMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_DURATION_MS)
    expect(savableSectionTimeMs(Number.POSITIVE_INFINITY)).toBe(MAX_DURATION_MS)
  })

  test('spec: other sections\' time is left alone unless the deck total would pass MAX_DURATION_MS', () => {
    expect(savableSectionTimeMs(90_000, 60_000)).toBe(90_000)
    expect(savableSectionTimeMs(Number.MAX_SAFE_INTEGER, 60_000)).toBe(MAX_DURATION_MS - 60_000)
  })

  test('adversarial: other sections exactly filling MAX_DURATION_MS still leave the 1-second minimum', () => {
    expect(savableSectionTimeMs(90_000, MAX_DURATION_MS)).toBe(MIN_SECTION_TIME_MS)
    expect(savableSectionTimeMs(90_000, Number.POSITIVE_INFINITY)).toBe(MIN_SECTION_TIME_MS)
  })

  test('adversarial: a NaN or negative other-sections total counts as 0', () => {
    expect(savableSectionTimeMs(Number.MAX_SAFE_INTEGER, Number.NaN)).toBe(MAX_DURATION_MS)
    expect(savableSectionTimeMs(Number.MAX_SAFE_INTEGER, -60_000)).toBe(MAX_DURATION_MS)
  })
})

describe('withDurationPart', () => {
  test('spec: replacing the minutes keeps the seconds', () => {
    expect(withDurationPart(90_000, 'minutes', 5)).toBe(330_000)
  })

  test('spec: replacing the seconds keeps the minutes', () => {
    expect(withDurationPart(90_000, 'seconds', 5)).toBe(65_000)
  })

  test('adversarial: an unchanged part value returns the same duration', () => {
    expect(withDurationPart(90_000, 'minutes', 1)).toBe(90_000)
    expect(withDurationPart(90_000, 'seconds', 30)).toBe(90_000)
  })

  test('adversarial: an off-grid starting duration is rounded before the edit, not carried along', () => {
    expect(withDurationPart(90_400, 'minutes', 2)).toBe(150_000)
  })

  test('adversarial: a NaN value (an empty or half-typed number input) leaves the duration unchanged, for either part', () => {
    expect(withDurationPart(90_000, 'minutes', Number.NaN)).toBe(90_000)
    expect(withDurationPart(90_000, 'seconds', Number.NaN)).toBe(90_000)
  })

  test('adversarial: a NaN value still normalizes an off-grid or out-of-range starting duration', () => {
    expect(withDurationPart(90_400, 'seconds', Number.NaN)).toBe(90_000)
    expect(withDurationPart(-5_000, 'minutes', Number.NaN)).toBe(0)
    expect(withDurationPart(Number.NaN, 'minutes', Number.NaN)).toBe(0)
  })
})

describe('example: editing a section time with the minutes/seconds spinners', () => {
  test.each(sectionTimeExamples.automated.map(e => [e.id, e] as const))('example: %s', (_id, example) => {
    const timeMs = withDurationPart(example.state.timeMs, example.event.part, example.event.value)
    expect({ ...msToMinutesSeconds(timeMs), written: formatDurationMs(timeMs) }).toEqual(example.expect)
  })

  test('every example is either automated or carries a manual reason', () => {
    expect(isExhaustivelyAccountedFor(sectionTimeExamples)).toBe(true)
  })
})

// Non-functional: robustness. The acceptance condition for the spinner UI
// is that no input it can produce yields a time string `parseDurationToMs`
// rejects. These properties feed every kind of number an
// `<input type="number">` can report, not just the typical ones above.
describe('robustness: section-time spinners can\'t produce an unparseable time', () => {
  const anyInputNumber = fc.oneof(
    fc.double(),
    fc.integer(),
    fc.constantFrom(Number.NaN, 0, -0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MAX_VALUE),
  )

  test('adversarial: any spinner edit from any starting time writes a string that parses back to the same duration (property)', () => {
    fc.assert(
      fc.property(anyInputNumber, fc.constantFrom<DurationPart>('minutes', 'seconds'), anyInputNumber, (start, part, value) => {
        const timeMs = withDurationPart(start, part, value)
        return parseDurationToMs(formatDurationMs(timeMs)) === timeMs
      }),
      { numRuns: 2_000 },
    )
  })

  test('adversarial: any spinner edit keeps the displayed parts non-negative whole numbers with seconds in 0..59 (property)', () => {
    fc.assert(
      fc.property(anyInputNumber, fc.constantFrom<DurationPart>('minutes', 'seconds'), anyInputNumber, (start, part, value) => {
        const timeMs = withDurationPart(start, part, value)
        const { minutes, seconds } = msToMinutesSeconds(timeMs)
        return Number.isSafeInteger(minutes) && minutes >= 0
          && Number.isInteger(seconds) && seconds >= 0 && seconds <= 59
          && Object.is(timeMs, Math.abs(timeMs)) && timeMs <= MAX_DURATION_MS
      }),
      { numRuns: 2_000 },
    )
  })

  test('adversarial: whatever the spinners show, the saved time is greater than zero, keeps the deck total within peitho-core\'s limit, and parses back (property)', () => {
    fc.assert(
      fc.property(
        anyInputNumber,
        fc.constantFrom<DurationPart>('minutes', 'seconds'),
        anyInputNumber,
        // Other sections as peitho-core could have loaded them: whole
        // seconds, leaving at least a second of room under the limit.
        fc.integer({ min: 0, max: (MAX_DURATION_MS - MIN_SECTION_TIME_MS) / 1000 }).map(s => s * 1000),
        (start, part, value, otherSectionsMs) => {
          const saved = savableSectionTimeMs(withDurationPart(start, part, value), otherSectionsMs)
          return saved >= MIN_SECTION_TIME_MS && saved + otherSectionsMs <= MAX_DURATION_MS
            && parseDurationToMs(formatDurationMs(saved)) === saved
        },
      ),
      { numRuns: 2_000 },
    )
  })
})

describe('updateFrontmatterTime', () => {
  test('spec: rewrites an existing time: line', () => {
    const source = '---\ntime: 1m\n---\n# Title\n'
    expect(updateFrontmatterTime(source, 90_000)).toBe('---\ntime: 1m30s\n---\n# Title\n')
  })

  test('spec: inserts a time: line (just before the closing ---) when frontmatter has none', () => {
    const source = '---\ntitle: Deck\n---\n# Title\n'
    const updated = updateFrontmatterTime(source, 60_000)
    expect(updated).toBe('---\ntitle: Deck\ntime: 1m\n---\n# Title\n')
  })

  test('adversarial: no frontmatter at all gets a fresh block prepended', () => {
    const source = '# Title\n'
    expect(updateFrontmatterTime(source, 5_000)).toBe('---\ntime: 5s\n---\n# Title\n')
  })

  test('adversarial: an unterminated frontmatter block is left untouched', () => {
    const source = '---\ntime: 1m\n# Title\n'
    expect(updateFrontmatterTime(source, 90_000)).toBe(source)
  })

  test('adversarial: zero duration formats as 0s, not an empty string', () => {
    const source = '---\ntime: 1m\n---\n# Title\n'
    expect(updateFrontmatterTime(source, 0)).toBe('---\ntime: 0s\n---\n# Title\n')
  })
})

describe('joinSlideTexts', () => {
  test('spec: joins slides with peitho\'s --- separator and keeps prefix/suffix', () => {
    const joined = joinSlideTexts('---\ntime: 1m\n---\n', ['# One', '# Two'], '')
    expect(joined).toBe('---\ntime: 1m\n---\n# One\n\n---\n\n# Two\n')
  })

  test('adversarial: a single slide has no separator at all', () => {
    expect(joinSlideTexts('', ['# One'], '')).toBe('# One\n')
  })

  test('adversarial: each slide text is trimmed before joining', () => {
    expect(joinSlideTexts('', ['  # One  \n', '\n# Two\n'], '')).toBe('# One\n\n---\n\n# Two\n')
  })

  test('adversarial: an empty texts array still returns prefix+suffix', () => {
    expect(joinSlideTexts('pre', [], 'post')).toBe('pre\npost')
  })
})

describe('sumSectionTimesMs', () => {
  test('spec: sums only slides that mark the start of a section', () => {
    const texts = [
      '<!-- {"section":"Intro","time":"1m"} -->\n# One',
      '# Two (no section)',
      '<!-- {"section":"Body","time":"2m30s"} -->\n# Three',
    ]
    expect(sumSectionTimesMs(texts)).toBe(210_000)
  })

  test('adversarial: no sections at all sums to zero', () => {
    expect(sumSectionTimesMs(['# One', '# Two'])).toBe(0)
  })

  test('adversarial: a slide with only `section` (no `time`) contributes nothing', () => {
    // peitho requires section+time to be set together — a malformed
    // half-set PageComment shouldn't be treated as if it had a valid time.
    const texts = ['<!-- {"section":"Intro"} -->\n# One']
    expect(sumSectionTimesMs(texts)).toBe(0)
  })

  test('adversarial: an empty array sums to zero', () => {
    expect(sumSectionTimesMs([])).toBe(0)
  })
})

describe('stabilizeByKey', () => {
  test('spec: reuses the previous object for a structurally-unchanged entry', () => {
    const prevItem = { key: 'a', title: 'Hello' }
    const previous = [prevItem]
    const next = [{ key: 'a', title: 'Hello' }] // same content, different object
    const result = stabilizeByKey(previous, next)
    expect(result[0]).toBe(prevItem)
  })

  test('spec: keeps the new object for a genuinely changed entry', () => {
    const previous = [{ key: 'a', title: 'Hello' }]
    const nextItem = { key: 'a', title: 'Changed' }
    const result = stabilizeByKey(previous, [nextItem])
    expect(result[0]).toBe(nextItem)
  })

  test('adversarial: a brand-new key (no previous match) passes through as-is', () => {
    const nextItem = { key: 'b', title: 'New' }
    const result = stabilizeByKey([{ key: 'a', title: 'Hello' }], [nextItem])
    expect(result[0]).toBe(nextItem)
  })

  test('adversarial: an empty previous array stabilizes nothing', () => {
    const nextItem = { key: 'a', title: 'Hello' }
    expect(stabilizeByKey([], [nextItem])[0]).toBe(nextItem)
  })

  test('adversarial: order and length follow `next`, not `previous`', () => {
    const a = { key: 'a', title: 'A' }
    const b = { key: 'b', title: 'B' }
    const result = stabilizeByKey([b, a], [a, b])
    expect(result.map(item => item.key)).toEqual(['a', 'b'])
  })

  test('adversarial: mixed reordering only stabilizes the unchanged entries', () => {
    const a = { key: 'a', title: 'A' }
    const b = { key: 'b', title: 'B' }
    const changedB = { key: 'b', title: 'B2' }
    const result = stabilizeByKey([a, b], [changedB, a])
    expect(result[0]).toBe(changedB)
    expect(result[1]).toBe(a)
  })
})
