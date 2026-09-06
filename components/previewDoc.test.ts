import { describe, expect, test } from 'bun:test'
import { buildSlidePreviewDoc } from './previewDoc'

describe('buildSlidePreviewDoc', () => {
  test('spec: wraps the fragment with the given base URL and canvas size', () => {
    const doc = buildSlidePreviewDoc('<section class="peitho-slide">Hi</section>', 'http://localhost:1234/', 1280, 720)
    expect(doc).toContain('<base href="http://localhost:1234/">')
    expect(doc).toContain('--peitho-canvas-width: 1280px')
    expect(doc).toContain('--peitho-canvas-height: 720px')
    expect(doc).toContain('<section class="peitho-slide">Hi</section>')
    expect(doc).toContain('window.innerWidth / 1280')
    expect(doc).toContain('window.innerHeight / 720')
  })

  test('adversarial: an empty base URL still produces a valid <base> tag', () => {
    const doc = buildSlidePreviewDoc('<div></div>', '', 1280, 720)
    expect(doc).toContain('<base href="">')
  })

  test('adversarial: fragment HTML is inlined verbatim, not escaped', () => {
    const fragment = '<section data-key="a&b"><p>1 &lt; 2</p></section>'
    const doc = buildSlidePreviewDoc(fragment, 'http://localhost/', 100, 50)
    expect(doc).toContain(fragment)
  })

  test('adversarial: non-standard canvas dimensions are threaded through unchanged', () => {
    const doc = buildSlidePreviewDoc('<div></div>', 'http://localhost/', 1, 99999)
    expect(doc).toContain('--peitho-canvas-width: 1px')
    expect(doc).toContain('--peitho-canvas-height: 99999px')
  })
})
