// The "Check for Updates…" window's page (`pages/update.html`,
// `UpdateScreen.tsx`). The native menu item and the window itself
// (`src-tauri/src/update_window.rs`) are covered only by on-device
// verification; these tests load the page the window opens and answer its
// commands with the mock.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { initialUpdateStatus, type UpdateStatus } from '../domain/updates'

type Invoke = { cmd: string; args: Record<string, unknown> }

const NEW_VERSION: UpdateStatus = { ...initialUpdateStatus(), phase: 'available', version: '1.1.0', notes: '- Faster previews\n- Fewer crashes' }

async function openUpdateWindow(page: Page, deck: Partial<MockDeck> = {}): Promise<{ invokes: Invoke[]; deck: MockDeck }> {
  const invokes: Invoke[] = []
  const full: MockDeck = { source: '', onInvoke: (cmd, args) => { invokes.push({ cmd, args }) }, ...deck }
  await mockTauri(page, full)
  await page.goto('/update.html')
  return { invokes, deck: full }
}

async function emit(page: Page, event: string, payload: unknown, toWindow?: string): Promise<void> {
  await page.evaluate(({ event, payload, toWindow }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, payload, toWindow)
  }, { event, payload, toWindow })
}

function checks(invokes: Invoke[]): number {
  return invokes.filter(i => i.cmd === 'check_for_updates').length
}

const statusLine = (page: Page) => page.locator('[data-update-status]')
const action = (page: Page, name: 'releases' | 'retry' | 'prepare') => page.locator(`[data-update-action="${name}"]`)

