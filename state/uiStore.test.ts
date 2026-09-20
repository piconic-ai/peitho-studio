import { describe, expect, test } from 'bun:test'
import { createEffect, createRoot } from '@barefootjs/client'
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

describe('preview phone shape', () => {
  test('spec: Given a fresh session, when nothing was chosen, then phone display would be the tall phone shape', () => {
    createRoot(() => {
      expect(createUiStore().phoneShape()).toBe('portrait')
    })
  })

  test('spec: Given the tall shape, when the deck-ratio shape is selected by name, then the shape is that one, and selecting the tall one returns to it', () => {
    createRoot(() => {
      const store = createUiStore()
      store.selectPhoneShape('deck')
      expect(store.phoneShape()).toBe('deck')
      store.selectPhoneShape('portrait')
      expect(store.phoneShape()).toBe('portrait')
    })
  })

  test('spec: Given the deck-ratio shape chosen in phone display, when the user goes to PC display and back, then the shape is still the deck-ratio one', () => {
    createRoot(() => {
      const store = createUiStore()
      store.toggleViewportMode()
      store.selectPhoneShape('deck')
      store.toggleViewportMode()
      expect(store.viewportMode()).toBe('desktop')
      expect(store.phoneShape()).toBe('deck')
      store.toggleViewportMode()
      expect(store.viewportMode()).toBe('mobile')
      expect(store.phoneShape()).toBe('deck')
    })
  })

  test('adversarial: selecting the shape that is already chosen leaves it chosen (a select is not a toggle)', () => {
    createRoot(() => {
      const store = createUiStore()
      store.selectPhoneShape('portrait')
      expect(store.phoneShape()).toBe('portrait')
      store.selectPhoneShape('deck')
      store.selectPhoneShape('deck')
      expect(store.phoneShape()).toBe('deck')
    })
  })

  test('adversarial: a run of selections ends on the last one (however many, in whatever order)', () => {
    createRoot(() => {
      const store = createUiStore()
      const run = ['deck', 'portrait', 'portrait', 'deck', 'portrait', 'deck', 'deck'] as const
      for (const shape of run) {
        store.selectPhoneShape(shape)
        expect(store.phoneShape()).toBe(shape)
      }
    })
  })

  test('adversarial: the shape and the viewport mode are independent (selecting one never moves the other)', () => {
    createRoot(() => {
      const store = createUiStore()
      store.selectPhoneShape('deck')
      expect(store.viewportMode()).toBe('desktop')
      store.toggleViewportMode()
      expect(store.phoneShape()).toBe('deck')
    })
  })

  test('adversarial: each store instance keeps its own shape (a second window does not follow the first)', () => {
    createRoot(() => {
      const first = createUiStore()
      const second = createUiStore()
      first.selectPhoneShape('deck')
      expect(first.phoneShape()).toBe('deck')
      expect(second.phoneShape()).toBe('portrait')
    })
  })

  test('adversarial: selecting a shape leaves the other UI state alone', () => {
    createRoot(() => {
      const store = createUiStore()
      store.setSlideListWidth(300)
      store.setPresentMenuOpen(true)
      store.selectPhoneShape('deck')
      expect(store.slideListWidth()).toBe(300)
      expect(store.presentMenuOpen()).toBe(true)
      expect(store.contextMenu()).toEqual({ kind: 'closed' })
    })
  })
})

