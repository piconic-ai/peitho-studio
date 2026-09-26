import { describe, expect, test } from 'bun:test'
import { rootRelativeRefs } from './appBundle'

describe('rootRelativeRefs', () => {
  test('Given a built page, When scanned, Then every root-relative src/href is listed in order', () => {
    const html = `
      <link rel="icon" href="/static/favicon.svg" />
      <link rel="stylesheet" href="/static/tokens.css">
      <script type="module" crossorigin src="/static/assets/pages/index-X.js"></script>
      <link rel="modulepreload" crossorigin href="/static/assets/index-Y.js">`
    expect(rootRelativeRefs(html)).toEqual([
      '/static/favicon.svg',
      '/static/tokens.css',
      '/static/assets/pages/index-X.js',
      '/static/assets/index-Y.js',
    ])
  })

  test('Given single quotes and extra whitespace, When scanned, Then they are still found', () => {
    expect(rootRelativeRefs(`<a href = '/a.css'>`)).toEqual(['/a.css'])
  })

  test('Given absolute, protocol-relative, relative and fragment URLs, When scanned, Then they are skipped', () => {
    const html = `
      <a href="https://example.com/x.js"></a>
      <a href="//cdn.example.com/x.js"></a>
      <a href="x.js"></a>
      <a href="#top"></a>
      <a href=""></a>`
    expect(rootRelativeRefs(html)).toEqual([])
  })

  test('Given a query string or fragment, When scanned, Then only the path is kept', () => {
    expect(rootRelativeRefs(`<a href="/a.css?v=1"></a><a href="/b.svg#icon"></a>`)).toEqual(['/a.css', '/b.svg'])
  })

  test('Given the same URL twice, When scanned, Then it is listed once', () => {
    expect(rootRelativeRefs(`<a href="/a.js"></a><script src="/a.js"></script>`)).toEqual(['/a.js'])
  })

  test('Given empty input or attributes like data-src, When scanned, Then nothing is listed', () => {
    expect(rootRelativeRefs('')).toEqual([])
    expect(rootRelativeRefs(`<img data-src="/lazy.png">`)).toEqual([])
  })
})
