// A skipped slide's thumbnail stays visible with a SKIP badge laid over it,
// instead of the old separate "skip" text label under the thumbnail (see
// `SlideList.tsx` and `domain/slideStatus.ts`). A draft slide is covered
// too: peitho-core drops it before the manifest is built (the mock's
// `buildManifest` mirrors that), so `domain/slideList.ts`'s `buildSlideList`
// is what puts it back as a placeholder row, badged DRAFT, instead of
// leaving it invisible — and, since a draft slide shifts every later
// slide's position in the manifest but not in the deck's own source, this
// is also where a slide *after* one used to get the wrong click/skip/badge
// applied to it (see todo/slide-status-badges.md).
import { test, expect, type Locator, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const DECK_WITH_SKIPPED_SLIDE = '# Opening\n\n---\n\n<!-- {"skip":true} -->\n# Backup Slide\n'
const DECK_WITH_DRAFT_THEN_SKIPPED = '# Opening\n\n---\n\n<!-- {"draft":true} -->\n# Hidden\n\n---\n\n<!-- {"skip":true} -->\n# Backup Slide\n'

async function openDeck(page: Page, deck: MockDeck, rowCount = 2): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(rowCount, { timeout: 10_000 })
}

/** Whether the thumbnail canvas in `row` has actually mounted rendered
 * slide content (not just an empty host element). */
async function hasRenderedCanvas(row: Locator): Promise<boolean> {
  return row.locator('[data-slide-canvas-key]').evaluate(el => el.shadowRoot?.querySelector('.peitho-slide') != null)
}

test('Given a deck whose second slide is marked skip, when the deck opens, then that thumbnail stays rendered with a SKIP badge over it and no separate "skip" label', async ({ page }) => {
  await openDeck(page, { source: DECK_WITH_SKIPPED_SLIDE })
  const plainRow = page.locator('[data-slide-row="0"]')
  const skippedRow = page.locator('[data-slide-row="1"]')

  const badge = skippedRow.locator('[data-slide-status="skip"]')
  await expect(badge).toBeVisible()
  // `innerText`, not `toHaveText` (textContent): the DOM text is the raw
  // status and CSS `uppercase` is what the user actually reads.
  expect(await badge.evaluate(el => (el as HTMLElement).innerText)).toBe('SKIP')
  expect(await hasRenderedCanvas(skippedRow)).toBe(true)
  // The badge is the only "skip" text left in the row — the old label
  // under the thumbnail is gone.
  await expect(skippedRow.getByText(/^skip$/i)).toHaveCount(1)

  await expect(plainRow.locator('[data-slide-status]')).toHaveCount(0)
  expect(await hasRenderedCanvas(plainRow)).toBe(true)
})

test('Given an open deck, when "Skip in Present" is turned on and then off from a thumbnail\'s context menu, then its SKIP badge appears and then disappears', async ({ page }) => {
  const deck: MockDeck = { source: '# Opening\n\n---\n\n# Backup Slide\n' }
  await openDeck(page, deck)
  const row = page.locator('[data-slide-row="1"]')
  await expect(row.locator('[data-slide-status]')).toHaveCount(0)

  const skipToggle = page.getByRole('button', { name: /^Skip in Present/ })

  await row.click({ button: 'right' })
  await skipToggle.click()
  await expect(row.locator('[data-slide-status="skip"]')).toBeVisible({ timeout: 5_000 })
  // `commitChange` paints the new render *before* it saves and refreshes
  // `slideRanges`, so wait for both instead of racing them: the save for
  // the file, and the menu's checkmark (read from `slideRanges`) before
  // toggling again — otherwise the second click could re-apply skip.
  await expect.poll(() => deck.source).toContain('"skip":true')

  await row.click({ button: 'right' })
  await expect(skipToggle).toContainText('✓')
  await skipToggle.click()
  await expect(row.locator('[data-slide-status]')).toHaveCount(0, { timeout: 5_000 })
  await expect.poll(() => deck.source).not.toContain('"skip":true')
})

test('Given a deck whose middle slide is marked draft, when the deck opens, then that thumbnail shows a DRAFT badge and its title instead of a rendered canvas, and its neighbors are unaffected', async ({ page }) => {
  await openDeck(page, { source: DECK_WITH_DRAFT_THEN_SKIPPED }, 3)
  const openingRow = page.locator('[data-slide-row="0"]')
  const draftRow = page.locator('[data-slide-row="1"]')
  const backupRow = page.locator('[data-slide-row="2"]')

  const badge = draftRow.locator('[data-slide-status="draft"]')
  await expect(badge).toBeVisible()
  expect(await badge.evaluate(el => (el as HTMLElement).innerText)).toBe('DRAFT')
  // No fragment was ever rendered for a draft slide (peitho-core excludes
  // it from the build), so there's no canvas host to mount at all — the
  // placeholder shows the slide's own title as plain text instead.
  await expect(draftRow.locator('[data-slide-canvas-key]')).toHaveCount(0)
  await expect(draftRow.getByText('Hidden')).toBeVisible()

  expect(await hasRenderedCanvas(openingRow)).toBe(true)
  expect(await hasRenderedCanvas(backupRow)).toBe(true)
  await expect(backupRow.locator('[data-slide-status="skip"]')).toBeVisible()
})

