// The preview pane's PC / phone toggle, as pure canvas arithmetic. The
// preview feeds the resulting size to the slide host as
// `--peitho-canvas-width/height`; a deck whose CSS branches on the canvas's
// own shape (`@container`) then lays itself out for a tall canvas. Phone
// display has a shape: one of the device presets' proportions, or the deck's
// own (`PhoneShape`, `deviceForShape`). See
// `todo/archive/preview-viewport-toggle.md` and
// `todo/viewport-device-presets.md` for the contract and its rationale.
import { containScale, containSize, type Size } from './geometry'

export type ViewportMode = 'desktop' | 'mobile'

export type DevicePresetId = 'small-phone' | 'phone' | 'large-phone' | 'tablet'

/** A device phone display can simulate. `width` x `height` is what a deck's
 * viewer gets to draw in on that device — portrait, in CSS pixels, with
 * Safari's toolbars showing (as on first load, before a scroll collapses
 * them) — not the whole screen. `model` names the device the size is taken
 * from. */
export interface DevicePreset extends Size {
  id: DevicePresetId
  model: string
}

// Representative values for Safari on iOS / iPadOS in portrait with its
// toolbars expanded (`innerWidth` x `innerHeight` on first load), not
// measured here: the todo keeps checking them against real devices as a
// human item. peitho's own viewer has no bar of its own, so nothing more is
// subtracted.
export const DEVICE_PRESETS: readonly DevicePreset[] = [
  // iPhone SE (2nd / 3rd generation): a 375x667 screen.
  { id: 'small-phone', model: 'iPhone SE', width: 375, height: 548 },
  // iPhone 15 / 16: a 390x844 screen.
  { id: 'phone', model: 'iPhone 15', width: 390, height: 664 },
  // iPhone 15 Pro Max / 16 Plus: a 430x932 screen.
  { id: 'large-phone', model: 'iPhone 15 Pro Max', width: 430, height: 740 },
  // iPad (10th generation) / iPad Air 11-inch: an 820x1180 screen. 820 is
  // still inside the `max-width: 820px` query the one known tall-canvas
  // viewer script uses, so a deck grows its canvas there too.
  { id: 'tablet', model: 'iPad', width: 820, height: 1030 },
]

/** The device phone display starts on: a standard-size phone. */
export const DEFAULT_DEVICE: DevicePreset = DEVICE_PRESETS[1]

/** The preset with `id`, or `undefined` for anything that is not one (a
 * stray value past the type, an `Object.prototype` member's name). */
export function devicePreset(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find(preset => preset.id === id)
}

/** How the menu writes a device's size: `375×548`. */
export function deviceDimensions(device: Size): string {
  return `${String(device.width)}×${String(device.height)}`
}

const ICON_BOX: Size = { width: 20, height: 20 }

/** A rectangle with `device`'s proportion, as large as fits a 20x20 box
 * (`containSize`, so whole pixels) centred in a 24x24 icon: the menu draws
 * each option's shape with it. A device with no usable proportion, or one
 * so lopsided a side would come out under a pixel, gets the whole square. */
