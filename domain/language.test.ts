import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { LANGUAGES, isJapaneseLocale, parseLocales, resolveLanguage, systemLanguage } from './language'

describe('isJapaneseLocale', () => {
  test('spec: Given the ways an OS spells Japanese, when checked, then each one is Japanese', () => {
    for (const tag of ['ja', 'ja-JP', 'ja_JP', 'JA-jp', 'ja-Jpan-JP', ' ja-JP ']) {
      expect(isJapaneseLocale(tag)).toBe(true)
    }
  })

  test('spec: Given other languages, when checked, then none is Japanese', () => {
    for (const tag of ['en', 'en-US', 'en-JP', 'zh-Hans-JP', 'ko-KR', 'fr']) {
      expect(isJapaneseLocale(tag)).toBe(false)
    }
  })

  test('adversarial: Given empty, malformed or look-alike tags, when checked, then none is Japanese', () => {
    for (const tag of ['', ' ', '-', '_ja', '-ja', 'jam', 'jav', 'j', 'japanese', 'x-ja', '日本語']) {
      expect(isJapaneseLocale(tag)).toBe(false)
    }
  })
})

describe('systemLanguage', () => {
  test('spec: Given Japanese first among the OS\'s preferred languages, when resolved, then the UI is Japanese', () => {
    expect(systemLanguage(['ja-JP', 'en-US'])).toBe('ja')
  })

  test('spec: Given English (or anything else) first, when resolved, then the UI is English', () => {
    expect(systemLanguage(['en-US', 'ja-JP'])).toBe('en')
    expect(systemLanguage(['fr-FR'])).toBe('en')
  })

  test('adversarial: Given the OS reports no language, or only blanks, when resolved, then the UI is English', () => {
    expect(systemLanguage([])).toBe('en')
    expect(systemLanguage([''])).toBe('en')
    expect(systemLanguage(['', 'ja'])).toBe('en')
  })

  test('adversarial: Given any list of strings, when resolved, then the answer is always a supported language', () => {
    fc.assert(fc.property(fc.array(fc.string()), locales => {
      expect(LANGUAGES).toContain(systemLanguage(locales))
    }))
  })
})

describe('resolveLanguage', () => {
  test('spec: Given nothing chosen yet, when resolved, then the OS\'s language is used', () => {
    expect(resolveLanguage('system', ['ja-JP'])).toBe('ja')
    expect(resolveLanguage('system', ['en-GB'])).toBe('en')
  })

  test('spec: Given a language chosen in Settings, when resolved, then it wins over the OS\'s', () => {
    expect(resolveLanguage('en', ['ja-JP'])).toBe('en')
    expect(resolveLanguage('ja', ['en-US'])).toBe('ja')
  })

  test('adversarial: Given a chosen language and no OS languages, when resolved, then the chosen one is used', () => {
    expect(resolveLanguage('ja', [])).toBe('ja')
    expect(resolveLanguage('system', [])).toBe('en')
  })
})

describe('parseLocales', () => {
  test('spec: Given the OS\'s locale list, when read, then it is kept as is, in order', () => {
    expect(parseLocales(['ja-JP', 'en-US'])).toEqual(['ja-JP', 'en-US'])
    expect(parseLocales([])).toEqual([])
  })

  test('adversarial: Given a malformed answer, when read, then only the strings survive, and anything but a list reads as none', () => {
    expect(parseLocales(['ja', 1, null, { tag: 'en' }, 'en'])).toEqual(['ja', 'en'])
    for (const raw of [null, undefined, 'ja-JP', 42, { 0: 'ja' }, true]) expect(parseLocales(raw)).toEqual([])
  })

  test('property: whatever arrives, the result is a list of strings', () => {
    fc.assert(fc.property(fc.anything(), raw => {
      const parsed = parseLocales(raw)
      expect(Array.isArray(parsed) && parsed.every(tag => typeof tag === 'string')).toBe(true)
    }))
  })
})
