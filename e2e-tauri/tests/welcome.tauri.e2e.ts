import { test, expect } from '../fixtures'

test('shows the welcome screen with Open Deck / New Deck actions, in the real WKWebView window', async ({ tauriPage }) => {
  await expect(tauriPage.getByRole('heading', { name: 'Peitho Studio' })).toBeVisible()
  await expect(tauriPage.getByRole('button', { name: 'Open Deck…' })).toBeVisible()
  await expect(tauriPage.getByRole('button', { name: 'New Deck…' })).toBeVisible()
})
