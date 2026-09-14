// Functional requirement (todo/action-click-feedback.md): the Present
// button gives visible feedback the instant it's clicked, for as long as
// `present_deck` is in flight — whether it ends in success or failure —
// instead of looking like a dead click while a slow present-window launch
// is still starting up. Each test below is one Given-When-Then example.
import { test, expect, type Page, type Locator } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

/** Opens the (mocked) deck, clicks Present, and asserts the busy state
 * appears — the part every scenario below shares. Returns the button
 * locator so each test can add its own post-condition assertions once
 * `present_deck` settles. */
async function openDeckAndTriggerPresent(page: Page, deck: MockDeck): Promise<Locator> {
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  const presentButton = page.getByRole('button', { name: 'Present', exact: true })
  await expect(presentButton).toBeEnabled()

  await presentButton.click()

  // While present_deck is still in flight: disabled + relabeled, the same
  // click-to-completion pattern WelcomeScreen's isBusy/"Opening…" uses.
  await expect(page.getByRole('button', { name: 'Presenting…', exact: true })).toBeDisabled()

  return presentButton
}

test('Given an open deck, when Present is clicked and the launch is slow, then the button shows a busy state until it succeeds', async ({ page }) => {
  const presentButton = await openDeckAndTriggerPresent(page, { source: '# Slide One\n', presentDeckDelayMs: 300 })

  // Once it resolves: reverts to the normal, clickable label.
  await expect(presentButton).toBeEnabled({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: 'Presenting…' })).toHaveCount(0)
})

test('Given an open deck, when Present is clicked and the launch fails, then the busy state clears and the error shows', async ({ page }) => {
  const presentButton = await openDeckAndTriggerPresent(page, {
    source: '# Slide One\n',
    presentDeckDelayMs: 300,
    commandError: cmd => (cmd === 'present_deck' ? 'simulated present_deck failure' : null),
  })

  // A failed launch clears the busy state exactly like a successful one —
  // it's independent of the separate success/failure result display.
  await expect(presentButton).toBeEnabled({ timeout: 5_000 })
  const errorBanner = page.locator('.bg-destructive\\/10')
  await expect(errorBanner).toBeVisible()
  await expect(errorBanner).toContainText('simulated present_deck failure')
})

// Note: whether mashing the button can ever actually open a second present
// window is explicitly left to real-device verification in
// todo/action-click-feedback.md (queued there under "human judgment
// required") rather than tested here — a synthetic double-click through
// Playwright/CDP races the page's own JS event loop in ways a real
// hardware double-click (bounded by human reaction time, well after the
// synchronous click handler already ran) cannot, so it can't reliably
// stand in for that check.
