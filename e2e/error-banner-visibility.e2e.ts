// Regression test for a real bug: StatusBar's error banner used the
// `{errorMessage ? <div/> : null}` conditional-mount pattern, whose later
// branch (only reachable once `errorMessage` transitions from `null` to a
// string well after mount) sometimes never rendered — the same BarefootJS
// ternary-mounting gap CLAUDE.md's Pitfalls section had marked "Unresolved
// — watch out" for. This made every commitChange failure (e.g. a real
// peitho-core "slide matches multiple layouts" build error hit via New
// Slide on a deck with more than one layout) invisible: errorMessage() was
// set correctly, but nothing ever painted, so the user just saw "nothing
// happens". Fixed by keeping the banner permanently mounted and toggling
// it with `hidden` instead (see StatusBar.tsx).
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

test('a render_draft failure actually paints the error banner', async ({ page }) => {
  const deck: MockDeck = {
    source: '# Slide One\n',
    renderDraftError: content => (content.includes('# New Slide') ? 'slide 2: simulated build error' : null),
  }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  const errorBanner = page.locator('.bg-destructive\\/10')
  await expect(errorBanner).toBeHidden()

  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByRole('button', { name: 'New Slide ⌘⏎' }).click()

  await expect(errorBanner).toBeVisible({ timeout: 5_000 })
  await expect(errorBanner).toContainText('simulated build error')
  // The failed render never reached applyRenderPayload/saveDeckSource.
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
})
