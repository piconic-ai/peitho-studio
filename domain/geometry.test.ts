import { describe, expect, test } from 'bun:test'
import { clampMenuPosition, containScale } from './geometry'

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
    // 2000x720 available against a 1280x720 canvas: height is the tight
    // axis (scale 1), width has slack (scale 1.5625) — contain uses the
    // smaller of the two.
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
