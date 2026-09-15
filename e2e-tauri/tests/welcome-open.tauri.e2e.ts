import { test, expect } from '../fixtures'

// Real-WKWebView companion to e2e/welcome-busy-feedback.e2e.ts, which
// verifies the optimistic-transition architecture precisely against the
// IPC-mocked browser tab (see state/deckStore.ts's `showEditor` and
// Studio.tsx's loading-placeholder branch). This confirms the same thing
// actually works end to end on the real window: clicking a Recent entry
// leaves the welcome screen immediately and lands on the real editor,
// without getting stuck or misbehaving — closing the real-device gap that
// prompted this redesign in the first place (see
// todo/archive/welcome-open-feels-frozen.md).
test('clicking a Recent entry leaves the welcome screen immediately and opens the deck, on the real WKWebView window', async ({ tauriPage }) => {
  const recentButtons = tauriPage.locator('button')
  const recentCount = await recentButtons.count()
  expect(recentCount).toBeGreaterThan(2)

  // Last button in document order is a Recent entry (WelcomeScreen.tsx
  // renders Open Deck…/New Deck… first, then the Recent list).
  const recent = recentButtons.nth(recentCount - 1)
  const deckPath = await recent.textContent()
  console.log('opening recent deck:', deckPath)

  await recent.click()

  await expect(tauriPage.locator('h1')).toHaveCount(0)
  await expect(tauriPage.locator('[data-slide-row]').first()).toBeVisible({ timeout: 10_000 })
})
