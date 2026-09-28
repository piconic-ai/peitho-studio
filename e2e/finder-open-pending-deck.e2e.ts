// Functional requirement from todo/finder-file-association.md: a Finder
// `.md` double-click with nothing open anywhere yet reuses the app's own
// `main` welcome window instead of opening a redundant second one (see
// `finder_open_target`/`open_finder_urls` in peitho.rs) — handed to the
// frontend the same way `open_deck_window_impl` hands a path to a brand
// new `deck-N` window, through Rust-side `PendingDecks`/`take_pending_deck`.
// `mockTauri` always plays the one `main` window (see its `currentWindow`
// setup), which is exactly the case this file exercises.
//
// The second test is a regression test for a real bug caught while
// implementing this: `main` receiving a `pending` path is new — before
// this feature, only a disposable `deck-N` window ever did, and Studio.tsx's
// onMount closed that window outright on any open failure, since such a
// window "exists solely to show `pending`". Reusing that same code
// unconditionally for `main` would have silently closed the app's only
// window whenever a Finder-handed file failed to open, leaving no visible
// error at all — directly violating this todo's own acceptance criteria.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const deck: MockDeck = {
  source: '# Slide One\n',
  devDefaultDeck: null,
}

test('Given a Finder-opened deck path is waiting for the main window, when it mounts, then it opens that deck in place, never showing the welcome screen', async ({ page }) => {
  await mockTauri(page, { ...deck, pendingDeck: '/fake/finder-opened/deck.md' })
  await page.goto('/')

  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })
  await expect(page.getByText('Peitho Studio', { exact: true })).toHaveCount(0)
})

test('Given a Finder-opened deck path no longer resolves, when the main window tries to open it, then the welcome screen stays up with the error shown instead of the window closing', async ({ page }) => {
  const invokedCommands: string[] = []
  await mockTauri(page, {
    ...deck,
    pendingDeck: '/fake/finder-opened/moved-deck.md',
    invokedCommands,
    commandError: cmd => (cmd === 'open_deck' ? 'deck file not found: /fake/finder-opened/moved-deck.md' : null),
  })
  await page.goto('/')

  await expect(page.getByText('Peitho Studio', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('deck file not found: /fake/finder-opened/moved-deck.md')).toBeVisible()
  // The whole point of this test: the window must still be here to show
  // that error, not have closed itself as a disposable `deck-N` window
  // would (see Studio.tsx's onMount).
  expect(invokedCommands).not.toContain('plugin:window|close')
})
