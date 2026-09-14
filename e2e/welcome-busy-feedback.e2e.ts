// Functional requirement: "Open Deck…"/a Recent entry transitions to the
// editor shell the instant the click is handled — not once open_deck
// resolves — so the screen change itself is the "you pressed it, it's
// doing something" signal. A real-device report found the previous design
// (a busy indicator kept on WelcomeScreen, however reliably painted) still
// didn't read as reassuring to a real user; this replaces that with an
// optimistic transition (see state/deckStore.ts's `showEditor` and
// Studio.tsx's loading-placeholder branch) instead of trying to make the
// indicator itself louder. See todo/archive/welcome-open-feels-frozen.md.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const deck: MockDeck = {
  source: '# Slide One\n',
  devDefaultDeck: null,
  recentDecks: ['/fake/recent-deck/deck.md'],
  dialogPath: '/fake/picked-deck',
}

test('Given a Recent entry click, when clicked, then the editor shell replaces the welcome screen immediately, with a loading placeholder until open_deck resolves', async ({ page }) => {
  await mockTauri(page, { ...deck, openDeckDelayMs: 300 })
  await page.goto('/')
  await expect(page.getByText('Peitho Studio', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: '/fake/recent-deck/deck.md' }).click()

  // Gone immediately — well before open_deck (300ms away) has any chance
  // to resolve.
  await expect(page.getByText('Peitho Studio', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Loading deck…')).toBeVisible()

  // Once open_deck resolves, the real editor content replaces the
  // placeholder.
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 5_000 })
  await expect(page.getByText('Loading deck…')).toHaveCount(0)
})

test('Given "Open Deck…", when clicked, then the editor shell replaces the welcome screen immediately, with a loading placeholder until open_deck resolves', async ({ page }) => {
  await mockTauri(page, { ...deck, openDeckDelayMs: 300 })
  await page.goto('/')

  await page.getByRole('button', { name: 'Open Deck…', exact: true }).click()

  await expect(page.getByText('Peitho Studio', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Loading deck…')).toBeVisible()

  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 5_000 })
})

test('Given open_deck fails while the editor shell is showing a loading placeholder, when it rejects, then the screen falls back to the welcome screen with the error shown', async ({ page }) => {
  await mockTauri(page, {
    ...deck,
    openDeckDelayMs: 200,
    commandError: cmd => (cmd === 'open_deck' ? 'simulated open_deck failure' : null),
  })
  await page.goto('/')

  await page.getByRole('button', { name: '/fake/recent-deck/deck.md' }).click()
  await expect(page.getByText('Loading deck…')).toBeVisible()

  // Falls back to the welcome screen (not stuck showing the placeholder
  // forever) once open_deck rejects, with the failure surfaced there.
  await expect(page.getByText('Peitho Studio', { exact: true })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('simulated open_deck failure')).toBeVisible()
})
