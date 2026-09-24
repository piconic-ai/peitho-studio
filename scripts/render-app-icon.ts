// Renders `brand/app-icon.svg` to `brand/app-icon.png` (1024×1024, transparent
// outside the rounded square) — the source `tauri icon` then resizes into
// every platform format under `src-tauri/icons/`. Run via `bun run icons`.
//
// Rasterizes with the same Playwright Chromium the e2e suite uses (a real
// browser engine, so the SVG's stroke joins come out exactly as the app
// itself would draw them). Like playwright.config.ts it reaches for the
// system Chrome (`channel: 'chrome'`); set `CHROME_BIN` to point at another
// Chromium binary instead (e.g. a CI container that ships one).
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(ROOT, 'brand/app-icon.svg')
const OUTPUT = resolve(ROOT, 'brand/app-icon.png')
const SIZE = 1024

const svg = await readFile(SOURCE, 'utf8')
const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' },
)
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`,
  )
  const png = await page.screenshot({ omitBackground: true, type: 'png' })
  await writeFile(OUTPUT, png)
  console.log(`wrote ${OUTPUT} (${png.byteLength} bytes)`)
} finally {
  await browser.close()
}
