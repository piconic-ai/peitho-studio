import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  SETTINGS_SCHEMA,
  booleanField,
  defaultsOf,
  oneOfField,
  overlaySettings,
  parseSettings,
  type SettingsSchema,
} from './settings'
import { LANGUAGE_SETTINGS } from './language'

// A stand-in independent of the app's own `Settings`, so the per-field
// reading every setting relies on is exercised whatever fields the app has.
interface Sample {
  vimMode: boolean
  uiLanguage: 'en' | 'ja'
}

const SAMPLE: SettingsSchema<Sample> = {
  vimMode: booleanField(false),
  uiLanguage: oneOfField(['en', 'ja'], 'en'),
}

const DEFAULTS: Sample = { vimMode: false, uiLanguage: 'en' }

describe('defaultsOf', () => {
  test('spec: Given a schema, when nothing is saved yet, then every setting is at its default', () => {
    expect(defaultsOf(SAMPLE)).toEqual(DEFAULTS)
  })

  test('spec: Given the app\'s own schema, when nothing is saved yet, then the UI language follows the OS and vim mode is off', () => {
    expect(defaultsOf(SETTINGS_SCHEMA)).toEqual({ uiLanguage: 'system', vimMode: false })
  })
})

describe('parseSettings', () => {
  test('spec: Given valid saved settings, when read, then every setting comes from them', () => {
    expect(parseSettings(SAMPLE, { vimMode: true, uiLanguage: 'ja' })).toEqual({ vimMode: true, uiLanguage: 'ja' })
  })

  test('spec: Given saved settings missing a setting (an older file), when read, then that setting is its default', () => {
    expect(parseSettings(SAMPLE, { vimMode: true })).toEqual({ vimMode: true, uiLanguage: 'en' })
  })

  test('adversarial: Given one setting of the wrong type, when read, then only that setting falls back to its default', () => {
    expect(parseSettings(SAMPLE, { vimMode: 'yes', uiLanguage: 'ja' })).toEqual({ vimMode: false, uiLanguage: 'ja' })
    expect(parseSettings(SAMPLE, { vimMode: true, uiLanguage: 'fr' })).toEqual({ vimMode: true, uiLanguage: 'en' })
    expect(parseSettings(SAMPLE, { vimMode: 1, uiLanguage: 'JA' })).toEqual(DEFAULTS)
  })

  test('adversarial: Given keys the app does not know, when read, then they are dropped', () => {
    const read = parseSettings(SAMPLE, { vimMode: true, theme: 'dark', '': 1 })
    expect(read).toEqual({ vimMode: true, uiLanguage: 'en' })
    expect(Object.keys(read).sort()).toEqual(['uiLanguage', 'vimMode'])
  })

  test('adversarial: Given anything that is not a settings object, when read, then everything is the default', () => {
    for (const raw of [null, undefined, '', '{', 'not json', 0, 42, true, [], [true, 'ja'], () => ({ vimMode: true })]) {
      expect(parseSettings(SAMPLE, raw)).toEqual(DEFAULTS)
    }
  })

  test('adversarial: Given a setting only on the prototype chain, when read, then it is ignored', () => {
    const inherited = Object.create({ vimMode: true }) as object
    expect(parseSettings(SAMPLE, inherited)).toEqual(DEFAULTS)
    expect(parseSettings(SAMPLE, JSON.parse('{"__proto__":{"vimMode":true}}'))).toEqual(DEFAULTS)
  })

  test('spec: Given a saved UI language, when read with the app\'s own schema, then it is kept', () => {
    for (const uiLanguage of LANGUAGE_SETTINGS) {
      expect(parseSettings(SETTINGS_SCHEMA, { uiLanguage })).toEqual({ uiLanguage, vimMode: false })
    }
  })

  test('adversarial: Given a missing or unsupported UI language, when read with the app\'s own schema, then it follows the OS', () => {
    for (const raw of [null, {}, { vimMode: true }, 'x', { uiLanguage: 'fr' }, { uiLanguage: 'JA' }, { uiLanguage: '' }, { uiLanguage: null }, { uiLanguage: ['ja'] }]) {
      expect(parseSettings(SETTINGS_SCHEMA, raw).uiLanguage).toBe('system')
    }
  })

  test('spec: Given the app\'s own schema and vim mode saved as on, when read, then vim mode is on', () => {
    expect(parseSettings(SETTINGS_SCHEMA, { vimMode: true })).toEqual({ uiLanguage: 'system', vimMode: true })
  })

  test('adversarial: Given the app\'s own schema and no valid vim mode saved, when read, then vim mode is off', () => {
    for (const raw of [null, {}, { vimMode: 'true' }, { vimMode: 1 }, { vimMode: null }, 'x', [true]]) {
      expect(parseSettings(SETTINGS_SCHEMA, raw).vimMode).toBe(false)
    }
  })

  test('property: whatever arrives, every setting read is one its field accepts', () => {
    fc.assert(fc.property(fc.anything(), raw => {
      const read = parseSettings(SAMPLE, raw)
      return SAMPLE.vimMode.accepts(read.vimMode) && SAMPLE.uiLanguage.accepts(read.uiLanguage)
    }))
  })
})

describe('overlaySettings', () => {
  test('spec: Given current settings and a change to one, when applied, then only that setting changes', () => {
    expect(overlaySettings(SAMPLE, { vimMode: false, uiLanguage: 'ja' }, { vimMode: true })).toEqual({ vimMode: true, uiLanguage: 'ja' })
  })

  test('adversarial: Given an invalid value, when applied, then the current value is kept rather than reset', () => {
    const current: Sample = { vimMode: true, uiLanguage: 'ja' }
    expect(overlaySettings(SAMPLE, current, { uiLanguage: 'fr', vimMode: null })).toEqual(current)
  })

  test('adversarial: Given a change, when applied, then the current settings object is left untouched', () => {
    const current: Sample = { vimMode: false, uiLanguage: 'en' }
    const next = overlaySettings(SAMPLE, current, { vimMode: true })
    expect(current).toEqual({ vimMode: false, uiLanguage: 'en' })
    expect(next).not.toBe(current)
  })

  test('property: a valid change is taken as is, and applying it again changes nothing', () => {
    const sampleArb = fc.record({ vimMode: fc.boolean(), uiLanguage: fc.constantFrom('en' as const, 'ja' as const) })
    fc.assert(fc.property(sampleArb, sampleArb, (current, change) => {
      const next = overlaySettings(SAMPLE, current, change)
      return JSON.stringify(overlaySettings(SAMPLE, next, next)) === JSON.stringify(next)
        && next.vimMode === change.vimMode && next.uiLanguage === change.uiLanguage
    }))
  })
})
