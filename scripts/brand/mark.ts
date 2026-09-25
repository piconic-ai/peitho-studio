// The Peitho Studio mark, as pure functions returning SVG markup.
//
// The goddess Peitho, drawn front-on in a Japanese kawaii register: the
// krobylos (the knot Greek statues tie at the back of the head) moves up to
// become an odango bun, and its spiral is the same two-semicircle volute
// the earlier mark used — Peitho's ball of twine. A stephane (the diadem
// she wears in vase painting) sits across the hair as a tiara, the eyes
// are closed in a smile, and the only colour outside ink and paper is the
// sakura blush on her cheeks.
//
// Everything is drawn in a 100-unit box. Two cuts exist, the way a type
// family has optical sizes: `markBody` for 64 px and up, `markSmallBody`
// for 48 px and below, where the spiral, tiara gem and mouth would turn to
// noise and the eyes need to be solid to survive.

export const INK = '#111111'
export const PAPER = '#ffffff'
export const BLUSH = '#F4A6B8'
export const TILE_TOP = '#FDF0F3'
export const TILE_BOTTOM = '#F8D9E1'

/** Sizes at or below this use the small cut. */
export const SMALL_CUT_MAX_PX = 48

const HAIR_BACK =
  'M50 22C29 22 18.5 37 18.5 56C18.5 64 20.5 71 23.5 76.5C24.5 78.3 26.8 78.6 28 77C29.5 75 30 72 30 69L70 69C70 72 70.5 75 72 77C73.2 78.6 75.5 78.3 76.5 76.5C79.5 71 81.5 64 81.5 56C81.5 37 71 22 50 22Z'
const BUN = { cx: 50, cy: 17, r: 10 }
const FACE =
  'M50 42C35 42 27.5 52 27.5 62.5C27.5 73.5 37 81.5 50 81.5C63 81.5 72.5 73.5 72.5 62.5C72.5 52 65 42 50 42Z'
const BANGS =
  'M26.8 62C26.8 46.5 37 35.5 50 35.5C63 35.5 73.2 46.5 73.2 62C67.5 57 61.5 51.5 56.8 45.5C55.3 50 52.9 53.2 50 54.8C47.1 53.2 44.7 50 43.2 45.5C38.5 51.5 32.5 57 26.8 62Z'
const SPIRAL = 'M51.6 17a1.6 1.6 0 1 0-3.2 0a3.4 3.4 0 1 0 6.8 0a5.2 5.2 0 1 0-10.4 0'
const TIARA = 'M33.8 32.6C43 27.4 57 27.4 66.2 32.6'
const EYES = 'M38.8 64.6q3.4-3.8 6.8 0M54.4 64.6q3.4-3.8 6.8 0'
const MOUTH = 'M47.9 72.3q2.1 1.9 4.2 0'

/** An ellipse as path data (two arcs), for renderers — or JSX typings — without `<ellipse>`. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (!(rx > 0) || !(ry > 0)) throw new RangeError(`ellipsePath: radii must be > 0, got ${rx}, ${ry}`)
  return `M${round2(cx - rx)} ${round2(cy)}a${round2(rx)} ${round2(ry)} 0 1 0 ${round2(2 * rx)} 0a${round2(rx)} ${round2(ry)} 0 1 0 ${round2(-2 * rx)} 0Z`
}
const BLUSH_CHEEKS = ellipsePath(36.3, 70.6, 4.2, 2.5) + ellipsePath(63.7, 70.6, 4.2, 2.5)
const SMALL_EYES = ellipsePath(42.2, 64, 3.3, 4) + ellipsePath(57.8, 64, 3.3, 4)
const SMALL_BLUSH_CHEEKS = ellipsePath(35.6, 71, 5.2, 3.2) + ellipsePath(64.4, 71, 5.2, 3.2)

/**
 * The path data, exported so a test can check that components/WelcomeScreen.tsx
 * (which has to inline the mark as JSX) hasn't drifted from it.
 */
export const MARK_PATHS = { HAIR_BACK, FACE, BANGS, SPIRAL, TIARA, EYES, BLUSH_CHEEKS, MOUTH } as const

/** The mark's inked extent inside its 100-unit box (without a rim). */
export const MARK_BOUNDS = { x: 18.5, y: 7, width: 63, height: 74.5 } as const

export interface MarkOptions {
  /** Cheek colour, or null for the single-colour version. */
  blush?: string | null
  /** Draws a keyline of this colour around the silhouette, for dark grounds. */
  rim?: string | null
}

function silhouette(fill: string, strokeWidth: number): string {
  return `<g fill="${fill}" stroke="${fill}" stroke-width="${strokeWidth}" stroke-linejoin="round"><circle cx="${BUN.cx}" cy="${BUN.cy}" r="${BUN.r}"/><path d="${HAIR_BACK}"/><path d="${FACE}"/></g>`
}

