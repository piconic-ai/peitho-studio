import { describe, expect, test } from 'bun:test'
import { LANGUAGES, type Language } from './language'
import { LANGUAGE_NAMES, messagesFor, type Messages } from './messages'
import { DEVICE_PRESETS } from './viewport'

// Every message rendered as text: plain strings as they are, message
// functions called with sample arguments, and a table of names (such as
// `deviceNames`) flattened to one entry per name (`deviceNames.phone`).
function rendered(messages: Messages): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === 'function') out[key] = (value as (...args: unknown[]) => string)('ARG1', 'ARG2')
    else if (typeof value === 'object') for (const [name, text] of Object.entries(value as Record<string, string>)) out[`${key}.${name}`] = text
    else out[key] = value
  }
  return out
}

describe('messagesFor', () => {
  test('spec: Given each language, when its messages are read, then the UI\'s words come back in that language', () => {
    expect(messagesFor('en').openDeck).toBe('Open Deck…')
    expect(messagesFor('ja').openDeck).toBe('デッキを開く…')
    expect(messagesFor('en').settings).toBe('Settings')
    expect(messagesFor('ja').settings).toBe('設定')
  })

  test('spec: Given a message with details, when worded, then the details appear in the text', () => {
    for (const language of LANGUAGES) {
      const messages = messagesFor(language)
      expect(messages.openedDeck('/decks/talk/deck.md')).toContain('/decks/talk/deck.md')
      expect(messages.slideFallbackTitle(3)).toContain('3')
      expect(messages.previewScaledDown(75)).toContain('75%')
      expect(messages.unsupportedImageFiles('diagram.svg, notes.txt')).toContain('diagram.svg, notes.txt')
      expect(messages.imageImportFailed('permission denied')).toContain('permission denied')
      expect(messages.imageLayoutAddFailed('already exists')).toContain('already exists')
      expect(messages.layoutActionFailed('slide 2 is on it')).toContain('slide 2 is on it')
      expect(messages.deleteLayoutConfirm('quote')).toContain('quote')
      expect(messages.layoutAlreadyApplied('quote')).toContain('quote')
      expect(messages.layoutDeletedHistoryCleared('quote')).toContain('quote')
      expect(messages.deleteLayoutMoveSlides('quote', 3)).toContain('quote')
      expect(messages.deleteLayoutMoveSlides('quote', 3)).toContain('3')
      const mismatch = messages.layoutMismatch('cover', "missing 'body' slot")
      expect(mismatch).toContain('cover')
      expect(mismatch).toContain("missing 'body' slot")
    }
  })

  test('spec: Given a layout\'s slide count, when worded, then none, one and several read differently in English', () => {
    const en = messagesFor('en')
    expect(en.layoutUsage(0)).toBe('Unused')
    expect(en.layoutUsage(1)).toBe('1 slide')
    expect(en.layoutUsage(12)).toBe('12 slides')
    expect(messagesFor('ja').layoutUsage(2)).toContain('2')
  })

  test('spec: Given English, when a layout mismatch is worded, then it reads as before the UI was translated', () => {
    expect(messagesFor('en').layoutMismatch('cover', 'why')).toBe('"cover" doesn\'t fit this slide: why')
  })

  test('spec: Given both languages, when their messages are compared, then they have exactly the same keys', () => {
    const keysOf = (language: Language) => Object.keys(rendered(messagesFor(language))).sort()
    expect(keysOf('ja')).toEqual(keysOf('en'))
  })

  test('spec: Given the phone shape menu, when its devices are named, then every preset has a name in each language, and no two share one', () => {
    for (const language of LANGUAGES) {
      const names = DEVICE_PRESETS.map(preset => messagesFor(language).deviceNames[preset.id])
      for (const name of names) expect(typeof name === 'string' && name.trim() !== '').toBe(true)
      expect(new Set(names).size).toBe(DEVICE_PRESETS.length)
    }
    expect(messagesFor('en').deviceNames['small-phone']).toBe('Small phone')
    expect(messagesFor('ja').deviceNames['large-phone']).toBe('大きめのスマホ')
  })

  test('adversarial: Given a device id that is not a preset (past the type checker), when its name is looked up, then nothing comes back rather than an inherited member', () => {
    for (const language of LANGUAGES) {
      const names = messagesFor(language).deviceNames as Record<string, string>
      expect(Object.keys(names).sort()).toEqual(DEVICE_PRESETS.map(preset => preset.id).sort())
      expect(names.deck).toBeUndefined()
    }
  })

  test('spec: Given every language, when each message is worded, then none is blank', () => {
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(rendered(messagesFor(language)))) {
        expect({ key, blank: text.trim() === '' }).toEqual({ key, blank: false })
      }
    }
  })

  test('spec: Given Japanese, when its messages are read, then the prose is actually translated, not left in English', () => {
    // Words that read the same in both (the "PC" label) are the exception.
    const same = new Set(['previewPc'])
    const en = rendered(messagesFor('en'))
    const ja = rendered(messagesFor('ja'))
    const untranslated = Object.keys(en).filter(key => !same.has(key) && en[key] === ja[key])
    expect(untranslated).toEqual([])
  })

  test('adversarial: Given a message with empty or markup-like details, when worded, then they are inserted verbatim', () => {
    for (const language of LANGUAGES) {
      const messages = messagesFor(language)
      expect(messages.openedDeck('')).not.toContain('undefined')
      expect(messages.layoutMismatch('<b>x</b>', 'line1\nline2')).toContain('<b>x</b>')
      expect(messages.layoutMismatch('<b>x</b>', 'line1\nline2')).toContain('line1\nline2')
      expect(messages.slideFallbackTitle(0)).toContain('0')
    }
  })

  test('adversarial: Given a language that isn\'t supported (past the type checker), when read, then English is used rather than nothing', () => {
    for (const unknown of ['fr', '', 'EN', 'toString', '__proto__']) {
      expect(messagesFor(unknown as Language)).toBe(messagesFor('en'))
    }
  })
})

describe('LANGUAGE_NAMES', () => {
  test('spec: Given the language picker, when each language is listed, then it is named in its own language', () => {
    expect(LANGUAGE_NAMES).toEqual({ en: 'English', ja: '日本語' })
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...LANGUAGES].sort())
  })
})
