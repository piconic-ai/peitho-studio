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
      store.applyRenderPayload(payload(), 'source')
      expect(store.manifest()?.title).toBe('Deck')
      expect(store.assetBaseUrl()).toBe('asset://base/')
      expect(store.canvasWidth()).toBe(1280)
      expect(store.canvasHeight()).toBe(720)
      expect(store.canvasFragmentOf('slide-1')).toBe('<div class="peitho-slide">one</div>')
    })
  })

  test('spec: derives sectionDrafts from the manifest\'s sections, keeping their planned duration in milliseconds', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({
        manifest: {
          title: 'Deck', slideCount: 1, canvasWidth: 1280, canvasHeight: 720,
          sections: [{ name: 'Intro', startIndex: 0, endIndex: 0, plannedDurationMs: 90_000 }],
          slides: [slide()],
        },
      }), 'source')
      expect(store.sectionDrafts()[0]).toEqual({ name: 'Intro', timeMs: 90_000 })
    })
  })

  test('spec: sectionDraftOf returns the edited draft once one is set', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({
        manifest: {
          title: 'Deck', slideCount: 1, canvasWidth: 1280, canvasHeight: 720,
          sections: [{ name: 'Intro', startIndex: 0, endIndex: 0, plannedDurationMs: 90_000 }],
          slides: [slide()],
        },
      }), 'source')
      store.setSectionDrafts({ 0: { name: 'Opening', timeMs: 120_000 } })
      expect(store.sectionDraftOf(0)).toEqual({ name: 'Opening', timeMs: 120_000 })
    })
  })

  test('adversarial: sectionDraftOf falls back to the section\'s saved values when its draft is missing', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({
        manifest: {
          title: 'Deck', slideCount: 1, canvasWidth: 1280, canvasHeight: 720,
          sections: [{ name: 'Intro', startIndex: 0, endIndex: 0, plannedDurationMs: 90_000 }],
          slides: [slide()],
        },
      }), 'source')
      store.setSectionDrafts({})
      expect(store.sectionDraftOf(0)).toEqual({ name: 'Intro', timeMs: 90_000 })
    })
  })

  test('adversarial: a manifest with no sections resets sectionDrafts to empty, not stale', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.setSectionDrafts({ 0: { name: 'stale', timeMs: 60_000 } })
      store.applyRenderPayload(payload(), 'source')
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
      store.applyRenderPayload(payload(), 'source')
      const first = store.manifest()!.slides[0]
      store.applyRenderPayload(payload({ fragments: { 'slide-1': '<div class="peitho-slide">one</div>' } }), 'source')
      const second = store.manifest()!.slides[0]
      expect(second).toBe(first)
    })
  })

  test('spec: renderedSource holds exactly the source string this call was given, updated on each later render', () => {
    createRoot(() => {
      const store = createRenderStore()
      expect(store.renderedSource()).toBe('')
      store.applyRenderPayload(payload(), '# One\n')
      expect(store.renderedSource()).toBe('# One\n')
      store.applyRenderPayload(payload(), '# One\n\n---\n\n# Two\n')
      expect(store.renderedSource()).toBe('# One\n\n---\n\n# Two\n')
    })
  })

  test('adversarial: going back to an empty source string after a real one is not mistaken for "no render yet"', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload(), 'not empty')
      store.applyRenderPayload(payload(), '')
      expect(store.renderedSource()).toBe('')
      expect(store.manifest()).not.toBeNull()
    })
  })

  test('adversarial: an edited slide gets a fresh object reference, not the stale previous one', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload(), 'source')
      const first = store.manifest()!.slides[0]
      store.applyRenderPayload(payload({
        manifest: { title: 'Deck', slideCount: 1, canvasWidth: 1280, canvasHeight: 720, sections: [], slides: [slide({ text: { title: 'Changed', body: '', code: '' } })] },
      }), 'source')
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
      }), 'source')
      expect(store.canvasFragmentOf('slide-1'))
        .toBe('<section class="peitho-slide"><img src="http://localhost:1234/assets/a.png"></section>')
    })
  })

  test('spec: re-derives from the new asset base after a later render, not a frozen one', () => {
    createRoot(() => {
      const store = createRenderStore()
      const fragments = { 'slide-1': '<img src="assets/a.png">' }
      store.applyRenderPayload(payload({ assetBaseUrl: 'http://localhost:1111/', fragments }), 'source')
      store.applyRenderPayload(payload({ assetBaseUrl: 'http://localhost:2222/', fragments }), 'source')
      expect(store.canvasFragmentOf('slide-1')).toBe('<img src="http://localhost:2222/assets/a.png">')
    })
  })

  test('adversarial: a fragment with no asset reference comes back byte-identical', () => {
    createRoot(() => {
      const store = createRenderStore()
      const html = '<section class="peitho-slide"><img src="https://cdn.example.com/a.png"></section>'
      store.applyRenderPayload(payload({ assetBaseUrl: 'http://localhost:1234/', fragments: { 'slide-1': html } }), 'source')
      expect(store.canvasFragmentOf('slide-1')).toBe(html)
    })
  })

  test('adversarial: no asset server resolved yet leaves the fragment alone instead of throwing', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({ assetBaseUrl: '', fragments: { 'slide-1': '<img src="assets/a.png">' } }), 'source')
      expect(store.canvasFragmentOf('slide-1')).toBe('<img src="assets/a.png">')
    })
  })
})

describe('fragmentOf', () => {
  test('spec: returns the fragment as rendered, without rewriting its asset URLs', () => {
    createRoot(() => {
      const store = createRenderStore()
      const html = '<section class="peitho-slide"><img src="assets/a.png"></section>'
      store.applyRenderPayload(payload({ assetBaseUrl: 'http://localhost:1234/', fragments: { 'slide-1': html } }), 'source')
      expect(store.fragmentOf('slide-1')).toBe(html)
    })
  })

  test('adversarial: a key that was never rendered reads as an empty fragment', () => {
    createRoot(() => {
      expect(createRenderStore().fragmentOf('never-rendered')).toBe('')
    })
  })

  test('adversarial: an edit that changes the fragment is visible to the next read', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({ fragments: { 'slide-1': '<section>one</section>' } }), 'source')
      store.applyRenderPayload(payload({ fragments: { 'slide-1': '<section>two</section>' } }), 'source')
      expect(store.fragmentOf('slide-1')).toBe('<section>two</section>')
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
      }), 'source')
      expect(store.fontFaceCss()).toContain('url("http://localhost:1234/theme-fonts/Inter.woff2")')
      expect(store.slideStylesheetText()).not.toContain('@font-face')
      expect(store.slideStylesheetText()).toContain(':host { --x: 1px; }')
      expect(store.slideStylesheetText()).toContain('.peitho-slide { color: red; }')
    })
  })

  test('adversarial: theme CSS with no @font-face leaves fontFaceCss empty', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload({ css: '.peitho-slide { color: red; }' }), 'source')
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
      }), 'source')
      store.applyRenderPayload(payload({
        assetBaseUrl: 'http://localhost:2222/',
        css: '@font-face { src: url(theme-fonts/B.woff2); } .peitho-slide { color: blue; }',
      }), 'source')
      expect(store.fontFaceCss()).toBe('@font-face { src: url(http://localhost:2222/theme-fonts/B.woff2); }')
      expect(store.slideStylesheetText()).toBe(' .peitho-slide { color: blue; }')
    })
  })
})
