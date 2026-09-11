import { describe, expect, test } from 'bun:test'
import { createRoot } from '@barefootjs/client'
import { createRenderStore } from './renderStore'
import { type RenderPayload, type ManifestSlide } from '../domain/render'

function slide(overrides: Partial<ManifestSlide> = {}): ManifestSlide {
  return {
    index: 0,
    key: 'slide-1',
    src: '',
    hasNotes: false,
    skip: false,
    revealSteps: 1,
    text: { title: 'Title', body: '', code: '' },
    ...overrides,
  }
}

function payload(overrides: Partial<RenderPayload> = {}): RenderPayload {
  return {
    manifest: { title: 'Deck', slideCount: 1, canvasWidth: 1280, canvasHeight: 720, sections: [], slides: [slide()] },
    fragments: { 'slide-1': '<div class="peitho-slide">one</div>' },
    assetBaseUrl: 'asset://base/',
    css: '',
    ...overrides,
  }
}

describe('applyRenderPayload', () => {
  test('spec: populates manifest, assetBaseUrl, canvas size, and per-slide fragments', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload())
      expect(store.manifest()?.title).toBe('Deck')
      expect(store.assetBaseUrl()).toBe('asset://base/')
      expect(store.canvasWidth()).toBe(1280)
      expect(store.canvasHeight()).toBe(720)
      expect(store.canvasFragmentOf('slide-1')).toBe('<div class="peitho-slide">one</div>')
    })
  })

  test('spec: derives sectionDrafts from the manifest\'s sections, formatting their planned duration', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({
        manifest: {
          title: 'Deck', slideCount: 1, canvasWidth: 1280, canvasHeight: 720,
          sections: [{ name: 'Intro', startIndex: 0, endIndex: 0, plannedDurationMs: 90_000 }],
          slides: [slide()],
        },
      }))
      expect(store.sectionDrafts()[0]).toEqual({ name: 'Intro', time: '1m30s' })
    })
  })

  test('adversarial: a manifest with no sections resets sectionDrafts to empty, not stale', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.setSectionDrafts({ 0: { name: 'stale', time: '1m0s' } })
      store.applyRenderPayload(payload())
      expect(store.sectionDrafts()).toEqual({})
    })
  })

  test('adversarial: an unrendered key reads as an empty fragment, not undefined/throwing', () => {
    createRoot(() => {
      const store = createRenderStore()
      expect(store.canvasFragmentOf('never-rendered')).toBe('')
    })
  })

  test('adversarial: an unchanged slide keeps its previous object reference across two renders (stabilizeByKey)', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload())
      const first = store.manifest()!.slides[0]
      store.applyRenderPayload(payload({ fragments: { 'slide-1': '<div class="peitho-slide">one</div>' } }))
      const second = store.manifest()!.slides[0]
      expect(second).toBe(first)
    })
  })

  test('adversarial: an edited slide gets a fresh object reference, not the stale previous one', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload())
      const first = store.manifest()!.slides[0]
      store.applyRenderPayload(payload({
        manifest: { title: 'Deck', slideCount: 1, canvasWidth: 1280, canvasHeight: 720, sections: [], slides: [slide({ text: { title: 'Changed', body: '', code: '' } })] },
      }))
      const second = store.manifest()!.slides[0]
      expect(second).not.toBe(first)
      expect(second.text.title).toBe('Changed')
    })
  })
})

describe('canvasFragmentOf', () => {
  test('spec: absolutizes a slide\'s asset URLs against the current asset base', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({
        assetBaseUrl: 'http://localhost:1234/',
        fragments: { 'slide-1': '<section class="peitho-slide"><img src="assets/a.png"></section>' },
      }))
      expect(store.canvasFragmentOf('slide-1'))
        .toBe('<section class="peitho-slide"><img src="http://localhost:1234/assets/a.png"></section>')
    })
  })

  test('spec: re-derives from the new asset base after a later render, not a frozen one', () => {
    createRoot(() => {
      const store = createRenderStore()
      const fragments = { 'slide-1': '<img src="assets/a.png">' }
      store.applyRenderPayload(payload({ assetBaseUrl: 'http://localhost:1111/', fragments }))
      store.applyRenderPayload(payload({ assetBaseUrl: 'http://localhost:2222/', fragments }))
      expect(store.canvasFragmentOf('slide-1')).toBe('<img src="http://localhost:2222/assets/a.png">')
    })
  })

  test('adversarial: a fragment with no asset reference comes back byte-identical', () => {
    createRoot(() => {
      const store = createRenderStore()
      const html = '<section class="peitho-slide"><img src="https://cdn.example.com/a.png"></section>'
      store.applyRenderPayload(payload({ assetBaseUrl: 'http://localhost:1234/', fragments: { 'slide-1': html } }))
      expect(store.canvasFragmentOf('slide-1')).toBe(html)
    })
  })

  test('adversarial: no asset server resolved yet leaves the fragment alone instead of throwing', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({ assetBaseUrl: '', fragments: { 'slide-1': '<img src="assets/a.png">' } }))
      expect(store.canvasFragmentOf('slide-1')).toBe('<img src="assets/a.png">')
    })
  })
})

describe('slideStylesheetText / fontFaceCss', () => {
  test('spec: splits @font-face out of the theme CSS, absolutized and :root-scoped', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({
        assetBaseUrl: 'http://localhost:1234/',
        css: '@font-face { src: url("theme-fonts/Inter.woff2"); }\n:root { --x: 1px; } .peitho-slide { color: red; }',
      }))
      expect(store.fontFaceCss()).toContain('url("http://localhost:1234/theme-fonts/Inter.woff2")')
      expect(store.slideStylesheetText()).not.toContain('@font-face')
      expect(store.slideStylesheetText()).toContain(':host { --x: 1px; }')
      expect(store.slideStylesheetText()).toContain('.peitho-slide { color: red; }')
    })
  })

  test('adversarial: theme CSS with no @font-face leaves fontFaceCss empty', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({ css: '.peitho-slide { color: red; }' }))
      expect(store.fontFaceCss()).toBe('')
      expect(store.slideStylesheetText()).toBe('.peitho-slide { color: red; }')
    })
  })

  test('adversarial: no render yet reads as empty stylesheet text, not throwing', () => {
    createRoot(() => {
      const store = createRenderStore()
      expect(store.slideStylesheetText()).toBe('')
      expect(store.fontFaceCss()).toBe('')
    })
  })

  test('adversarial: a later render re-derives both from the new css *and* the new asset base', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({
        assetBaseUrl: 'http://localhost:1111/',
        css: '@font-face { src: url(theme-fonts/A.woff2); } .peitho-slide { color: red; }',
      }))
      store.applyRenderPayload(payload({
        assetBaseUrl: 'http://localhost:2222/',
        css: '@font-face { src: url(theme-fonts/B.woff2); } .peitho-slide { color: blue; }',
      }))
      expect(store.fontFaceCss()).toBe('@font-face { src: url(http://localhost:2222/theme-fonts/B.woff2); }')
      expect(store.slideStylesheetText()).toBe(' .peitho-slide { color: blue; }')
    })
  })
})
