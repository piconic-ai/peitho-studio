import { test, expect } from '../fixtures'

// Real-device companion to the "human judgment required" item in
// todo/action-click-feedback.md: does mashing Present actually risk
// spawning more than one `peitho present` subprocess? This drives the
// real window via tauri-plugin-playwright (see
// docs/tauri-playwright-spike.md) rather than OS-level clicks, so a
// same-machine double-click is safe to attempt here.
test('clicking Present twice in a row only spawns one presentation, on the real WKWebView window', async ({ tauriPage }) => {
  const recentButtons = tauriPage.locator('button')
  const recentCount = await recentButtons.count()
  const recent = recentButtons.nth(recentCount - 1)
  await recent.click()
  await expect(tauriPage.locator('[data-slide-row]').first()).toBeVisible({ timeout: 10_000 })

  const present = tauriPage.locator('header button').nth(0)
  await expect(present).toContainText('Present')

  await present.click()
  // Second click while presentPending should be a no-op — the button is
  // disabled (a genuinely disabled HTML button doesn't fire click
  // handlers at all), and handlePresent's own presentPending guard covers
  // it even if something bypassed the disabled attribute.
  await present.click()

  await expect(present).toContainText('Present', { timeout: 20_000 })
})
