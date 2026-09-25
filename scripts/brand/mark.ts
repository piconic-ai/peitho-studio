// The Peitho Studio mark, as pure functions returning SVG markup.
//
// Peitho, the Greek goddess of persuasion the engine is named after, in
// profile the way Greek vases and coins show her: hair tied back into a
// krobylos at the nape, its spiral her ball of twine (drawn as semicircles
// on one axis, like an Ionic volute). A big round head and a short neck
// keep her kawaii. No colour: ink and paper only, the same two
// peitho.gosu.ke uses.
//
// The mark is one silhouette with a few lines cut out of it in the ground's
// colour: the hairline, the spiral, and her expression. The expression is
// swappable — `EXPRESSIONS` holds the set of faces the same head can wear.
//
// Two cuts exist, the way a type family has optical sizes: `markBody` for
// 64 px and up, `markSmallBody` for 48 px and below, where the spiral would
// turn to noise and the remaining lines need to be heavier to survive.

export const INK = '#111111'
export const PAPER = '#ffffff'

/** Sizes at or below this use the small cut. */
export const SMALL_CUT_MAX_PX = 48

const HEAD =
  'M60 85L60 71C64 70.5 68.5 68 70 64.5C71.3 61.5 72.5 59 74.5 56.5C76 54.8 77 53.3 76.9 52C76.7 50 74.6 46 73.6 42C72.5 36 71 30 66 25C60 19 52 17 46 17.5C35 18.5 26 26 24 36C18 36 12 42 12.5 50C13 58 20 62 26 60C28 66 33 70 40 72C41 76 41 81 40 85C46 87.5 54 87.5 60 85Z'
const HAIRLINE = 'M64 24C58 29 55 37 54.5 45C54 53 50.5 61 44 67.5'
const SPIRAL = 'M21.6 49a1.6 1.6 0 1 0-3.2 0a3.4 3.4 0 1 0 6.8 0a5.2 5.2 0 1 0-10.4 0'

/**
 * Her faces. Each draws only the eye (and, where it needs one, a brow) in
 * `line`, with strokes and dots scaled by `weight` — 1 in the full cut,
 * heavier in the small cut.
 */
export const EXPRESSIONS = {
  /** Eye closed in a smile. The default, and the app icon's face. */
  smile: (line: string, weight: number) => stroke('M61 47q3-3 6 0', line, 2.2 * weight),
  /** A plain open eye. */
  neutral: (line: string, weight: number) => dot(64, 46, 1.9 * weight, line),
  /** Eye closed, at rest. */
  calm: (line: string, weight: number) => stroke('M61 45.6q3 3 6 0', line, 2.2 * weight),
  /** Eye wide open under a raised brow. */
  surprised: (line: string, weight: number) =>
    `<circle cx="64" cy="46" r="2.3" fill="none" stroke="${line}" stroke-width="${round2(1.6 * weight)}"/>` + stroke('M60.8 40.4q3.2-2.2 6.4-.6', line, 1.8 * weight),
  /** An open eye under a brow raised at its inner end. */
  troubled: (line: string, weight: number) => dot(64, 46.6, 1.8 * weight, line) + stroke('M60.8 42.4L66.8 40.2', line, 1.8 * weight),
  /** Eye half shut, a flat line. */
  sleepy: (line: string, weight: number) => stroke('M61 46.6h6', line, 2.2 * weight),
} as const

export type Expression = keyof typeof EXPRESSIONS

function stroke(d: string, colour: string, width: number): string {
  return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${round2(width)}" stroke-linecap="round"/>`
}

function dot(cx: number, cy: number, r: number, colour: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${round2(r)}" fill="${colour}"/>`
}

/**
 * The path data, exported so a test can check that components/WelcomeScreen.tsx
 * (which has to inline the mark as JSX) hasn't drifted from it.
 */
export const MARK_PATHS = { HEAD, HAIRLINE, SPIRAL } as const

/** The silhouette's extent inside its 100-unit box; every line sits inside it. */
export const MARK_BOUNDS = { x: 12.5, y: 17, width: 64.5, height: 70.5 } as const

export interface MarkOptions {
  /** The silhouette's colour. Ink for light grounds, paper for dark ones. */
  figure?: string
  /** The colour the lines are drawn in — the ground's colour, so they read as cut out. */
  line?: string
  /** Which face she wears. */
  expression?: Expression
}

function face(expression: Expression, line: string, weight: number): string {
  if (!Object.hasOwn(EXPRESSIONS, expression)) throw new RangeError(`unknown expression ${JSON.stringify(expression)}`)
  return EXPRESSIONS[expression](line, weight)
}

/** Full-detail cut, for 64 px and up. */
export function markBody({ figure = INK, line = PAPER, expression = 'smile' }: MarkOptions = {}): string {
  return (
    `<path d="${HEAD}" fill="${figure}"/>` +
    stroke(HAIRLINE, line, 2) +
    stroke(SPIRAL, line, 1.7) +
    face(expression, line, 1)
  )
}

/** Small cut, for 48 px and below: no spiral, heavier hairline and face. */
export function markSmallBody({ figure = INK, line = PAPER, expression = 'smile' }: MarkOptions = {}): string {
  return `<path d="${HEAD}" fill="${figure}"/>` + stroke(HAIRLINE, line, 3.6) + face(expression, line, 1.6)
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
