import { describe, expect, test } from 'bun:test'
import { createFakeDeckIpc } from './fakeDeckIpc'

describe('createFakeDeckIpc', () => {
  test('spec: default methods resolve and record their call', async () => {
    const ipc = createFakeDeckIpc()
    await ipc.saveDeckSource('# Hello')
    expect(ipc.calls).toEqual([{ method: 'saveDeckSource', args: ['# Hello'] }])
  })

  test('spec: createDeck joins parentDir/name/deck.md and records both args', async () => {
    const ipc = createFakeDeckIpc()
    const path = await ipc.createDeck('/tmp', 'talk')
    expect(path).toBe('/tmp/talk/deck.md')
    expect(ipc.calls).toEqual([{ method: 'createDeck', args: ['/tmp', 'talk'] }])
  })

  test('spec: openDeck echoes the given path into deckPath/deckDir with an empty render', async () => {
    const ipc = createFakeDeckIpc()
    const info = await ipc.openDeck('/tmp/deck.md')
    expect(info.deckPath).toBe('/tmp/deck.md')
    expect(info.render.manifest.slides).toEqual([])
  })

  test('spec: an override replaces the default behavior and is not auto-recorded', async () => {
    const ipc = createFakeDeckIpc({ getRecentDecks: async () => ['/a/deck.md', '/b/deck.md'] })
    expect(await ipc.getRecentDecks()).toEqual(['/a/deck.md', '/b/deck.md'])
    expect(ipc.calls).toEqual([])
  })

  test('spec: onDeckFileChanged subscribes, emitDeckFileChanged fires every subscriber', () => {
    const ipc = createFakeDeckIpc()
    let a = 0
    let b = 0
    ipc.onDeckFileChanged(() => { a++ })
    ipc.onDeckFileChanged(() => { b++ })
    ipc.emitDeckFileChanged()
    ipc.emitDeckFileChanged()
    expect(a).toBe(2)
    expect(b).toBe(2)
  })

  test('spec: the Unsubscribe returned by onMenuNewDeck stops further callbacks', () => {
    const ipc = createFakeDeckIpc()
    let count = 0
    const unsubscribe = ipc.onMenuNewDeck(() => { count++ })
    ipc.emitMenuNewDeck()
    unsubscribe()
    ipc.emitMenuNewDeck()
    expect(count).toBe(1)
  })

  test('adversarial: emitting with no subscribers does nothing (no throw)', () => {
    const ipc = createFakeDeckIpc()
    expect(() => { ipc.emitDeckFileChanged() }).not.toThrow()
  })

  test('adversarial: unsubscribing twice is a no-op, not an error', () => {
    const ipc = createFakeDeckIpc()
    const unsubscribe = ipc.onDeckFileChanged(() => {})
    unsubscribe()
    expect(() => { unsubscribe() }).not.toThrow()
  })

  test('adversarial: the same callback reference subscribed twice via separate calls fires once per emit per registration', () => {
    const ipc = createFakeDeckIpc()
    let count = 0
    const cb = () => { count++ }
    ipc.onDeckFileChanged(cb)
    ipc.onDeckFileChanged(cb)
    ipc.emitDeckFileChanged()
    // A `Set` de-dupes the identical function reference — only one entry, so one call.
    expect(count).toBe(1)
  })
})
