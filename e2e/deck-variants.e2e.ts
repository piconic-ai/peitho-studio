// Functional requirement (todo/deck-language-variants.md): when the open
// deck has same-name siblings in its folder (deck.md, deck.ja.md, ...), the
// deck header offers a switcher that opens the picked one; a deck with no
// siblings shows no switcher at all. Each test below is one
// Given-When-Then example.
//
// What this can't show: that `open_deck_window` really opens a second
// native window with the picked deck, or how the dropdown paints on
// WKWebView — both need a real Tauri window (see the manual example in
// domain/deckVariants.examples.ts).
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import type { DeckVariant } from '../domain/deckVariants'

const variant = (fileName: string, suffix: string | null, isCurrent = false): DeckVariant => ({
  path: `/fake/${fileName}`, fileName, suffix, isCurrent,
})

interface Invocation { cmd: string; args: Record<string, unknown> }

async function openDeck(page: Page, deck: MockDeck): Promise<Invocation[]> {
  const invocations: Invocation[] = []
  await mockTauri(page, { ...deck, onInvoke: (cmd, args) => { invocations.push({ cmd, args }) } })
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })
  return invocations
}

const switcherButton = (page: Page) => page.getByRole('button', { name: 'Switch deck variant' })

test('Given deck.md is open next to deck.en.md and deck.ja.md, when the user picks "ja" from the switcher, then deck.ja.md is opened in a new window and this window keeps its deck', async ({ page }) => {
  const invocations = await openDeck(page, {
    source: '# Slide One\n',
    deckVariants: [variant('deck.md', null, true), variant('deck.en.md', 'en'), variant('deck.ja.md', 'ja')],
  })

  await expect(switcherButton(page)).toBeVisible()
  await expect(switcherButton(page)).toHaveText(/deck\.md/)

  await switcherButton(page).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitemradio')).toHaveText([/deck\.md/, /en\s*deck\.en\.md/, /ja\s*deck\.ja\.md/])

  const opensBefore = invocations.filter(i => i.cmd === 'open_deck').length
  await menu.getByRole('menuitemradio', { name: /^ja/ }).click()

  await expect.poll(() => invocations.filter(i => i.cmd === 'open_deck_window').map(i => i.args.path)).toEqual(['/fake/deck.ja.md'])
  await expect(menu).toBeHidden()
  // Still this window's own deck: no in-place re-open, slides still there.
  expect(invocations.filter(i => i.cmd === 'open_deck').length).toBe(opensBefore)
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
  await expect(switcherButton(page)).toHaveText(/deck\.md/)
})

test('Given deck.ja.md is the open deck, when the switcher menu is opened, then "ja" is shown as current and cannot be picked again', async ({ page }) => {
  const invocations = await openDeck(page, {
    source: '# Slide One\n',
    deckVariants: [variant('deck.md', null), variant('deck.ja.md', 'ja', true)],
  })

  await expect(switcherButton(page)).toHaveText(/ja/)
  await switcherButton(page).click()

  const current = page.getByRole('menuitemradio', { name: /^✓?\s*ja/ })
  await expect(current).toHaveAttribute('aria-checked', 'true')
  await expect(current).toBeDisabled()
  await expect(page.getByRole('menuitemradio', { name: /deck\.md/ })).toBeEnabled()
  expect(invocations.some(i => i.cmd === 'open_deck_window')).toBe(false)
})

test('Given the switcher menu is open, when the user clicks outside it, then it closes without opening anything', async ({ page }) => {
  const invocations = await openDeck(page, {
    source: '# Slide One\n',
    deckVariants: [variant('deck.md', null, true), variant('deck.ja.md', 'ja')],
  })

  await switcherButton(page).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.mouse.click(5, 300)

  await expect(page.getByRole('menu')).toBeHidden()
  expect(invocations.some(i => i.cmd === 'open_deck_window')).toBe(false)
})

test('Given the open deck has no same-name siblings, when the deck is shown, then no switcher is shown', async ({ page }) => {
  const invocations = await openDeck(page, {
    source: '# Slide One\n',
    deckVariants: [variant('deck.md', null, true)],
  })

  await expect.poll(() => invocations.some(i => i.cmd === 'list_deck_variants')).toBe(true)
  await expect(switcherButton(page)).toBeHidden()
})

// Robustness (non-functional): the switcher is a convenience, so a folder
// that can't be listed must not surface as an error or block editing.
test('Given listing the deck folder fails, when the deck is opened, then no switcher and no error are shown and the deck is still editable', async ({ page }) => {
  await mockTauri(page, {
    source: '# Slide One\n',
    deckVariants: [variant('deck.md', null, true), variant('deck.ja.md', 'ja')],
    commandError: cmd => (cmd === 'list_deck_variants' ? 'simulated read_dir failure' : null),
  })
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  await expect(switcherButton(page)).toBeHidden()
  await expect(page.getByText('simulated read_dir failure')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeEnabled()
})
