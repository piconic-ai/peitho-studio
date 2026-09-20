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
