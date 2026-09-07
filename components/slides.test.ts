import { describe, expect, test } from 'bun:test'
import {
  splitSlides,
  extractNote,
  injectNote,
  extractPageComment,
  buildSlideText,
  updatePageComment,
  stripPageCommentKey,
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

describe('stripPageCommentKey', () => {
  test('spec: removes the key field, keeping everything else', () => {
    const stripped = stripPageCommentKey('<!-- {"key":"a","layout":"cover"} -->\n# Title\n')
    expect(stripped).toContain('"layout":"cover"')
    expect(stripped).not.toContain('"key"')
  })

  test('adversarial: no PageComment at all is a no-op', () => {
    const raw = '# Title\n'
    expect(stripPageCommentKey(raw)).toBe(raw)
  })

  test('adversarial: a PageComment with no key field is a no-op', () => {
    const raw = '<!-- {"layout":"cover"} -->\n# Title\n'
    expect(stripPageCommentKey(raw)).toBe(raw)
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
