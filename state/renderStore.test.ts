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
      expect(store.fragmentOf('slide-1')).toBe('<div class="peitho-slide">one</div>')
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
      expect(store.fragmentOf('never-rendered')).toBe('')
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

describe('buildSlideDoc', () => {
  test('spec: reflects the store\'s own current assetBaseUrl/canvas size, not a frozen snapshot', () => {
    createRoot(() => {
      const store = createRenderStore()
      store.applyRenderPayload(payload())
      const doc = store.buildSlideDoc('<div class="peitho-slide">x</div>')
      expect(doc).toContain('asset://base/')
    })
  })
})
