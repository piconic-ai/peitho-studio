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

  test('spec: a real rendered <img> keeps its surrounding attributes', () => {
    const html = '<section data-slide-key="s1" class="peitho-slide"><div class="slot-hero">'
      + '<img src="assets/0123456789abcdef-hero.png" alt="Hero image"></div></section>'
    expect(absolutizeFragmentUrls(html, 'http://127.0.0.1:1234/')).toBe(
      '<section data-slide-key="s1" class="peitho-slide"><div class="slot-hero">'
      + '<img src="http://127.0.0.1:1234/assets/0123456789abcdef-hero.png" alt="Hero image"></div></section>')
  })

  test('adversarial: a src that does not start with assets/ is left untouched', () => {
    const html = '<img src="https://cdn.example.com/a.png">'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(html)
  })

  test('adversarial: an empty base URL is a no-op', () => {
    const html = '<img src="assets/a.png">'
    expect(absolutizeFragmentUrls(html, '')).toBe(html)
  })

  test('adversarial: an attribute merely ending in "src" is not mistaken for src', () => {
    const html = '<img data-src="assets/a.png" srcset="assets/a.png 1x">'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(html)
  })

  test('adversarial: HTML with no img tags passes through unchanged', () => {
    const html = '<section class="peitho-slide"><p>Hello</p></section>'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(html)
  })

  test('adversarial: an empty fragment stays empty', () => {
    expect(absolutizeFragmentUrls('', 'http://localhost/')).toBe('')
  })

  test('spec: a script tag\'s own src attribute is absolutized, same as an img', () => {
    const html = '<section><script src="assets/deck.js"></script></section>'
    expect(absolutizeFragmentUrls(html, 'http://localhost:1234/')).toBe(
      '<section><script src="http://localhost:1234/assets/deck.js"></script></section>')
  })

  test('spec: a script tag\'s attributes other than src are left in place, in order', () => {
    const html = '<script type="module" src="assets/deck.js" defer></script>'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(
      '<script type="module" src="http://localhost/assets/deck.js" defer></script>')
  })

  test('adversarial: text inside a script body that merely looks like a src attribute is left untouched', () => {
    // A layout script that itself builds an <img> tag as a string must not
    // have that string corrupted — only real HTML attributes are this
    // function's job, never a script's own source text.
    const html = '<script>const img = "<img src=\\"assets/icon.png\\">"</script>'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(html)
  })

  test('adversarial: a script with no src is left untouched, body included', () => {
    const html = '<script>console.log("assets/not-a-url")</script>'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(html)
  })

  test('spec: an img before and after a script tag is still rewritten, the script body is not', () => {
    const html = '<img src="assets/a.png"><script>const s = "assets/b.png"</script><img src="assets/c.png">'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(
      '<img src="http://localhost/assets/a.png"><script>const s = "assets/b.png"</script>'
      + '<img src="http://localhost/assets/c.png">')
  })

  test('adversarial: multiple script tags are each handled independently', () => {
    const html = '<script src="assets/a.js"></script><script src="assets/b.js"></script>'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(
      '<script src="http://localhost/assets/a.js"></script><script src="http://localhost/assets/b.js"></script>')
  })

  test('spec: a video\'s poster attribute is absolutized, same as an img src', () => {
    // Missed in an earlier pass: a <video poster="assets/...">'s poster
    // isn't a `src` attribute at all, so the src-only pattern silently
    // skipped it — confirmed 404ing against the wrong origin (the app's
    // own dev server, not the asset server) on a real device.
    const html = '<video poster="assets/hero.jpg"><source src="assets/hero.mp4" type="video/mp4"></video>'
    expect(absolutizeFragmentUrls(html, 'http://127.0.0.1:1234/')).toBe(
      '<video poster="http://127.0.0.1:1234/assets/hero.jpg"><source src="http://127.0.0.1:1234/assets/hero.mp4" type="video/mp4"></video>')
  })

  test('adversarial: an attribute merely ending in "poster" is not mistaken for poster', () => {
    const html = '<div data-poster="assets/a.png"></div>'
    expect(absolutizeFragmentUrls(html, 'http://localhost/')).toBe(html)
  })
})
