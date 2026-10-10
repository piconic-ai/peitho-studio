// The slide list is the slides panel's only scroll area: with more
// thumbnails than fit, it must scroll inside the panel, never grow past the
// window and paint its thumbnails over the error and status bars below.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

test('Given a long slide list and an error shown, then the list scrolls inside its panel, above the error and status bars', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 600 })
  const deck: MockDeck = {
    source: Array.from({ length: 20 }, (_, i) => `# Slide ${String(i + 1)}\n`).join('\n---\n\n'),
    commandError: (cmd, args) =>
      cmd === 'render_draft' && (args.content as string).includes('# New Slide') ? 'slide 2: simulated build error' : null,
  }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(20, { timeout: 10_000 })

  // A failed New Slide is what brings the error bar up.
  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByRole('button', { name: 'New Slide ⌘⏎' }).click()
  const errorBar = page.locator('.bg-destructive\\/10')
  await expect(errorBar).toBeVisible({ timeout: 5_000 })
  await expect(errorBar).toContainText('simulated build error')

  const scroller = page.locator('#panel-slides .overflow-y-auto')
  const scrollerBox = await scroller.boundingBox()
  const errorBarBox = await errorBar.boundingBox()
  const footerBox = await page.locator('footer').boundingBox()
  const scrollerBottom = scrollerBox!.y + scrollerBox!.height
  expect(scrollerBottom).toBeLessThanOrEqual(errorBarBox!.y)
  expect(scrollerBottom).toBeLessThanOrEqual(footerBox!.y)
  expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
})