test.describe('functional', () => {
  test('Given the app is up to date, when the window opens, then it checks once by itself and says so, with nothing to act on', async ({ page }) => {
    const { invokes } = await openUpdateWindow(page)

    await expect(statusLine(page)).toHaveText('You are up to date.')
    expect(checks(invokes)).toBe(1)
    await expect(action(page, 'prepare')).toBeHidden()
    await expect(action(page, 'retry')).toBeHidden()
    await expect(action(page, 'releases')).toBeHidden()
  })

  test('Given a check still running, when the window shows it, then it says it is checking', async ({ page }) => {
    await openUpdateWindow(page, { checkUpdateResult: { ...initialUpdateStatus(), phase: 'checking' } })

    await expect(statusLine(page)).toHaveText('Checking for updates…')
    await expect(action(page, 'prepare')).toBeHidden()
  })

  test('Given a new version, when the window opens, then it shows the version, its notes, Update and Release notes', async ({ page }) => {
    await openUpdateWindow(page, { checkUpdateResult: NEW_VERSION })

    await expect(statusLine(page)).toHaveText('A new version is available (1.1.0)')
    await expect(page.locator('[data-update-notes]')).toHaveText('- Faster previews\n- Fewer crashes')
    await expect(page.getByText('What’s new')).toBeVisible()
    await expect(action(page, 'prepare')).toHaveText('Update')
    await expect(action(page, 'releases')).toHaveText('Release notes')
  })

  test('Given a new version, when Update and Release notes are clicked, then the update is prepared for quit and the release page is asked for', async ({ page }) => {
    const { invokes } = await openUpdateWindow(page, { checkUpdateResult: NEW_VERSION, updateStatus: NEW_VERSION })
    await expect(action(page, 'prepare')).toBeVisible()

    await action(page, 'prepare').click()
    await expect(statusLine(page)).toHaveText('Updates when you quit the app. (1.1.0)')
    await expect(action(page, 'prepare')).toBeHidden()

    await action(page, 'releases').click()
    await expect.poll(() => invokes.filter(i => i.cmd === 'open_update_releases').length).toBe(1)
  })

  test('Given the check fails, when the window opens, then it shows the error and Retry, and Retry checks again', async ({ page }) => {
    const { invokes, deck } = await openUpdateWindow(page, { commandError: cmd => cmd === 'check_for_updates' ? 'Offline' : null })

    await expect(page.getByRole('alert')).toContainText('Offline')
    await expect(statusLine(page)).toHaveText('Could not complete the update. Please retry.')
    await expect(action(page, 'retry')).toBeVisible()

    deck.commandError = undefined
    await action(page, 'retry').click()
    await expect(statusLine(page)).toHaveText('You are up to date.')
    await expect(page.getByRole('alert')).toBeHidden()
    await expect(action(page, 'retry')).toBeHidden()
    expect(checks(invokes)).toBe(2)
  })

  test('Given a build without in-app updates, when the window opens, then it says so and links to Releases', async ({ page }) => {
    const { invokes } = await openUpdateWindow(page, { checkUpdateResult: { ...initialUpdateStatus(), phase: 'unconfigured' } })

    await expect(statusLine(page)).toContainText('In-app updates are not configured for this build.')
    await expect(action(page, 'releases')).toHaveText('Open Releases')
    await expect(action(page, 'prepare')).toBeHidden()

    await action(page, 'releases').click()
    await expect.poll(() => invokes.filter(i => i.cmd === 'open_update_releases').length).toBe(1)
  })

  test('Given an update being prepared, when progress and readiness are broadcast, then the window follows them', async ({ page }) => {
    await openUpdateWindow(page, { checkUpdateResult: NEW_VERSION })
    await expect(action(page, 'prepare')).toBeVisible()

    await emit(page, 'updates:changed', { ...NEW_VERSION, phase: 'downloading', downloaded: 50, total: 100 })
    await expect(statusLine(page)).toHaveText('Downloading update… (1.1.0) 50%')
    await expect(action(page, 'prepare')).toBeHidden()

    await emit(page, 'updates:changed', { ...NEW_VERSION, phase: 'ready', installOnExit: true })
    await expect(statusLine(page)).toHaveText('Updates when you quit the app. (1.1.0)')
  })

  test('Given the window is already open, when the menu item is chosen again, then it checks again', async ({ page }) => {
    const { invokes } = await openUpdateWindow(page)
    await expect(statusLine(page)).toHaveText('You are up to date.')

    await emit(page, 'update-window:check', null, 'main')

    await expect.poll(() => checks(invokes)).toBe(2)
  })

  test('Given Japanese is the chosen UI language, when the window opens, then its words are in Japanese', async ({ page }) => {
    await openUpdateWindow(page, { settings: { uiLanguage: 'ja' }, checkUpdateResult: NEW_VERSION })

    await expect(page.getByRole('heading', { name: 'アップデート' })).toBeVisible()
    await expect(statusLine(page)).toHaveText('新しいバージョンがあります (1.1.0)')
    await expect(page.getByText('変更点')).toBeVisible()
    await expect(action(page, 'prepare')).toHaveText('更新する')
    await expect(action(page, 'releases')).toHaveText('リリースノート')
  })

  test('Given a failed check in Japanese, when the window shows it, then Retry reads in Japanese', async ({ page }) => {
    await openUpdateWindow(page, { settings: { uiLanguage: 'ja' }, commandError: cmd => cmd === 'check_for_updates' ? 'Offline' : null })

    await expect(action(page, 'retry')).toHaveText('再試行')
  })
})

test.describe('non-functional', () => {
  test('Given check_for_updates answers garbage, when the window opens, then it still renders without offering anything', async ({ page }) => {
    await openUpdateWindow(page, { checkUpdateResult: { phase: 'bogus', version: 7 } as unknown as UpdateStatus })

    await expect(statusLine(page)).toHaveText('Check for a newer version of Peitho Studio.')
    await expect(action(page, 'prepare')).toBeHidden()
    await expect(action(page, 'releases')).toBeHidden()
  })

  test('Given the settings cannot be read, when the window opens, then it still checks and shows the result in English', async ({ page }) => {
    await openUpdateWindow(page, { commandError: cmd => cmd === 'get_settings' || cmd === 'get_system_locales' ? 'boom' : null })

    await expect(statusLine(page)).toHaveText('You are up to date.')
  })

  test('Given a check-again event meant for another window, when it arrives, then this window does not check again', async ({ page }) => {
    const { invokes } = await openUpdateWindow(page)
    await expect(statusLine(page)).toHaveText('You are up to date.')

    await emit(page, 'update-window:check', null, 'deck-2')
    // A real check-again afterwards proves the event plumbing had settled.
    await emit(page, 'update-window:check', null, 'main')

    await expect.poll(() => checks(invokes)).toBe(2)
  })
})
