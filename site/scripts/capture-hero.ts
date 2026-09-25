// Regenerates the landing site's hero screenshot (site/public/studio.webp
// and studio@2x.webp) from the real Studio frontend, driven by the same
// Tauri IPC mock the e2e suite uses (e2e/helpers/mockTauri.ts).
//
// From the repository root, with the app's dependencies installed:
//   bun run build && PORT=3013 bun run start &   # serve the Studio frontend
//   bun site/scripts/capture-hero.ts             # CHROME_PATH=... to pick a browser
import { chromium } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mockTauri, type MockDeck } from '../../e2e/helpers/mockTauri'

const STUDIO_URL = process.env.STUDIO_URL ?? 'http://localhost:3013/'
const OUT = mkdtempSync(join(tmpdir(), 'peitho-hero-'))
const SITE = resolve(import.meta.dir, '../public')
const slide = (key: string, body: string, extra: Record<string, unknown> = {}) =>
  `<!-- ${JSON.stringify({ key, ...extra })} -->\n${body}\n`
const SOURCE = [
  slide('cover', '# Markdown Decks\n\nWrite slides the way you write notes.'),
  slide('plain-text', '# Why plain text\n\n- One file, any editor\n- Diffs you can review\n- Nothing locked in\n\n<!-- Pause here. Ask who keeps slides in git. -->', { section: 'Intro', time: '5m' }),
  slide('schema', '# The layout is the schema\n\n- Slots declare what fits\n- Broken decks fail at build'),
  slide('preview', '# Live preview\n\n- Rendered by peitho-core\n- PC or phone canvas', { section: 'Demo', time: '8m' }),
  slide('present', '# Present anywhere\n\n- Presenter view\n- Phone remote'),
  slide('thanks', '# Thanks'),
].join('\n---\n\n')

const BODIES: Record<string, string> = {
  'Markdown Decks': '<p class="sub">Write slides the way you write notes.</p>',
  'Why plain text': '<ul><li>One file, any editor</li><li>Diffs you can review</li><li>Nothing locked in</li></ul>',
  'The layout is the schema': '<ul><li>Slots declare what fits</li><li>Broken decks fail at build</li></ul>',
  'Live preview': '<ul><li>Rendered by peitho-core</li><li>PC or phone canvas</li></ul>',
  'Present anywhere': '<ul><li>Presenter view</li><li>Phone remote</li></ul>',
  'Thanks': '',
}
const fragmentFor = (title: string) => {
  const cls = title === 'Markdown Decks' || title === 'Thanks' ? 'peitho-slide cover' : 'peitho-slide'
  return `<section class="${cls}"><h1>${title}</h1>${BODIES[title] ?? ''}</section>`
}
const css = `
.peitho-slide { width: var(--peitho-canvas-width, 1280px); height: var(--peitho-canvas-height, 720px); box-sizing: border-box;
  padding: 96px 112px; background: #fbfaf8; color: #1c1917; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
.peitho-slide h1 { margin: 0 0 44px; font-size: 76px; line-height: 1.05; letter-spacing: -0.03em; }
.peitho-slide h1::after { content: ""; display: block; width: 96px; height: 8px; margin-top: 28px; background: #1c1917; border-radius: 4px; }
.peitho-slide ul { margin: 0; padding-left: 1.1em; font-size: 44px; line-height: 1.55; color: #44403c; }
.peitho-slide.cover { display: flex; flex-direction: column; justify-content: center; background: #111; color: #fff; }
.peitho-slide.cover h1 { font-size: 104px; }
.peitho-slide.cover h1::after { background: #fff; }
.peitho-slide .sub { margin: 0; font-size: 40px; color: #d6d3d1; }
`
const deck: MockDeck = { source: SOURCE, fragmentFor, css }

const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'en-US' })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('pageerror', String(e)))
await mockTauri(page as never, deck)
// The mock answers open_deck with the source as the path; show a real one.
await page.addInitScript(() => {
  const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<any> } }
  const inner = w.__TAURI_INTERNALS__.invoke
  w.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    const r = await inner(cmd, args)
    return cmd === 'open_deck' ? { ...r, deckPath: '~/talks/markdown-decks/deck.md', deckDir: '~/talks/markdown-decks' } : r
  }
})
await page.goto(STUDIO_URL)
await page.locator('[data-slide-row]').first().waitFor({ timeout: 15000 })
await page.locator('[data-slide-row="1"]').click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/studio-raw.png` })
// Encode WebP at 2x and 1x in the page itself, so no image tooling is needed.
const png = 'data:image/png;base64,' + readFileSync(`${OUT}/studio-raw.png`).toString('base64')
const out = await page.evaluate(async (src) => {
  const img = new Image(); img.src = src; await img.decode()
  const enc = (w: number) => { const c = document.createElement('canvas'); c.width = w; c.height = Math.round(img.height * w / img.width)
    const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/webp', 0.9) }
  return { x2: enc(img.width), x1: enc(img.width / 2) }
}, png)
writeFileSync(`${SITE}/studio@2x.webp`, Buffer.from(out.x2.split(',')[1], 'base64'))
writeFileSync(`${SITE}/studio.webp`, Buffer.from(out.x1.split(',')[1], 'base64'))
console.log(`wrote ${SITE}/studio.webp and studio@2x.webp`)
await b.close()
