import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  DECK_SETTING_CHOICES,
  DECK_SETTING_KEYS,
  type DeckSettingKey,
  type DeckSettingPick,
  defaultChoiceOf,
  frontmatterValueOf,
  parseDeckSetting,
  parseDeckSettingPick,
  pickChangesNothing,
  readDeckSettings,
  resolveDeckSettingPick,
  sameDeckSettings,
} from './deckSettings'
import { readDeckSettingsExamples, writeDeckSettingExamples } from './deckSettings.examples'
import { setFrontmatterKey } from './frontmatter'
import { isExhaustivelyAccountedFor } from './spec'

const ALL_PICKS: DeckSettingPick[] = DECK_SETTING_KEYS.flatMap(key =>
  DECK_SETTING_CHOICES[key].map(choice => ({ key, choice }) as DeckSettingPick),
)

describe('deck setting examples', () => {
  test.each(readDeckSettingsExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_title, example) => {
      expect(readDeckSettings(example.state)).toEqual(example.expect)
    },
  )

  test.each(writeDeckSettingExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_title, example) => {
      expect(frontmatterValueOf(example.event.key, example.event.choice as never)).toBe(example.expect)
    },
  )

  test('spec: every example is either automated or carries a manual reason', () => {
    expect(isExhaustivelyAccountedFor(readDeckSettingsExamples)).toBe(true)
    expect(isExhaustivelyAccountedFor(writeDeckSettingExamples)).toBe(true)
  })
})

describe('parseDeckSetting', () => {
  test('spec: an absent key reads as its default choice', () => {
    for (const key of DECK_SETTING_KEYS) {
      expect(parseDeckSetting(key, null)).toEqual({ kind: 'known', choice: defaultChoiceOf(key) })
    }
  })

  test('spec: every offered choice reads back as itself', () => {
    for (const { key, choice } of ALL_PICKS) {
      // `none` is never written: it is the key being absent.
      if (key === 'page_numbers' && choice === 'none') continue
      expect(parseDeckSetting(key, choice)).toEqual({ kind: 'known', choice })
    }
  })

  test('adversarial: an empty value is unknown, not the default', () => {
    for (const key of DECK_SETTING_KEYS) {
      expect(parseDeckSetting(key, '')).toEqual({ kind: 'unknown', raw: '' })
    }
  })

  test('adversarial: near-miss spellings are unknown (matching is exact, as in peitho-core)', () => {
    expect(parseDeckSetting('aspect_ratio', '16：9')).toEqual({ kind: 'unknown', raw: '16：9' })
    expect(parseDeckSetting('aspect_ratio', '16/9')).toEqual({ kind: 'unknown', raw: '16/9' })
    expect(parseDeckSetting('aspect_ratio', '16:10')).toEqual({ kind: 'unknown', raw: '16:10' })
    expect(parseDeckSetting('lang', 'JA')).toEqual({ kind: 'unknown', raw: 'JA' })
    expect(parseDeckSetting('lang', 'ja-JP')).toEqual({ kind: 'unknown', raw: 'ja-JP' })
    expect(parseDeckSetting('breaks', 'yes')).toEqual({ kind: 'unknown', raw: 'yes' })
    expect(parseDeckSetting('breaks', 'True')).toEqual({ kind: 'unknown', raw: 'True' })
    expect(parseDeckSetting('page_numbers', 'Current')).toEqual({ kind: 'unknown', raw: 'Current' })
  })

  test('adversarial: `none` written out for page_numbers is unknown (peitho has no such value)', () => {
    expect(parseDeckSetting('page_numbers', 'none')).toEqual({ kind: 'unknown', raw: 'none' })
  })

  test('adversarial: an explicit `breaks: false` reads as off', () => {
    expect(parseDeckSetting('breaks', 'false')).toEqual({ kind: 'known', choice: 'false' })
  })
})

describe('readDeckSettings', () => {
  test('adversarial: the empty source reads as all defaults', () => {
    expect(sameDeckSettings(readDeckSettings(''), readDeckSettings('# Title\n'))).toBe(true)
  })

  test('adversarial: CRLF line endings don\'t leak into the values', () => {
    const source = '---\r\naspect_ratio: 4:3\r\nlang: ja\r\n---\r\n# Title\r\n'
    expect(readDeckSettings(source)).toMatchObject({ aspect_ratio: { kind: 'known', choice: '4:3' }, lang: { kind: 'known', choice: 'ja' } })
  })

  test('adversarial: a key written in a slide, after the frontmatter, is not read', () => {
    expect(readDeckSettings('---\ntime: 1m\n---\nlang: ja\n').lang).toEqual({ kind: 'known', choice: 'en' })
  })

  test('adversarial: an unknown value keeps its raw text, so it can be reported', () => {
    expect(readDeckSettings('---\nlang: fr # French\n---\n# T\n').lang).toEqual({ kind: 'unknown', raw: 'fr' })
  })
})

describe('frontmatterValueOf', () => {
  test('spec: writing a choice and reading it back gives the same choice', () => {
    for (const pick of ALL_PICKS) {
      const written = setFrontmatterKey('# Title\n', pick.key, frontmatterValueOf(pick.key, pick.choice as never))
      expect(readDeckSettings(written)[pick.key]).toEqual({ kind: 'known', choice: pick.choice })
    }
  })

  test('spec: only the default removes the key', () => {
    for (const { key, choice } of ALL_PICKS) {
      expect(frontmatterValueOf(key, choice as never) === null).toBe(choice === defaultChoiceOf(key))
    }
  })
})

