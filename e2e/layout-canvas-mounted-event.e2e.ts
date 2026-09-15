// A layout-authored component library (e.g. BarefootJS's `data-bf`
// marker + a shared mounter script) needs to discover elements inside a
// slide's Shadow root, but `document.querySelectorAll`/`MutationObserver`
// never cross into one on their own — see `dom/slideCanvas.ts`'s
// `CANVAS_MOUNTED_EVENT` and `todo/layout-js-console-log.md`. Verifies the
// event actually reaches light-DOM code with a usable shadow root, both
// on first mount and again after an edit re-patches the canvas.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

function fragmentWithMountPoint(title: string): string {
  return `<section class="peitho-slide"><h1>${title}</h1><div data-bf="Thing"></div></section>`
}

test('Given a slide fragment with a data-bf marker, when its canvas mounts, then a light-DOM listener receives the event with that shadow root', async ({ page }) => {
  const deck: MockDeck = { source: '# Marked Slide\n', fragmentFor: fragmentWithMountPoint }
  await mockTauri(page, deck)
  await page.addInitScript(() => {
    document.addEventListener('peitho:canvas-mounted', event => {
      const detail = (event as CustomEvent<{ root: ShadowRoot }>).detail
      const marker = detail.root.querySelector('[data-bf]')
      if (marker) marker.textContent = 'mounted via event'
    })
  })

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  await expect.poll(() => page.evaluate(() => {
    const host = document.querySelector('[data-slide-canvas-key]')
    return host?.shadowRoot?.querySelector('[data-bf]')?.textContent ?? null
  })).toBe('mounted via event')
})

test('Given that same listener, when the slide is edited (re-patching its canvas), then the event fires again with the new shadow content', async ({ page }) => {
  const deck: MockDeck = { source: '# Marked Slide\n', fragmentFor: fragmentWithMountPoint }
  await mockTauri(page, deck)
  await page.addInitScript(() => {
    (window as unknown as { __canvasMountedCount: number }).__canvasMountedCount = 0
    document.addEventListener('peitho:canvas-mounted', () => {
      (window as unknown as { __canvasMountedCount: number }).__canvasMountedCount += 1
    })
  })

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __canvasMountedCount: number }).__canvasMountedCount))
    .toBeGreaterThanOrEqual(1)
  const afterMount = await page.evaluate(() => (window as unknown as { __canvasMountedCount: number }).__canvasMountedCount)

  // A title-only edit is what actually changes the mock's fragment string
  // (see e2e/layout-script-execution.e2e.ts's own note on fragmentFor).
  await page.locator('[data-slide-row="0"]').click()
  await page.locator('textarea').first().fill('# Marked Slide Edited\n')

  await expect.poll(() => page.evaluate(() => (window as unknown as { __canvasMountedCount: number }).__canvasMountedCount))
    .toBeGreaterThan(afterMount!)
})
