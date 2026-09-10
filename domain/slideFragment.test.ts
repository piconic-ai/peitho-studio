import { describe, expect, test } from 'bun:test'
import { absolutizeFragmentUrls } from './slideFragment'

describe('absolutizeFragmentUrls', () => {
  test('spec: a relative assets/ src is resolved against the base', () => {
    expect(absolutizeFragmentUrls('<img src="assets/abc123-photo.png">', 'http://localhost:1234/'))
      .toBe('<img src="http://localhost:1234/assets/abc123-photo.png">')
  })

  test('spec: multiple img tags are all rewritten', () => {
    const html = '<img src="assets/a.png"><img src="assets/b.png">'
    const result = absolutizeFragmentUrls(html, 'http://localhost/')
    expect(result).toContain('src="http://localhost/assets/a.png"')
    expect(result).toContain('src="http://localhost/assets/b.png"')
  })

  test('adversarial: a src that does not start with assets/ is left untouched', () => {
    const html = '<img src="https://cdn.example.com/a.png">'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(html)
  })

  test('adversarial: an empty base URL is a no-op', () => {
    const html = '<img src="assets/a.png">'
    expect(absolutizeFragmentUrls(html, '')).toBe(html)
  })

  test('adversarial: HTML with no img tags passes through unchanged', () => {
    const html = '<section class="peitho-slide"><p>Hello</p></section>'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(html)
  })

  test('adversarial: an empty fragment stays empty', () => {
    expect(absolutizeFragmentUrls('', 'http://localhost/')).toBe('')
  })
})
