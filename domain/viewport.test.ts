import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { isExhaustivelyAccountedFor } from './spec'
import {
  DEFAULT_DEVICE,
  DEVICE_PRESETS,
  deviceDimensions,
  deviceForShape,
  deviceIconRect,
  devicePreset,
  effectiveCanvas,
  reshapeCanvas,
  toggledViewportMode,
  viewportCanvas,
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

describe('DEVICE_PRESETS', () => {
  test('spec: Given the phone shape menu, Then it offers a small phone, a standard phone, a large phone and a tablet, in that order, each sized as Safari\'s visible area in portrait', () => {
    expect(DEVICE_PRESETS).toEqual([
      { id: 'small-phone', model: 'iPhone SE', width: 375, height: 548 },
      { id: 'phone', model: 'iPhone 15', width: 390, height: 664 },
      { id: 'large-phone', model: 'iPhone 15 Pro Max', width: 430, height: 740 },
      { id: 'tablet', model: 'iPad', width: 820, height: 1030 },
    ])
  })

  test('spec: Given a fresh window, Then phone display starts on the standard phone', () => {
    expect(DEFAULT_DEVICE).toBe(devicePreset('phone')!)
  })

  test('spec: every preset is portrait (taller than wide), whole-pixel, and has its own id', () => {
    for (const preset of DEVICE_PRESETS) {
      expect(preset.height).toBeGreaterThan(preset.width)
      expect(Number.isInteger(preset.width) && Number.isInteger(preset.height)).toBe(true)
    }
    expect(new Set(DEVICE_PRESETS.map(preset => preset.id)).size).toBe(DEVICE_PRESETS.length)
  })

  test('spec: no preset is wider than 820px, the widest screen the known tall-canvas viewer script still grows', () => {
    // A wider device would keep the deck's 16:9 there, so simulating a tall
    // canvas for it would show a layout the viewer never does.
    for (const preset of DEVICE_PRESETS) expect(preset.width).toBeLessThanOrEqual(820)
  })

  test('spec: on a 16:9 deck the phones are ordered by how tall they make the canvas, and the tablet is the least tall of all', () => {
    const height = (id: string) => reshapeCanvas(widescreen, devicePreset(id)!).height
    expect(height('small-phone')).toBeLessThan(height('phone'))
    expect(height('phone')).toBeLessThan(height('large-phone'))
    expect(height('tablet')).toBeLessThan(height('small-phone'))
    expect(height('tablet')).toBeGreaterThan(widescreen.height)
  })
})

describe('devicePreset', () => {
  test('spec: each id finds its own preset', () => {
    for (const preset of DEVICE_PRESETS) expect(devicePreset(preset.id)).toBe(preset)
  })

  test('adversarial: the deck shape, an empty string, a different case, and Object.prototype member names are not presets', () => {
    for (const stray of ['deck', '', 'PHONE', ' phone', 'portrait', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(devicePreset(stray)).toBeUndefined()
    }
  })

  test('adversarial: a non-string past the type is not a preset either', () => {
    for (const stray of [undefined, null, 0, {}, []]) {
      expect(devicePreset(stray as unknown as string)).toBeUndefined()
    }
  })
})

describe('deviceDimensions', () => {
  test('spec: writes width × height, as the menu shows it', () => {
    expect(deviceDimensions(devicePreset('small-phone')!)).toBe('375×548')
    expect(deviceDimensions(devicePreset('tablet')!)).toBe('820×1030')
  })

  test('adversarial: zero, negative, fractional and non-finite sizes are written as they are, never thrown on', () => {
    expect(deviceDimensions({ width: 0, height: 0 })).toBe('0×0')
    expect(deviceDimensions({ width: -1, height: 2.5 })).toBe('-1×2.5')
    expect(deviceDimensions({ width: Number.NaN, height: Infinity })).toBe('NaN×Infinity')
  })
})

describe('deviceIconRect', () => {
  test('spec: a portrait device is drawn 20 high, as wide as its proportion in whole pixels (rounded down), centred in the 24x24 icon', () => {
    // 20 * 390 / 664 = 11.75
    expect(deviceIconRect({ width: 390, height: 664 })).toEqual({ x: 6.5, y: 2, width: 11, height: 20 })
  })

  test('spec: a landscape device (the deck\'s own 16:9) is drawn 20 wide and shorter than it is wide', () => {
    // 20 * 720 / 1280 = 11.25
    expect(deviceIconRect({ width: 1280, height: 720 })).toEqual({ x: 2, y: 6.5, width: 20, height: 11 })
  })

  test('adversarial: a device so lopsided its short side would be under a pixel gets the whole square', () => {
    expect(deviceIconRect({ width: 1, height: 100 })).toEqual({ x: 2, y: 2, width: 20, height: 20 })
  })

  test('spec: the tablet\'s icon is wider than every phone\'s, so the menu tells them apart at a glance', () => {
    const width = (id: string) => deviceIconRect(devicePreset(id)!).width
    for (const phone of ['small-phone', 'phone', 'large-phone']) expect(width('tablet')).toBeGreaterThan(width(phone))
  })

  test('adversarial: a square device fills the box', () => {
    expect(deviceIconRect({ width: 5, height: 5 })).toEqual({ x: 2, y: 2, width: 20, height: 20 })
  })

  test('adversarial: a device with a zero, negative, NaN or infinite dimension gets the whole square, never NaN', () => {
    for (const bad of [0, -390, Number.NaN, Infinity, -Infinity]) {
      expect(deviceIconRect({ width: bad, height: 664 })).toEqual({ x: 2, y: 2, width: 20, height: 20 })
      expect(deviceIconRect({ width: 390, height: bad })).toEqual({ x: 2, y: 2, width: 20, height: 20 })
    }
  })

  test('property: the rectangle always stays inside the 24x24 icon with a positive size', () => {
    fc.assert(fc.property(deviceArb, device => {
      const rect = deviceIconRect(device)
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.height).toBeGreaterThan(0)
      expect(rect.x).toBeGreaterThanOrEqual(2)
      expect(rect.y).toBeGreaterThanOrEqual(2)
      expect(rect.x + rect.width).toBeLessThanOrEqual(22 + 1e-9)
      expect(rect.y + rect.height).toBeLessThanOrEqual(22 + 1e-9)
    }))
  })
})

describe('reshapeCanvas', () => {
  test('spec: a 16:9 deck takes the phone\'s proportion, keeping its width', () => {
    expect(reshapeCanvas(widescreen, DEFAULT_DEVICE)).toEqual({ width: 1280, height: 2179 })
  })

  test('spec: a 4:3 deck takes the phone\'s proportion, rounded to the nearest whole pixel', () => {
    // 960 * 664 / 390 = 1634.46, so it rounds down.
    expect(reshapeCanvas(standard, DEFAULT_DEVICE)).toEqual({ width: 960, height: 1634 })
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
    expect(reshapeCanvas({ width: 1280, height: 0 }, DEFAULT_DEVICE)).toEqual({ width: 1280, height: 2179 })
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

describe('deviceForShape', () => {
  test('spec: the standard phone shape is the default device, whatever the deck', () => {
    expect(deviceForShape('phone', widescreen)).toBe(DEFAULT_DEVICE)
    expect(deviceForShape('phone', standard)).toBe(DEFAULT_DEVICE)
  })

  test('spec: the deck-ratio shape is the deck\'s own size', () => {
    expect(deviceForShape('deck', widescreen)).toEqual({ width: 1280, height: 720 })
    expect(deviceForShape('deck', standard)).toEqual({ width: 960, height: 720 })
  })

  test('spec: reshaping a deck to its own-size device gives the deck back (16:9 and 4:3)', () => {
    expect(reshapeCanvas(widescreen, deviceForShape('deck', widescreen))).toEqual(widescreen)
    expect(reshapeCanvas(standard, deviceForShape('deck', standard))).toEqual(standard)
  })

  test('spec: on a 4:3 deck the standard phone grows the canvas to 960x1634 while the deck-ratio shape leaves it at 960x720', () => {
    expect(effectiveCanvas(standard, 'mobile', deviceForShape('phone', standard), false)).toEqual({ width: 960, height: 1634 })
    expect(effectiveCanvas(standard, 'mobile', deviceForShape('deck', standard), false)).toEqual(standard)
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

  test('spec: each device shape is its own preset, whatever the deck', () => {
    for (const preset of DEVICE_PRESETS) {
      expect(deviceForShape(preset.id, widescreen)).toBe(preset)
      expect(deviceForShape(preset.id, standard)).toBe(preset)
    }
  })

  test('adversarial: an unknown shape string gets the default phone (only "deck" keeps the deck\'s proportion)', () => {
    // 'portrait' was the one tall shape before the presets: a value left
    // over from it lands on the standard phone, as it used to.
    for (const stray of ['landscape', '', 'DECK', 'portrait', 'constructor', '__proto__', undefined, null]) {
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

  test('property: the standard phone shape is the default device for any deck at all, however unusable', () => {
    fc.assert(fc.property(deviceArb, deck => {
      expect(deviceForShape('phone', deck)).toBe(DEFAULT_DEVICE)
    }))
  })

  test('property: for any deck, the deck-ratio shape neither throws nor changes the width', () => {
    fc.assert(fc.property(deviceArb, deck => {
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

describe('viewportCanvas', () => {
  test('spec: Given PC display, When a slide is laid out, Then it is on the deck\'s own canvas', () => {
    expect(viewportCanvas(widescreen, 'desktop', 'phone', false)).toEqual(widescreen)
  })

  test('spec: Given phone display with the standard phone, When a 16:9 slide is laid out, Then the canvas keeps its width and grows to the phone\'s proportion', () => {
    expect(viewportCanvas(widescreen, 'mobile', 'phone', false)).toEqual({ width: 1280, height: 2179 })
  })

  test('spec: Given phone display with the deck\'s own shape, When a slide is laid out, Then it is on the deck\'s own canvas', () => {
    expect(viewportCanvas(standard, 'mobile', 'deck', false)).toEqual(standard)
  })

  test('spec: Given a fixed-canvas slide, When phone display is on, Then it stays on the deck\'s own canvas', () => {
    expect(viewportCanvas(widescreen, 'mobile', 'phone', true)).toEqual(widescreen)
  })

  test('adversarial: Given a stray mode or shape past the types, Then it is PC display or the default phone, never a non-Size', () => {
    expect(viewportCanvas(widescreen, 'tablet' as ViewportMode, 'phone', false)).toEqual(widescreen)
    expect(viewportCanvas(widescreen, 'mobile', 'square' as PhoneShape, false)).toEqual({ width: 1280, height: 2179 })
  })

  test('adversarial: Given a deck with no usable size, Then it comes back as it is', () => {
    for (const deck of [{ width: 0, height: 0 }, { width: Number.NaN, height: 720 }, { width: -1280, height: -720 }]) {
      expect(viewportCanvas(deck, 'mobile', 'deck', false)).toEqual(deck)
    }
  })

  test('property: it is always effectiveCanvas with the shape\'s device', () => {
    fc.assert(fc.property(
      fc.record({ width: fc.integer({ min: 1, max: 8000 }), height: fc.integer({ min: 1, max: 8000 }) }),
      fc.constantFrom<ViewportMode>('desktop', 'mobile'),
      fc.constantFrom<PhoneShape>('small-phone', 'phone', 'large-phone', 'tablet', 'deck'),
      fc.boolean(),
      (deck, mode, shape, fixed) => {
        expect(viewportCanvas(deck, mode, shape, fixed)).toEqual(effectiveCanvas(deck, mode, deviceForShape(shape, deck), fixed))
      },
    ))
  })
})
