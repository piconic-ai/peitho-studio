import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appIconSvg, EXPRESSIONS, type Expression, iconComposerGlyphSvg, iconComposerJson, INK, MARK_PATHS, markBody, markSmallBody, PAPER, squirclePath, srgbFill, svgDocument } from './mark'

function points(path: string): [number, number][] {
  expect(path.startsWith('M')).toBe(true)
  expect(path.endsWith('Z')).toBe(true)
  return path.slice(1, -1).split('L').map(p => p.split(' ').map(Number) as [number, number])
}

describe('squirclePath', () => {
  test('Given a centre and half-size, When drawn, Then every point lies within the bounding square and it touches all four sides', () => {
    const pts = points(squirclePath(512, 512, 412))
    expect(pts).toHaveLength(256)
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(100)
      expect(x).toBeLessThanOrEqual(924)
      expect(y).toBeGreaterThanOrEqual(100)
      expect(y).toBeLessThanOrEqual(924)
    }
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    expect(Math.min(...xs)).toBe(100)
    expect(Math.max(...xs)).toBe(924)
    expect(Math.min(...ys)).toBe(100)
    expect(Math.max(...ys)).toBe(924)
  })

  test('Given the default exponent, When drawn, Then its corner sits between a circle and the square (not a plain rounded rect)', () => {
    // At 45° a circle reaches half·cos45 ≈ 0.707·half; a square would reach half.
    const pts = points(squirclePath(0, 0, 100, 5, 8))
    const [x, y] = pts[1] // t = 45°
    expect(x).toBeGreaterThan(70.7)
    expect(x).toBeLessThan(100)
    expect(y).toBeCloseTo(x, 5)
  })

  test('Given a symmetric shape, When drawn, Then no coordinate is written as -0', () => {
    expect(squirclePath(0, 0, 10, 5, 8)).not.toContain('-0 ')
  })

  test.each([
    ['half = 0', () => squirclePath(0, 0, 0)],
    ['negative half', () => squirclePath(0, 0, -1)],
    ['NaN half', () => squirclePath(0, 0, Number.NaN)],
    ['n = 0', () => squirclePath(0, 0, 10, 0)],
    ['too few steps', () => squirclePath(0, 0, 10, 5, 3)],
    ['fractional steps', () => squirclePath(0, 0, 10, 5, 10.5)],
  ])('Given %s, When drawn, Then throws', (_label, draw) => {
    expect(draw).toThrow(RangeError)
  })
})

