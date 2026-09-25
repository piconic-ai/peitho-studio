import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appIconSvg, BLUSH, ellipsePath, MARK_PATHS, markBody, markSmallBody, squirclePath, svgDocument } from './mark'

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

describe('ellipsePath', () => {
  test('Given a centre and radii, When drawn, Then it is two half-arcs starting at the left extreme and closing', () => {
    expect(ellipsePath(10, 20, 4, 2)).toBe('M6 20a4 2 0 1 0 8 0a4 2 0 1 0 -8 0Z')
  })

  test.each([[0, 1], [1, 0], [-1, 1], [Number.NaN, 1]])('Given radii (%p, %p), When drawn, Then throws', (rx, ry) => {
    expect(() => ellipsePath(0, 0, rx, ry)).toThrow(RangeError)
  })
})

describe('markBody / markSmallBody', () => {
  test('Given the defaults, When drawn, Then the full cut has the blush, the spiral and no rim', () => {
    const svg = markBody()
    expect(svg).toContain(BLUSH)
    expect(svg).toContain('a1.6 1.6') // spiral
    expect(svg).not.toContain('stroke-width="7"') // rim
  })

  test('Given blush: null, When drawn, Then neither cut uses the blush colour', () => {
    expect(markBody({ blush: null })).not.toContain(BLUSH)
    expect(markSmallBody({ blush: null })).not.toContain(BLUSH)
  })

  test('Given a rim colour, When drawn, Then the rim is drawn first, behind the head', () => {
    const svg = markBody({ rim: '#abcdef' })
    expect(svg.indexOf('#abcdef')).toBe(svg.indexOf('<g fill="#abcdef"') + '<g fill="'.length)
    expect(svg.indexOf('#abcdef')).toBeLessThan(svg.indexOf('#111111'))
  })

  test('Given the small cut, When drawn, Then it drops the spiral and mouth that turn to noise at 16 px', () => {
    const svg = markSmallBody()
    expect(svg).not.toContain('a1.6 1.6')
    expect(svg).not.toContain('q2.1 1.9') // mouth
  })
})

describe('appIconSvg / svgDocument', () => {
  test('Given the defaults, When drawn, Then it is a 1024 document with the macOS shadow', () => {
    const svg = appIconSvg()
    expect(svg).toContain('viewBox="0 0 1024 1024"')
    expect(svg).toContain('feDropShadow')
  })

  test('Given shadow: false and a full tile, When drawn, Then there is no filter and the tile reaches the canvas edge', () => {
    const svg = appIconSvg({ shadow: false, tile: 'full' })
    expect(svg).not.toContain('filter')
    expect(svg).toContain('M1024 512')
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
    expect(tsx).toContain(BLUSH)
  })
})
