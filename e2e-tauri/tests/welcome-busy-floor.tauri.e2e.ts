import { test, expect } from '../fixtures'

// Real-WKWebView companion to e2e/welcome-busy-feedback.e2e.ts (which
// verifies the exact 400ms floor with millisecond precision against the
// IPC-mocked browser tab — see domain/minDisplayDuration.ts). This test
// can't reproduce that precision: tauri-plugin-playwright's Unix-socket
// round trip for a single click() has been observed taking ~2s on this
// machine, dwarfing the 400ms floor itself. What it *can* confirm is that
// the fix behaves consistently on the real window — Open Deck/Recent
// clicks land, and the app doesn't get stuck or misbehave — closing the
// real-device gap the mocked suite explicitly can't reach (see
// todo/welcome-open-feels-frozen.md's still-open human-judgment item).
test('clicking a Recent entry opens it, on the real WKWebView window', async ({ tauriPage }) => {
  const recentButtons = tauriPage.locator('button')
  const recentCount = await recentButtons.count()
  expect(recentCount).toBeGreaterThan(2)

  // Last button in document order is a Recent entry (WelcomeScreen.tsx
  // renders Open Deck…/New Deck… first, then the Recent list).
  const recent = recentButtons.nth(recentCount - 1)
  const deckPath = await recent.textContent()
  console.log('opening recent deck:', deckPath)

  await recent.click()

  await expect(tauriPage.locator('[data-slide-row]').first()).toBeVisible({ timeout: 10_000 })
})
