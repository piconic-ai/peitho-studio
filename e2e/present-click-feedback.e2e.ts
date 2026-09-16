// Functional requirement (todo/action-click-feedback.md): the Present
// button gives visible feedback the instant it's clicked, for as long as
// the launch is actually in flight — whether it ends in success or
// failure — instead of looking like a dead click while a slow
// present-window launch is still starting up.
//
// "In flight" means until the `present-ready` event fires (or, on
// failure, until `present_deck` itself rejects) — not until `present_deck`
// resolves. That invoke only confirms the OS accepted spawning the
// `peitho present` subprocess, which is near-instant regardless of deck
// size; the actual render/serve step a heavy deck is slow at happens after
// that, inside the subprocess, and only `present-ready` (see
// `watch_present_readiness` in peitho.rs) tracks it. Each test below is
// one Given-When-Then example.
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

test('Given an open deck, when Present is clicked and the subprocess is slow to become ready, then the button stays busy until present-ready fires', async ({ page }) => {
  // presentDeckDelayMs left at its default (0) deliberately — the invoke
  // itself resolves immediately, same as production; presentReadyDelayMs
  // is what stands in for the actually-slow part.
  const presentButton = await openDeckAndTriggerPresent(page, { source: '# Slide One\n', presentReadyDelayMs: 300 })

  // Still busy well before the 300ms readiness delay elapses — proves the
  // busy state isn't just clearing as soon as `present_deck` resolves.
  await expect(page.getByRole('button', { name: 'Presenting…', exact: true })).toBeDisabled()

  // Once `present-ready` fires: reverts to the normal, clickable label.
  await expect(presentButton).toBeEnabled({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: 'Presenting…' })).toHaveCount(0)
})

test('Given an open deck, when Present is clicked and the spawn itself fails, then the busy state clears and the error shows', async ({ page }) => {
  const presentButton = await openDeckAndTriggerPresent(page, {
    source: '# Slide One\n',
    presentDeckDelayMs: 300,
    commandError: cmd => (cmd === 'present_deck' ? 'simulated present_deck failure' : null),
  })

  // A failed spawn clears the busy state exactly like a successful launch
  // does — it's independent of the separate success/failure result
  // display, and never waits on `present-ready` (nothing was spawned to
  // ever become ready).
  await expect(presentButton).toBeEnabled({ timeout: 5_000 })
  const errorBanner = page.locator('.bg-destructive\\/10')
  await expect(errorBanner).toBeVisible()
  await expect(errorBanner).toContainText('simulated present_deck failure')
})

test('Given an open deck, when Present is clicked and the subprocess exits without ever becoming ready, then the busy state clears and the error shows', async ({ page }) => {
  // Simulates `peitho present --rehearsal` on a deck with no agenda
  // sections: the subprocess rejects immediately and stderr (captured by
  // `watch_present_failure` in peitho.rs) becomes the `present-failed`
  // payload — a case `commandError` (a failed `present_deck` invoke
  // itself) can't represent, since here the spawn succeeds and only the
  // subprocess it started fails.
  const presentButton = await openDeckAndTriggerPresent(page, {
    source: '# Slide One\n',
    presentReadyDelayMs: 300,
    presentFailedMessage: '--rehearsal requires agenda sections',
  })

  await expect(presentButton).toBeEnabled({ timeout: 5_000 })
  const errorBanner = page.locator('.bg-destructive\\/10')
  await expect(errorBanner).toBeVisible()
  await expect(errorBanner).toContainText('--rehearsal requires agenda sections')
})

// Note: whether mashing the button can ever actually open a second present
// window is explicitly left to real-device verification in
// todo/action-click-feedback.md (queued there under "human judgment
// required") rather than tested here — a synthetic double-click through
// Playwright/CDP races the page's own JS event loop in ways a real
// hardware double-click (bounded by human reaction time, well after the
// synchronous click handler already ran) cannot, so it can't reliably
// stand in for that check.
