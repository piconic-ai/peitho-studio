// A failed render must show its error even when the banner starts absent.
// Keep this check when changing StatusBar's conditional rendering.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

test('a render_draft failure actually paints the error banner', async ({ page }) => {
  const deck: MockDeck = {
    source: '# Slide One\n',
    commandError: (cmd, args) =>
      cmd === 'render_draft' && (args.content as string).includes('# New Slide') ? 'slide 2: simulated build error' : null,
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
