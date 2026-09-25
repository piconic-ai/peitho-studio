// The Peitho Studio mark, as pure functions returning SVG markup.
//
// Peitho, the Greek goddess of persuasion the engine is named after, in
// profile the way Greek coins show her, with her hair hanging down behind
// her neck and ending in a curl — the ball of twine she holds in vase
// painting, and an Ionic volute. Her face is expressionless: a single dot
// for the eye. No colour: ink and paper only, the same two peitho.gosu.ke
// uses.
//
// The mark is two shapes: the head, and the hair as a band laid over it.
// A thin gap in the ground's colour separates them, so the whole mark
// reads as one silhouette with one line cut into it. Two cuts exist, the
// way a type family has optical sizes: `markBody` for 64 px and up,
// `markSmallBody` for 48 px and below, where the gap and the eye are drawn
// larger so they survive.

export const INK = '#111111'
export const PAPER = '#ffffff'

/** Sizes at or below this use the small cut. */
export const SMALL_CUT_MAX_PX = 48

const FACE =
  'M60 85L60 71C64 70.5 68.5 68 70 64.5C71.3 61.5 72.5 59 74.5 56.5C76 54.8 77 53.3 76.9 52C76.7 50 74.6 46 73.6 42C72.5 36 71 30 66 25C60 19 52 17 46 17.5C35 18.5 26 26 24 36C22 46 25 56 32 63C36 67 40 70 42 72C42.5 77 42 81 41 85C47 87 54 87 60 85Z'
// The hair band's centreline: from the hairline, over the crown just inside
// the head's outline, down behind the neck, into a curl.
const HAIR =
  'M63 26.5C57 22.2 50.5 21.6 46 22.3C37 23.2 30.2 29.2 28.8 36.5C27.2 46 28.2 56 32.2 64C36 71.8 36.2 80.6 31.5 84.8C27.5 88 23.5 85 25.3 82C26.8 79.7 30 80.8 29.5 83.5'
const HAIR_WIDTH = 9.5
const EYE = { cx: 64, cy: 46 } as const

/**
 * The path data, exported so a test can check that components/WelcomeScreen.tsx
 * (which has to inline the mark as JSX) hasn't drifted from it.
 */
export const MARK_PATHS = { FACE, HAIR } as const

/** The drawn extent inside the 100-unit box (head and hair band together). */
export const MARK_BOUNDS = { x: 20, y: 17.2, width: 57, height: 73.8 } as const

export interface MarkOptions {
  /** The silhouette's colour. Ink for light grounds, paper for dark ones. */
  figure?: string
  /** The ground's colour, used for the gap around the hair and for the eye. */
  line?: string
}

function drawMark(figure: string, line: string, gap: number, eyeRadius: number): string {
  return (
    `<path d="${FACE}" fill="${figure}"/>` +
    `<g fill="none" stroke-linecap="round"><path d="${HAIR}" stroke="${line}" stroke-width="${HAIR_WIDTH + 2 * gap}"/><path d="${HAIR}" stroke="${figure}" stroke-width="${HAIR_WIDTH}"/></g>` +
    `<circle cx="${EYE.cx}" cy="${EYE.cy}" r="${eyeRadius}" fill="${line}"/>`
  )
}

/** Full-detail cut, for 64 px and up. */
export function markBody({ figure = INK, line = PAPER }: MarkOptions = {}): string {
  return drawMark(figure, line, 2, 1.9)
}

/** Small cut, for 48 px and below: a wider gap and a bigger eye. */
export function markSmallBody({ figure = INK, line = PAPER }: MarkOptions = {}): string {
  return drawMark(figure, line, 3.5, 3)
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

/** The app icon on a 1024×1024 canvas: a paper-white Peitho on an ink tile. */
export function appIconSvg({ small = false, shadow = true, tile = 'macos' }: AppIconOptions = {}): string {
  const half = tile === 'macos' ? 412 : 512
  // The silhouette fills about 62% of the tile's height (a little more in the small cut).
  const scale = ((small ? 0.68 : 0.62) * 2 * half) / MARK_BOUNDS.height
  const cx = MARK_BOUNDS.x + MARK_BOUNDS.width / 2
  const cy = MARK_BOUNDS.y + MARK_BOUNDS.height / 2
  const filter = shadow
    ? '<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/></filter></defs>'
    : ''
  const colours = { figure: PAPER, line: INK }
  return svgDocument(
    1024,
    1024,
    filter +
      `<path d="${squirclePath(512, 512, half)}" fill="${INK}"${shadow ? ' filter="url(#shadow)"' : ''}/>` +
      `<g transform="translate(${round2(512 - cx * scale)} ${round2(512 - cy * scale)}) scale(${round2(scale)})">${small ? markSmallBody(colours) : markBody(colours)}</g>`,
  )
}

/** Wraps a body in a standalone SVG document with the given viewBox size. */
export function svgDocument(width: number, height: number, body: string, viewBox = `0 0 ${width} ${height}`, title = 'Peitho Studio'): string {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" role="img"><title>${safeTitle}</title>${body}</svg>\n`
}
