import { describe, expect, test } from 'bun:test'
import { clampMenuPosition, containScale, isPointInRect, physicalToCssPoint } from './geometry'

describe('clampMenuPosition', () => {
  test('spec: a point that already fits within the viewport is left unchanged', () => {
    expect(clampMenuPosition({ x: 50, y: 50 }, { width: 200, height: 100 }, { width: 1000, height: 800 }, 8)).toEqual({ x: 50, y: 50 })
  })

  test('spec: a point past the right edge is shifted left to keep the menu on-screen', () => {
    expect(clampMenuPosition({ x: 950, y: 50 }, { width: 200, height: 100 }, { width: 1000, height: 800 }, 8)).toEqual({ x: 792, y: 50 })
  })

  test('spec: a point past the bottom edge is shifted up to keep the menu on-screen', () => {
    expect(clampMenuPosition({ x: 50, y: 780 }, { width: 200, height: 100 }, { width: 1000, height: 800 }, 8)).toEqual({ x: 50, y: 692 })
  })

  test('spec: a point past both edges shifts both axes independently', () => {
    expect(clampMenuPosition({ x: 950, y: 780 }, { width: 200, height: 100 }, { width: 1000, height: 800 }, 8)).toEqual({ x: 792, y: 692 })
  })

  test('adversarial: a menu larger than the viewport clamps to margin rather than going negative', () => {
    expect(clampMenuPosition({ x: 500, y: 500 }, { width: 2000, height: 2000 }, { width: 1000, height: 800 }, 8)).toEqual({ x: 8, y: 8 })
  })

  test('adversarial: a point already off-screen to the left/top is left as-is (only the far edge is clamped)', () => {
    expect(clampMenuPosition({ x: -50, y: -50 }, { width: 200, height: 100 }, { width: 1000, height: 800 }, 8)).toEqual({ x: -50, y: -50 })
  })

  test('adversarial: zero margin still keeps the menu flush with the viewport edge, not past it', () => {
    expect(clampMenuPosition({ x: 950, y: 50 }, { width: 200, height: 100 }, { width: 1000, height: 800 }, 0)).toEqual({ x: 800, y: 50 })
  })
})

describe('containScale', () => {
  test('spec: a wider-than-canvas box is limited by height, not width', () => {
    // The tight axis is an exact 1:1 fit, so 1.02 here is purely the overscan.
    expect(containScale({ width: 2000, height: 720 }, { width: 1280, height: 720 })).toBeCloseTo(1.02, 5)
  })

  test('spec: a taller-than-canvas box is limited by width, not height', () => {
    expect(containScale({ width: 1280, height: 2000 }, { width: 1280, height: 720 })).toBeCloseTo(1.02, 5)
  })

  test('spec: half-size available box halves the scale (plus overscan)', () => {
    expect(containScale({ width: 640, height: 360 }, { width: 1280, height: 720 })).toBeCloseTo(0.51, 5)
  })

  test('adversarial: a zero-size available box scales to zero, not NaN/Infinity', () => {
    expect(containScale({ width: 0, height: 0 }, { width: 1280, height: 720 })).toBe(0)
  })

  test('adversarial: a zero-size canvas produces Infinity rather than throwing', () => {
    expect(containScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(Infinity)
  })
})

describe('isPointInRect', () => {
  const rect = { left: 10, top: 20, right: 110, bottom: 220 }

  test('spec: Given a drop inside the editor, when checked, then it is inside', () => {
    expect(isPointInRect({ x: 50, y: 100 }, rect)).toBe(true)
  })

  test('spec: Given a drop on another pane, when checked, then it is outside', () => {
    expect(isPointInRect({ x: 500, y: 100 }, rect)).toBe(false)
    expect(isPointInRect({ x: 50, y: 5 }, rect)).toBe(false)
  })

  test('adversarial: Given a point exactly on each edge, when checked, then it counts as inside', () => {
    for (const point of [{ x: 10, y: 20 }, { x: 110, y: 220 }, { x: 10, y: 220 }, { x: 110, y: 20 }]) {
      expect(isPointInRect(point, rect)).toBe(true)
    }
  })

  test('adversarial: Given a zero-size box or NaN coordinates, when checked, then nothing is inside but its one point', () => {
    const empty = { left: 0, top: 0, right: 0, bottom: 0 }
    expect(isPointInRect({ x: 0, y: 0 }, empty)).toBe(true)
    expect(isPointInRect({ x: 1, y: 0 }, empty)).toBe(false)
    expect(isPointInRect({ x: Number.NaN, y: 50 }, rect)).toBe(false)
  })
})

describe('physicalToCssPoint', () => {
  test('spec: Given a Retina display, when a drop position is converted, then it is halved', () => {
    expect(physicalToCssPoint({ x: 400, y: 300 }, 2)).toEqual({ x: 200, y: 150 })
  })

  test('spec: Given a standard display, when converted, then it is unchanged', () => {
    expect(physicalToCssPoint({ x: 400, y: 300 }, 1)).toEqual({ x: 400, y: 300 })
  })

  test('adversarial: Given a fractional scale, when converted, then the division is exact', () => {
    expect(physicalToCssPoint({ x: 300, y: 150 }, 1.5)).toEqual({ x: 200, y: 100 })
  })

  test('adversarial: Given a zero, negative, NaN or infinite scale, when converted, then the point is left as is', () => {
    for (const scale of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(physicalToCssPoint({ x: 4, y: 6 }, scale)).toEqual({ x: 4, y: 6 })
    }
  })
})
