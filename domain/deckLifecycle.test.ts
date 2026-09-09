import { describe, expect, test } from 'bun:test'
import { decide, isBusy, type DeckLifecycle } from './deckLifecycle'

describe('isBusy', () => {
  test('spec: creating and opening are busy', () => {
    expect(isBusy({ kind: 'creating', parentDir: '/a', name: 'b' })).toBe(true)
    expect(isBusy({ kind: 'opening', path: '/a' })).toBe(true)
  })

  test('adversarial: welcome, naming-new-deck, and open are not busy', () => {
    expect(isBusy({ kind: 'welcome' })).toBe(false)
    expect(isBusy({ kind: 'naming-new-deck', parentDir: '/a', name: 'b' })).toBe(false)
    expect(isBusy({ kind: 'open', deckPath: '/a' })).toBe(false)
  })
})

describe('decide', () => {
  describe('welcome', () => {
    const welcome: DeckLifecycle = { kind: 'welcome' }

    test('spec: open-requested transitions to opening and invokes the open IPC', () => {
      expect(decide(welcome, { type: 'open-requested', path: '/deck' })).toEqual({
        kind: 'transition',
        next: { kind: 'opening', path: '/deck' },
        effect: 'invoke-open',
      })
    })

    test('spec: new-deck-requested transitions to naming-new-deck with an empty name', () => {
      expect(decide(welcome, { type: 'new-deck-requested', parentDir: '/parent' })).toEqual({
        kind: 'transition',
        next: { kind: 'naming-new-deck', parentDir: '/parent', name: '' },
      })
    })

    test('adversarial: every other event is rejected as not-applicable', () => {
      expect(decide(welcome, { type: 'name-changed', name: 'x' })).toEqual({ kind: 'rejected', reason: 'not-applicable' })
      expect(decide(welcome, { type: 'create-confirmed' })).toEqual({ kind: 'rejected', reason: 'not-applicable' })
      expect(decide(welcome, { type: 'opened', deckPath: '/x' })).toEqual({ kind: 'rejected', reason: 'not-applicable' })
    })
  })

  describe('naming-new-deck', () => {
    const naming: DeckLifecycle = { kind: 'naming-new-deck', parentDir: '/parent', name: 'old' }

    test('spec: name-changed updates only the name, keeping parentDir', () => {
      expect(decide(naming, { type: 'name-changed', name: 'new' })).toEqual({
        kind: 'transition',
        next: { kind: 'naming-new-deck', parentDir: '/parent', name: 'new' },
      })
    })

    test('spec: create-confirmed transitions to creating and invokes the create IPC', () => {
      expect(decide(naming, { type: 'create-confirmed' })).toEqual({
        kind: 'transition',
        next: { kind: 'creating', parentDir: '/parent', name: 'old' },
        effect: 'invoke-create',
      })
    })

    test('spec: create-cancelled returns to welcome', () => {
      expect(decide(naming, { type: 'create-cancelled' })).toEqual({ kind: 'transition', next: { kind: 'welcome' } })
    })

    test('adversarial: create-confirmed with a blank/whitespace-only name is rejected as invalid, not sent to create_deck', () => {
      const blank: DeckLifecycle = { kind: 'naming-new-deck', parentDir: '/parent', name: '   ' }
      expect(decide(blank, { type: 'create-confirmed' })).toEqual({ kind: 'rejected', reason: 'invalid-name' })
    })

    test('adversarial: a second open/new-deck request while naming is rejected as busy', () => {
      expect(decide(naming, { type: 'open-requested', path: '/x' })).toEqual({ kind: 'rejected', reason: 'busy' })
      expect(decide(naming, { type: 'new-deck-requested', parentDir: '/y' })).toEqual({ kind: 'rejected', reason: 'busy' })
    })
  })

  describe('creating', () => {
    const creating: DeckLifecycle = { kind: 'creating', parentDir: '/parent', name: 'deck' }

    test('spec (bfa5577 regression): created always transitions to opening, never straight to open', () => {
      const result = decide(creating, { type: 'created', path: '/parent/deck' })
      expect(result).toEqual({
        kind: 'transition',
        next: { kind: 'opening', path: '/parent/deck' },
        effect: 'invoke-open',
      })
      // The regression this guards: a Decision that skipped straight to
      // `open` (or dropped the `invoke-open` effect) would silently
      // reintroduce "folder created but editor never shown".
      expect(result.kind === 'transition' && result.next.kind).toBe('opening')
    })

    test('spec: failed returns to naming-new-deck with the same parentDir/name (not welcome) so the user can retry', () => {
      expect(decide(creating, { type: 'failed', message: 'disk full' })).toEqual({
        kind: 'transition',
        next: { kind: 'naming-new-deck', parentDir: '/parent', name: 'deck' },
      })
    })

    test('adversarial: a request to open/create something else mid-flight is rejected as busy', () => {
      expect(decide(creating, { type: 'open-requested', path: '/x' })).toEqual({ kind: 'rejected', reason: 'busy' })
    })
  })

  describe('opening', () => {
    const opening: DeckLifecycle = { kind: 'opening', path: '/deck' }

    test('spec: opened transitions to open with the resolved deckPath', () => {
      expect(decide(opening, { type: 'opened', deckPath: '/deck' })).toEqual({
        kind: 'transition',
        next: { kind: 'open', deckPath: '/deck' },
      })
    })

    test('spec: failed returns to welcome (unlike creating, there is no name/parentDir worth preserving)', () => {
      expect(decide(opening, { type: 'failed', message: 'not found' })).toEqual({ kind: 'transition', next: { kind: 'welcome' } })
    })

    test('adversarial: a second request mid-flight is rejected as busy', () => {
      expect(decide(opening, { type: 'new-deck-requested', parentDir: '/x' })).toEqual({ kind: 'rejected', reason: 'busy' })
    })
  })

  describe('open', () => {
    const open: DeckLifecycle = { kind: 'open', deckPath: '/deck' }

    test('spec: open-requested spawns a second window, leaving this one on its own deck', () => {
      expect(decide(open, { type: 'open-requested', path: '/other' })).toEqual({
        kind: 'transition',
        next: { kind: 'open', deckPath: '/deck' },
        effect: 'spawn-window',
      })
    })

    test('adversarial: new-deck-requested is rejected as already-open, not silently ignored', () => {
      expect(decide(open, { type: 'new-deck-requested', parentDir: '/x' })).toEqual({ kind: 'rejected', reason: 'already-open' })
    })
  })
})
