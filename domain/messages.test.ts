import { describe, expect, test } from 'bun:test'
import { LANGUAGES, type Language } from './language'
import { LANGUAGE_NAMES, messagesFor, type Messages } from './messages'

// Every message rendered as text: plain strings as they are, message
// functions called with sample arguments.
function rendered(messages: Messages): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages)) {
    out[key] = typeof value === 'function' ? (value as (...args: unknown[]) => string)('ARG1', 'ARG2') : value
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
      const mismatch = messages.layoutMismatch('cover', "missing 'body' slot")
      expect(mismatch).toContain('cover')
      expect(mismatch).toContain("missing 'body' slot")
    }
  })

  test('spec: Given English, when a layout mismatch is worded, then it reads as before the UI was translated', () => {
    expect(messagesFor('en').layoutMismatch('cover', 'why')).toBe('"cover" doesn\'t fit this slide: why')
  })

  test('spec: Given both languages, when their messages are compared, then they have exactly the same keys', () => {
    const keysOf = (language: Language) => Object.keys(messagesFor(language)).sort()
    expect(keysOf('ja')).toEqual(keysOf('en'))
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
