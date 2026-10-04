import { describe, expect, test } from 'bun:test'
import { clampMenuPosition, containScale, containSize, isDrag, isPointInRect, dropPointToCss, fractionInRect, pinInSlide } from './geometry'

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

describe('dropPointToCss', () => {
  test('spec: Given macOS on a Retina display, when a drop position is converted, then it is already in CSS pixels and unchanged', () => {
    expect(dropPointToCss({ x: 400, y: 300 }, 2, true)).toEqual({ x: 400, y: 300 })
  })

  test('spec: Given another platform on a scaled display, when converted, then it is divided by the scale', () => {
    expect(dropPointToCss({ x: 400, y: 300 }, 2, false)).toEqual({ x: 200, y: 150 })
  })

  test('spec: Given another platform on a standard display, when converted, then it is unchanged', () => {
    expect(dropPointToCss({ x: 400, y: 300 }, 1, false)).toEqual({ x: 400, y: 300 })
  })

  test('adversarial: Given a fractional scale, when converted off macOS, then the division is exact', () => {
    expect(dropPointToCss({ x: 300, y: 150 }, 1.5, false)).toEqual({ x: 200, y: 100 })
  })

  test('adversarial: Given a zero, negative, NaN or infinite scale, when converted, then the point is left as is on every platform', () => {
    for (const scale of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(dropPointToCss({ x: 4, y: 6 }, scale, false)).toEqual({ x: 4, y: 6 })
      expect(dropPointToCss({ x: 4, y: 6 }, scale, true)).toEqual({ x: 4, y: 6 })
    }
  })
})

describe('fractionInRect', () => {
  test('spec: Given a click at the middle of a box, Then it is halfway across and down', () => {
    expect(fractionInRect({ x: 150, y: 70 }, { left: 100, top: 20, right: 200, bottom: 120 })).toEqual({ x: 0.5, y: 0.5 })
  })

  test('spec: Given the top-left corner, Then it is 0, 0', () => {
    expect(fractionInRect({ x: 100, y: 20 }, { left: 100, top: 20, right: 200, bottom: 120 })).toEqual({ x: 0, y: 0 })
  })

  test('adversarial: Given a point outside the box, Then it is clamped to the edge', () => {
    expect(fractionInRect({ x: -50, y: 500 }, { left: 0, top: 0, right: 100, bottom: 100 })).toEqual({ x: 0, y: 1 })
  })

  test.each([
    ['no width', { left: 10, top: 0, right: 10, bottom: 100 }],
    ['no height', { left: 0, top: 5, right: 100, bottom: 5 }],
    ['a reversed box', { left: 100, top: 100, right: 0, bottom: 0 }],
    ['NaN edges', { left: Number.NaN, top: 0, right: 100, bottom: 100 }],
  ])('adversarial: Given a box with %s, Then there is no fraction', (_label, rect) => {
    expect(fractionInRect({ x: 1, y: 1 }, rect)).toBeNull()
  })
})

describe('pinInSlide', () => {
  const slide = { left: 100, top: 50, right: 500, bottom: 250 }

  test('spec: Given a spot inside an element, Then it is placed at the same spot of that element on the slide', () => {
    const element = { left: 140, top: 70, right: 340, bottom: 110 }
    expect(pinInSlide({ x: 0.5, y: 0.5 }, element, slide)).toEqual({ x: 0.35, y: 0.2 })
  })

  test('spec: Given the element laid out elsewhere (a reflowed slide), Then the pin follows it', () => {
    expect(pinInSlide({ x: 0, y: 0 }, { left: 100, top: 150, right: 300, bottom: 250 }, slide)).toEqual({ x: 0, y: 0.5 })
  })

  test('adversarial: Given a slide or an element with no area, Then there is no place', () => {
    expect(pinInSlide({ x: 0.5, y: 0.5 }, { left: 1, top: 1, right: 1, bottom: 9 }, slide)).toBeNull()
    expect(pinInSlide({ x: 0.5, y: 0.5 }, { left: 140, top: 70, right: 340, bottom: 110 }, { left: 0, top: 0, right: 0, bottom: 0 })).toBeNull()
  })

  test('adversarial: Given an element partly off the slide, Then the pin may fall outside 0-1 rather than be moved', () => {
    expect(pinInSlide({ x: 1, y: 1 }, { left: 400, top: 200, right: 600, bottom: 300 }, slide)).toEqual({ x: 1.25, y: 1.25 })
  })
})

