// Cmd+Z / Cmd+Shift+Z undo and redo structural slide operations (New
// Slide, Delete, Skip, ...) when focus is outside the editor's textareas,
// and leave the keys to the textarea's native undo when it has focus (see
// the `onKeyDown` handler in `components/Studio.tsx`). Drives the real
// keydown path against the mock IPC; the native Edit menu itself isn't
// reachable here, so a mouse click on Edit > Undo is covered only by
// on-device verification.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const TWO_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
}

async function rightClickMenu(page: Page, row: number, item: string): Promise<void> {
  await page.locator(`[data-slide-row="${row}"]`).click({ button: 'right' })
  await page.getByText(item, { exact: true }).click()
}

/** Moves focus off any field, the way clicking a thumbnail does. */
async function blurFields(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

test('Given a new slide, when Cmd+Z is pressed outside the editor, then the slide is removed, and Cmd+Shift+Z brings it back', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)

  await rightClickMenu(page, 1, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  await blurFields(page)

  await page.keyboard.press('Meta+z')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
  expect(deck.source).not.toContain('# New Slide')

  await page.keyboard.press('Meta+Shift+z')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  expect(deck.source).toContain('# New Slide')
})

test('Given a deleted slide, when Cmd+Z is pressed, then the slide comes back in its old position', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)

  await rightClickMenu(page, 0, 'Delete')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 5_000 })
  await blurFields(page)

  await page.keyboard.press('Meta+z')

  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
  expect(deck.source.indexOf('# Slide One')).toBeLessThan(deck.source.indexOf('# Slide Two'))
})

test('Given two operations, when Cmd+Z is pressed twice, then they are undone newest first', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)

  await rightClickMenu(page, 1, 'Skip in Present')
  await expect.poll(() => deck.source).toContain('"skip":true')
  await rightClickMenu(page, 0, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  await blurFields(page)

  await page.keyboard.press('Meta+z')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
  expect(deck.source).toContain('"skip":true')

  await page.keyboard.press('Meta+z')
  await expect.poll(() => deck.source).not.toContain('"skip"')
  expect(deck.source).toBe(TWO_SLIDES)
})

test('Given focus in the slide body textarea, when Cmd+Z is pressed, then no structural operation is undone', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)

  await rightClickMenu(page, 1, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })

  await page.locator('textarea').first().click()
  await page.keyboard.press('Meta+z')

  // Give a wrongly routed undo time to land before asserting it didn't.
  await page.waitForTimeout(500)
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  expect(deck.source).toContain('# New Slide')
})

test('Given nothing has been done yet, when Cmd+Z is pressed, then the deck is left as it is', async ({ page }) => {
  const invoked: string[] = []
  const deck: MockDeck = { source: TWO_SLIDES, onInvoke: cmd => { invoked.push(cmd) } }
  await openDeck(page, deck)
  await blurFields(page)
  invoked.length = 0

  await page.keyboard.press('Meta+z')
  await page.keyboard.press('Meta+Shift+z')

  await page.waitForTimeout(500)
  expect(invoked).not.toContain('save_deck_source')
  expect(deck.source).toBe(TWO_SLIDES)
})
