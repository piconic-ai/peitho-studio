import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { mockTauri } from './helpers/mockTauri'
import { realEngineAvailable, startRealEngine } from './helpers/realEngine'

test.skip(!realEngineAvailable(), 'needs cargo build --example e2e_engine')

test('a title styled with display: contents accepts typing on the first click', async ({ page }, testInfo) => {
  const engine = startRealEngine()
  try {
    mkdirSync(testInfo.outputDir, { recursive: true })
    const deckPath = await engine.newDeck(testInfo.outputDir)
    const source = '<!-- {"key":"intro","layout":"title-only"} -->\n# Title\n'
    writeFileSync(deckPath, source)
    writeFileSync(join(dirname(deckPath), 'css', 'overrides.css'), '.slot-title { display: contents; }\n')
    const deck = { source, deckPath, realEngine: (cmd: string, args: Record<string, unknown>) => engine.invoke(deckPath, cmd, args) }
    await mockTauri(page, deck)
    await page.goto('/')
    await page.locator('[data-slide-row="0"]').click()

    const heading = page.locator('[data-preview-host] h1')
    const slot = heading.locator('.slot-title')
    await expect(slot).toHaveCSS('display', 'contents')
    await heading.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('New title')
    await page.keyboard.press('Enter')

    await expect.poll(() => deck.source).toContain('# New title')
    await expect(heading).toHaveText('New title')
    await expect(slot).toHaveCSS('display', 'contents')
  } finally {
    engine.stop()
  }
})
