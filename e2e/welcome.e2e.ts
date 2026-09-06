// Smoke-level only: this runs the BarefootJS frontend in a plain browser,
// with no Tauri IPC bridge behind it — `invoke()` calls made on mount
// (`take_pending_deck`, `dev_default_deck`) simply reject, so `deckPath()`
// stays null and the app renders its welcome screen, same as a real launch
// with no deck open yet. That's the ceiling for what this suite can cover:
// anything past the welcome screen (opening a deck, editing, presenting)
// needs the actual Tauri window and IPC layer, which means driving the
// compiled app through `tauri-driver` — a real but separate piece of
// infrastructure, tracked in tmp/todo.md rather than built here.
import { test, expect } from '@playwright/test'

test('shows the welcome screen with Open Deck / New Deck actions', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Peitho Studio' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Deck…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Deck…' })).toBeVisible()
})
