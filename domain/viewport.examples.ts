// Given-When-Then examples for the preview's PC / phone toggle — the
// human-readable source of truth for "what canvas size the preview slide is
// laid out at" (see docs/architecture.md's "Examples by Specification").
// Run by viewport.test.ts.
import type { Size } from './geometry'
import { defineExamples } from './spec'
import { DEFAULT_DEVICE, type PhoneShape, type ViewportMode } from './viewport'

/** What the preview knows when it decides the canvas size. */
export interface PreviewCanvasInput {
  deck: Size
  mode: ViewportMode
  device: Size
  /** The selected slide's own `data-canvas="fixed"` opt-out. */
  fixedCanvas: boolean
}

/** The only event these examples describe: the preview laying out the
 * selected slide. */
type PreviewLaidOut = 'preview-laid-out'

/** The deck canvases peitho-core produces: 16:9 and 4:3. */
export const widescreen: Size = { width: 1280, height: 720 }
export const standard: Size = { width: 960, height: 720 }

export const previewCanvasExamples = defineExamples<PreviewCanvasInput, PreviewLaidOut, Size>(
  'preview canvas size',
  [
    {
      id: 'widescreen-deck-on-phone',
      given: 'a 16:9 deck (1280x720) and the phone preset (390x844) selected',
      when: 'the preview lays out a normal slide',
      then: 'the canvas keeps its 1280 width and grows to 2770 high, the phone\'s proportion',
      state: { deck: widescreen, mode: 'mobile', device: DEFAULT_DEVICE, fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 2770 },
    },
    {
      id: 'standard-deck-on-phone',
      given: 'a 4:3 deck (960x720) and the phone preset (390x844) selected',
      when: 'the preview lays out a normal slide',
      then: 'the canvas keeps its 960 width and grows to 2078 high (2077.54 rounded to a whole pixel)',
      state: { deck: standard, mode: 'mobile', device: DEFAULT_DEVICE, fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 960, height: 2078 },
    },
    {
      id: 'desktop-keeps-deck-canvas',
      given: 'PC display selected',
      when: 'the preview lays out a normal slide',
      then: 'the canvas stays the deck\'s own 1280x720',
      state: { deck: widescreen, mode: 'desktop', device: DEFAULT_DEVICE, fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
    },
    {
      id: 'fixed-slide-ignores-phone',
      given: 'the phone preset selected and a slide marked data-canvas="fixed" (authored in 16:9 coordinates)',
      when: 'the preview lays out that slide',
      then: 'the canvas stays 1280x720, so the slide is not stretched into a layout it was never drawn for',
      state: { deck: widescreen, mode: 'mobile', device: DEFAULT_DEVICE, fixedCanvas: true },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
      tags: ['boundary'],
    },
    {
      id: 'fixed-slide-on-desktop',
      given: 'PC display selected and a slide marked data-canvas="fixed"',
      when: 'the preview lays out that slide',
      then: 'the canvas stays 1280x720',
      state: { deck: widescreen, mode: 'desktop', device: DEFAULT_DEVICE, fixedCanvas: true },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
      tags: ['boundary'],
    },
    {
      id: 'landscape-device-never-shrinks',
      given: 'the phone display selected, but the simulated device is landscape (844x390)',
      when: 'the preview lays out a normal slide',
      then: 'the canvas keeps its 720 height instead of shrinking to 591',
      state: { deck: widescreen, mode: 'mobile', device: { width: 844, height: 390 }, fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
      tags: ['boundary'],
    },
    {
      id: 'unusable-device-keeps-deck-canvas',
      given: 'the phone display selected, but the device has no width (0x844)',
      when: 'the preview lays out a normal slide',
      then: 'the canvas stays the deck\'s own 1280x720 rather than becoming infinite or NaN',
      state: { deck: widescreen, mode: 'mobile', device: { width: 0, height: 844 }, fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
      tags: ['boundary'],
    },
  ],
)

/** What the preview knows when the phone shape is a choice: the device is no
 * longer an input, it follows from the shape and the deck
 * (`deviceForShape`). */
export interface PhoneShapeCanvasInput {
  deck: Size
  mode: ViewportMode
  shape: PhoneShape
  /** The selected slide's own `data-canvas="fixed"` opt-out. */
  fixedCanvas: boolean
}

export const phoneShapeCanvasExamples = defineExamples<PhoneShapeCanvasInput, PreviewLaidOut, Size>(
  'preview canvas size by phone shape',
  [
    {
      id: 'widescreen-phone-portrait',
      given: 'a 16:9 deck (1280x720), phone display, and the tall phone shape',
      when: 'the preview lays out a normal slide',
      then: 'the canvas grows to 1280x2770, the phone\'s proportion',
      state: { deck: widescreen, mode: 'mobile', shape: 'portrait', fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 2770 },
    },
    {
      id: 'widescreen-phone-deck-ratio',
      given: 'a 16:9 deck (1280x720), phone display, and the same ratio as PC',
      when: 'the preview lays out a normal slide',
      then: 'the canvas is 1280x720, the same size PC display gives',
      state: { deck: widescreen, mode: 'mobile', shape: 'deck', fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
    },
    {
      id: 'standard-phone-portrait',
      given: 'a 4:3 deck (960x720), phone display, and the tall phone shape',
      when: 'the preview lays out a normal slide',
      then: 'the canvas grows to 960x2078',
      state: { deck: standard, mode: 'mobile', shape: 'portrait', fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 960, height: 2078 },
    },
    {
      id: 'standard-phone-deck-ratio',
      given: 'a 4:3 deck (960x720), phone display, and the same ratio as PC',
      when: 'the preview lays out a normal slide',
      then: 'the canvas stays 960x720, the deck\'s own 4:3',
      state: { deck: standard, mode: 'mobile', shape: 'deck', fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 960, height: 720 },
    },
    {
      id: 'desktop-ignores-portrait-shape',
      given: 'PC display selected while the tall phone shape is remembered',
      when: 'the preview lays out a normal slide',
      then: 'the canvas is the deck\'s own 1280x720: the shape only matters in phone display',
      state: { deck: widescreen, mode: 'desktop', shape: 'portrait', fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
      tags: ['boundary'],
    },
    {
      id: 'desktop-ignores-deck-ratio-shape',
      given: 'PC display selected while the same-ratio shape is remembered',
      when: 'the preview lays out a normal slide',
      then: 'the canvas is the deck\'s own 1280x720',
      state: { deck: widescreen, mode: 'desktop', shape: 'deck', fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
      tags: ['boundary'],
    },
    {
      id: 'fixed-slide-ignores-portrait-shape',
      given: 'phone display with the tall phone shape and a slide marked data-canvas="fixed"',
      when: 'the preview lays out that slide',
      then: 'the canvas stays 1280x720',
      state: { deck: widescreen, mode: 'mobile', shape: 'portrait', fixedCanvas: true },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
      tags: ['boundary'],
    },
    {
      id: 'fixed-slide-ignores-deck-ratio-shape',
      given: 'phone display with the same ratio as PC and a slide marked data-canvas="fixed"',
      when: 'the preview lays out that slide',
      then: 'the canvas stays 1280x720',
      state: { deck: widescreen, mode: 'mobile', shape: 'deck', fixedCanvas: true },
      event: 'preview-laid-out',
      expect: { width: 1280, height: 720 },
      tags: ['boundary'],
    },
    {
      id: 'zero-sized-deck-ratio-phone',
      given: 'a deck with no size (0x0), phone display, and the same ratio as PC',
      when: 'the preview lays out a normal slide',
      then: 'the canvas stays 0x0 instead of becoming NaN or infinite',
      state: { deck: { width: 0, height: 0 }, mode: 'mobile', shape: 'deck', fixedCanvas: false },
      event: 'preview-laid-out',
      expect: { width: 0, height: 0 },
      tags: ['boundary'],
    },
  ],
)
