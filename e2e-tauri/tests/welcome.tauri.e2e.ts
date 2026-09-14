import { test, expect } from '../fixtures'

// `getByText`/`getByRole` + `expect(...).toBeVisible()` don't work against a
// real Tauri window in this version of tauri-plugin-playwright (0.4.1) —
// confirmed by hand: the same text is provably on the page and visible
// (`document.body.innerText`, `tauriPage.isVisible('h1')` with a plain CSS
// selector both agree), but `getByText(...).isVisible()` alone returns
// `false`. `tauriPage.locator(cssSelector)` (plain `document.querySelectorAll`
// under the hood — no `getByText`/`getByRole` involved) works correctly, so
// that's what every real-window test here uses instead. See
// docs/tauri-playwright-spike.md.
test('shows the welcome screen with Open Deck / New Deck actions, in the real WKWebView window', async ({ tauriPage }) => {
  await expect(tauriPage.locator('h1')).toBeVisible()
  await expect(tauriPage.locator('h1')).toHaveText('Peitho Studio')
  // Document order: WelcomeScreen renders "Open Deck…" then "New Deck…"
  // before any Recent entries — see WelcomeScreen.tsx.
  await expect(tauriPage.locator('button').nth(0)).toHaveText('Open Deck…')
  await expect(tauriPage.locator('button').nth(1)).toHaveText(/New Deck…/)
})
