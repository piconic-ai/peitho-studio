// The Peitho Studio mark, as pure functions returning SVG markup.
//
// Peitho, the Greek goddess of persuasion the engine is named after, in
// profile the way Greek vases and coins show her: hair tied back into a
// krobylos at the nape, a fillet (stephane) across the crown. The kawaii
// part is in the proportions and the face — a big round head, a short neck,
// and an eye closed in a smile — and nowhere else.
// No colour: ink and paper only, the same two peitho.gosu.ke uses. The
// spiral in the krobylos is her ball of twine, drawn as semicircles on one
// axis like an Ionic volute.
//
// Everything is drawn in a 100-unit box as one silhouette plus a handful
// of lines. Two cuts exist, the way a type family has optical sizes:
// `markBody` for 64 px and up, `markSmallBody` for 48 px and below, where
// the spiral would turn to noise and the lines need to be heavier to
// survive.

export const INK = '#111111'
export const PAPER = '#ffffff'

/** Sizes at or below this use the small cut. */
export const SMALL_CUT_MAX_PX = 48

const HEAD =
  'M60 85L60 71C64 70.5 68.5 68 70 64.5C71.3 61.5 72.5 59 74.5 56.5C76 54.8 77 53.3 76.9 52C76.7 50 74.6 46 73.6 42C72.5 36 71 30 66 25C60 19 52 17 46 17.5C35 18.5 26 26 24 36C18 36 12 42 12.5 50C13 58 20 62 26 60C28 66 33 70 40 72C41 76 41 81 40 85C46 87.5 54 87.5 60 85Z'
const HAIRLINE = 'M64 24C58 29 55 37 54.5 45C54 53 50.5 61 44 67.5'
const FILLET = 'M29.5 28C40 19.5 54 17.5 62 22'
const EYE = 'M61 47q3-3 6 0'
const SPIRAL = 'M21.6 49a1.6 1.6 0 1 0-3.2 0a3.4 3.4 0 1 0 6.8 0a5.2 5.2 0 1 0-10.4 0'

/**
 * The path data, exported so a test can check that components/WelcomeScreen.tsx
 * (which has to inline the mark as JSX) hasn't drifted from it.
 */
export const MARK_PATHS = { HEAD, HAIRLINE, FILLET, EYE, SPIRAL } as const

/** The silhouette's extent inside its 100-unit box; every line sits inside it. */
export const MARK_BOUNDS = { x: 12.5, y: 17, width: 64.5, height: 70.5 } as const

export interface MarkOptions {
  /** The silhouette's colour. Ink for light grounds, paper for dark ones. */
  figure?: string
  /** The colour the lines are drawn in — the ground's colour, so they read as cut out. */
  line?: string
}

function lines(line: string, strokeWidth: number, extra: string): string {
  return `<g fill="none" stroke="${line}" stroke-width="${strokeWidth}" stroke-linecap="round"><path d="${HAIRLINE}"/><path d="${FILLET}"/><path d="${EYE}" stroke-width="${round2(strokeWidth * 1.1)}"/>${extra}</g>`
}

/** Full-detail cut, for 64 px and up. */
export function markBody({ figure = INK, line = PAPER }: MarkOptions = {}): string {
  return `<path d="${HEAD}" fill="${figure}"/>${lines(line, 2, `<path d="${SPIRAL}" stroke-width="1.7"/>`)}`
}

/** Small cut, for 48 px and below: no spiral, heavier lines. */
export function markSmallBody({ figure = INK, line = PAPER }: MarkOptions = {}): string {
  return `<path d="${HEAD}" fill="${figure}"/>${lines(line, 3.6, '')}`
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
