import { describe, expect, test } from 'bun:test'
import { createRoot } from '@barefootjs/client'
import { createUiStore } from './uiStore'
import { chooseLayout, layoutFitOf, layoutNoticeOf } from '../domain/contextMenu'
import type { LayoutVerdict } from '../domain/layoutFit'

const VERDICTS: LayoutVerdict[] = [
  { layout: 'cover', fit: { kind: 'mismatch', reason: "unassigned content remains for missing 'body' slot" } },
  { layout: 'statement', fit: { kind: 'fits' } },
]

describe('layout fit check on the context menu', () => {
  test('spec: Given a right-click on a slide, when its fit check answers, then the picker knows which layouts fit', () => {
    createRoot(() => {
      const store = createUiStore()
      const requestId = store.openSlideContextMenu(1, 10, 20)
      expect(layoutFitOf(store.contextMenu())).toEqual({ kind: 'checking', requestId })

      store.settleLayoutFit(requestId, VERDICTS)

      expect(layoutFitOf(store.contextMenu())).toEqual({ kind: 'checked', verdicts: VERDICTS })
    })
  })

  test('spec: Given a checked slide, when a layout it does not fit is chosen and refused, then the notice shows until the menu closes', () => {
    createRoot(() => {
      const store = createUiStore()
      store.settleLayoutFit(store.openSlideContextMenu(1, 10, 20), VERDICTS)

      const choice = chooseLayout(store.contextMenu(), 'cover')
      if (choice.kind !== 'reject') throw new Error(`expected a refusal, got ${choice.kind}`)
      store.showLayoutNotice(choice.notice)
      expect(layoutNoticeOf(store.contextMenu())).toBe(choice.notice)

      store.closeContextMenu()
      expect(layoutNoticeOf(store.contextMenu())).toBeNull()
    })
  })

  test('adversarial: every right-click gets a fresh request id, so the earlier one\'s late answer is dropped', () => {
    createRoot(() => {
      const store = createUiStore()
      const first = store.openSlideContextMenu(0, 0, 0)
      const second = store.openSlideContextMenu(1, 0, 0)
      expect(second).not.toBe(first)

      store.settleLayoutFit(first, VERDICTS)
      expect(layoutFitOf(store.contextMenu())).toEqual({ kind: 'checking', requestId: second })

      store.settleLayoutFit(second, null)
      expect(layoutFitOf(store.contextMenu())).toEqual({ kind: 'unavailable' })
    })
  })

  test('adversarial: an answer after the menu closed does not reopen it', () => {
    createRoot(() => {
      const store = createUiStore()
      const requestId = store.openSlideContextMenu(0, 0, 0)
      store.closeContextMenu()
      store.settleLayoutFit(requestId, VERDICTS)
      store.showLayoutNotice('late')
      expect(store.contextMenu()).toEqual({ kind: 'closed' })
    })
  })

  test('adversarial: toggling the picker keeps the settled check and the notice', () => {
    createRoot(() => {
      const store = createUiStore()
      store.settleLayoutFit(store.openSlideContextMenu(0, 0, 0), VERDICTS)
      store.showLayoutNotice('why')
      store.toggleLayoutPicker()
      store.toggleLayoutPicker()
      expect(layoutFitOf(store.contextMenu())).toEqual({ kind: 'checked', verdicts: VERDICTS })
      expect(layoutNoticeOf(store.contextMenu())).toBe('why')
    })
  })
})

describe('layoutPreviewStylesheetText', () => {
  test('spec: strips @font-face and scopes :root to :host, unabsolutized', () => {
    createRoot(() => {
      const store = createUiStore()
      store.setLayoutPreviewCss('@font-face { src: url("theme-fonts/Inter.woff2"); }\n:root { --x: 1px; } .peitho-slide { color: red; }')
      expect(store.layoutPreviewStylesheetText()).not.toContain('@font-face')
      // Unlike renderStore's slideStylesheetText, this is never
      // absolutized — preview_layouts never touches the asset server.
      expect(store.layoutPreviewStylesheetText()).not.toContain('theme-fonts/Inter.woff2')
      expect(store.layoutPreviewStylesheetText()).toContain(':host { --x: 1px; }')
      expect(store.layoutPreviewStylesheetText()).toContain('.peitho-slide { color: red; }')
    })
  })

  test('adversarial: CSS with no @font-face leaves the rest unchanged', () => {
    createRoot(() => {
      const store = createUiStore()
      store.setLayoutPreviewCss('.peitho-slide { color: red; }')
      expect(store.layoutPreviewStylesheetText()).toBe('.peitho-slide { color: red; }')
    })
  })

  test('adversarial: no layout preview loaded yet reads as empty, not throwing', () => {
    createRoot(() => {
      const store = createUiStore()
      expect(store.layoutPreviewStylesheetText()).toBe('')
    })
  })

  test('adversarial: a later load re-derives from the new css, not a frozen one', () => {
    createRoot(() => {
      const store = createUiStore()
      store.setLayoutPreviewCss(':root { --x: 1px; }')
      store.setLayoutPreviewCss(':root { --x: 2px; }')
      expect(store.layoutPreviewStylesheetText()).toBe(':host { --x: 2px; }')
    })
  })
})

describe('preview viewport mode', () => {
  test('spec: Given a fresh session, when nothing was toggled, then the preview shows PC display', () => {
    createRoot(() => {
      expect(createUiStore().viewportMode()).toBe('desktop')
    })
  })

  test('spec: Given PC display, when the toggle is pressed, then phone display shows, and pressing again returns to PC display', () => {
    createRoot(() => {
      const store = createUiStore()
      store.toggleViewportMode()
      expect(store.viewportMode()).toBe('mobile')
      store.toggleViewportMode()
      expect(store.viewportMode()).toBe('desktop')
    })
  })

  test('adversarial: an odd number of rapid presses ends on phone display, an even number on PC display', () => {
    createRoot(() => {
      const store = createUiStore()
      for (let presses = 1; presses <= 9; presses += 1) {
        store.toggleViewportMode()
        expect(store.viewportMode()).toBe(presses % 2 === 1 ? 'mobile' : 'desktop')
      }
    })
  })

  test('adversarial: each store instance keeps its own mode (a second window does not follow the first)', () => {
    createRoot(() => {
      const first = createUiStore()
      const second = createUiStore()
      first.toggleViewportMode()
      expect(first.viewportMode()).toBe('mobile')
      expect(second.viewportMode()).toBe('desktop')
    })
  })

  test('adversarial: toggling leaves the other UI state alone', () => {
    createRoot(() => {
      const store = createUiStore()
      store.setSlideListWidth(300)
      store.setPresentMenuOpen(true)
      store.toggleViewportMode()
      expect(store.slideListWidth()).toBe(300)
      expect(store.presentMenuOpen()).toBe(true)
      expect(store.contextMenu()).toEqual({ kind: 'closed' })
    })
  })
})