describe('parseDeckSettingPick', () => {
  test('spec: a pick of any offered choice is read as is', () => {
    for (const pick of ALL_PICKS) expect(parseDeckSettingPick({ ...pick })).toEqual(pick)
  })

  test('adversarial: anything else is rejected', () => {
    const rejected: unknown[] = [
      null, undefined, 'lang', 42, [], {},
      { key: 'lang' },
      { choice: 'ja' },
      { key: 'lang', choice: 'fr' },
      { key: 'lang', choice: null },
      { key: 'lang', choice: 'JA' },
      { key: 'aspect_ratio', choice: 'ja' },
      { key: 'breaks', choice: true },
      { key: 'pointer_color', choice: 'red' },
      { key: 'toString', choice: 'en' },
      { key: '__proto__', choice: 'en' },
      { key: 'page_numbers', choice: 'both' },
    ]
    for (const payload of rejected) expect(parseDeckSettingPick(payload)).toBeNull()
  })

  test('adversarial: arbitrary input never throws, and any accepted pick is an offered one', () => {
    fc.assert(fc.property(fc.anything(), payload => {
      const pick = parseDeckSettingPick(payload)
      if (pick !== null) expect((DECK_SETTING_CHOICES[pick.key] as readonly string[]).includes(pick.choice)).toBe(true)
    }))
    fc.assert(fc.property(fc.record({ key: fc.string(), choice: fc.string() }), payload => {
      const pick = parseDeckSettingPick(payload)
      const key = payload.key as DeckSettingKey
      const offered = (DECK_SETTING_KEYS as readonly string[]).includes(payload.key)
        && (DECK_SETTING_CHOICES[key] as readonly string[]).includes(payload.choice)
      expect(pick !== null).toBe(offered)
    }))
  })
})

describe('resolveDeckSettingPick', () => {
  const off = readDeckSettings('# Title\n')
  const on = readDeckSettings('---\nbreaks: true\n---\n# Title\n')
  const TOGGLE = { key: 'breaks', choice: 'toggle' }

  test('spec: a line-break toggle turns them on when off, and off when on', () => {
    expect(resolveDeckSettingPick(TOGGLE, off)).toEqual({ key: 'breaks', choice: 'true' })
    expect(resolveDeckSettingPick(TOGGLE, on)).toEqual({ key: 'breaks', choice: 'false' })
  })

  test('spec: any other pick reads as parseDeckSettingPick does', () => {
    for (const pick of ALL_PICKS) expect(resolveDeckSettingPick({ ...pick }, on)).toEqual(pick)
  })

  test('adversarial: a toggle over an unknown or explicitly false value turns line breaks on', () => {
    expect(resolveDeckSettingPick(TOGGLE, readDeckSettings('---\nbreaks: yes\n---\n# T\n'))).toEqual({ key: 'breaks', choice: 'true' })
    expect(resolveDeckSettingPick(TOGGLE, readDeckSettings('---\nbreaks: false\n---\n# T\n'))).toEqual({ key: 'breaks', choice: 'true' })
  })

  test('adversarial: a toggle for any other key, or a malformed payload, is rejected', () => {
    for (const payload of [{ key: 'lang', choice: 'toggle' }, { key: 'page_numbers', choice: 'toggle' }, { choice: 'toggle' }, 'toggle', null]) {
      expect(resolveDeckSettingPick(payload, off)).toBeNull()
    }
  })

  test('adversarial: two toggles, each resolved after the previous one landed, end where they began', () => {
    const first = resolveDeckSettingPick(TOGGLE, off)!
    const after = readDeckSettings(setFrontmatterKey('# Title\n', 'breaks', frontmatterValueOf(first.key, first.choice as never)))
    const second = resolveDeckSettingPick(TOGGLE, after)!
    expect(frontmatterValueOf(second.key, second.choice as never)).toBeNull()
  })
})

describe('pickChangesNothing', () => {
  const defaults = readDeckSettings('# Title\n')

  test('spec: picking the choice already in place changes nothing', () => {
    expect(pickChangesNothing(defaults, { key: 'lang', choice: 'en' })).toBe(true)
    expect(pickChangesNothing(defaults, { key: 'lang', choice: 'ja' })).toBe(false)
  })

  test('adversarial: an unknown value is replaced by any pick, the default included', () => {
    const state = readDeckSettings('---\nlang: fr\n---\n# T\n')
    for (const choice of DECK_SETTING_CHOICES.lang) expect(pickChangesNothing(state, { key: 'lang', choice })).toBe(false)
  })
})

describe('sameDeckSettings', () => {
  const state = readDeckSettings('# Title\n')

  test('spec: equal states are the same, a changed choice is not', () => {
    expect(sameDeckSettings(state, readDeckSettings('# Title\n'))).toBe(true)
    expect(sameDeckSettings(state, { ...state, lang: { kind: 'known', choice: 'ja' } })).toBe(false)
  })

  test('adversarial: a key that became unknown counts as a change', () => {
    expect(sameDeckSettings(state, { ...state, aspect_ratio: { kind: 'unknown', raw: '16:10' } })).toBe(false)
  })

  test('adversarial: two unknown values differ by their raw text, which the menu shows', () => {
    const fr = readDeckSettings('---\nlang: fr\n---\n# T\n')
    expect(sameDeckSettings(fr, readDeckSettings('---\nlang: fr\n---\n# T\n'))).toBe(true)
    expect(sameDeckSettings(fr, readDeckSettings('---\nlang: de\n---\n# T\n'))).toBe(false)
    expect(sameDeckSettings(fr, readDeckSettings('---\nlang: ""\n---\n# T\n'))).toBe(false)
  })
})
