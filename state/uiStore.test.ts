import { describe, expect, test } from 'bun:test'
import { createRoot } from '@barefootjs/client'
import { createUiStore } from './uiStore'

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
