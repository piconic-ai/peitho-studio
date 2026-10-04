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

describe('the layout list\'s right-click menu', () => {
  test('spec: Given a right-click on a layout with a slide to apply it to, When the fit check answers, Then the menu settles with it', () => {
    createRoot(() => {
      const layouts = createLayoutScreenStore()
      const requestId = layouts.openMenuOnLayout('quote', 10, 20, true)
      expect(requestId).not.toBeNull()
      expect(layouts.menu()).toMatchObject({ kind: 'on-layout', name: 'quote', fit: { kind: 'checking' } })
      layouts.settleMenuFit(requestId!, [{ layout: 'quote', fit: { kind: 'fits' } }])
      expect(layouts.menu()).toMatchObject({ fit: { kind: 'checked' } })
      layouts.closeMenu()
      expect(layouts.menu().kind).toBe('closed')
    })
  })

  test('adversarial: Given a second right-click before the first check answers, Then the first answer is dropped', () => {
    createRoot(() => {
      const layouts = createLayoutScreenStore()
      const first = layouts.openMenuOnLayout('quote', 0, 0, true)!
      const second = layouts.openMenuOnLayout('title-body', 0, 0, true)!
      expect(second).not.toBe(first)
      layouts.settleMenuFit(first, [])
      expect(layouts.menu()).toMatchObject({ name: 'title-body', fit: { kind: 'checking' } })
    })
  })

  test('adversarial: Given no slide to check against, or empty space, Then nothing waits on a check, and a move keeps what it targets', () => {
    createRoot(() => {
      const layouts = createLayoutScreenStore()
      expect(layouts.openMenuOnLayout('quote', 0, 0, false)).toBeNull()
      expect(layouts.menu()).toMatchObject({ fit: { kind: 'unavailable' } })
      layouts.moveMenu({ x: 3, y: 4 })
      expect(layouts.menu()).toMatchObject({ name: 'quote', x: 3, y: 4 })
      layouts.openMenuOnList(5, 6)
      expect(layouts.menu()).toEqual({ kind: 'on-list', x: 5, y: 6 })
    })
  })
})

describe('the layout editor\'s live preview', () => {
  test('spec: Given two requests, When the older one answers last, Then the newer one\'s draft stays; a reset drops both', () => {
    createRoot(() => {
      const layouts = createLayoutScreenStore()
      const older = layouts.requestPreview('quote')
      const newer = layouts.requestPreview('quote')
      layouts.previewRendered(newer, { fragment: 'new', css: '' })
      layouts.previewRendered(older, { fragment: 'old', css: '' })
      expect(layouts.draftPreview().shown?.fragment).toBe('new')
      layouts.previewFailed(older, 'stale')
      expect(layouts.draftPreview().error).toBeNull()
      layouts.resetPreview()
      layouts.previewRendered(newer, { fragment: 'late', css: '' })
      expect(layouts.draftPreview().shown).toBeNull()
    })
  })
})

describe('the layout list\'s width', () => {
  test('spec: Given the screen not laid out yet, When it first is, Then the list takes the width worked out from it; a later layout leaves it alone', () => {
    createRoot(() => {
      const layouts = createLayoutScreenStore()
      layouts.settleListWidth(480)
      expect(layouts.listWidth()).toBe(480)
      layouts.settleListWidth(300)
      expect(layouts.listWidth()).toBe(480)
    })
  })

  test('spec: Given the divider dragged before the screen was laid out, When it is, Then the dragged width stays', () => {
    createRoot(() => {
      const layouts = createLayoutScreenStore()
      layouts.setListWidth(350)
      layouts.settleListWidth(480)
      expect(layouts.listWidth()).toBe(350)
    })
  })

  test('adversarial: Given a layout with no width to settle on (null), Then the list keeps its fallback and the next real layout still settles it', () => {
    createRoot(() => {
      const layouts = createLayoutScreenStore()
      const fallback = layouts.listWidth()
      layouts.settleListWidth(null)
      expect(layouts.listWidth()).toBe(fallback)
      layouts.settleListWidth(500)
      expect(layouts.listWidth()).toBe(500)
    })
  })
})