describe('preview phone shape menu', () => {
  test('spec: Given a fresh session, when nothing was done, then the shape menu is closed', () => {
    createRoot(() => {
      expect(createUiStore().phoneShapeMenuOpen()).toBe(false)
    })
  })

  test('spec: Given phone display, when the ▾ is toggled, then the menu opens, and toggling again (or closing it) shuts it', () => {
    createRoot(() => {
      const store = createUiStore()
      store.toggleViewportMode()
      store.togglePhoneShapeMenu()
      expect(store.phoneShapeMenuOpen()).toBe(true)
      store.togglePhoneShapeMenu()
      expect(store.phoneShapeMenuOpen()).toBe(false)
      store.togglePhoneShapeMenu()
      store.closePhoneShapeMenu()
      expect(store.phoneShapeMenuOpen()).toBe(false)
    })
  })

  test('spec: Given the menu open, when a shape is picked, then the shape is that one and the menu is closed', () => {
    createRoot(() => {
      const store = createUiStore()
      store.toggleViewportMode()
      store.togglePhoneShapeMenu()
      store.selectPhoneShape('deck')
      expect(store.phoneShape()).toBe('deck')
      expect(store.phoneShapeMenuOpen()).toBe(false)
    })
  })

  test('adversarial: toggling the menu in PC display does not open it (it has no ▾ there), however many times', () => {
    createRoot(() => {
      const store = createUiStore()
      store.togglePhoneShapeMenu()
      expect(store.phoneShapeMenuOpen()).toBe(false)
      store.togglePhoneShapeMenu()
      expect(store.phoneShapeMenuOpen()).toBe(false)
    })
  })

  test('adversarial: Given the menu open in phone display, when the user goes back to PC display, then the menu is closed, and phone display again does not reopen it', () => {
    createRoot(() => {
      const store = createUiStore()
      store.toggleViewportMode()
      store.togglePhoneShapeMenu()
      store.toggleViewportMode()
      expect(store.viewportMode()).toBe('desktop')
      expect(store.phoneShapeMenuOpen()).toBe(false)
      store.toggleViewportMode()
      expect(store.viewportMode()).toBe('mobile')
      expect(store.phoneShapeMenuOpen()).toBe(false)
    })
  })

  test('adversarial: closing a menu that is not open changes nothing (also in PC display)', () => {
    createRoot(() => {
      const store = createUiStore()
      store.closePhoneShapeMenu()
      expect(store.phoneShapeMenuOpen()).toBe(false)
      expect(store.viewportMode()).toBe('desktop')
    })
  })

  test('adversarial: picking the shape that is already chosen still closes the menu and leaves the shape', () => {
    createRoot(() => {
      const store = createUiStore()
      store.toggleViewportMode()
      store.togglePhoneShapeMenu()
      store.selectPhoneShape('portrait')
      expect(store.phoneShape()).toBe('portrait')
      expect(store.phoneShapeMenuOpen()).toBe(false)
    })
  })

  test('adversarial: opening and closing the menu changes neither the chosen shape nor the mode', () => {
    createRoot(() => {
      const store = createUiStore()
      store.toggleViewportMode()
      store.selectPhoneShape('deck')
      store.togglePhoneShapeMenu()
      expect(store.phoneShape()).toBe('deck')
      expect(store.viewportMode()).toBe('mobile')
      store.closePhoneShapeMenu()
      expect(store.phoneShape()).toBe('deck')
      expect(store.viewportMode()).toBe('mobile')
    })
  })

  test('adversarial: no observer ever sees PC display with the menu open, not even in between the two changes leaving phone display makes', () => {
    createRoot(() => {
      const store = createUiStore()
      const seen: string[] = []
      createEffect(() => {
        seen.push(`${store.viewportMode()}/${store.phoneShapeMenuOpen() ? 'open' : 'closed'}`)
      })
      store.toggleViewportMode()
      store.togglePhoneShapeMenu()
      store.toggleViewportMode()
      expect(seen).toContain('mobile/open')
      expect(seen).not.toContain('desktop/open')
      expect(seen[seen.length - 1]).toBe('desktop/closed')
    })
  })

  test('adversarial: each store instance keeps its own menu (a second window does not follow the first)', () => {
    createRoot(() => {
      const first = createUiStore()
      const second = createUiStore()
      first.toggleViewportMode()
      second.toggleViewportMode()
      first.togglePhoneShapeMenu()
      expect(first.phoneShapeMenuOpen()).toBe(true)
      expect(second.phoneShapeMenuOpen()).toBe(false)
    })
  })

  test('adversarial: the store does not expose the setters (callers toggle, close and select only)', () => {
    createRoot(() => {
      const store = createUiStore()
      expect('setPhoneShapeMenuOpen' in store).toBe(false)
      expect('setPhoneShape' in store).toBe(false)
      expect('setViewportMode' in store).toBe(false)
    })
  })

  test('adversarial: the shape menu leaves the other dropdowns alone', () => {
    createRoot(() => {
      const store = createUiStore()
      store.setPresentMenuOpen(true)
      store.setVariantMenuOpen(true)
      store.toggleViewportMode()
      store.togglePhoneShapeMenu()
      store.toggleViewportMode()
      expect(store.presentMenuOpen()).toBe(true)
      expect(store.variantMenuOpen()).toBe(true)
    })
  })
})
