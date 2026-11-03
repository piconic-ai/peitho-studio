import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorText } from './helpers/codeEditor'

const SOURCE = '# One\n\n---\n\n# Two\n'

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await page.locator('[data-panel="slides"] button').first().focus()
}

async function dispatchKey(page: Page, key: string, modifier: 'meta' | 'ctrl', shiftKey = false): Promise<boolean> {
  return page.evaluate(({ key, modifier, shiftKey }) => {
    const event = new KeyboardEvent('keydown', { key, metaKey: modifier === 'meta', ctrlKey: modifier === 'ctrl', shiftKey, bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }, { key, modifier, shiftKey })
}

test('slide clipboard shortcuts consume Meta keys while Ctrl keys keep their default', async ({ page }) => {
  const deck: MockDeck = { source: SOURCE, clipboardText: 'OS clipboard' }
  await openDeck(page, deck)
  for (const key of ['x', 'c', 'v', 'Enter']) expect(await dispatchKey(page, key, 'ctrl')).toBe(false)
  expect(deck.source).toBe(SOURCE)
  expect(await dispatchKey(page, 'c', 'meta')).toBe(true)
  await page.locator('[data-slide-row="1"]').click()
  await page.locator('[data-panel="slides"] button').first().focus()
  expect(await dispatchKey(page, 'c', 'ctrl')).toBe(false)
  expect(await dispatchKey(page, 'v', 'meta')).toBe(true)
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  await expect.poll(() => deck.source.match(/# One/g)?.length).toBe(2)
  await page.locator('[data-panel="slides"] button').first().focus()
  expect(await dispatchKey(page, 'x', 'meta')).toBe(true)
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
  expect(deck.clipboardText).toBe('OS clipboard')
})

test('Meta Copy defers to selected text without replacing the slide clipboard', async ({ page }) => {
  const deck: MockDeck = { source: SOURCE, clipboardText: 'OS clipboard' }
  await openDeck(page, deck)
  expect(await dispatchKey(page, 'c', 'meta')).toBe(true)
  await page.locator('[data-slide-row="1"]').click()
  await page.locator('[data-panel="slides"] button').first().focus()
  await page.locator('[data-slide-row="1"]').evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0)
  expect(await dispatchKey(page, 'c', 'meta')).toBe(false)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  expect(await dispatchKey(page, 'v', 'meta')).toBe(true)
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  await expect.poll(() => deck.source.match(/# One/g)?.length).toBe(2)
  expect(deck.clipboardText).toBe('OS clipboard')
})

test('structure shortcuts move and add slides before arrow navigation', async ({ page }) => {
  const deck: MockDeck = { source: SOURCE }
  await openDeck(page, deck)
  expect(await dispatchKey(page, 'ArrowDown', 'meta', true)).toBe(true)
  await expect.poll(() => deck.source.indexOf('# Two') < deck.source.indexOf('# One')).toBe(true)
  expect(await dispatchKey(page, 'ArrowUp', 'meta', true)).toBe(true)
  await expect.poll(() => deck.source.indexOf('# One') < deck.source.indexOf('# Two')).toBe(true)
  expect(await dispatchKey(page, 'Enter', 'meta')).toBe(true)
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  await expect.poll(() => editorText(page)).toContain('# New Slide')
  await page.locator('[data-panel="slides"] button').first().focus()
  expect(await dispatchKey(page, 'Backspace', 'ctrl')).toBe(true)
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
})

test('without slides, arrows and Meta Enter keep their default and create no slide', async ({ page }) => {
  const deck: MockDeck = { source: '', devDefaultDeck: null }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Peitho Studio' })).toBeVisible()
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter']) expect(await dispatchKey(page, key, 'meta')).toBe(false)
  await expect(page.locator('[data-slide-row]')).toHaveCount(0)
  expect(deck.source).toBe('')
})
