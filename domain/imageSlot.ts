// A slide holding an image whose layout has no slot for one: peitho-core
// refuses to build it with "no slot accepts image in layout '...'". The
// error bar offers a way out next to that error — open the "Change Layout"
// picker when another of the deck's layouts fits the slide, or add Studio's
// built-in image layout (`add_image_layout`, `engine::image_layout` in
// src-tauri) when none does.
import type { LayoutVerdict } from './layoutFit'
import type { Messages } from './messages'
import type { PageConfig } from './pageConfig'

/** The built-in image layout's name — `IMAGE_LAYOUT_NAME` in
 * `engine::image_layout`. */
export const IMAGE_LAYOUT = 'title-body-image'

/** peitho-core's own wording for the error (`mapping.rs::image_slot_name`).
 * On a deck with several layouts it shows up once per rejected layout,
 * under "no layout matches this slide". */
const IMAGE_SLOT_MESSAGE = "no slot accepts image in layout '"

/** A build error that is peitho-core's "no slot accepts image", and the
 * slide it names — `index` counts every slide, drafts included (the
 * position `splitSlides` gives it). */
export interface ImageSlotError {
  index: number
}

/** The slide number in a build error's headline: `slide 3 ('key'), line 25:`,
 * `slide 3:`, or after an included file's `path:25, `. Only the first line
 * is the headline; the rest is per-layout detail and the help text. */
const SLIDE_NUMBER = /(?:^|[\s,])slide (\d+)(?=[ ,:])/

/** `message` as an `ImageSlotError`, or `null` when it's any other error
 * (or none), or names no slide among the deck's `slideCount`. */
export function parseImageSlotError(message: string | null, slideCount: number): ImageSlotError | null {
  if (message === null || !message.includes(IMAGE_SLOT_MESSAGE)) return null
  const headline = message.split('\n', 1)[0]
  const match = SLIDE_NUMBER.exec(headline)
  if (match === null) return null
  const number = Number(match[1])
  if (!Number.isSafeInteger(number) || number < 1 || number > slideCount) return null
  return { index: number - 1 }
}

/** What the error bar offers for an `ImageSlotError` on slide `index`. */
export type ImageSlotFix =
  | { kind: 'pick-layout'; index: number }
  | { kind: 'add-image-layout'; index: number }
  | { kind: 'none' }

/** The fix for slide `index`, pinned to `pinnedLayout` (if any), given
 * which of the deck's layouts it fits (`check_slide_layouts`; `null` when
 * that couldn't be answered). None when there's nothing to go on, when the
 * slide already fits the layout it's pinned to (the error is out of date),
 * or when the deck already has the image layout and the slide doesn't fit
 * it either (adding it again would be refused). */
export function imageSlotFixFor(index: number, pinnedLayout: string | undefined, verdicts: readonly LayoutVerdict[] | null): ImageSlotFix {
  if (verdicts === null) return { kind: 'none' }
  const fitting = verdicts.filter(verdict => verdict.fit.kind === 'fits').map(verdict => verdict.layout)
  if (pinnedLayout !== undefined && fitting.includes(pinnedLayout)) return { kind: 'none' }
  if (fitting.length > 0) return { kind: 'pick-layout', index }
  if (verdicts.some(verdict => verdict.layout === IMAGE_LAYOUT)) return { kind: 'none' }
  return { kind: 'add-image-layout', index }
}

/** `fix` while `error` is still about the slide it was found for — so a
 * fix doesn't outlive its error, and a new error on the same slide (a line
 * number moved while typing) keeps showing it until the new answer lands. */
export function shownImageSlotFix(error: ImageSlotError | null, fix: ImageSlotFix): ImageSlotFix {
  if (error === null || fix.kind === 'none' || fix.index !== error.index) return { kind: 'none' }
  return fix
}

/** The page settings change that goes with adding the image layout: a
 * slide pinned to some other layout is re-pinned to it, since adding a
 * layout file alone doesn't change a pin. `null` when the slide isn't
 * pinned (it finds the new layout by its content) or already names it. */
export function imageLayoutPin(pinnedLayout: string | undefined): Partial<PageConfig> | null {
  return pinnedLayout === undefined || pinnedLayout === IMAGE_LAYOUT ? null : { layout: IMAGE_LAYOUT }
}

/** The error bar button's label for `kind`, or `null` when there's none.
 * `adding`: the image layout is being added right now. */
export function imageSlotFixLabel(messages: Messages, kind: ImageSlotFix['kind'], adding: boolean): string | null {
  switch (kind) {
    case 'pick-layout': return messages.imageSlotPickLayout
    case 'add-image-layout': return adding ? messages.imageSlotAddingLayout : messages.imageSlotAddLayout
    case 'none': return null
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}
