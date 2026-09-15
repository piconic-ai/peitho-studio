import { describe, expect, test } from 'bun:test'
import { createRoot } from '@barefootjs/client'
import { createDeckStore } from './deckStore'

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

      store.setDeckLifecycle({ kind: 'naming-new-deck', parentDir: '/a', name: '' })
      expect(store.showEditor()).toBe(false)

      store.setDeckLifecycle({ kind: 'creating', parentDir: '/a', name: 'talk' })
      expect(store.showEditor()).toBe(false)
    })
  })
})
