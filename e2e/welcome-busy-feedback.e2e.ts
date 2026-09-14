// Functional requirement (todo/welcome-open-feels-frozen.md): "Open
// Deck…"/a Recent entry gives visible feedback that outlasts a single
// frame — a real-device report found that a fast in-process `open_deck`
// (openDeckDelayMs left at its default, 0) resolved so quickly that
// `deckLifecycle` reached `open` and the editor replaced WelcomeScreen in
// the very same tick, with the busy state never actually painted (measured
// directly with a throwaway Playwright probe before this fix — see
// Studio.tsx's comment above `MIN_WELCOME_BUSY_DISPLAY_MS`). Each test
// below is one Given-When-Then example of the floor that fixes it.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const deck: MockDeck = {
  source: '# Slide One\n',
  devDefaultDeck: null,
  recentDecks: ['/fake/recent-deck/deck.md'],
  dialogPath: '/fake/picked-deck',
  // Default (0) deliberately — this is exactly the "resolves within a
  // single frame" case the floor exists to cover.
}

test('Given a Recent entry click and a near-instant open_deck, when clicked, then the busy state stays visible for the floor duration before the editor replaces it', async ({ page }) => {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.getByText('Peitho Studio', { exact: true })).toBeVisible({ timeout: 10_000 })

  const recentButton = page.getByRole('button', { name: '/fake/recent-deck/deck.md' })
  await recentButton.click()

  // Still on the welcome screen, still disabled — not swapped out for the
  // editor the instant open_deck resolves.
  await expect(recentButton).toBeDisabled()
  await expect(page.getByText('Peitho Studio', { exact: true })).toBeVisible()

  // Eventually settles on the editor once the floor elapses.
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 5_000 })
  await expect(page.getByText('Peitho Studio', { exact: true })).toHaveCount(0)
})

test('Given "Open Deck…" and a near-instant open_deck, when clicked, then the busy state stays visible for the floor duration before the editor replaces it', async ({ page }) => {
  await mockTauri(page, deck)
  await page.goto('/')

  const openButton = page.getByRole('button', { name: 'Open Deck…', exact: true })
  await openButton.click()

  await expect(page.getByRole('button', { name: 'Opening…', exact: true })).toBeDisabled()
  await expect(page.getByText('Peitho Studio', { exact: true })).toBeVisible()

  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 5_000 })
  await expect(page.getByText('Peitho Studio', { exact: true })).toHaveCount(0)
})

test('Given open_deck is genuinely slow, when Open Deck… is clicked, then the busy state clears once it actually finishes rather than being cut short by the floor', async ({ page }) => {
  await mockTauri(page, { ...deck, openDeckDelayMs: 600 })
  await page.goto('/')

  const openButton = page.getByRole('button', { name: 'Open Deck…', exact: true })
  await openButton.click()
  await expect(page.getByRole('button', { name: 'Opening…', exact: true })).toBeDisabled()

  // Still busy well past the 400ms floor, since the real work is slower
  // than that.
  await page.waitForTimeout(450)
  await expect(page.getByText('Peitho Studio', { exact: true })).toBeVisible()

  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 5_000 })
})
