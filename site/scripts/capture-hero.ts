// Records the landing site's hero demo (studio-demo.mp4) and WebP posters
// from the real Studio frontend, driven by the same
// Tauri IPC mock the e2e suite uses (e2e/helpers/mockTauri.ts).
//
// From the repository root, with the app's dependencies installed:
//   bun run build && PORT=3013 bun run start &   # serve the Studio frontend
//   bun site/scripts/capture-hero.ts             # requires ffmpeg; CHROME_PATH=...
import { spawnSync } from 'node:child_process'
import { chromium, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mockTauri, type MockDeck } from '../../e2e/helpers/mockTauri'

import { editorContent } from '../../e2e/helpers/codeEditor'
import { source, fragmentFor, css } from './demo-deck'
import { createFakeCritIpc } from '../../ipc/fakeCritIpc'

const STUDIO_URL = process.env.STUDIO_URL ?? 'http://localhost:3013/'
const OUT = mkdtempSync(join(tmpdir(), 'peitho-hero-'))
const SITE = resolve(import.meta.dir, '../public')
const crit = createFakeCritIpc({ now: () => '2026-10-02T10:00:00Z' })
const deck: MockDeck = { source, fragmentFor: title => fragmentFor(deck.source, title), css, trusted: true, crit }

const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'en-US', recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } })
const page = await ctx.newPage()
const pageErrors: string[] = []
page.on('pageerror', e => pageErrors.push(String(e)))
await mockTauri(page as never, deck)
// The mock answers open_deck with the source as the path; show a real one.
await page.addInitScript(() => {
  const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<any> } }
  const inner = w.__TAURI_INTERNALS__.invoke
  w.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    const r = await inner(cmd, args)
    return cmd === 'open_deck' ? { ...r, deckPath: '~/talks/peitho-studio-intro/deck.md', deckDir: '~/talks/peitho-studio-intro' } : r
  }
})
await page.goto(STUDIO_URL)
await page.locator('[data-slide-row]').first().waitFor({ timeout: 15000 })
await page.locator('[data-slide-row="1"]').click()
await page.locator('[data-panel-toggle="review"][aria-expanded="true"]').click()
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(1800)
// First, the user edits Markdown directly; the HTML preview follows each edit.
const editor = editorContent(page)
await editor.click()
await page.keyboard.press('ControlOrMeta+Home')
await page.keyboard.press('Home')
await page.keyboard.press('Shift+End')
await page.keyboard.press('Backspace')
await editor.pressSequentially('# Meet Peitho Studio', { delay: 100 })
await expect(page.locator('[data-preview-host] h1')).toHaveText('Meet Peitho Studio')
await page.waitForTimeout(2200)
// Then the user asks their agent to refine this same introduction slide.
await page.locator('[data-panel-toggle="review"][aria-expanded="false"]').click()
await page.waitForTimeout(600)
await page.locator('[data-preview-host] h1').click()
await page.waitForTimeout(700)
await page.locator('[data-comment-box] textarea').pressSequentially('Use a light editorial style: warm white (#FFFCF7), charcoal text (#252525), a large Georgia title and 40px sans-serif bullets. Keep the title and 3 bullets left-aligned with wide margins. No extra text, cards, numbers or icons. Fade in the bullets.', { delay: 28 })
await page.waitForTimeout(1300)
await page.locator('[data-comment-add]').click()
await page.waitForTimeout(1500)
await page.locator('[data-review-send]').click()
await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
// Expand the slide after showing its Markdown source, so the before/after layout stays readable.
await page.locator('[data-panel-toggle="editor"][aria-expanded="true"]').click()
await page.waitForTimeout(2200)
// Prerecorded agent result: update the deck via the real external-file-change flow.
await expect.poll(() => deck.source).toContain('# Meet Peitho Studio')
const wordsBefore = deck.source.split('\n').filter(line => !line.startsWith('<!--')).join('\n')
deck.source = deck.source.replace('"layout":"plain"', '"layout":"light-editorial"')
expect(deck.source.split('\n').filter(line => !line.startsWith('<!--')).join('\n')).toBe(wordsBefore)
await page.evaluate(() => {
  (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown) => void })
    .__mockEmitTauriEvent('deck-file-changed', null)
})
await expect(page.locator('[data-preview-host] .editorial')).toBeVisible()
await expect(page.locator('[data-preview-host] .editorial > :not(script)')).toHaveCount(2)
await expect(page.locator('[data-preview-host] .features li')).toHaveText([
  'Write in Markdown', 'See changes instantly', 'Refine with your AI Agent',
])
await expect(page.locator('[data-preview-host] .editorial')).toHaveCSS('background-color', 'rgb(255, 252, 247)')
await expect(page.locator('[data-preview-host] .editorial')).toHaveCSS('color', 'rgb(37, 37, 37)')
// The light editorial HTML slide animates with its own JavaScript inside Studio.
await expect.poll(() => page.locator('[data-preview-host] .features li').first().evaluate(el => el.getAnimations().length)).toBeGreaterThan(0)
crit.reply('c_1', 'Applied the light editorial style. Kept only your title and three bullets, with the requested colors, fonts, spacing and fade-in.', 'AI Agent')
crit.agentConnects()
await expect(page.locator('[data-review-agent]')).toContainText(['AI Agent'])
await page.waitForTimeout(5500)
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
const video = page.video()!
await ctx.close()
const recorded = await video.path()
const encoded = spawnSync('ffmpeg', ['-y', '-i', recorded, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${SITE}/studio-demo.mp4`], { encoding: 'utf8' })
if (encoded.status !== 0) throw new Error(encoded.stderr)
console.log(`wrote ${SITE}/studio-demo.mp4`)
await b.close()
if (pageErrors.length) throw new Error(pageErrors.join('\n'))
