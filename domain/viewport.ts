// The preview pane's PC / phone toggle, as pure canvas arithmetic. The
// preview feeds the resulting size to the slide host as
// `--peitho-canvas-width/height`; a deck whose CSS branches on the canvas's
// own shape (`@container`) then lays itself out for a tall canvas. See
// `todo/preview-viewport-toggle.md` for the contract and its rationale.
import type { Size } from './geometry'

export type ViewportMode = 'desktop' | 'mobile'

export interface DevicePreset extends Size { name: string }

/** The one device the toggle simulates (no picker, by design). */
export const DEFAULT_DEVICE: DevicePreset = { name: 'Phone (portrait)', width: 390, height: 844 }

/** The other mode, for the preview's toggle button. A stray value that got
 * past the type is treated as PC display, as `effectiveCanvas` treats it, so
 * the next toggle lands on phone display. */
export function toggledViewportMode(mode: ViewportMode): ViewportMode {
  return mode === 'mobile' ? 'desktop' : 'mobile'
}

function isUsableDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** Keeps the deck's width and grows the height to the device's proportion,
 * rounded to a whole pixel (the same `Math.max(deck height, Math.round(...))`
 * rule the barefootjs overview viewer's `fitCanvas` applies). Never shrinks
 * below the deck's own height, so a landscape device leaves the canvas as it
 * is. A device with a non-finite or non-positive dimension carries no usable
 * proportion, so the deck comes back unchanged. There is no upper bound on
 * the height: `DEFAULT_DEVICE` is the only device the preview offers, so an
 * absurd proportion cannot arise until a device picker exists. */
export function reshapeCanvas(deck: Size, device: Size): Size {
  if (!isUsableDimension(device.width) || !isUsableDimension(device.height)) return deck
  const proportionalHeight = Math.round(deck.width * device.height / device.width)
  // Overflow (an absurd deck width times an absurd device height) is as
  // unusable as an invalid device.
  if (!Number.isFinite(proportionalHeight)) return deck
  return { width: deck.width, height: Math.max(deck.height, proportionalHeight) }
}

/** The canvas the preview should render at. `fixedCanvas` is the slide's own
 * `data-canvas="fixed"` opt-out (a layout authored in absolute 16:9
 * coordinates), which wins over the mode. */
export function effectiveCanvas(deck: Size, mode: ViewportMode, device: Size, fixedCanvas: boolean): Size {
  if (fixedCanvas) return deck
  switch (mode) {
    case 'desktop':
      return deck
    case 'mobile':
      return reshapeCanvas(deck, device)
    default: {
      // Compile-time exhaustiveness check; at runtime a stray mode is
      // treated as PC display rather than handed back as a non-Size.
      const _exhaustive: never = mode
      return deck
    }
  }
}

/** What phone display gives the canvas: `portrait` is the simulated phone's
 * tall proportion, `deck` keeps the deck's own proportion (so the canvas is
 * the same size as in PC display). */
export type PhoneShape = 'portrait' | 'deck'

/** The other phone shape, for the preview's shape toggle. A stray value that
 * got past the type is treated as `portrait`, as `deviceForShape` treats it,
 * so the next toggle lands on the deck's own proportion. */
export function toggledPhoneShape(shape: PhoneShape): PhoneShape {
  return shape === 'deck' ? 'portrait' : 'deck'
}

/** The device `effectiveCanvas` should reshape to for a phone shape.
 * `portrait` is `DEFAULT_DEVICE`. `deck` is the deck's own size: reshaping a
 * deck to its own proportion keeps its width and gives back its height, so
 * the canvas comes out the same as PC display's without `reshapeCanvas` or
 * `effectiveCanvas` knowing about shapes. A whole-pixel deck (the only kind
 * peitho-core produces) comes back exactly; a fractional height may round up
 * to the next whole pixel, and a deck with no usable size stays as it is
 * (`reshapeCanvas` refuses a device with no usable proportion). */
export function deviceForShape(shape: PhoneShape, deck: Size): Size {
  switch (shape) {
    case 'portrait':
      return DEFAULT_DEVICE
    case 'deck':
      return { width: deck.width, height: deck.height }
    default: {
      // Compile-time exhaustiveness check; at runtime a stray shape gets
      // the default phone proportion rather than a non-Size.
      const _exhaustive: never = shape
      return DEFAULT_DEVICE
    }
  }
}
