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
  /** The layout's own name — its file name, what a slide's `"layout"` and
   * the agent call it (`title-body`) — shown under `label` when that's a
   * translated name; `null` when `label` is the name already (a deck's own
   * layout). */
  englishName: string | null
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
  return names.map(name => {
    const label = layoutDisplayName(name, language)
    return {
      key: `${generation}:${name}`,
      name,
      label,
      englishName: label === name ? null : name,
      usage: usage.get(name)?.length ?? 0,
      deletable: names.length > 1,
    }
  })
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

/** How much of the list column's height (under its switch) the selected
 * layout's large preview may take at most: the rest stays for the other
 * layouts' thumbnails under it. */
export const SELECTED_PREVIEW_SHARE = 0.6

/** The room the selected layout's large preview has in a list column whose
 * body (under its switch) measures `body`: the column's width, and
 * `SELECTED_PREVIEW_SHARE` of its height, in whole pixels. `null` until
 * measured. */
export function selectedPreviewRoom(body: Size | null): Size | null {
  if (body === null) return null
  return { width: body.width, height: Math.floor(body.height * SELECTED_PREVIEW_SHARE) }
}

/** What the selected layout's large preview takes around its drawing,
 * against its room (`selectedPreviewRoom`), in CSS px — from
 * `LayoutScreen.tsx`'s classes: the section's `p-2` (8 a side), and under
 * the drawing its `gap-1` (4) and the name line (`text-xs`, 16 tall). No
 * frame: like the slide preview, the drawing stands on its own. */
export const LAYOUT_ROW_CHROME: Size = { width: 8 * 2, height: 8 * 2 + 4 + 16 }

/** The selected layout's large preview's box in `room`
 * (`selectedPreviewRoom`), for a layout drawn on `canvas`: as large as
 * fits both the room's width and its height (a phone's tall canvas in a
 * wide list would otherwise push the other layouts out of sight), keeping
 * the canvas's proportion. In phone display on a
 * device preset, `deviceWidth` (its CSS width, `previewDevice`) caps the
 * width too, so a small phone's thumbnail shows smaller than a standard
 * one's, as the slide preview does; `null` (or anything that isn't a
 * positive, finite width) leaves it uncapped. `null` with no room measured
 * yet, or too little for any box. */
export function layoutThumbnailSize(room: Size | null, canvas: Size, deviceWidth: number | null = null): Size | null {
  if (room === null) return null
  const rowWidth = room.width - LAYOUT_ROW_CHROME.width
  const width = deviceWidth !== null && Number.isFinite(deviceWidth) && deviceWidth > 0 ? Math.min(rowWidth, deviceWidth) : rowWidth
  return containSize({ width, height: room.height - LAYOUT_ROW_CHROME.height }, canvas)
}

/** The thumbnail box's inline style: its size (`layoutThumbnailSize`), or
 * without one the row's full width at the canvas's proportion. */
export function layoutThumbnailStyle(canvas: Size, room: Size | null, deviceWidth: number | null = null): string {
  const size = layoutThumbnailSize(room, canvas, deviceWidth)
  if (size === null) return layoutGridThumbnailStyle(canvas)
  return `width: ${String(size.width)}px; height: ${String(size.height)}px`
}

/** A small thumbnail's inline style in the two-column grid under the large
 * preview: its cell's whole width, at the canvas's proportion. */
export function layoutGridThumbnailStyle(canvas: Size): string {
  return `width: 100%; aspect-ratio: ${String(canvas.width)} / ${String(canvas.height)}`
}
