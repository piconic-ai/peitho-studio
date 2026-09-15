// A layout author's own <script> in a slide's rendered fragment used to be
// silently inert: `dom/slideCanvas.ts` mounts/patches a canvas via
// `innerHTML`, and the HTML spec marks any <script> parsed that way
// "already started" — it never executes, no matter how it's later moved or
// reconnected. `executeInlineScripts` (see that file) swaps every such
// script for a freshly created one, which does. See
// `todo/layout-js-console-log.md` for the investigation and the matching
// fix ported into `peitho`/`peitho-present`'s own viewers.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

function fragmentWithCountingScript(title: string): string {
  return `<section class="peitho-slide"><h1>${title}</h1>`
    + `<script>window.__scriptRunCount = (window.__scriptRunCount || 0) + 1; let n = 0</script></section>`
}

test('Given a slide whose fragment embeds a <script>, when its thumbnail is mounted, then the script actually executes', async ({ page }) => {
  const deck: MockDeck = { source: '# Scripted Slide\n', fragmentFor: fragmentWithCountingScript }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  await expect.poll(() => page.evaluate(() => (window as unknown as { __scriptRunCount?: number }).__scriptRunCount))
    .toBeGreaterThanOrEqual(1)
})

test('Given a slide whose script declares a top-level `let`, when the slide is edited twice (re-executing its script each time), then it does not throw "already declared"', async ({ page }) => {
  const deck: MockDeck = { source: '# Scripted Slide\n', fragmentFor: fragmentWithCountingScript }
  const pageErrors: string[] = []
  page.on('pageerror', err => pageErrors.push(err.message))
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __scriptRunCount?: number }).__scriptRunCount))
    .toBeGreaterThanOrEqual(1)
  const afterMount = await page.evaluate(() => (window as unknown as { __scriptRunCount?: number }).__scriptRunCount)

  // The mock's fragmentFor is keyed by title (see fragmentWithCountingScript),
  // matching real peitho-core: a title-only edit is what actually changes the
  // rendered fragment string and so reaches patchSlideCanvas — editing only
  // the body (an unrelated change) would look like a no-op fragment to it.
  await page.locator('[data-slide-row="0"]').click()
  const body = page.locator('textarea').first()
  await body.fill('# Scripted Slide Edited Once\n')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __scriptRunCount?: number }).__scriptRunCount))
    .toBeGreaterThan(afterMount!)
  const afterFirstEdit = await page.evaluate(() => (window as unknown as { __scriptRunCount?: number }).__scriptRunCount)

  await body.fill('# Scripted Slide Edited Twice\n')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __scriptRunCount?: number }).__scriptRunCount))
    .toBeGreaterThan(afterFirstEdit!)

  expect(pageErrors).toEqual([])
})
