// Builds every brand asset from the geometry in scripts/brand/mark.ts:
//
//   brand/*.svg              the mark, wordmark and app-icon sources
//   brand/expressions/*.svg  the mark wearing each of her expressions
//   brand/app-icon.png       the 1024 px app icon, for reference/previews
//   public/favicon.svg       the small cut on a full-bleed tile
//   src-tauri/icons/*        every PNG Tauri bundles, plus icon.icns / icon.ico
//
// Each raster size is rendered on its own (48 px and below from the small
// cut) and packed into .icns/.ico here, instead of `tauri icon` resizing a
// single 1024 px image — which is what lets 16/32 px stay legible.
//
// Run via `bun run icons`. Rasterizes with Playwright's Chromium: the system
// Chrome by default (like playwright.config.ts), or CHROME_BIN if set.
import { chromium, type Page } from '@playwright/test'
import opentype from 'opentype.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeIco, encodeIcns, type IcnsType } from './brand/iconContainers'
import { appIconSvg, EXPRESSIONS, type Expression, INK, MARK_BOUNDS, markBody, PAPER, SMALL_CUT_MAX_PX, svgDocument } from './brand/mark'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = (path: string) => resolve(ROOT, path)

function write(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(out(path)), { recursive: true })
  writeFileSync(out(path), data)
  console.log(`wrote ${path}`)
}

// ── Vector assets ────────────────────────────────────────────────────

/** A viewBox around the mark's silhouette, padded. */
function markViewBox(pad: number): { x: number; y: number; w: number; h: number } {
  return { x: MARK_BOUNDS.x - pad, y: MARK_BOUNDS.y - pad, w: MARK_BOUNDS.width + 2 * pad, h: MARK_BOUNDS.height + 2 * pad }
}

function markDocument(body: string, pad: number): string {
  const v = markViewBox(pad)
  const scale = 2 // intrinsic size in CSS px, so the file previews at a useful size
  return svgDocument(v.w * scale, v.h * scale, body, `${v.x} ${v.y} ${v.w} ${v.h}`)
}

/** "Peitho Studio" set in Charis SIL (OFL), converted to one path so the file needs no font. */
function wordmarkDocument(ink: string, mark: string): string {
  const font = opentype.loadSync(out('node_modules/@fontsource/charis-sil/files/charis-sil-latin-400-normal.woff'))
  const size = 100
  const tracking = -0.03 * size // the letter-spacing Peitho's own wordmark uses
  const unit = size / font.unitsPerEm
  const glyphs = font.stringToGlyphs('Peitho Studio')
  let x = 0
  const parts: string[] = []
  glyphs.forEach((glyph, i) => {
    parts.push(glyph.getPath(x, 0, size).toPathData(2))
    x += (glyph.advanceWidth ?? 0) * unit + tracking
    if (i + 1 < glyphs.length) x += font.getKerningValue(glyph, glyphs[i + 1]) * unit
  })
  const textWidth = x - tracking
  const capHeight = font.tables.os2.sCapHeight * unit

  const pad = 1
  const v = markViewBox(pad)
  const markHeight = capHeight * 2.4
  const markScale = markHeight / v.h
  const markWidth = v.w * markScale
  const gap = size * 0.42
  const margin = size * 0.12
  const height = markHeight + 2 * margin
  const baseline = margin + markHeight / 2 + capHeight / 2
  const width = margin + markWidth + gap + textWidth + margin
  const body =
    `<g transform="translate(${(margin - v.x * markScale).toFixed(2)} ${(margin - v.y * markScale).toFixed(2)}) scale(${markScale.toFixed(4)})">${mark}</g>` +
    `<path transform="translate(${(margin + markWidth + gap).toFixed(2)} ${baseline.toFixed(2)})" fill="${ink}" d="${parts.join('')}"/>`
  return svgDocument(Math.ceil(width), Math.ceil(height), body)
}

// ── Raster assets ────────────────────────────────────────────────────

async function rasterize(page: Page, svg: string, size: number): Promise<Uint8Array> {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  )
  return new Uint8Array(await page.screenshot({ omitBackground: true, type: 'png' }))
}

async function main(): Promise<void> {
  const onLight = markBody()
  const onDark = markBody({ figure: PAPER, line: INK })
  write('brand/logo-mark.svg', markDocument(onLight, 1))
  write('brand/logo-mark-inverse.svg', markDocument(onDark, 1))
  write('brand/logo-wordmark.svg', wordmarkDocument(INK, onLight))
  write('brand/logo-wordmark-inverse.svg', wordmarkDocument(PAPER, onDark))
  for (const expression of Object.keys(EXPRESSIONS) as Expression[]) {
    write(`brand/expressions/${expression}.svg`, markDocument(markBody({ expression }), 1))
    write(`brand/expressions/${expression}-inverse.svg`, markDocument(markBody({ expression, figure: PAPER, line: INK }), 1))
  }
  write('brand/app-icon.svg', appIconSvg())
  write('brand/app-icon-small.svg', appIconSvg({ small: true }))
  write('public/favicon.svg', appIconSvg({ small: true, shadow: false, tile: 'full' }))

  const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' })
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 })
    const cache = new Map<number, Uint8Array>()
    const png = async (size: number) => {
      let bytes = cache.get(size)
      if (!bytes) {
        bytes = await rasterize(page, appIconSvg({ small: size <= SMALL_CUT_MAX_PX }), size)
        cache.set(size, bytes)
      }
      return bytes
    }

    write('brand/app-icon.png', await png(1024))

    const tauriPngs: Record<string, number> = {
      '32x32.png': 32,
      '64x64.png': 64,
      '128x128.png': 128,
      '128x128@2x.png': 256,
      'icon.png': 512,
      'StoreLogo.png': 50,
      'Square30x30Logo.png': 30,
      'Square44x44Logo.png': 44,
      'Square71x71Logo.png': 71,
      'Square89x89Logo.png': 89,
      'Square107x107Logo.png': 107,
      'Square142x142Logo.png': 142,
      'Square150x150Logo.png': 150,
      'Square284x284Logo.png': 284,
      'Square310x310Logo.png': 310,
    }
    for (const [name, size] of Object.entries(tauriPngs)) write(`src-tauri/icons/${name}`, await png(size))

    const icns: [IcnsType, number][] = [
      ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
      ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
    ]
    const icnsEntries = []
    for (const [type, size] of icns) icnsEntries.push({ type, png: await png(size) })
    write('src-tauri/icons/icon.icns', encodeIcns(icnsEntries))

    const icoPngs = []
    for (const size of [16, 24, 32, 48, 64, 256]) icoPngs.push(await png(size))
    write('src-tauri/icons/icon.ico', encodeIco(icoPngs))
  } finally {
    await browser.close()
  }
}

await main()
