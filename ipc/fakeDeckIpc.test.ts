import { describe, expect, test } from 'bun:test'
import { createFakeDeckIpc } from './fakeDeckIpc'

describe('createFakeDeckIpc', () => {
  test('spec: default methods resolve and record their call', async () => {
    const ipc = createFakeDeckIpc()
    await ipc.saveDeckSource('# Hello')
    expect(ipc.calls).toEqual([{ method: 'saveDeckSource', args: ['# Hello'] }])
  })

  test('spec: createDeck joins parentDir/name/deck.md and records every arg', async () => {
    const ipc = createFakeDeckIpc()
    const path = await ipc.createDeck('/tmp', 'talk', { aspect_ratio: '4:3', lang: 'ja' })
    expect(path).toBe('/tmp/talk/deck.md')
    expect(ipc.calls).toEqual([{ method: 'createDeck', args: ['/tmp', 'talk', { aspect_ratio: '4:3', lang: 'ja' }] }])
  })

  test('spec: openDeck echoes the given path into deckPath/deckDir with an empty render', async () => {
    const ipc = createFakeDeckIpc()
    const info = await ipc.openDeck('/tmp/deck.md')
    expect(info.deckPath).toBe('/tmp/deck.md')
    expect(info.render.kind).toBe('rendered')
    if (info.render.kind === 'rendered') expect(info.render.manifest.slides).toEqual([])
  })

  test('spec: an openDeck override can answer a failed render, as open_deck does for a deck peitho-core refuses', async () => {
    const error = { kind: 'Parse', line: 3, originFile: null, message: 'm', help: 'h', headline: 'line 3: m', slide: null }
    const ipc = createFakeDeckIpc({ openDeck: async path => ({ deckPath: path, deckDir: '/tmp', trusted: false, render: { kind: 'failed', error } }) })
    const info = await ipc.openDeck('/tmp/deck.md')
    expect(info.render).toEqual({ kind: 'failed', error })
  })

  test('spec: listDeckVariants defaults to no variants (a lone deck) and records the call', async () => {
    const ipc = createFakeDeckIpc()
    expect(await ipc.listDeckVariants()).toEqual([])
    expect(ipc.calls).toEqual([{ method: 'listDeckVariants', args: [] }])
  })

  test('spec: checkSlideLayouts defaults to "nothing to judge" and records both args', async () => {
    const ipc = createFakeDeckIpc()
    expect(await ipc.checkSlideLayouts('# One\n', 0)).toBeNull()
    expect(ipc.calls).toEqual([{ method: 'checkSlideLayouts', args: ['# One\n', 0] }])
  })

  test('spec: addImageLayout defaults to writing nothing and records both args', async () => {
    const ipc = createFakeDeckIpc()
    expect(await ipc.addImageLayout('# One\n', 0)).toEqual([])
    expect(ipc.calls).toEqual([{ method: 'addImageLayout', args: ['# One\n', 0] }])
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

  test('spec: Given a layout-files and a flush-before-close subscriber, When each event is emitted, Then only its own subscriber hears it, until unsubscribed', () => {
    const ipc = createFakeDeckIpc()
    const heard: string[] = []
    const stopFiles = ipc.onLayoutFilesChanged(() => { heard.push('files') })
    ipc.onLayoutFlushBeforeClose(() => { heard.push('flush') })
    ipc.emitLayoutFilesChanged()
    ipc.emitLayoutFlushBeforeClose()
    stopFiles()
    ipc.emitLayoutFilesChanged()
    expect(heard).toEqual(['files', 'flush'])
  })

  test('spec: saveDeckFile resolves with a fingerprint and reportLayoutDraft records whether a draft is pending', async () => {
    const ipc = createFakeDeckIpc()
    expect(await ipc.saveDeckFile('src', 'css/base.css', 'a {}')).toBe('')
    await ipc.reportLayoutDraft(true)
    expect(ipc.calls.at(-1)).toEqual({ method: 'reportLayoutDraft', args: [true] })
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

  test('spec: menu Undo and Redo reach only their own subscribers', () => {
    const ipc = createFakeDeckIpc()
    const heard: string[] = []
    ipc.onMenuUndo(() => { heard.push('undo') })
    ipc.onMenuRedo(() => { heard.push('redo') })
    ipc.emitMenuUndo()
    ipc.emitMenuRedo()
    ipc.emitMenuUndo()
    expect(heard).toEqual(['undo', 'redo', 'undo'])
  })

  test('adversarial: menu Undo after unsubscribing, or with no subscriber, does nothing', () => {
    const ipc = createFakeDeckIpc()
    expect(() => { ipc.emitMenuUndo() }).not.toThrow()
    let count = 0
    const unsubscribe = ipc.onMenuRedo(() => { count++ })
    unsubscribe()
    ipc.emitMenuRedo()
    expect(count).toBe(0)
  })

  test('spec: onPresentReady subscribes, emitPresentReady fires every subscriber', () => {
    const ipc = createFakeDeckIpc()
    let a = 0
    let b = 0
    ipc.onPresentReady(() => { a++ })
    ipc.onPresentReady(() => { b++ })
    ipc.emitPresentReady()
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  test('adversarial: emitting with no subscribers does nothing (no throw)', () => {
    const ipc = createFakeDeckIpc()
    expect(() => { ipc.emitDeckFileChanged() }).not.toThrow()
    expect(() => { ipc.emitPresentReady() }).not.toThrow()
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