describe('markBody / markSmallBody', () => {
  const colours = (svg: string) => new Set(svg.match(/#[0-9a-fA-F]{6}/g))
  const names = Object.keys(EXPRESSIONS) as Expression[]

  test('Given the defaults, When drawn, Then it is an ink silhouette with the hairline and the neutral eye cut out in paper, and nothing else', () => {
    expect(markBody()).toBe(`<path d="${MARK_PATHS.HEAD}" fill="${INK}"/>` + `<path d="${MARK_PATHS.HAIRLINE}" fill="none" stroke="${PAPER}" stroke-width="2" stroke-linecap="round"/>` + EXPRESSIONS.neutral(PAPER, 1))
  })

  test('Given the head, When drawn, Then there is no line across the crown and no spiral in the knot', () => {
    const svg = markBody()
    expect(svg).not.toContain('M29.5 28C40 19.5 54 17.5 62 22')
    expect(svg).not.toContain('a1.6 1.6')
  })

  test('Given the expression set, When listed, Then it is exactly neutral and calm', () => {
    expect(Object.keys(EXPRESSIONS).sort()).toEqual(['calm', 'neutral'])
  })

  test.each(names)('Given the %s expression, When drawn, Then only the face changes', name => {
    const svg = markBody({ expression: name })
    expect(svg).toContain(EXPRESSIONS[name](PAPER, 1))
    expect(svg.replace(EXPRESSIONS[name](PAPER, 1), '')).toBe(markBody().replace(EXPRESSIONS.neutral(PAPER, 1), ''))
  })

  test('Given every expression, When drawn, Then no two faces are the same', () => {
    const faces = names.map(n => EXPRESSIONS[n](PAPER, 1))
    expect(new Set(faces).size).toBe(names.length)
  })

  test.each(names)('Given the %s expression in any colours, When drawn in either cut, Then only the figure and line colours appear', name => {
    expect(colours(markBody({ expression: name, figure: '#000001', line: '#000002' }))).toEqual(new Set(['#000001', '#000002']))
    expect(colours(markSmallBody({ expression: name, figure: '#000001', line: '#000002' }))).toEqual(new Set(['#000001', '#000002']))
  })

  test('Given an expression name that does not exist, When drawn, Then throws', () => {
    // @ts-expect-error — exercising the runtime guard for untyped callers
    expect(() => markBody({ expression: 'angry' })).toThrow(RangeError)
    // @ts-expect-error — a prototype key must not pass as an expression
    expect(() => markSmallBody({ expression: 'toString' })).toThrow()
  })

  test('Given the small cut, When drawn, Then the hairline and face are heavier than in the full cut', () => {
    const svg = markSmallBody()
    expect(svg).toContain('stroke-width="3.6"')
    expect(svg).toContain(EXPRESSIONS.neutral(PAPER, 1.6))
    expect(EXPRESSIONS.neutral(PAPER, 1.6)).not.toBe(EXPRESSIONS.neutral(PAPER, 1))
  })
})

describe('appIconSvg / svgDocument', () => {
  test('Given the defaults, When drawn, Then it is a 1024 document: ink tile, paper figure, macOS shadow', () => {
    const svg = appIconSvg()
    expect(svg).toContain('viewBox="0 0 1024 1024"')
    expect(svg).toContain('feDropShadow')
    expect(svg).toContain(`<path d="${MARK_PATHS.HEAD}" fill="${PAPER}"/>`)
  })

  test('Given shadow: false and a full tile, When drawn, Then there is no filter and the tile reaches the canvas edge', () => {
    const svg = appIconSvg({ shadow: false, tile: 'full' })
    expect(svg).not.toContain('filter')
    expect(svg).toContain('M1024 512')
  })

  test('Given small: true, When drawn, Then the small cut is used', () => {
    expect(appIconSvg({ small: true })).toContain('stroke-width="3.6"')
    expect(appIconSvg()).not.toContain('stroke-width="3.6"')
  })

  test('Given a title with markup characters, When wrapped, Then they are escaped so the document stays well-formed', () => {
    expect(svgDocument(10, 10, '', undefined, 'A <b> & C')).toContain('<title>A &lt;b&gt; &amp; C</title>')
  })
})

describe('WelcomeScreen inline mark', () => {
  test('Given the mark source, When the welcome screen inlines it, Then every path matches the source verbatim', () => {
    const tsx = readFileSync(resolve(import.meta.dir, '../../components/WelcomeScreen.tsx'), 'utf8')
    for (const [name, d] of Object.entries(MARK_PATHS)) {
      expect(tsx.includes(`d="${d}"`), `WelcomeScreen.tsx is missing ${name}`).toBe(true)
    }
  })
})

describe('srgbFill', () => {
  test('Given ink, When converted, Then it is the srgb triple with full alpha, five decimals each', () => {
    expect(srgbFill(INK)).toBe('srgb:0.06667,0.06667,0.06667,1.00000')
    expect(srgbFill(PAPER)).toBe('srgb:1.00000,1.00000,1.00000,1.00000')
    expect(srgbFill('#000000')).toBe('srgb:0.00000,0.00000,0.00000,1.00000')
  })

  test.each(['', '#fff', '111111', '#11111', '#1111111', '#gggggg', '#111111 ', 'rgb(1,1,1)'])('Given %j, When converted, Then throws', hex => {
    expect(() => srgbFill(hex)).toThrow(RangeError)
  })
})

describe('iconComposerGlyphSvg', () => {
  const svg = iconComposerGlyphSvg()

  test('Given the glyph layer, When drawn, Then it is a 1024 document holding only the paper figure with ink lines', () => {
    expect(svg).toContain('viewBox="0 0 1024 1024"')
    expect(svg).toContain(markBody({ figure: PAPER, line: INK }))
    expect(svg).not.toContain('feDropShadow')
    expect(svg).not.toContain(squirclePath(512, 512, 412))
    expect(svg).not.toContain(squirclePath(512, 512, 512))
  })

  test('Given the glyph layer, When placed, Then it is centred on the canvas at the same proportion as the full-tile app icon', () => {
    // The .icon's fill is the whole 1024 canvas, so the figure sits as it does on appIconSvg's full tile.
    const full = appIconSvg({ shadow: false, tile: 'full' })
    const transform = (s: string) => /<g transform="([^"]+)"/.exec(s)?.[1]
    expect(transform(svg)).toBe(transform(full))
  })
})

describe('iconComposerJson', () => {
  const doc = JSON.parse(iconComposerJson('glyph.svg'))

  test('Given the glyph file, When written, Then the fill is solid ink and the one layer is that file, flat', () => {
    expect(doc.fill).toEqual({ solid: srgbFill(INK) })
    expect(doc.groups).toHaveLength(1)
    expect(doc.groups[0].layers).toEqual([
      expect.objectContaining({ 'image-name': 'glyph.svg', name: 'glyph', glass: false, hidden: false }),
    ])
    expect(doc.groups[0].shadow.kind).toBe('none')
    expect(doc.groups[0].specular).toBe(false)
    expect(doc.groups[0].translucency.enabled).toBe(false)
    expect(doc['supported-platforms']).toEqual({ squares: ['macOS'] })
  })

  test('Given the output, When read back, Then it ends with a newline and round-trips as JSON', () => {
    const text = iconComposerJson('glyph.svg')
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.stringify(JSON.parse(text))).toBe(JSON.stringify(doc))
  })

  test.each(['', 'glyph', 'Assets/glyph.svg', '../glyph.svg', 'glyph.jpg', 'glyph.svg '])('Given %j as the glyph file, When written, Then throws', file => {
    expect(() => iconComposerJson(file)).toThrow(RangeError)
  })
})
