// The layout screen (Studio's "Layouts" mode): which screen the deck window
// shows, the layout list's rows, and the checks on a name typed for a new
// layout. Pure — `components/LayoutScreen.tsx` renders what this computes.
import type { Language } from './language'
import type { SlideListEntry } from './slideList'
import { layoutDisplayName } from './standardLayouts'

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
 * changes with `generation` (each fresh set of previews), so a row whose
 * preview was re-rendered is mounted afresh and its canvas `ref` runs
 * again — a keyed row kept across an update never re-runs it. */
export interface LayoutRow {
  key: string
  name: string
  label: string
  /** How many slides are on this layout. */
  usage: number
  /** Whether the row offers Delete: never for the deck's only layout. */
  deletable: boolean
}

/** The layout list's rows, in the deck's own layout order (`names`). */
export function layoutRows(
  names: readonly string[],
  usage: ReadonlyMap<string, readonly number[]>,
  language: Language,
  generation: number,
): LayoutRow[] {
  return names.map(name => ({
    key: `${String(generation)}:${name}`,
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