test('Given a draft slide, when its thumbnail placeholder is clicked, then its own raw text opens in the editor', async ({ page }) => {
  await openDeck(page, { source: DECK_WITH_DRAFT_THEN_SKIPPED }, 3)

  await page.locator('[data-slide-row="1"]').click()

  await expect(page.locator('textarea').first()).toHaveValue(/# Hidden/, { timeout: 5_000 })
})

test('Given a slide right after a draft slide, when "Skip in Present" is toggled from its context menu, then the draft slide is left alone and only the later slide is skipped', async ({ page }) => {
  const deck: MockDeck = { source: DECK_WITH_DRAFT_THEN_SKIPPED.replace('"skip":true', '') }
  await openDeck(page, deck, 3)
  const draftRow = page.locator('[data-slide-row="1"]')
  const laterRow = page.locator('[data-slide-row="2"]')
  await expect(laterRow.locator('[data-slide-status]')).toHaveCount(0)

  await laterRow.click({ button: 'right' })
  const skipToggle = page.getByRole('button', { name: /^Skip in Present/ })
  await skipToggle.click()

  await expect(laterRow.locator('[data-slide-status="skip"]')).toBeVisible({ timeout: 5_000 })
  // The row this landed on is what actually matters — but confirm the
  // *content* too: the draft slide still wears only its own DRAFT badge
  // (which peitho-core would refuse to build alongside "skip":true on the
  // same slide, so it must never have picked up SKIP too), and the saved
  // source only marks the real "Backup Slide" as skipped.
  await expect(draftRow.locator('[data-slide-status="draft"]')).toBeVisible()
  await expect(draftRow.locator('[data-slide-status="skip"]')).toHaveCount(0)
  await expect.poll(() => deck.source).toContain('"skip":true')
  expect(deck.source).not.toMatch(/"draft":true,"skip":true|"skip":true,"draft":true/)
})

test('Given a draft slide, when "Mark as Draft" is unchecked from its context menu, then it becomes a rendered thumbnail and the DRAFT badge disappears', async ({ page }) => {
  const deck: MockDeck = { source: DECK_WITH_DRAFT_THEN_SKIPPED }
  await openDeck(page, deck, 3)
  const draftRow = page.locator('[data-slide-row="1"]')

  await draftRow.click({ button: 'right' })
  const draftToggle = page.getByRole('button', { name: /^Mark as Draft/ })
  await expect(draftToggle).toContainText('✓')
  await draftToggle.click()

  await expect(draftRow.locator('[data-slide-status="draft"]')).toHaveCount(0, { timeout: 5_000 })
  expect(await hasRenderedCanvas(draftRow)).toBe(true)
  await expect.poll(() => deck.source).not.toContain('"draft":true')
})

test.describe('non-functional: the badge overlay never gets in the way of interacting with the thumbnail', () => {
  // `page.mouse` rather than `locator.click()`: the overlay is
  // `pointer-events: none` by design, which Playwright's actionability
  // check would itself report as "another element intercepts pointer
  // events" — a real click at the badge's own position is exactly what's
  // under test here.
  async function badgeCenter(row: Locator): Promise<{ x: number; y: number }> {
    const box = await row.locator('[data-slide-status] > span').boundingBox()
    if (!box) throw new Error('badge has no bounding box')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  test('Given a thumbnail wearing a SKIP badge, when the badge itself is clicked, then that slide opens in the editor', async ({ page }) => {
    await openDeck(page, { source: DECK_WITH_SKIPPED_SLIDE })
    const { x, y } = await badgeCenter(page.locator('[data-slide-row="1"]'))

    await page.mouse.click(x, y)

    await expect(page.locator('textarea').first()).toHaveValue(/# Backup Slide/, { timeout: 5_000 })
  })

  test('Given a thumbnail wearing a SKIP badge, when the badge itself is right-clicked, then the context menu targets that slide', async ({ page }) => {
    await openDeck(page, { source: DECK_WITH_SKIPPED_SLIDE })
    const { x, y } = await badgeCenter(page.locator('[data-slide-row="1"]'))

    await page.mouse.click(x, y, { button: 'right' })

    // Only the skipped slide's own config has "skip" checked, so the
    // checkmark proves the menu opened for row 1, not empty space (where
    // the toggle is disabled) or row 0.
    const skipToggle = page.getByRole('button', { name: /^Skip in Present/ })
    await expect(skipToggle).toBeEnabled()
    await expect(skipToggle).toContainText('✓')
  })
})
