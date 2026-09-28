import { describe, expect, test } from 'bun:test'
import { createRoot } from '@barefootjs/client'
import { createDeckStore } from './deckStore'
import { defaultNewDeckSettings } from '../domain/newDeckSettings'

const DEFAULTS = defaultNewDeckSettings()

describe('showEditor', () => {
  test('spec: true for opening and open, so the editor shell appears the instant a click is handled — before deckPath() has any value', () => {
    createRoot(() => {
      const store = createDeckStore()
      store.setDeckLifecycle({ kind: 'opening', path: '/a/deck.md' })
      expect(store.showEditor()).toBe(true)
      expect(store.deckPath()).toBeNull()

      store.setDeckLifecycle({ kind: 'open', deckPath: '/a/deck.md' })
      expect(store.showEditor()).toBe(true)
      expect(store.deckPath()).toBe('/a/deck.md')
    })
  })

  test('adversarial: false for welcome, naming-new-deck, and creating — WelcomeScreen (and NewDeckModal on top of it) stays up through the whole New Deck flow until the created deck actually starts opening', () => {
    createRoot(() => {
      const store = createDeckStore()
      expect(store.showEditor()).toBe(false)

      store.setDeckLifecycle({ kind: 'naming-new-deck', parentDir: '/a', name: '', settings: DEFAULTS })
      expect(store.showEditor()).toBe(false)

      store.setDeckLifecycle({ kind: 'creating', parentDir: '/a', name: 'talk', settings: DEFAULTS })
      expect(store.showEditor()).toBe(false)
    })
  })
})

describe('newDeckSettings', () => {
  test('spec: given the dialog holds 4:3 and 日本語, then it shows them while naming and while creating', () => {
    createRoot(() => {
      const store = createDeckStore()
      const picked = { aspect_ratio: '4:3', lang: 'ja' } as const
      store.setDeckLifecycle({ kind: 'naming-new-deck', parentDir: '/a', name: 'talk', settings: picked })
      expect(store.newDeckSettings()).toEqual(picked)

      store.setDeckLifecycle({ kind: 'creating', parentDir: '/a', name: 'talk', settings: picked })
      expect(store.newDeckSettings()).toEqual(picked)
    })
  })

  test('adversarial: given no dialog is open, then it reads as the defaults, not a leftover pick', () => {
    createRoot(() => {
      const store = createDeckStore()
      expect(store.newDeckSettings()).toEqual(DEFAULTS)

      store.setDeckLifecycle({ kind: 'naming-new-deck', parentDir: '/a', name: '', settings: { aspect_ratio: '4:3', lang: 'ja' } })
      store.setDeckLifecycle({ kind: 'opening', path: '/a/talk/deck.md' })
      expect(store.newDeckSettings()).toEqual(DEFAULTS)
    })
  })
})