export function deviceIconRect(device: Size): Size & { x: number, y: number } {
  const { width, height } = containSize(ICON_BOX, device) ?? ICON_BOX
  return { x: (24 - width) / 2, y: (24 - height) / 2, width, height }
}

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
 * the height: only `DEVICE_PRESETS` grow the canvas (the deck-ratio phone
 * shape hands over the deck's own size, which changes nothing), and none of
 * them is even twice as tall as it is wide. */
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

/** What phone display gives the canvas: a device preset's proportion, or
 * `deck`, the deck's own proportion (so the canvas is the same size as in
 * PC display). */
export type PhoneShape = DevicePresetId | 'deck'

/** The device `effectiveCanvas` should reshape to for a phone shape. A
 * preset's id is that preset. `deck` is the deck's own size: reshaping a deck
 * to its own proportion keeps its width and gives back its height, so the
 * canvas comes out the same as PC display's without `reshapeCanvas` or
 * `effectiveCanvas` knowing about shapes. A whole-pixel deck (the only kind
 * peitho-core produces) comes back exactly; a fractional height may round up
 * to the next whole pixel, and a deck with no usable size stays as it is
 * (`reshapeCanvas` refuses a device with no usable proportion). A stray shape
 * past the type gets `DEFAULT_DEVICE` rather than a non-Size. */
export function deviceForShape(shape: PhoneShape, deck: Size): Size {
  if (shape === 'deck') return { width: deck.width, height: deck.height }
  return devicePreset(shape) ?? DEFAULT_DEVICE
}

/** The canvas a slide (or a layout's placeholder slide) is laid out on
 * for the PC / Phone switch's state: `effectiveCanvas` with the device the
 * phone shape stands for. Shared by the slide preview and the layout
 * list's thumbnails, so both draw a layout at the same size. */
export function viewportCanvas(deck: Size, mode: ViewportMode, shape: PhoneShape, fixedCanvas: boolean): Size {
  return effectiveCanvas(deck, mode, deviceForShape(shape, deck), fixedCanvas)
}

/** The device whose real size the slide preview draws the slide at: phone
 * display on a device preset. `null` for PC display and for the deck-ratio
 * shape, which fill the panel as before. A stray shape past the type gets
 * `DEFAULT_DEVICE`, as `deviceForShape` gives it. */
export function previewDevice(mode: ViewportMode, shape: PhoneShape): DevicePreset | null {
  if (mode !== 'mobile' || shape === 'deck') return null
  return devicePreset(shape) ?? DEFAULT_DEVICE
}

/** The on-screen box the slide preview draws a device's canvas in, and the
 * scale that draws it there. `fitted` says the device did not fit the panel
 * at real size, so it was shrunk to fit instead. */
export interface DevicePreviewSize extends Size {
  scale: number
  fitted: boolean
}

/** The slide preview's box for a device `deviceWidth` CSS px wide, in a
 * panel of size `area`, with the slide laid out on `canvas` (the deck's
 * width, grown to the device's proportion — or the deck's own size for a
 * `data-canvas="fixed"` slide). At real size the box is `deviceWidth` wide,
 * so the canvas is scaled by `deviceWidth / canvas.width`: the device's CSS
 * pixels, as a browser's device mode shows them. When that box crosses the
 * panel on either side it is fitted ("contain", no overscan) instead of
 * left to scroll. `null` when any size isn't a positive, finite number. */
export function devicePreviewSize(area: Size, canvas: Size, deviceWidth: number): DevicePreviewSize | null {
  const sizes = [area.width, area.height, canvas.width, canvas.height, deviceWidth]
  if (!sizes.every(isUsableDimension)) return null
  const realScale = deviceWidth / canvas.width
  const realHeight = canvas.height * realScale
  if (deviceWidth <= area.width && realHeight <= area.height) {
    return { width: deviceWidth, height: realHeight, scale: realScale, fitted: false }
  }
  const scale = Math.min(area.width / canvas.width, area.height / canvas.height)
  return { width: canvas.width * scale, height: canvas.height * scale, scale, fitted: true }
}

/** The scale the slide preview draws `canvas` at in a panel of size `area`:
 * a device's real size (`devicePreviewSize`) when `deviceWidth` is one,
 * otherwise — and for an area not measured yet — the panel-filling
 * `containScale` it has always used. */
export function previewCanvasScale(area: Size, canvas: Size, deviceWidth: number | null): number {
  const size = deviceWidth === null ? null : devicePreviewSize(area, canvas, deviceWidth)
  return size?.scale ?? containScale(area, canvas)
}

/** How much of the device's real size a fitted preview shows, as a whole
 * percentage for its label — rounded down, so a fit just short of real size
 * never reads 100%, and at least 1. `null` when the device is at real size
 * (no label) or there is no size to go by. */
export function scaledDownPercent(area: Size, canvas: Size, deviceWidth: number): number | null {
  const size = devicePreviewSize(area, canvas, deviceWidth)
  if (size === null || !size.fitted) return null
  return Math.max(1, Math.floor(size.width / deviceWidth * 100))
}
