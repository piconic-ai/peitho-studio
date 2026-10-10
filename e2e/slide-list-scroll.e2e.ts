// The slide list is the slides panel's only scroll area: with more
// thumbnails than fit, it must scroll inside the panel, never grow past the
// window and paint its thumbnails over the error bar and status bar below.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

test('a long slide list scrolls inside its panel, above the error and status bars', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 600 })
  const deck: MockDeck = {
    source: Array.from({ length: 20 }, (_, i) => `# Slide ${String(i + 1)}\n`).join('\n---\n\n'),
    commandError: cmd => cmd === 'render_draft' ? 'slide 3: something went wrong' : null,
  }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(20, { timeout: 10_000 })
  const footer = page.locator('footer')
  const scroller = page.locator('#panel-slides .overflow-y-auto')

  const scrollerBox = await scroller.boundingBox()
  const footerBox = await footer.boundingBox()
  expect(scrollerBox!.y + scrollerBox!.height).toBeLessThanOrEqual(footerBox!.y)
  expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
})
