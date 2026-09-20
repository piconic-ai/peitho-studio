import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import type { Size } from './geometry'
import { isExhaustivelyAccountedFor } from './spec'
import { DEFAULT_DEVICE, effectiveCanvas, reshapeCanvas, type ViewportMode } from './viewport'
import { previewCanvasExamples } from './viewport.examples'

const widescreen: Size = { width: 1280, height: 720 }
const standard: Size = { width: 960, height: 720 }

describe('effectiveCanvas examples', () => {
  test.each(previewCanvasExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_title, example) => {
      const { deck, mode, device, fixedCanvas } = example.state
      expect(effectiveCanvas(deck, mode, device, fixedCanvas)).toEqual(example.expect)
    },
  )

  test('spec: every example is either automated or carries a manual reason', () => {
    expect(isExhaustivelyAccountedFor(previewCanvasExamples)).toBe(true)
  })
})

describe('DEFAULT_DEVICE', () => {
  test('spec: is a portrait phone, taller than it is wide', () => {
    expect(DEFAULT_DEVICE).toEqual({ name: 'Phone (portrait)', width: 390, height: 844 })
  })
})

describe('reshapeCanvas', () => {
  test('spec: a 16:9 deck takes the phone\'s proportion, keeping its width', () => {
    expect(reshapeCanvas(widescreen, DEFAULT_DEVICE)).toEqual({ width: 1280, height: 2770 })
  })

  test('spec: a 4:3 deck takes the phone\'s proportion, rounding half a pixel up', () => {
    expect(reshapeCanvas(standard, DEFAULT_DEVICE)).toEqual({ width: 960, height: 2078 })
  })

  test('spec: a device that is exactly the deck\'s own shape changes nothing', () => {
    expect(reshapeCanvas(widescreen, { width: 1920, height: 1080 })).toEqual(widescreen)
  })

  test('spec: a device passed as a full preset works the same as a bare size', () => {
    expect(reshapeCanvas(widescreen, DEFAULT_DEVICE)).toEqual(reshapeCanvas(widescreen, { width: 390, height: 844 }))
  })

  test('adversarial: a device with zero, negative, NaN or infinite width leaves the deck unchanged', () => {
    for (const width of [0, -390, -0, Number.NaN, Infinity, -Infinity]) {
      expect(reshapeCanvas(widescreen, { width, height: 844 })).toEqual(widescreen)
    }
  })

  test('adversarial: a device with zero, negative, NaN or infinite height leaves the deck unchanged', () => {
    for (const height of [0, -844, -0, Number.NaN, Infinity, -Infinity]) {
      expect(reshapeCanvas(widescreen, { width: 390, height })).toEqual(widescreen)
    }
  })

  test('adversarial: a device with both dimensions negative is not read as its positive mirror image', () => {
    // -390x-844 divides out to the same proportion as 390x844, so a check
    // that only looked at the resulting height would wrongly accept it.
    expect(reshapeCanvas(widescreen, { width: -390, height: -844 })).toEqual(widescreen)
  })

  test('adversarial: a landscape device does not shrink the canvas below the deck\'s height', () => {
    expect(reshapeCanvas(widescreen, { width: 844, height: 390 })).toEqual(widescreen)
    expect(reshapeCanvas(widescreen, { width: 1000000, height: 1 })).toEqual(widescreen)
  })

  test('adversarial: a square device is only as tall as the deck is wide', () => {
    expect(reshapeCanvas(widescreen, { width: 500, height: 500 })).toEqual({ width: 1280, height: 1280 })
    expect(reshapeCanvas(standard, { width: 500, height: 500 })).toEqual({ width: 960, height: 960 })
  })

  test('adversarial: an extremely tall device (1x10000) still gives a whole, finite height', () => {
    expect(reshapeCanvas(widescreen, { width: 1, height: 10000 })).toEqual({ width: 1280, height: 12800000 })
  })

  test('adversarial: a fractional device size (a scaled CSS pixel count) still rounds to a whole height', () => {
    const result = reshapeCanvas(widescreen, { width: 390.5, height: 844.25 })
    expect(Number.isInteger(result.height)).toBe(true)
    expect(result.height).toBe(Math.round(1280 * 844.25 / 390.5))
  })

  test('adversarial: an overflowing product (huge deck, huge device) falls back to the deck', () => {
    const huge = { width: Number.MAX_VALUE, height: 720 }
    expect(reshapeCanvas(huge, { width: 1, height: Number.MAX_VALUE })).toEqual(huge)
  })

  test('adversarial: a zero-sized deck stays zero-sized (there is no proportion to grow from)', () => {
    expect(reshapeCanvas({ width: 0, height: 0 }, DEFAULT_DEVICE)).toEqual({ width: 0, height: 0 })
  })

  test('adversarial: a zero-height deck still gets the device\'s proportional height', () => {
    expect(reshapeCanvas({ width: 1280, height: 0 }, DEFAULT_DEVICE)).toEqual({ width: 1280, height: 2770 })
  })

  test('adversarial: a NaN deck never throws and stays NaN', () => {
    const deck = { width: Number.NaN, height: Number.NaN }
    expect(() => reshapeCanvas(deck, DEFAULT_DEVICE)).not.toThrow()
    expect(reshapeCanvas(deck, DEFAULT_DEVICE)).toEqual(deck)
  })

  test('purity: does not mutate its inputs and repeats its answer', () => {
    const deck = Object.freeze({ width: 1280, height: 720 })
    const device = Object.freeze({ width: 390, height: 844 })
    const first = reshapeCanvas(deck, device)
    expect(reshapeCanvas(deck, device)).toEqual(first)
    expect(deck).toEqual({ width: 1280, height: 720 })
    expect(device).toEqual({ width: 390, height: 844 })
  })
})

