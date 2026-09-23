// A layout-authored component library (e.g. BarefootJS's `data-bf`
// marker + a shared mounter script) needs to discover elements inside a
// slide's Shadow root, but `document.querySelectorAll`/`MutationObserver`
// never cross into one on their own. Studio follows peitho's own contract
// for this (`domain/shadowMounted.ts`, mizzy/peitho#530): a
// `peitho:shadow-mounted` event carrying `{ root, key, index }`, plus a
// `window.__peithoShadowRoots` backlog of the same details. Verifies both
// reach light-DOM code, on first mount and again after an edit re-patches
// the canvas.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

function fragmentWithMountPoint(title: string): string {
  return `<section class="peitho-slide" data-slide-key="marked" data-slide-index="0"><h1>${title}</h1><div data-bf="Thing"></div></section>`
}

type Detail = { root: ShadowRoot; key: string; index: number }

test('Given a slide fragment with a data-bf marker, when its canvas mounts, then a light-DOM listener receives the event with that shadow root and slide identity', async ({ page }) => {
  const deck: MockDeck = { source: '# Marked Slide\n', fragmentFor: fragmentWithMountPoint }
  await mockTauri(page, deck)
  await page.addInitScript(() => {
    document.addEventListener('peitho:shadow-mounted', event => {
      const detail = (event as CustomEvent<Detail>).detail
      const marker = detail.root.querySelector('[data-bf]')
      if (marker) marker.textContent = `mounted ${detail.key}#${String(detail.index)}`
    })
  })

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  await expect.poll(() => page.evaluate(() => {
    const host = document.querySelector('[data-slide-canvas-key]')
    return host?.shadowRoot?.querySelector('[data-bf]')?.textContent ?? null
  })).toBe('mounted marked#0')
})

test('Given canvases have mounted, when a script loads later, then the backlog holds one entry per live shadow root', async ({ page }) => {
  const deck: MockDeck = { source: '# Marked Slide\n', fragmentFor: fragmentWithMountPoint }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await page.locator('textarea').first().fill('# Marked Slide Edited\n')

  await expect.poll(() => page.evaluate(() => {
    const backlog = (window as unknown as { __peithoShadowRoots?: Detail[] }).__peithoShadowRoots ?? []
    const roots = backlog.map(detail => detail.root)
    return {
      allLive: roots.every(root => root.host.isConnected),
      unique: new Set(roots).size === roots.length,
      keys: backlog.map(detail => detail.key),
      edited: roots.some(root => root.querySelector('h1')?.textContent === 'Marked Slide Edited'),
    }
  })).toMatchObject({ allLive: true, unique: true, edited: true })
})

test('Given that same listener, when the slide is edited (re-patching its canvas), then the event fires again with the new shadow content', async ({ page }) => {
  const deck: MockDeck = { source: '# Marked Slide\n', fragmentFor: fragmentWithMountPoint }
  await mockTauri(page, deck)
  await page.addInitScript(() => {
    (window as unknown as { __shadowMountedCount: number }).__shadowMountedCount = 0
    document.addEventListener('peitho:shadow-mounted', () => {
      (window as unknown as { __shadowMountedCount: number }).__shadowMountedCount += 1
    })
  })

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shadowMountedCount: number }).__shadowMountedCount))
    .toBeGreaterThanOrEqual(1)
  const afterMount = await page.evaluate(() => (window as unknown as { __shadowMountedCount: number }).__shadowMountedCount)

  // A title-only edit is what actually changes the mock's fragment string
  // (see e2e/layout-script-execution.e2e.ts's own note on fragmentFor).
  await page.locator('[data-slide-row="0"]').click()
  await page.locator('textarea').first().fill('# Marked Slide Edited\n')

  await expect.poll(() => page.evaluate(() => (window as unknown as { __shadowMountedCount: number }).__shadowMountedCount))
    .toBeGreaterThan(afterMount)
})
