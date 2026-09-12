// Regression tests for the same "invisible error" bug fixed in StatusBar
// (see error-banner-visibility.e2e.ts and CLAUDE.md's BarefootJS
// pitfalls), found by Pullfrog's review of that fix in two other
// components sharing the same `errorMessage` signal: WelcomeScreen (a
// failed `open_deck`, e.g. a stale Recent entry) and NewDeckModal (a
// failed `create_deck`) both stay mounted across their own failure
// window, so both hit the identical `{errorMessage ? <div/> : null}`
// gap.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

test('a failed open_deck (e.g. a stale Recent entry) paints an error on the welcome screen', async ({ page }) => {
  const deck: MockDeck = {
    source: '# Slide One\n',
    devDefaultDeck: null,
    recentDecks: ['/fake/gone/deck.md'],
    commandError: cmd => (cmd === 'open_deck' ? 'no such file or directory' : null),
  }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.getByText('Peitho Studio', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByText('/fake/gone/deck.md', { exact: true }).click()

  await expect(page.getByText('no such file or directory')).toBeVisible({ timeout: 5_000 })
})

test('a failed create_deck paints an error inside the New Deck modal', async ({ page }) => {
  const deck: MockDeck = {
    source: '# Slide One\n',
    devDefaultDeck: null,
    dialogPath: '/fake/parent',
    commandError: cmd => (cmd === 'create_deck' ? 'a directory with that name already exists' : null),
  }
  await mockTauri(page, deck)

  await page.goto('/')
  await page.getByText('New Deck…', { exact: true }).click()
  await page.getByPlaceholder('Deck name').fill('my-talk')
  await page.getByText('Create', { exact: true }).click()

  // `errorMessage` is a single signal shared app-wide, so the same text
  // also appears on the (still-mounted, now-obscured) welcome screen
  // behind the modal — scope to the modal's own overlay to avoid an
  // ambiguous match.
  const modal = page.locator('.z-50')
  await expect(modal.getByText('a directory with that name already exists')).toBeVisible({ timeout: 5_000 })
})
