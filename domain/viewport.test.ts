import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { isExhaustivelyAccountedFor } from './spec'
import {
  DEFAULT_DEVICE,
  deviceForShape,
  effectiveCanvas,
  reshapeCanvas,
  toggledViewportMode,
  type PhoneShape,
  type ViewportMode,
} from './viewport'
import { phoneShapeCanvasExamples, previewCanvasExamples, standard, widescreen } from './viewport.examples'

const deckArb = fc.record({ width: fc.integer({ min: 1, max: 8000 }), height: fc.integer({ min: 1, max: 8000 }) })
// Includes the values a device could never legitimately hold, so the
// properties below must survive them too.
const deviceDimension = fc.oneof(
  fc.integer({ min: 1, max: 5000 }),
  fc.double({ min: 0.001, max: 5000, noNaN: true }),
  fc.constantFrom(0, -1, -0, Number.NaN, Infinity, -Infinity),
)
const deviceArb = fc.record({ width: deviceDimension, height: deviceDimension })

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

  test('spec: a 4:3 deck takes the phone\'s proportion, rounded to the nearest whole pixel', () => {
    // 960 * 844 / 390 = 2077.54, so it rounds up.
    expect(reshapeCanvas(standard, DEFAULT_DEVICE)).toEqual({ width: 960, height: 2078 })
  })

  test('spec: a height that lands exactly halfway rounds up', () => {
    // 1001 * 1 / 2 = 500.5 exactly, so the tie-break is what is pinned here.
    expect(reshapeCanvas({ width: 1001, height: 100 }, { width: 2, height: 1 })).toEqual({ width: 1001, height: 501 })
  })

  test('spec: a height just under halfway rounds down', () => {
    // 1000 * 1 / 3 = 333.33
    expect(reshapeCanvas({ width: 1000, height: 100 }, { width: 3, height: 1 })).toEqual({ width: 1000, height: 333 })
  })

  test('spec: a device that is exactly the deck\'s own shape changes nothing', () => {
    expect(reshapeCanvas(widescreen, { width: 1920, height: 1080 })).toEqual(widescreen)
  })

  test('adversarial: a device with a zero, negative, NaN or infinite dimension leaves the deck unchanged', () => {
    for (const bad of [0, -390, -0, Number.NaN, Infinity, -Infinity]) {
      expect(reshapeCanvas(widescreen, { width: bad, height: 844 })).toEqual(widescreen)
      expect(reshapeCanvas(widescreen, { width: 390, height: bad })).toEqual(widescreen)
    }
  })

  test('adversarial: a device with both dimensions negative is not read as its positive mirror image', () => {
    // -390x-844 divides out to the same proportion as 390x844, so a check
    // that only looked at the resulting height would wrongly accept it.
    expect(reshapeCanvas(widescreen, { width: -390, height: -844 })).toEqual(widescreen)
  })

  test('adversarial: an extremely wide device (1000000x1) does not shrink the canvas below the deck\'s height', () => {
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

  test('adversarial: a NaN deck stays NaN rather than throwing', () => {
    const deck = { width: Number.NaN, height: Number.NaN }
    expect(reshapeCanvas(deck, DEFAULT_DEVICE)).toEqual(deck)
  })

  test('purity: works on frozen inputs (a mutation would throw) and repeats its answer', () => {
    const deck = Object.freeze({ width: 1280, height: 720 })
    const device = Object.freeze({ width: 390, height: 844 })
    expect(reshapeCanvas(deck, device)).toEqual(reshapeCanvas(deck, device))
  })
})

