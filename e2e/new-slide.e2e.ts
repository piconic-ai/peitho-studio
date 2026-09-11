// Regression test for a real bug: a brand-new `.map()` row's `ref` runs
// while the row is still part of a detached "template contents" document
// (not yet the real page document) — see dom/slideCanvas.ts's
// mountSlideCanvas doc comment. Adopting a CSSStyleSheet created against
// the real document into that row's shadow root threw
// `NotAllowedError: Sharing constructed stylesheets in multiple documents
// is not allowed`, silently aborting the whole "New Slide" commit before
// it reached saveDeckSource — the thumbnail list just never grew, with no
// visible error (StatusBar's own error-message slot has the same
// detached-row problem on its first conditional render, so the thrown
// error never painted either).
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

test('New Slide adds a thumbnail and persists the new slide text', async ({ page }) => {
  const deck: MockDeck = { source: '# Slide One\n' }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByText('New Slide', { exact: true }).click()

  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
  expect(deck.source).toContain('# New Slide')
})
