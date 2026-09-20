import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { absolutizeFragmentUrls, hasFixedCanvas } from './slideFragment'
import { fixedCanvasExamples } from './slideFragment.examples'
import { isExhaustivelyAccountedFor } from './spec'

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

describe('hasFixedCanvas examples', () => {
  test.each(fixedCanvasExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_title, example) => {
      expect(hasFixedCanvas(example.state)).toBe(example.expect)
    },
  )

  test('spec: every example is either automated or carries a manual reason', () => {
    expect(isExhaustivelyAccountedFor(fixedCanvasExamples)).toBe(true)
  })
})

describe('hasFixedCanvas', () => {
  const withAttributes = (attributes: string) => `<section ${attributes}><p>body</p></section>`

  test('spec: root <section data-canvas="fixed"> is fixed', () => {
    expect(hasFixedCanvas('<section data-canvas="fixed"></section>')).toBe(true)
  })

  test('spec: a root <section> without the attribute is not fixed', () => {
    expect(hasFixedCanvas('<section class="peitho-slide"></section>')).toBe(false)
  })

  test('spec: the attribute may sit anywhere among the root\'s other attributes', () => {
    expect(hasFixedCanvas(withAttributes('data-canvas="fixed" class="a" data-slide-key="k"'))).toBe(true)
    expect(hasFixedCanvas(withAttributes('class="a" data-canvas="fixed" data-slide-key="k"'))).toBe(true)
    expect(hasFixedCanvas(withAttributes('class="a" data-slide-key="k" data-canvas="fixed"'))).toBe(true)
  })

  test('spec: a real rendered arcade fragment (leading comment, script child) is fixed', () => {
    const html = '<!--\n  Full-bleed slide.\n\n  data-canvas="fixed": the play field is authored in 1280x720 coordinates.\n-->\n'
      + '<section class="peitho-slide layout-arcade" data-ground="dark" data-canvas="fixed" data-slide-key="what-arcade">\n'
      + '  <div class="bf-mount arcade-mount" data-bf="Arcade"></div>\n'
      + '  <script type="module" src="assets/mount.js"></script>\n</section>\n'
    expect(hasFixedCanvas(html)).toBe(true)
  })

  test('adversarial: an empty or whitespace-only fragment is not fixed', () => {
    expect(hasFixedCanvas('')).toBe(false)
    expect(hasFixedCanvas(' \n\t ')).toBe(false)
  })

  test('adversarial: the attribute only on a child element is not fixed', () => {
    expect(hasFixedCanvas('<section class="peitho-slide"><div data-canvas="fixed"></div></section>')).toBe(false)
  })

  test('adversarial: the attribute only on a nested <section> is not fixed', () => {
    expect(hasFixedCanvas('<section class="peitho-slide"><section data-canvas="fixed"></section></section>')).toBe(false)
  })

  test('adversarial: a root that is not a <section> is not fixed, even if it carries the attribute', () => {
    expect(hasFixedCanvas('<div data-canvas="fixed"></div>')).toBe(false)
    expect(hasFixedCanvas('<article data-canvas="fixed"></article>')).toBe(false)
  })

  test('adversarial: text before the root <section> means it is not the root', () => {
    expect(hasFixedCanvas('stray <section data-canvas="fixed"></section>')).toBe(false)
  })

  test('adversarial: single-quoted, unquoted and spaced-out values are the same attribute', () => {
    expect(hasFixedCanvas(withAttributes(`data-canvas='fixed'`))).toBe(true)
    expect(hasFixedCanvas(withAttributes('data-canvas=fixed'))).toBe(true)
    expect(hasFixedCanvas(withAttributes('data-canvas = "fixed"'))).toBe(true)
    expect(hasFixedCanvas(withAttributes(`data-canvas\n=\n'fixed'`))).toBe(true)
  })

  test('adversarial: the tag and attribute names are case-insensitive, like HTML', () => {
    expect(hasFixedCanvas('<SECTION DATA-CANVAS="fixed"></SECTION>')).toBe(true)
    expect(hasFixedCanvas('<Section Data-Canvas="fixed"></Section>')).toBe(true)
  })

  test('adversarial: the value is case-sensitive, like the CSS selector other viewers use', () => {
    expect(hasFixedCanvas(withAttributes('data-canvas="FIXED"'))).toBe(false)
    expect(hasFixedCanvas(withAttributes('data-canvas="Fixed"'))).toBe(false)
  })

  test('adversarial: any value other than exactly "fixed" is not fixed', () => {
    for (const value of ['', 'fixed ', ' fixed', 'fixed-ish', 'fixedx', 'flex', 'true', 'fix']) {
      expect(hasFixedCanvas(withAttributes(`data-canvas="${value}"`))).toBe(false)
    }
  })

  test('adversarial: the attribute with no value, or an empty one, is not fixed', () => {
    expect(hasFixedCanvas('<section data-canvas></section>')).toBe(false)
    expect(hasFixedCanvas('<section data-canvas=""></section>')).toBe(false)
    expect(hasFixedCanvas('<section data-canvas=></section>')).toBe(false)
  })

  test('adversarial: lookalike attribute names are not data-canvas', () => {
    for (const name of ['data-canvasx', 'xdata-canvas', 'data-canvas-mode', 'canvas', 'data_canvas', 'data-canvas:x']) {
      expect(hasFixedCanvas(withAttributes(`${name}="fixed"`))).toBe(false)
    }
  })

  test('adversarial: lookalike tag names are not <section>', () => {
    for (const tag of ['sectionx', 'section-x', 'sections', 'sect']) {
      expect(hasFixedCanvas(`<${tag} data-canvas="fixed"></${tag}>`)).toBe(false)
    }
  })

  test('adversarial: data-canvas="fixed" inside another attribute\'s value is not the attribute', () => {
    expect(hasFixedCanvas(`<section title='data-canvas="fixed"'></section>`)).toBe(false)
    expect(hasFixedCanvas(`<section title="data-canvas='fixed'"></section>`)).toBe(false)
    expect(hasFixedCanvas('<section data-note="x data-canvas=fixed"></section>')).toBe(false)
  })

  test('adversarial: a ">" inside a quoted value does not end the start tag early', () => {
    expect(hasFixedCanvas('<section title="a>b" data-canvas="fixed"></section>')).toBe(true)
    expect(hasFixedCanvas(`<section title='a>b' data-canvas='fixed'></section>`)).toBe(true)
  })

  test('adversarial: with a duplicated attribute the first one wins, as in an HTML parser', () => {
    expect(hasFixedCanvas(withAttributes('data-canvas="fixed" data-canvas="flex"'))).toBe(true)
    expect(hasFixedCanvas(withAttributes('data-canvas="flex" data-canvas="fixed"'))).toBe(false)
  })

  test('adversarial: newlines and tabs between attributes are fine', () => {
    expect(hasFixedCanvas('<section\n  class="peitho-slide"\n\tdata-canvas="fixed"\n>\n</section>')).toBe(true)
  })

  test('adversarial: a self-closing start tag still reads its attributes', () => {
    expect(hasFixedCanvas('<section data-canvas="fixed"/>')).toBe(true)
  })

  test('adversarial: a start tag that never closes is not fixed', () => {
    expect(hasFixedCanvas('<section data-canvas="fixed"')).toBe(false)
    expect(hasFixedCanvas('<section data-canvas="fixed')).toBe(false)
    expect(hasFixedCanvas('<section')).toBe(false)
  })

  test('adversarial: a string inside a <script> that looks like the root tag is not fixed', () => {
    const html = `<section class="peitho-slide"><script>const s = '<section data-canvas="fixed">'</script></section>`
    expect(hasFixedCanvas(html)).toBe(false)
  })

  test('adversarial: a <script> ahead of the root means the root is not the first element, so it is not fixed', () => {
    // Documents a limit rather than endorsing it: fragments open with their
    // root <section>, so this shape is not expected from peitho-core.
    const html = '<script>1</script><section data-canvas="fixed"></section>'
    expect(hasFixedCanvas(html)).toBe(false)
  })

  test('adversarial: several leading comments and blank lines are all skipped', () => {
    const html = '\n<!-- one -->\n\n<!-- two: data-canvas="fixed" -->  \t<!-- three -->\n<section data-canvas="fixed"></section>'
    expect(hasFixedCanvas(html)).toBe(true)
    expect(hasFixedCanvas(html.replace('<section data-canvas="fixed">', '<section>'))).toBe(false)
  })

  test('adversarial: a comment that never closes swallows the rest, so nothing is fixed', () => {
    expect(hasFixedCanvas('<!-- <section data-canvas="fixed"></section>')).toBe(false)
  })

  test('adversarial: a comment holding the whole root tag, followed by an ordinary root, is not fixed', () => {
    expect(hasFixedCanvas('<!-- <section data-canvas="fixed"> --><section class="peitho-slide"></section>')).toBe(false)
  })

  test('adversarial: a comment after the root tag is irrelevant', () => {
    expect(hasFixedCanvas('<section class="peitho-slide"><!-- data-canvas="fixed" --></section>')).toBe(false)
  })

  test('adversarial: emoji, CJK and other non-ASCII text around the tag does not confuse it', () => {
    expect(hasFixedCanvas('<!-- 日本語のコメント 🎮 --><section data-canvas="fixed" data-title="🎮 ゲーム"></section>')).toBe(true)
  })

  test('adversarial: pathological input finishes quickly instead of backtracking forever', () => {
    const started = performance.now()
    hasFixedCanvas(`<section ${'a="'.repeat(20000)}`)
    hasFixedCanvas(`<section ${`a='`.repeat(20000)}`)
    hasFixedCanvas('<!--'.repeat(20000))
    hasFixedCanvas(' '.repeat(200000))
    hasFixedCanvas(`<section ${'a '.repeat(100000)}`)
    hasFixedCanvas(`<section ${'a="b" '.repeat(50000)}>`)
    // Takes tens of milliseconds; a backtracking regression would take
    // minutes, so the budget only has to be loose enough not to flake on a
    // loaded machine.
    expect(performance.now() - started).toBeLessThan(4000)
  })

  test('purity: repeats its answer across calls (its global regexes hold no state between them)', () => {
    const fixedHtml = '<section data-canvas="fixed"></section>'
    const ordinaryHtml = '<section></section>'
    expect([fixedHtml, fixedHtml, ordinaryHtml, fixedHtml, ordinaryHtml].map(hasFixedCanvas)).toEqual([true, true, false, true, false])
  })

  test('property: never throws, whatever string it is handed', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary' }), html => {
      expect(typeof hasFixedCanvas(html)).toBe('boolean')
    }))
  })

  test('property: only the root start tag decides — whatever follows it changes nothing', () => {
    fc.assert(fc.property(
      fc.constantFrom('<section data-canvas="fixed">', '<section class="peitho-slide">'),
      fc.string({ unit: 'binary' }),
      (startTag, tail) => {
        expect(hasFixedCanvas(startTag + tail)).toBe(startTag.includes('data-canvas'))
      },
    ))
  })

  test('property: a leading comment, whatever it says, changes nothing', () => {
    const commentBody = fc.string({ unit: 'binary' }).filter(text => !text.includes('-->'))
    fc.assert(fc.property(
      fc.constantFrom('<section data-canvas="fixed"></section>', '<section></section>'),
      commentBody,
      (slide, body) => {
        expect(hasFixedCanvas(`<!--${body}-->${slide}`)).toBe(hasFixedCanvas(slide))
      },
    ))
  })
})
