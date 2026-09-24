// The app menu's "Settings…" (Cmd+,) opens the in-app settings panel in the
// window it was sent to (see `settings.rs` and `SettingsPanel.tsx`). These
// tests send the `menu:settings` event the Rust side emits to the focused
// window; the native menu item and its Cmd+, accelerator are covered only
// by on-device verification.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const TWO_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
}

/** Sends an event the way the Rust side does: `emit_to` one window, or a
 * broadcast `emit` when `toWindow` is omitted. */
async function emit(page: Page, event: string, payload: unknown, toWindow?: string): Promise<void> {
  await page.evaluate(({ event, payload, toWindow }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, payload, toWindow)
  }, { event, payload, toWindow })
}

async function chooseSettingsMenu(page: Page, toWindow = 'main'): Promise<void> {
  await emit(page, 'menu:settings', null, toWindow)
}

function settingsPanel(page: Page) {
  return page.getByRole('dialog', { name: 'Settings' })
}

test.describe('functional', () => {
  test('Given an open deck, when Settings… is chosen from the app menu, then the settings panel opens, and its close button closes it', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })
    await expect(settingsPanel(page)).toBeHidden()

    await chooseSettingsMenu(page)
    await expect(settingsPanel(page)).toBeVisible()
    await expect(settingsPanel(page).getByText('There are no settings to change yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Close settings' }).click()
    await expect(settingsPanel(page)).toBeHidden()
  })

  test('Given the settings panel is open, when Escape is pressed, then it closes', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })
    await chooseSettingsMenu(page)
    await expect(settingsPanel(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(settingsPanel(page)).toBeHidden()
  })

  test('Given the settings panel is open, when the dimmed area around it is clicked, then it closes', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })
    await chooseSettingsMenu(page)
    await expect(settingsPanel(page)).toBeVisible()

    await page.mouse.click(5, 5)
    await expect(settingsPanel(page)).toBeHidden()
  })

  test('Given the welcome screen with no deck open, when Settings… is chosen, then the settings panel opens there too', async ({ page }) => {
    await mockTauri(page, { source: TWO_SLIDES, devDefaultDeck: null })
    await page.goto('/')
    await expect(page.getByText('Peitho Studio', { exact: true })).toBeVisible({ timeout: 10_000 })

    await chooseSettingsMenu(page)
    await expect(settingsPanel(page)).toBeVisible()
  })

  test('Given two windows, when Settings… is sent to the other one, then this window\'s panel stays closed', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })

    await chooseSettingsMenu(page, 'deck-2')
    // Give a wrongly delivered event time to land before checking.
    await page.waitForTimeout(200)
    await expect(settingsPanel(page)).toBeHidden()
  })

  test('Given a window starting up, when it loads, then it reads the saved settings once', async ({ page }) => {
    const invokedCommands: string[] = []
    await openDeck(page, { source: TWO_SLIDES, invokedCommands })
    expect(invokedCommands.filter(cmd => cmd === 'get_settings')).toHaveLength(1)
  })
})

test.describe('robustness', () => {
  test('Given the settings panel is open, when Delete or an arrow key is pressed, then the slides behind it are left alone', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await page.locator('[data-slide-row="0"]').click()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await chooseSettingsMenu(page)
    await expect(settingsPanel(page)).toBeVisible()

    await page.keyboard.press('Delete')
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(200)

    await expect(page.locator('[data-slide-row]')).toHaveCount(2)
    expect(deck.source).toBe(TWO_SLIDES)
    await expect(settingsPanel(page)).toBeVisible()
  })

  test('Given the settings panel is open, when Edit > Undo arrives, then no slide operation is undone behind it', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    await page.getByText('Delete', { exact: true }).click()
    await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 5_000 })
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

    await chooseSettingsMenu(page)
    await emit(page, 'menu:undo', null, 'main')
    await page.waitForTimeout(200)

    await expect(page.locator('[data-slide-row]')).toHaveCount(1)
  })

  test('Given a malformed saved-settings answer, when the window starts, then the deck opens normally with no error shown', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES, settings: 'not a settings object' })
    await expect(page.locator('.bg-destructive\\/10')).toBeHidden()
  })

  test('Given reading the saved settings fails, when the window starts, then the deck still opens and Settings… still works', async ({ page }) => {
    await openDeck(page, {
      source: TWO_SLIDES,
      commandError: cmd => (cmd === 'get_settings' ? 'simulated get_settings failure' : null),
    })
    await chooseSettingsMenu(page)
    await expect(settingsPanel(page)).toBeVisible()
  })

  test('Given a settings change broadcast from another window, when heard while the panel is open, then the panel stays open with no error', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })
    await chooseSettingsMenu(page)

    await emit(page, 'settings:changed', { unknownSetting: true })
    await emit(page, 'settings:changed', null)

    await expect(settingsPanel(page)).toBeVisible()
    await expect(page.locator('.bg-destructive\\/10')).toBeHidden()
  })
})
