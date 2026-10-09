// Pinning a slide to a layout it doesn't fit, against the real engine
// (helpers/realEngine.ts): a new slide (a lone heading) on the image
// layout, whose image is required. The pin is saved with the slide
// isolated as an ERROR row — the other slides keep rendering — and adding
// the image renders it. The mocked counterpart is layout-picker-mismatch.e2e.ts.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, expect } from '@playwright/test'
import { mockTauri } from './helpers/mockTauri'
import { realEngineAvailable, startRealEngine } from './helpers/realEngine'
import { editorText, fillEditor } from './helpers/codeEditor'
import { IMAGE_LAYOUT } from '../domain/imageSlot'

const ERROR_BADGE = '[data-slide-status="error"]'
const PREVIEW_ERROR = '[data-preview-build-error]'
const ERROR_BAR = '.bg-destructive\\/10'

/** A 1x1 PNG peitho-core accepts. */
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')

const SOURCE = '---\ntime: 1m\n---\n<!-- {"key":"cover","layout":"title-slide"} -->\n# Cover\n\n---\n\n<!-- {"key":"intro","layout":"title-body"} -->\n# Intro\n\nHello.\n'

test.skip(!realEngineAvailable(), 'needs `cargo build --example e2e_engine` in src-tauri/')

test('Given a new slide holding only a heading, when the image layout is chosen from Change Layout, then the pin is saved with the slide isolated, and adding the image renders it', async ({ page }) => {
  const engine = startRealEngine()
  try {
    const deckPath = await engine.newDeck(mkdtempSync(join(tmpdir(), 'peitho-e2e-')))
    mkdirSync(join(dirname(deckPath), 'img'), { recursive: true })
    writeFileSync(join(dirname(deckPath), 'img/photo.png'), TINY_PNG)
    writeFileSync(deckPath, SOURCE)

    const deck = {
      source: SOURCE,
      deckPath,
      // A new deck has the image layout along with the standard ones.
      layouts: ['title-slide', 'title-body', IMAGE_LAYOUT],
      realEngine: (cmd: string, args: Record<string, unknown>) => engine.invoke(deckPath, cmd, args),
    }
    await mockTauri(page, deck)
    await page.goto('/')
    await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    await page.getByText('New Slide', { exact: true }).click()
    await expect(page.locator('[data-slide-row]')).toHaveCount(3)
    await expect.poll(() => deck.source, { timeout: 10_000 }).toContain('# New Slide')

    await page.locator('[data-slide-row="2"]').click({ button: 'right' })
    await page.getByRole('button', { name: /^Change Layout/ }).click()
    const entry = page.locator(`button[data-key="${IMAGE_LAYOUT}"]`)
    // peitho-core's own verdict marks it — but it stays choosable.
    await expect(entry).toHaveAttribute('data-layout-mismatch', 'true', { timeout: 10_000 })
    await entry.click()

    await expect.poll(() => deck.source.split(/^---$/m).at(-1), { timeout: 10_000 }).toContain(`"layout":"${IMAGE_LAYOUT}"`)
    expect(deck.source).not.toContain('draft')
    await expect(page.locator('[data-slide-row="2"]').locator(ERROR_BADGE)).toBeVisible()
    await expect(page.locator(PREVIEW_ERROR)).toContainText("slot 'image' got 0 item(s)")
    await expect(page.locator(ERROR_BAR)).toContainText("1 slide doesn't build")

    // Adding the image renders it.
    await page.locator('[data-slide-row="2"]').click()
    await expect.poll(() => editorText(page)).toBe('# New Slide')
    await fillEditor(page, '# New Slide\n\n![](img/photo.png)')
    await expect.poll(() => deck.source, { timeout: 10_000 }).toContain('![](img/photo.png)')
    await expect(page.locator(ERROR_BADGE)).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator(PREVIEW_ERROR)).toBeHidden()
    await expect(page.locator(ERROR_BAR)).toBeHidden()
    await expect(page.locator('[data-preview-host] img')).toHaveCount(1)
  } finally {
    engine.stop()
  }
})