describe('reshapeCanvas (properties)', () => {
  const deckArb = fc.record({ width: fc.integer({ min: 1, max: 8000 }), height: fc.integer({ min: 1, max: 8000 }) })
  // Includes the values a device could never legitimately hold, so the
  // properties below must survive them too.
  const deviceDimension = fc.oneof(
    fc.integer({ min: 1, max: 5000 }),
    fc.double({ min: 0.001, max: 5000, noNaN: true }),
    fc.constantFrom(0, -1, -0, Number.NaN, Infinity, -Infinity),
  )
  const deviceArb = fc.record({ width: deviceDimension, height: deviceDimension })

  test('property: the width is never changed', () => {
    fc.assert(fc.property(deckArb, deviceArb, (deck, device) => {
      expect(reshapeCanvas(deck, device).width).toBe(deck.width)
    }))
  })

  test('property: the height is never below the deck\'s own height', () => {
    fc.assert(fc.property(deckArb, deviceArb, (deck, device) => {
      expect(reshapeCanvas(deck, device).height).toBeGreaterThanOrEqual(deck.height)
    }))
  })

  test('property: a whole-pixel deck always yields a whole-pixel, finite canvas', () => {
    fc.assert(fc.property(deckArb, deviceArb, (deck, device) => {
      const { width, height } = reshapeCanvas(deck, device)
      expect(Number.isInteger(width)).toBe(true)
      expect(Number.isInteger(height)).toBe(true)
    }))
  })

  test('property: reshaping an already reshaped canvas changes nothing more', () => {
    fc.assert(fc.property(deckArb, deviceArb, (deck, device) => {
      const once = reshapeCanvas(deck, device)
      expect(reshapeCanvas(once, device)).toEqual(once)
    }))
  })

  test('property: a taller device never gives a shorter canvas', () => {
    fc.assert(fc.property(
      deckArb,
      fc.integer({ min: 1, max: 5000 }),
      fc.integer({ min: 1, max: 5000 }),
      fc.integer({ min: 0, max: 5000 }),
      (deck, deviceWidth, deviceHeight, extra) => {
        const shorter = reshapeCanvas(deck, { width: deviceWidth, height: deviceHeight })
        const taller = reshapeCanvas(deck, { width: deviceWidth, height: deviceHeight + extra })
        expect(taller.height).toBeGreaterThanOrEqual(shorter.height)
      },
    ))
  })
})

describe('effectiveCanvas', () => {
  test('spec: PC display returns the deck canvas untouched', () => {
    expect(effectiveCanvas(widescreen, 'desktop', DEFAULT_DEVICE, false)).toEqual(widescreen)
  })

  test('spec: phone display reshapes a normal slide', () => {
    expect(effectiveCanvas(widescreen, 'mobile', DEFAULT_DEVICE, false)).toEqual({ width: 1280, height: 2770 })
  })

  test('spec: phone display leaves a data-canvas="fixed" slide alone', () => {
    expect(effectiveCanvas(widescreen, 'mobile', DEFAULT_DEVICE, true)).toEqual(widescreen)
  })

  test('spec: the same call the preview makes, with width and height read as separate numbers', () => {
    // The preview memoizes width and height separately (an object memo would
    // remount the slide on every keystroke), so each is picked out of one
    // call's result on its own.
    const width = effectiveCanvas({ width: 1280, height: 720 }, 'mobile', DEFAULT_DEVICE, false).width
    const height = effectiveCanvas({ width: 1280, height: 720 }, 'mobile', DEFAULT_DEVICE, false).height
    expect({ width, height }).toEqual({ width: 1280, height: 2770 })
  })

  test('adversarial: a fixed slide stays put even with an unusable device', () => {
    expect(effectiveCanvas(widescreen, 'mobile', { width: 0, height: 0 }, true)).toEqual(widescreen)
  })

  test('adversarial: an unknown mode string is treated as PC display (only "mobile" reshapes)', () => {
    // The type forbids it, but a caller casting a stray string must neither
    // get a phone-shaped canvas by accident nor a non-Size back.
    for (const stray of ['tablet', '', 'MOBILE', undefined, null]) {
      expect(effectiveCanvas(widescreen, stray as unknown as ViewportMode, DEFAULT_DEVICE, false)).toEqual(widescreen)
    }
  })

  test('property: PC display and fixed slides are always the deck canvas, whatever the device', () => {
    fc.assert(fc.property(
      fc.record({ width: fc.integer({ min: 1, max: 8000 }), height: fc.integer({ min: 1, max: 8000 }) }),
      fc.record({ width: fc.double(), height: fc.double() }),
      fc.boolean(),
      (deck, device, fixedCanvas) => {
        expect(effectiveCanvas(deck, 'desktop', device, fixedCanvas)).toEqual(deck)
        expect(effectiveCanvas(deck, 'mobile', device, true)).toEqual(deck)
      },
    ))
  })

  test('property: phone display on a normal slide is exactly reshapeCanvas', () => {
    fc.assert(fc.property(
      fc.record({ width: fc.integer({ min: 1, max: 8000 }), height: fc.integer({ min: 1, max: 8000 }) }),
      fc.record({ width: fc.double(), height: fc.double() }),
      (deck, device) => {
        expect(effectiveCanvas(deck, 'mobile', device, false)).toEqual(reshapeCanvas(deck, device))
      },
    ))
  })
})