function head(): string {
  return `<circle cx="${BUN.cx}" cy="${BUN.cy}" r="${BUN.r}" fill="${INK}"/><path d="${HAIR_BACK}" fill="${INK}"/><path d="${FACE}" fill="${PAPER}"/><path d="${BANGS}" fill="${INK}"/>`
}

/** Full-detail cut, for 64 px and up. */
export function markBody({ blush = BLUSH, rim = null }: MarkOptions = {}): string {
  return [
    rim ? silhouette(rim, 7) : '',
    head(),
    `<path d="${SPIRAL}" fill="none" stroke="${PAPER}" stroke-width="1.6" stroke-linecap="round"/>`,
    `<path d="${TIARA}" fill="none" stroke="${PAPER}" stroke-width="1.8" stroke-linecap="round"/>`,
    `<circle cx="50" cy="28.9" r="1.9" fill="${PAPER}"/>`,
    `<path d="${EYES}" fill="none" stroke="${INK}" stroke-width="2.3" stroke-linecap="round"/>`,
    blush ? `<path d="${BLUSH_CHEEKS}" fill="${blush}"/>` : '',
    `<path d="${MOUTH}" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`,
  ].join('')
}

/** Small cut, for 48 px and below: solid eyes, a heavier tiara, bigger blush. */
export function markSmallBody({ blush = BLUSH, rim = null }: MarkOptions = {}): string {
  return [
    rim ? silhouette(rim, 8) : '',
    head(),
    `<path d="${TIARA}" fill="none" stroke="${PAPER}" stroke-width="3.4" stroke-linecap="round"/>`,
    `<path d="${SMALL_EYES}" fill="${INK}"/>`,
    blush ? `<path d="${SMALL_BLUSH_CHEEKS}" fill="${blush}"/>` : '',
  ].join('')
}

/**
 * A superellipse |x|^n + |y|^n = 1 scaled to `half` around (cx, cy), as a
 * closed polygon path. n = 5 approximates Apple's continuous-corner
 * "squircle" closely enough that the corners don't read as circular arcs.
 */
export function squirclePath(cx: number, cy: number, half: number, n = 5, steps = 256): string {
  if (!(half > 0)) throw new RangeError(`squirclePath: half must be > 0, got ${half}`)
  if (!(n > 0)) throw new RangeError(`squirclePath: n must be > 0, got ${n}`)
  if (!Number.isInteger(steps) || steps < 4) throw new RangeError(`squirclePath: steps must be an integer >= 4, got ${steps}`)
  const points: string[] = []
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI
    const c = Math.cos(t)
    const s = Math.sin(t)
    const x = cx + half * Math.sign(c) * Math.abs(c) ** (2 / n)
    const y = cy + half * Math.sign(s) * Math.abs(s) ** (2 / n)
    points.push(`${round2(x)} ${round2(y)}`)
  }
  return `M${points.join('L')}Z`
}

function round2(v: number): number {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? 0 : r
}

export interface AppIconOptions {
  /** Uses the small cut, for rasterizing at 48 px and below. */
  small?: boolean
  /** The macOS drop shadow under the tile. Off for favicons and flat uses. */
  shadow?: boolean
  /** Tile extent: 'macos' is the 824-unit body on a 1024 canvas, 'full' fills the canvas. */
  tile?: 'macos' | 'full'
}

/** The app icon on a 1024×1024 canvas. */
export function appIconSvg({ small = false, shadow = true, tile = 'macos' }: AppIconOptions = {}): string {
  const half = tile === 'macos' ? 412 : 512
  const scale = (small ? 7.6 : 6.9) * (half / 412)
  const offset = 512 - 50 * scale
  const lift = (small ? 6 : 14) * (half / 412)
  const filter = shadow
    ? '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.22"/></filter>'
    : ''
  return svgDocument(
    1024,
    1024,
    `<defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TILE_TOP}"/><stop offset="1" stop-color="${TILE_BOTTOM}"/></linearGradient>${filter}</defs>` +
      `<path d="${squirclePath(512, 512, half)}" fill="url(#tile)"${shadow ? ' filter="url(#shadow)"' : ''}/>` +
      `<g transform="translate(${round2(offset)} ${round2(offset + lift)}) scale(${round2(scale)})">${small ? markSmallBody() : markBody()}</g>`,
  )
}

/** Wraps a body in a standalone SVG document with the given viewBox size. */
export function svgDocument(width: number, height: number, body: string, viewBox = `0 0 ${width} ${height}`, title = 'Peitho Studio'): string {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" role="img"><title>${safeTitle}</title>${body}</svg>\n`
}
