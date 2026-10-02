import { describe, expect, test } from 'bun:test'
import { createRoot } from '@barefootjs/client'
import { createLayoutScreenStore } from './layoutScreenStore'
import { createUiStore } from './uiStore'
import { editorDraft } from '../domain/layoutEditor'

const NAMES = ['title-slide', 'title-body', 'quote']

describe('switching between the slides and layouts screens', () => {
  test('spec: Given a deck window, Then it starts on the slides screen, and the header switch moves it to layouts and back', () => {
    createRoot(() => {
      const ui = createUiStore()
      expect(ui.studioMode()).toBe('slides')
      ui.setStudioMode('layouts')
      expect(ui.studioMode()).toBe('layouts')
      ui.setStudioMode('slides')
      expect(ui.studioMode()).toBe('slides')
    })
  })

  test('spec: Given the slide context menu open, When the window switches to layouts, Then the menu closes so it can\'t act on a slide out of sight', () => {
    createRoot(() => {
      const ui = createUiStore()
      ui.openSlideContextMenu(1, 10, 20)
      ui.setStudioMode('layouts')
      expect(ui.contextMenu().kind).toBe('closed')
    })
  })

  test('adversarial: Given the mode already shown, When it is picked again, Then nothing else changes', () => {
    createRoot(() => {
      const ui = createUiStore()
      ui.openSlideContextMenu(1, 10, 20)
      ui.setStudioMode('slides')
      expect(ui.contextMenu().kind).toBe('on-slide')
    })
  })
})

describe('the layout screen\'s state', () => {
  test('spec: Given New Layout opened, Then the form starts empty on the blank template, and a name the deck has is flagged before sending', () => {
    createRoot(() => {
      const store = createLayoutScreenStore()
      store.setNewLayoutName('leftover')
      store.openNewLayout()
      expect(store.newLayoutOpen()).toBe(true)
      expect(store.newLayoutName()).toBe('')
      expect(store.newLayoutTemplate()).toBe('')
      expect(store.newLayoutNameProblem(NAMES)).toBe('empty')
      store.setNewLayoutName('Quote')
      expect(store.newLayoutNameProblem(NAMES)).toBe('taken')
      store.setNewLayoutName('pull-quote')
      expect(store.newLayoutNameProblem(NAMES)).toBeNull()
      store.closeNewLayout()
      expect(store.newLayoutOpen()).toBe(false)
    })
  })

  test('spec: Given a used layout, When Delete is confirmed only after a replacement is picked, Then the confirmed delete carries its slides and the replacement', () => {
    createRoot(() => {
      const store = createLayoutScreenStore()
      store.beginDelete('title-body', NAMES, [1, 3])
      expect(store.confirmDeleteFlow()).toBeNull()
      store.chooseReplacement('title-body', NAMES)
      expect(store.confirmDeleteFlow()).toBeNull()
      store.chooseReplacement('quote', NAMES)
      expect(store.confirmDeleteFlow()).toEqual({ kind: 'deleting', name: 'title-body', slides: [1, 3], replacement: 'quote' })
      store.cancelDeleteFlow()
      expect(store.deleteFlow().kind).toBe('deleting')
      store.finishDelete()
      expect(store.deleteFlow().kind).toBe('idle')
    })
  })

  test('spec: Given a layout\'s files arriving, Then the editor shows them; typing marks it unsaved and a landed save clears that', () => {
    createRoot(() => {
      const store = createLayoutScreenStore()
      store.editorLoading('quote')
      store.editorLoaded('quote', { html: '<section></section>', css: null })
      expect(editorDraft(store.editor())).toEqual({ html: '<section></section>', css: '' })
      store.typeInEditor('css', '.x {}')
      expect(store.editorDirty()).toBe(true)
      store.editorSaving()
      store.editorSaved('quote', editorDraft(store.editor()))
      expect(store.editorDirty()).toBe(false)
    })
  })

  test('adversarial: Given another layout selected while the first one\'s files were read, When they arrive late, Then they are dropped', () => {
    createRoot(() => {
      const store = createLayoutScreenStore()
      store.editorLoading('first')
      store.editorLoading('second')
      store.editorLoaded('first', { html: 'first', css: null })
      store.editorUnavailable('first', 'gone')
      expect(store.editor()).toEqual({ kind: 'loading', name: 'second' })
    })
  })

  test('spec: Given fresh previews, Then the generation moves on', () => {
    createRoot(() => {
      const store = createLayoutScreenStore()
      const before = store.previewGeneration()
      store.bumpPreviewGeneration()
      expect(store.previewGeneration()).toBe(before + 1)
    })
  })
})