describe('reshapeCanvas (properties)', () => {
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

  test('property: a whole-pixel deck always yields a whole-pixel, finite height', () => {
    fc.assert(fc.property(deckArb, deviceArb, (deck, device) => {
      expect(Number.isInteger(reshapeCanvas(deck, device).height)).toBe(true)
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

// The typical cases (PC display, phone display, fixed slide) are the
// examples run at the top of this file.
describe('effectiveCanvas', () => {
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
    fc.assert(fc.property(deckArb, deviceArb, fc.boolean(), (deck, device, fixedCanvas) => {
      expect(effectiveCanvas(deck, 'desktop', device, fixedCanvas)).toEqual(deck)
      expect(effectiveCanvas(deck, 'mobile', device, true)).toEqual(deck)
    }))
  })

  test('property: phone display on a normal slide is exactly reshapeCanvas', () => {
    fc.assert(fc.property(deckArb, deviceArb, (deck, device) => {
      expect(effectiveCanvas(deck, 'mobile', device, false)).toEqual(reshapeCanvas(deck, device))
    }))
  })
})

describe('toggledViewportMode', () => {
  test('spec: PC display toggles to phone display and back', () => {
    expect(toggledViewportMode('desktop')).toBe('mobile')
    expect(toggledViewportMode('mobile')).toBe('desktop')
  })

  test('adversarial: an unknown mode string is treated as PC display, so it toggles to phone display', () => {
    for (const stray of ['tablet', '', 'MOBILE', undefined, null]) {
      expect(toggledViewportMode(stray as unknown as ViewportMode)).toBe('mobile')
    }
  })

  test('property: toggling twice returns to where it started', () => {
    fc.assert(fc.property(fc.constantFrom<ViewportMode>('desktop', 'mobile'), mode => {
      expect(toggledViewportMode(toggledViewportMode(mode))).toBe(mode)
    }))
  })
})

describe('phone shape canvas examples', () => {
  test.each(phoneShapeCanvasExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_title, example) => {
      const { deck, mode, shape, fixedCanvas } = example.state
      // The composition `Studio.tsx` performs for the preview.
      expect(effectiveCanvas(deck, mode, deviceForShape(shape, deck), fixedCanvas)).toEqual(example.expect)
    },
  )

  test('spec: every example is either automated or carries a manual reason', () => {
    expect(isExhaustivelyAccountedFor(phoneShapeCanvasExamples)).toBe(true)
  })
})

// A double that can be a fraction, zero, negative, NaN or infinite: every
// value a deck should never carry but the properties below must survive.
const wildDimension = fc.oneof(
  fc.integer({ min: 1, max: 8000 }),
  fc.double({ min: 0.001, max: 8000, noNaN: true }),
  fc.constantFrom(0, -1, -0, Number.NaN, Infinity, -Infinity),
)
const wildDeckArb = fc.record({ width: wildDimension, height: wildDimension })

describe('deviceForShape', () => {
  test('spec: the tall phone shape is the default phone, whatever the deck', () => {
    expect(deviceForShape('portrait', widescreen)).toBe(DEFAULT_DEVICE)
    expect(deviceForShape('portrait', standard)).toBe(DEFAULT_DEVICE)
  })

  test('spec: the deck-ratio shape is the deck\'s own size', () => {
    expect(deviceForShape('deck', widescreen)).toEqual({ width: 1280, height: 720 })
    expect(deviceForShape('deck', standard)).toEqual({ width: 960, height: 720 })
  })

  test('spec: reshaping a deck to its own-size device gives the deck back (16:9 and 4:3)', () => {
    expect(reshapeCanvas(widescreen, deviceForShape('deck', widescreen))).toEqual(widescreen)
    expect(reshapeCanvas(standard, deviceForShape('deck', standard))).toEqual(standard)
  })

  test('spec: on a 4:3 deck the tall shape grows the canvas to 960x2078 while the deck-ratio shape leaves it at 960x720', () => {
    expect(effectiveCanvas(standard, 'mobile', deviceForShape('portrait', standard), false)).toEqual({ width: 960, height: 2078 })
    expect(effectiveCanvas(standard, 'mobile', deviceForShape('deck', standard), false)).toEqual(standard)
  })

  test('adversarial: the tall phone shape ignores an unusable deck', () => {
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      expect(deviceForShape('portrait', { width: bad, height: bad })).toBe(DEFAULT_DEVICE)
    }
  })

  test('adversarial: a deck with a zero, negative, NaN or infinite dimension stays as it is (no NaN or infinite canvas)', () => {
    for (const bad of [0, -390, -0, Number.NaN, Infinity, -Infinity]) {
      for (const deck of [{ width: bad, height: 720 }, { width: 1280, height: bad }, { width: bad, height: bad }]) {
        expect(effectiveCanvas(deck, 'mobile', deviceForShape('deck', deck), false)).toEqual(deck)
      }
    }
  })

  test('adversarial: a deck with both dimensions negative is not read as its positive mirror image', () => {
    const deck = { width: -1280, height: -720 }
    expect(effectiveCanvas(deck, 'mobile', deviceForShape('deck', deck), false)).toEqual(deck)
  })

  test('adversarial: a fractional height below the half-pixel keeps the deck\'s own height', () => {
    // Math.round(720.3) is 720, which the deck's own 720.3 outgrows.
    expect(effectiveCanvas({ width: 1280, height: 720.3 }, 'mobile', deviceForShape('deck', { width: 1280, height: 720.3 }), false))
      .toEqual({ width: 1280, height: 720.3 })
  })

  test('adversarial: a fractional height past the half-pixel rounds up to the next whole pixel, never down', () => {
    // Pinned so that nobody expects an exact identity for a fractional deck:
    // peitho-core only produces whole-pixel canvases, where it is exact.
    const deck = { width: 1280, height: 720.7 }
    expect(effectiveCanvas(deck, 'mobile', deviceForShape('deck', deck), false)).toEqual({ width: 1280, height: 721 })
  })

  test('adversarial: an extreme but usable deck (very wide, very tall) comes back whole', () => {
    for (const deck of [{ width: 1, height: 1 }, { width: 100000, height: 1 }, { width: 1, height: 100000 }, { width: 8000, height: 8000 }]) {
      expect(effectiveCanvas(deck, 'mobile', deviceForShape('deck', deck), false)).toEqual(deck)
    }
  })

  test('adversarial: an overflowing deck (huge width times huge height) falls back to the deck', () => {
    const huge = { width: Number.MAX_VALUE, height: Number.MAX_VALUE }
    expect(effectiveCanvas(huge, 'mobile', deviceForShape('deck', huge), false)).toEqual(huge)
  })

  test('adversarial: an unknown shape string gets the default phone (only "deck" keeps the deck\'s proportion)', () => {
    for (const stray of ['landscape', '', 'DECK', undefined, null]) {
      expect(deviceForShape(stray as unknown as PhoneShape, widescreen)).toBe(DEFAULT_DEVICE)
    }
  })

  test('purity: works on a frozen deck, repeats its answer, and hands back a copy rather than the deck itself', () => {
    const deck = Object.freeze({ width: 1280, height: 720 })
    const first = deviceForShape('deck', deck)
    expect(first).toEqual(deviceForShape('deck', deck))
    expect(first).not.toBe(deck)
  })

  test('property: a whole-pixel deck in phone display with the deck-ratio shape is exactly the deck', () => {
    fc.assert(fc.property(deckArb, deck => {
      expect(effectiveCanvas(deck, 'mobile', deviceForShape('deck', deck), false)).toEqual(deck)
    }))
  })

  test('property: the tall phone shape is the default phone for any deck at all', () => {
    fc.assert(fc.property(wildDeckArb, deck => {
      expect(deviceForShape('portrait', deck)).toBe(DEFAULT_DEVICE)
    }))
  })

  test('property: for any deck, the deck-ratio shape neither throws nor changes the width', () => {
    fc.assert(fc.property(wildDeckArb, deck => {
      const canvas = effectiveCanvas(deck, 'mobile', deviceForShape('deck', deck), false)
      expect(Object.is(canvas.width, deck.width)).toBe(true)
    }))
  })

  test('property: for a usable fractional deck, the deck-ratio shape never shrinks the height and grows it by under one pixel', () => {
    const usable = fc.record({
      width: fc.double({ min: 0.001, max: 8000, noNaN: true }),
      height: fc.double({ min: 0.001, max: 8000, noNaN: true }),
    })
    fc.assert(fc.property(usable, deck => {
      const canvas = effectiveCanvas(deck, 'mobile', deviceForShape('deck', deck), false)
      expect(canvas.height).toBeGreaterThanOrEqual(deck.height)
      expect(canvas.height - deck.height).toBeLessThan(1)
    }))
  })
})
