// No Tauri IPC bridge here — `invoke()` calls made on mount
// (`take_pending_deck`, `dev_default_deck`) simply reject, so `deckPath()`
// stays null and the app renders its welcome screen, same as a real launch
// with no deck open yet. Tests that need to get past this screen stub the
// bridge instead — see `helpers/mockTauri.ts` and `new-slide.e2e.ts`. A
// real Tauri window driven through `tauri-driver` (peitho-core's actual
// rendering, actual WKWebView quirks) is still a separate, not-yet-built
// piece of infrastructure, tracked in tmp/todo.md.
import { test, expect } from '@playwright/test'

test('shows the welcome screen with Open Deck / New Deck actions', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Peitho Studio' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Deck…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Deck…' })).toBeVisible()
})
