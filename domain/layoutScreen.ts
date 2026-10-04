// The layout screen (Studio's "Layouts" mode): which screen the deck window
// shows, the layout list's rows, and the checks on a name typed for a new
// layout. Pure — `components/LayoutScreen.tsx` renders what this computes.
import { containSize, type Size } from './geometry'
import type { Language } from './language'
import type { SlideListEntry } from './slideList'
import { layoutDisplayName } from './standardLayouts'
import type { PhoneShape, ViewportMode } from './viewport'

/** Which screen an open deck's window shows: the slides (list, editor,
 * preview, comments) or the deck's layouts. */
export type StudioMode = 'slides' | 'layouts'

/** The slides on each layout, as positions in the deck source (the
 * `splitSlides` index every slide operation takes), by the layout the last
 * render built them on (`RenderPayload.slideLayouts`, by slide key). A
 * draft — or any slide the render didn't reach — is on no layout. */
export function layoutUsage(
  entries: readonly SlideListEntry[],
  slideLayouts: Readonly<Record<string, string>>,
): ReadonlyMap<string, readonly number[]> {
  // A `Map`, not an object: a layout may be named `constructor` or
  // `__proto__`, which an object would find on its prototype.
  const usage = new Map<string, number[]>()
  for (const entry of entries) {
    if (entry.kind !== 'rendered' || !Object.hasOwn(slideLayouts, entry.slide.key)) continue
    const layout = slideLayouts[entry.slide.key]
    const slides = usage.get(layout)
    if (slides) slides.push(entry.sourceIndex)
    else usage.set(layout, [entry.sourceIndex])
  }
  return usage
}

/** One row of the layout list. `key` is the row's `.map()` key: it
 * changes with `generation` (`layoutListGeneration`), so a row whose
 * preview was re-rendered, or whose canvas changed shape, is mounted afresh
 * and its canvas `ref` runs again — a keyed row kept across an update
 * never re-runs it. */
export interface LayoutRow {
  key: string
  name: string
  label: string
  /** How many slides are on this layout. */
  usage: number
  /** Whether the row offers Delete: never for the deck's only layout. */
  deletable: boolean
}

/** What the layout list's thumbnails were last drawn from: the set of
 * previews (`previews`, bumped with each fresh one) and the PC / Phone
 * switch's state, which reshapes every thumbnail's canvas. Rows are keyed
 * by it (`layoutRows`), so a change to any part draws them all again. */
export function layoutListGeneration(previews: number, mode: ViewportMode, shape: PhoneShape): string {
  return `${String(previews)}/${mode}/${shape}`
}

/** The layout list's rows, in the deck's own layout order (`names`). */
export function layoutRows(
  names: readonly string[],
  usage: ReadonlyMap<string, readonly number[]>,
  language: Language,
  generation: string,
): LayoutRow[] {
  return names.map(name => ({
    key: `${generation}:${name}`,
    name,
    label: layoutDisplayName(name, language),
    usage: usage.get(name)?.length ?? 0,
    deletable: names.length > 1,
  }))
}

/** The layout the screen shows: `current` while the deck still has it,
 * otherwise its first layout (`null` for none) — after a delete, or when
 * the screen opens for the first time. */
export function shownLayout(current: string | null, names: readonly string[]): string | null {
  if (current !== null && names.includes(current)) return current
  return names[0] ?? null
}

/** Why a name typed for a new layout can't be used, or `null` when it can.
 * Mirrors `engine::layout_files::validate_layout_name` (src-tauri), which
 * still decides: this only says so before the round trip. */
export type LayoutNameProblem = 'empty' | 'too-long' | 'invalid' | 'start' | 'taken'

/** The longest name a layout may be given (`MAX_NAME_LEN` in src-tauri). */
export const MAX_LAYOUT_NAME_LENGTH = 64

export function layoutNameProblem(name: string, existing: readonly string[]): LayoutNameProblem | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'empty'
  if (trimmed.length > MAX_LAYOUT_NAME_LENGTH) return 'too-long'
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return 'invalid'
  if (!/^[A-Za-z0-9]/.test(trimmed)) return 'start'
  const lower = trimmed.toLowerCase()
  if (existing.some(taken => taken.toLowerCase() === lower)) return 'taken'
  return null
}

/** Whether the deck's layout files changed outside Studio — the Coding
 * Agent editing one — going by their fingerprint (`layout_files_stamp`)
 * before (`previous`) and now (`next`). Nothing is known to have changed
 * before there is a first fingerprint to compare with. */
export function layoutFilesChanged(previous: string | null, next: string): boolean {
  return previous !== null && previous !== next
}

/** The layout list's width the first time the layout screen is laid out:
 * half of `shared`, the width the editor and the list share (the divider
 * between them and the comments column aside), so the two start equally
 * wide — in whole pixels, the editor taking the odd one. Clamped to
 * `bounds`, the range dragging the divider keeps a column in, so the first
 * drag doesn't jump. `null` when there's no width to go by yet (the screen
 * hidden), to be worked out again once there is. */
export function initialLayoutListWidth(shared: number, bounds: { min: number; max: number }): number | null {
  if (!Number.isFinite(shared) || shared <= 0) return null
  return Math.max(bounds.min, Math.min(bounds.max, Math.floor(shared / 2)))
}

/** What a layout row takes around its thumbnail, against the list's
 * scrolling area's inner size (`clientWidth`/`clientHeight`), in CSS px —
 * from `LayoutScreen.tsx`'s classes: the area's `p-2` (8 a side; at the
 * bottom, the same 8 kept clear of the area's edge), the row's `border-2`
 * and `p-1.5` (8 a side), and under the thumbnail its `gap-1` (4) and the
 * name line (`text-xs`, 16 tall). */
export const LAYOUT_ROW_CHROME: Size = { width: 8 * 2 + 8 * 2, height: 8 * 2 + 8 * 2 + 4 + 16 }

/** Layout thumbnail's box in a list area of inner size `room`, for a
 * layout drawn on `canvas`: as large as fits both the row's width and the
 * area's height (a phone's tall canvas in a wide list would otherwise run
 * past the bottom), keeping the canvas's proportion. `null` with no room
 * measured yet, or too little for any box. */
export function layoutThumbnailSize(room: Size | null, canvas: Size): Size | null {
  if (room === null) return null
  return containSize({ width: room.width - LAYOUT_ROW_CHROME.width, height: room.height - LAYOUT_ROW_CHROME.height }, canvas)
}

/** The thumbnail box's inline style: its size (`layoutThumbnailSize`), or
 * without one the row's full width at the canvas's proportion. */
export function layoutThumbnailStyle(canvas: Size, room: Size | null): string {
  const size = layoutThumbnailSize(room, canvas)
  if (size === null) return `width: 100%; aspect-ratio: ${String(canvas.width)} / ${String(canvas.height)}`
  return `width: ${String(size.width)}px; height: ${String(size.height)}px`
}
