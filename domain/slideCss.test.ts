import { describe, expect, test } from 'bun:test'
import { absolutizeCssUrls, splitFontFaceRules, scopeRootToHost } from './slideCss'

describe('absolutizeCssUrls', () => {
  test('spec: a double-quoted relative url() is resolved against the base', () => {
    expect(absolutizeCssUrls('src: url("theme-fonts/Inter.woff2")', 'http://localhost:1234/'))
      .toBe('src: url("http://localhost:1234/theme-fonts/Inter.woff2")')
  })

  test('spec: single-quoted and unquoted url() are both resolved', () => {
    expect(absolutizeCssUrls("url('a.png')", 'http://localhost/')).toBe('url(\'http://localhost/a.png\')')
    expect(absolutizeCssUrls('url(a.png)', 'http://localhost/')).toBe('url(http://localhost/a.png)')
  })

  test('spec: multiple url() occurrences are all rewritten', () => {
    const css = 'a { background: url("a.png") } b { background: url("b.png") }'
    const result = absolutizeCssUrls(css, 'http://localhost/')
    expect(result).toContain('url("http://localhost/a.png")')
    expect(result).toContain('url("http://localhost/b.png")')
  })

  test('adversarial: an already-absolute url() is left untouched', () => {
    expect(absolutizeCssUrls('url("https://cdn.example.com/a.png")', 'http://localhost/'))
      .toBe('url("https://cdn.example.com/a.png")')
  })

  test('adversarial: a data: URI is left untouched', () => {
    const css = 'url("data:image/png;base64,AAAA")'
    expect(absolutizeCssUrls(css, 'http://localhost/')).toBe(css)
  })

  test('adversarial: a protocol-relative url() is left untouched', () => {
    const css = 'url("//cdn.example.com/a.png")'
    expect(absolutizeCssUrls(css, 'http://localhost/')).toBe(css)
  })

  test('adversarial: an empty base URL is a no-op', () => {
    const css = 'url("theme-fonts/Inter.woff2")'
    expect(absolutizeCssUrls(css, '')).toBe(css)
  })

  test('adversarial: an empty url() is left untouched rather than resolved to the base itself', () => {
    expect(absolutizeCssUrls('url()', 'http://localhost/')).toBe('url()')
  })

  test('adversarial: CSS with no url() at all passes through unchanged', () => {
    const css = '.peitho-slide { color: red; }'
    expect(absolutizeCssUrls(css, 'http://localhost/')).toBe(css)
  })
})

describe('splitFontFaceRules', () => {
  test('spec: extracts @font-face blocks and leaves the rest behind', () => {
    const css = '@font-face { font-family: "Inter"; src: url("a.woff2"); }\n.peitho-slide { color: red; }'
    const { fontFaces, rest } = splitFontFaceRules(css)
    expect(fontFaces).toContain('@font-face')
    expect(fontFaces).toContain('font-family: "Inter"')
    expect(rest).not.toContain('@font-face')
    expect(rest).toContain('.peitho-slide { color: red; }')
  })

  test('spec: multiple @font-face blocks are all collected', () => {
    const css = '@font-face { font-family: "A"; }\n@font-face { font-family: "B"; }\n.x {}'
    const { fontFaces, rest } = splitFontFaceRules(css)
    expect(fontFaces).toContain('font-family: "A"')
    expect(fontFaces).toContain('font-family: "B"')
    expect(rest.trim()).toBe('.x {}')
  })

  test('adversarial: no @font-face present leaves rest unchanged and fontFaces empty', () => {
    const css = '.peitho-slide { color: red; }'
    const { fontFaces, rest } = splitFontFaceRules(css)
    expect(fontFaces).toBe('')
    expect(rest).toBe(css)
  })

  test('adversarial: an empty string produces empty output on both sides', () => {
    const { fontFaces, rest } = splitFontFaceRules('')
    expect(fontFaces).toBe('')
    expect(rest).toBe('')
  })
})

describe('scopeRootToHost', () => {
  test('spec: a bare :root selector becomes :host', () => {
    expect(scopeRootToHost(':root { --x: 1px; }')).toBe(':host { --x: 1px; }')
  })

  test('spec: :root chained with another pseudo-class is rewritten in place', () => {
    expect(scopeRootToHost(':root:not(.dark) { color: black; }')).toBe(':host:not(.dark) { color: black; }')
  })

  test('spec: multiple :root occurrences are all rewritten', () => {
    expect(scopeRootToHost(':root { --a: 1; } :root { --b: 2; }')).toBe(':host { --a: 1; } :host { --b: 2; }')
  })

  test('adversarial: a class name merely containing "root" is left untouched', () => {
    expect(scopeRootToHost('.root-element { color: red; }')).toBe('.root-element { color: red; }')
  })

  test('adversarial: no :root present passes through unchanged', () => {
    const css = '.peitho-slide { color: red; }'
    expect(scopeRootToHost(css)).toBe(css)
  })
})