describe('isDrag', () => {
  test('spec: Given a press and a release a few pixels apart, Then it is a click; further apart, a drag', () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 12, y: 13 }, 4)).toBe(false)
    expect(isDrag({ x: 10, y: 10 }, { x: 20, y: 10 }, 4)).toBe(true)
  })

  test('adversarial: Given exactly the slop, no press seen, or a non-number, Then the slop counts as a click, an unseen press as a click, and NaN as no drag', () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 4, y: 0 }, 4)).toBe(false)
    expect(isDrag(null, { x: 100, y: 100 }, 4)).toBe(false)
    expect(isDrag({ x: Number.NaN, y: 0 }, { x: 100, y: 0 }, 4)).toBe(false)
  })
})

describe('containSize', () => {
  test('spec: Given room wider than the canvas\'s proportion, Then the box takes the full height and the width that keeps the proportion', () => {
    expect(containSize({ width: 600, height: 300 }, { width: 390, height: 844 })).toEqual({ width: 138, height: 300 })
  })

  test('spec: Given room taller than the canvas\'s proportion, Then the box takes the full width', () => {
    expect(containSize({ width: 400, height: 1000 }, { width: 1280, height: 720 })).toEqual({ width: 400, height: 225 })
  })

  test('spec: Given room of exactly the canvas\'s proportion, Then the box fills it', () => {
    expect(containSize({ width: 640, height: 360 }, { width: 1280, height: 720 })).toEqual({ width: 640, height: 360 })
  })

  test('adversarial: Given a very tall or very wide canvas, Then the box fits inside the room, never past it', () => {
    expect(containSize({ width: 500, height: 300 }, { width: 1, height: 50 })).toEqual({ width: 6, height: 300 })
    expect(containSize({ width: 500, height: 300 }, { width: 50, height: 1 })).toEqual({ width: 500, height: 10 })
    // So thin it comes out under a pixel across: no box.
    expect(containSize({ width: 500, height: 300 }, { width: 1, height: 100000 })).toBeNull()
    expect(containSize({ width: 500, height: 300 }, { width: 100000, height: 1 })).toBeNull()
  })

  test('adversarial: Given no room or no canvas (zero, negative, NaN, Infinity), Then there is no box', () => {
    const bad = [0, -1, Number.NaN, Number.POSITIVE_INFINITY]
    for (const value of bad) {
      expect(containSize({ width: value, height: 300 }, { width: 16, height: 9 })).toBeNull()
      expect(containSize({ width: 300, height: value }, { width: 16, height: 9 })).toBeNull()
      expect(containSize({ width: 300, height: 300 }, { width: value, height: 9 })).toBeNull()
      expect(containSize({ width: 300, height: 300 }, { width: 16, height: value })).toBeNull()
    }
  })

  test('adversarial: Given room under a pixel on one side, Then there is no box rather than a zero-sized one', () => {
    expect(containSize({ width: 0.5, height: 300 }, { width: 16, height: 9 })).toBeNull()
  })
})

describe('containSize rounding', () => {
  test('adversarial: Given a scale whose product lands a hair under a whole pixel, Then that pixel is kept, and the box still never passes the room', () => {
    expect(containSize({ width: 368, height: 868 }, { width: 1280, height: 720 })).toEqual({ width: 368, height: 207 })
    expect(containSize({ width: 100.7, height: 100.7 }, { width: 1, height: 1 })).toEqual({ width: 100, height: 100 })
  })
})
