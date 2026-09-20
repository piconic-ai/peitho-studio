// Given-When-Then examples for the preview's PC / phone toggle — the
// human-readable source of truth for "what canvas size the preview slide is
// laid out at" (see docs/architecture.md's "Examples by Specification").
// Run by viewport.test.ts.
import type { Size } from './geometry'
import { defineExamples } from './spec'
import { DEFAULT_DEVICE, type ViewportMode } from './viewport'

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

const widescreen: Size = { width: 1280, height: 720 }
const standard: Size = { width: 960, height: 720 }

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
      then: 'the canvas keeps its 960 width and grows to 2078 high (2077.5 rounded to a whole pixel)',
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
