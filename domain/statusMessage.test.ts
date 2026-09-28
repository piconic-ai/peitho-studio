import { describe, expect, test } from 'bun:test'
import { messagesFor } from './messages'
import { statusText, type StatusMessage } from './statusMessage'

const EVERY_STATUS: StatusMessage[] = [
  { kind: 'opened', deckPath: '/decks/talk/deck.md' },
  { kind: 'saved' },
  { kind: 'undone' },
  { kind: 'redone' },
  { kind: 'history-cleared' },
  { kind: 'merged-external-change' },
  { kind: 'reloaded-external-change' },
  { kind: 'presenting', rehearsal: false },
  { kind: 'presenting', rehearsal: true },
  { kind: 'importing-images', count: 1 },
  { kind: 'importing-images', count: 2 },
  { kind: 'imported-images', count: 1 },
  { kind: 'imported-images', count: 3 },
  { kind: 'image-layout-added' },
]

describe('statusText', () => {
  test('spec: Given a saved slide, when worded in each language, then the status bar says so in that language', () => {
    expect(statusText(messagesFor('en'), { kind: 'saved' })).toBe('Saved')
    expect(statusText(messagesFor('ja'), { kind: 'saved' })).toBe('保存しました')
  })

  test('spec: Given an opened deck, when worded, then the status names the deck\'s path', () => {
    expect(statusText(messagesFor('en'), { kind: 'opened', deckPath: '/d/deck.md' })).toBe('Opened /d/deck.md')
    expect(statusText(messagesFor('ja'), { kind: 'opened', deckPath: '/d/deck.md' })).toContain('/d/deck.md')
  })

  test('spec: Given a presentation, when worded, then a rehearsal reads differently from a plain one', () => {
    const en = messagesFor('en')
    expect(statusText(en, { kind: 'presenting', rehearsal: false })).toBe('Presenting…')
    expect(statusText(en, { kind: 'presenting', rehearsal: true })).toBe('Presenting (rehearsal)…')
  })

  test('spec: Given images dropped or pasted into the body, when worded, then the status says while they are imported and how many were added', () => {
    const en = messagesFor('en')
    expect(statusText(en, { kind: 'importing-images', count: 1 })).toBe('Importing image…')
    expect(statusText(en, { kind: 'importing-images', count: 3 })).toBe('Importing 3 images…')
    expect(statusText(en, { kind: 'imported-images', count: 1 })).toBe('Image added to img/')
    expect(statusText(en, { kind: 'imported-images', count: 2 })).toBe('2 images added to img/')
    expect(statusText(messagesFor('ja'), { kind: 'imported-images', count: 2 })).toContain('2')
  })

  test('spec: Given the image layout was added from the error bar, when worded, then the status names the layout and where it went', () => {
    const text = statusText(messagesFor('en'), { kind: 'image-layout-added' })
    expect(text).toContain('title-body-image')
    expect(text).toContain('layouts/')
  })

  test('spec: Given nothing to report, when worded, then the status bar is empty', () => {
    expect(statusText(messagesFor('en'), { kind: 'none' })).toBe('')
    expect(statusText(messagesFor('ja'), { kind: 'none' })).toBe('')
  })

  test('adversarial: Given every status, when worded in each language, then none is blank and the two languages differ', () => {
    for (const status of EVERY_STATUS) {
      const en = statusText(messagesFor('en'), status)
      const ja = statusText(messagesFor('ja'), status)
      expect(en.trim()).not.toBe('')
      expect(ja.trim()).not.toBe('')
      expect(ja).not.toBe(en)
    }
  })

  test('adversarial: Given an opened deck with an empty path, when worded, then no placeholder text leaks', () => {
    expect(statusText(messagesFor('en'), { kind: 'opened', deckPath: '' })).not.toContain('undefined')
  })
})
