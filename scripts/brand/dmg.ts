// The .dmg window's layout and background picture: the app on the left, an
// arrow, and the Applications folder on the right, with a caption saying to
// drag one onto the other.
//
// Coordinates are Finder points in the window's content area. The same
// numbers are written into src-tauri/tauri.conf.json's bundle.macOS.dmg
// (checked by dmg.test.ts), since Finder places the icons and the picture
// only draws around them.
import { INK, svgDocument } from './mark'

export interface Point { x: number; y: number }

export const DMG_WINDOW = { width: 660, height: 400 } as const
/** Icon centres, as tauri.conf.json's appPosition / applicationFolderPosition. */
export const DMG_APP: Point = { x: 180, y: 170 }
export const DMG_APPLICATIONS: Point = { x: 480, y: 170 }
/** Finder's default icon size in a dmg window (bundle_dmg's --icon-size). */
export const DMG_ICON_SIZE = 128

export const DMG_CAPTION = 'Drag Peitho Studio to Applications to install'
export const DMG_CAPTION_SIZE = 20
/** Baseline of the caption, above the icons. */
export const DMG_CAPTION_BASELINE = 72

export const DMG_BACKGROUND = '#f5f4f1'
const ARROW = '#9a9893'

/** The arrow between the two icons, leaving a gap beside each icon. */
export function dmgArrow(from: Point, to: Point, iconSize: number, gap = 24): { x1: number; x2: number; y: number } {
  if (to.x <= from.x) throw new Error('the Applications folder must be to the right of the app')
  const x1 = from.x + iconSize / 2 + gap
  const x2 = to.x - iconSize / 2 - gap
  if (x2 - x1 < 16) throw new Error(`no room for the arrow between x=${from.x} and x=${to.x}`)
  return { x1, x2, y: (from.y + to.y) / 2 }
}

/**
 * The background picture at 1x. `caption` is the caption already converted
 * to path data (with its advance width), so the picture needs no font.
 */
export function dmgBackgroundSvg(caption: { d: string; width: number }): string {
  const { width, height } = DMG_WINDOW
  const a = dmgArrow(DMG_APP, DMG_APPLICATIONS, DMG_ICON_SIZE)
  const head = 12
  const arrow =
    `<g fill="none" stroke="${ARROW}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M${a.x1} ${a.y}H${a.x2}"/>` +
    `<path d="M${a.x2 - head} ${a.y - head}L${a.x2} ${a.y}L${a.x2 - head} ${a.y + head}"/>` +
    `</g>`
  const text = `<path transform="translate(${((width - caption.width) / 2).toFixed(2)} ${DMG_CAPTION_BASELINE})" fill="${INK}" d="${caption.d}"/>`
  return svgDocument(width, height, `<rect width="${width}" height="${height}" fill="${DMG_BACKGROUND}"/>${arrow}${text}`, undefined, 'Install Peitho Studio')
}
