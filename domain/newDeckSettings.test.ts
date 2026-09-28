import { describe, expect, test } from 'bun:test'
import { DECK_SETTING_CHOICES, frontmatterValueOf } from './deckSettings'
import {
  NEW_DECK_SETTING_KEYS,
  type NewDeckSettingPick,
  applyNewDeckSettingPick,
  defaultNewDeckSettings,
  newDeckChoiceLabel,
} from './newDeckSettings'

const ALL_PICKS: NewDeckSettingPick[] = NEW_DECK_SETTING_KEYS.flatMap(key =>
  DECK_SETTING_CHOICES[key].map(choice => ({ key, choice }) as NewDeckSettingPick),
)

describe('defaultNewDeckSettings', () => {
  test('spec: given the dialog opens, then every setting is at the default the Edit menu writes by removing the key', () => {
    const settings = defaultNewDeckSettings()
    expect(settings).toEqual({ aspect_ratio: '16:9', lang: 'en' })
    for (const key of NEW_DECK_SETTING_KEYS) expect(frontmatterValueOf(key, settings[key])).toBeNull()
  })

  test('adversarial: given an earlier opening\'s settings were changed in place, then the next opening still gets the defaults', () => {
    const first = defaultNewDeckSettings()
    first.lang = 'ja'
    expect(defaultNewDeckSettings()).not.toBe(first)
    expect(defaultNewDeckSettings()).toEqual({ aspect_ratio: '16:9', lang: 'en' })
  })
})

describe('applyNewDeckSettingPick', () => {
  test('spec: given 4:3 is picked, then only the aspect ratio changes', () => {
    expect(applyNewDeckSettingPick({ aspect_ratio: '16:9', lang: 'ja' }, { key: 'aspect_ratio', choice: '4:3' }))
      .toEqual({ aspect_ratio: '4:3', lang: 'ja' })
  })

  test('spec: given 日本語 is picked, then only the language changes', () => {
    expect(applyNewDeckSettingPick({ aspect_ratio: '4:3', lang: 'en' }, { key: 'lang', choice: 'ja' }))
      .toEqual({ aspect_ratio: '4:3', lang: 'ja' })
  })

  test('adversarial: given the current choice is picked again, then the settings are equal and the input is untouched', () => {
    const settings = defaultNewDeckSettings()
    for (const pick of ALL_PICKS) {
      const next = applyNewDeckSettingPick(settings, pick)
      expect(next[pick.key]).toBe(pick.choice)
      expect(Object.keys(next).sort()).toEqual([...NEW_DECK_SETTING_KEYS].sort())
    }
    expect(settings).toEqual({ aspect_ratio: '16:9', lang: 'en' })
  })
})

describe('newDeckChoiceLabel', () => {
  test('spec: given a ratio, then it reads as written; given a language, then in its own name', () => {
    expect(ALL_PICKS.map(pick => newDeckChoiceLabel(pick.key, pick.choice))).toEqual(['16:9', '4:3', 'English', '日本語'])
  })

  test('adversarial: given every choice, then no label is empty and no two labels of a key collide', () => {
    for (const key of NEW_DECK_SETTING_KEYS) {
      const labels = ALL_PICKS.filter(pick => pick.key === key).map(pick => newDeckChoiceLabel(pick.key, pick.choice))
      expect(labels.every(label => label.trim() !== '')).toBe(true)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })
})
