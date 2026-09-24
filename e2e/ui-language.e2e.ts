// Switching the UI language (Japanese / English) from the settings panel
// (see `domain/messages.ts`, `state/settingsStore.ts` and
// `SettingsPanel.tsx`). The mock stands in for `settings.rs`: it answers
// `get_system_locales` with the OS languages a test gives it, keeps what
// `update_settings` saves in `deck.settings`, and broadcasts it as
// `settings:changed`. The native menu bar's labels are Rust-side
// (`src-tauri/src/i18n.rs`) and covered by `cargo test` plus on-device
// verification only.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const TWO_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'

async function openWelcome(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, { devDefaultDeck: null, ...deck })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Peitho Studio' })).toBeVisible({ timeout: 10_000 })
}

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
}

async function emit(page: Page, event: string, payload: unknown, toWindow?: string): Promise<void> {
  await page.evaluate(({ event, payload, toWindow }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, payload, toWindow)
  }, { event, payload, toWindow })
}

/** Opens Settings… and picks `name` ("日本語" / "English"). */
async function chooseLanguage(page: Page, name: string): Promise<void> {
  await emit(page, 'menu:settings', null, 'main')
  await page.getByRole('radio', { name }).click()
}

test.describe('functional', () => {
  test('Given an English OS and nothing chosen yet, when the app starts, then the UI is in English', async ({ page }) => {
    await openWelcome(page, { source: TWO_SLIDES, systemLocales: ['en-US', 'ja-JP'] })
    await expect(page.getByRole('button', { name: 'Open Deck…' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Deck…' })).toBeVisible()
  })

  test('Given a Japanese OS and nothing chosen yet, when the app starts, then the UI is in Japanese', async ({ page }) => {
    await openWelcome(page, { source: TWO_SLIDES, systemLocales: ['ja-JP', 'en-US'] })
    await expect(page.getByRole('button', { name: 'デッキを開く…' })).toBeVisible()
    await expect(page.getByRole('button', { name: '新規デッキ…' })).toBeVisible()
  })

  test('Given the welcome screen in English, when 日本語 is chosen in Settings, then the screen switches to Japanese without a reload and the choice is saved', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    const updates: unknown[] = []
    deck.onInvoke = (cmd, args) => { if (cmd === 'update_settings') updates.push(args.patch) }
    await openWelcome(page, deck)

    await chooseLanguage(page, '日本語')

    await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '日本語' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'デッキを開く…' })).toBeVisible()
    expect(updates).toEqual([{ uiLanguage: 'ja' }])
  })

  test('Given an open deck switched to Japanese, when a thumbnail is right-clicked, then the context menu is in Japanese', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })
    await chooseLanguage(page, '日本語')
    await page.keyboard.press('Escape')

    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    await expect(page.getByRole('button', { name: /^カット/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /^コピー/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /^削除/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /^レイアウトを変更/ })).toBeVisible()
  })

  test('Given an open deck in English, when Japanese is chosen, then the editor pane, the status bar and the notes placeholder switch too', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })
    await expect(page.locator('footer')).toHaveText(/^Opened /)
    await expect(page.locator('[data-editor="note"] .cm-placeholder')).toHaveText('Notes for the presenter — not shown to the audience.')

    await chooseLanguage(page, '日本語')
    await page.keyboard.press('Escape')

    await expect(page.getByText('スピーカーノート', { exact: true })).toBeVisible()
    await expect(page.locator('[data-editor="note"] .cm-placeholder')).toHaveText('発表者用のメモ — 聴衆には表示されません。')
    await expect(page.locator('footer')).toHaveText(/を開きました$/)
  })

  test('Given Japanese was chosen, when the app starts again, then it is still in Japanese', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, devDefaultDeck: null }
    await openWelcome(page, deck)
    await chooseLanguage(page, '日本語')
    await expect(page.getByRole('button', { name: 'デッキを開く…' })).toBeAttached()

    // A restart reads back what `update_settings` saved.
    await page.reload()
    await expect(page.getByRole('button', { name: 'デッキを開く…' })).toBeVisible({ timeout: 10_000 })
  })

  test('Given a Japanese OS, when English is chosen, then the UI switches to English', async ({ page }) => {
    await openWelcome(page, { source: TWO_SLIDES, systemLocales: ['ja-JP'] })
    await chooseLanguage(page, 'English')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Open Deck…' })).toBeVisible()
  })

  test('Given another window saves a language change, when this window hears it, then this window switches too', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })

    await emit(page, 'settings:changed', { uiLanguage: 'ja' })

    await expect(page.getByText('スピーカーノート', { exact: true })).toBeVisible()
    await emit(page, 'settings:changed', { uiLanguage: 'en' })
    await expect(page.getByText('Speaker Notes', { exact: true })).toBeVisible()
  })
})

test.describe('robustness', () => {
  test('Given the OS languages can\'t be read, when the app starts, then it falls back to English with no error shown', async ({ page }) => {
    await openWelcome(page, {
      source: TWO_SLIDES,
      commandError: cmd => (cmd === 'get_system_locales' ? 'simulated failure' : null),
    })
    await expect(page.getByRole('button', { name: 'Open Deck…' })).toBeVisible()
    await expect(page.getByText('simulated failure')).toBeHidden()
  })

  test('Given a malformed OS-language answer, when the app starts, then the UI is in English', async ({ page }) => {
    await openWelcome(page, { source: TWO_SLIDES, systemLocales: 'ja-JP' })
    await expect(page.getByRole('button', { name: 'Open Deck…' })).toBeVisible()
  })

  test('Given an unsupported saved language, when the app starts on a Japanese OS, then it follows the OS', async ({ page }) => {
    await openWelcome(page, { source: TWO_SLIDES, systemLocales: ['ja'], settings: { uiLanguage: 'fr' } })
    await expect(page.getByRole('button', { name: 'デッキを開く…' })).toBeVisible()
  })

  test('Given saving the language fails, when 日本語 is chosen, then the UI stays in English and the error is shown', async ({ page }) => {
    await openWelcome(page, {
      source: TWO_SLIDES,
      commandError: cmd => (cmd === 'update_settings' ? 'simulated save failure' : null),
    })
    await chooseLanguage(page, '日本語')

    await expect(page.getByText('simulated save failure')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Open Deck…' })).toBeVisible()
  })

  test('Given the language already shown, when it is chosen again, then nothing is saved', async ({ page }) => {
    const invokedCommands: string[] = []
    await openWelcome(page, { source: TWO_SLIDES, invokedCommands, settings: { uiLanguage: 'en' } })
    await chooseLanguage(page, 'English')
    await page.waitForTimeout(200)
    expect(invokedCommands).not.toContain('update_settings')
  })
})
