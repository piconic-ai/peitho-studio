import { describe, expect, test } from 'bun:test'
import { rewriteOutOfRootUrls } from './outOfRootAssets'

const DIR = '/repo/site'

describe('rewriteOutOfRootUrls', () => {
  test('points a ../ src at the /@fs/ endpoint', () => {
    expect(rewriteOutOfRootUrls('<img src="../brand/app-icon.svg" alt="">', DIR))
      .toBe('<img src="/@fs/repo/brand/app-icon.svg" alt="">')
  })

  test('rewrites href as well, and every occurrence', () => {
    const html = [
      '<link rel="icon" href="../brand/app-icon-small.svg">',
      '<link rel="icon" href="../src-tauri/icons/32x32.png">',
      '<img src="../brand/logo-wordmark.svg">',
    ].join('\n')
    expect(rewriteOutOfRootUrls(html, DIR)).toBe([
      '<link rel="icon" href="/@fs/repo/brand/app-icon-small.svg">',
      '<link rel="icon" href="/@fs/repo/src-tauri/icons/32x32.png">',
      '<img src="/@fs/repo/brand/logo-wordmark.svg">',
    ].join('\n'))
  })

  test('collapses several ../ segments', () => {
    expect(rewriteOutOfRootUrls('<img src="../../x.svg">', '/a/b/c'))
      .toBe('<img src="/@fs/a/x.svg">')
  })

  test('keeps a Windows drive path servable (/@fs/C:/...)', () => {
    expect(rewriteOutOfRootUrls('<img src="../brand/x.svg">', 'C:/repo/site'))
      .toBe('<img src="/@fs/C:/repo/brand/x.svg">')
  })

  test('leaves root-relative, same-dir, absolute and hash URLs alone', () => {
    const html = [
      '<img src="/studio.webp">',
      '<img src="./local.svg">',
      '<img src="brand/x.svg">',
      '<a href="https://example.invalid/../up">',
      '<a href="#download">',
      '<link rel="stylesheet" href="/site.css">',
    ].join('\n')
    expect(rewriteOutOfRootUrls(html, DIR)).toBe(html)
  })

  test('ignores ../ inside text content or other attributes', () => {
    const html = '<p title="../not-a-url">see ../brand</p><meta content="../x">'
    expect(rewriteOutOfRootUrls(html, DIR)).toBe(html)
  })

  test('handles an empty document', () => {
    expect(rewriteOutOfRootUrls('', DIR)).toBe('')
  })
})
