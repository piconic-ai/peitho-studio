// The About window's page (`pages/about.html`, `AboutScreen.tsx`). The
// native menu item and the window itself (`src-tauri/src/about.rs`) are
// covered only by on-device verification; these tests load the page the
// window opens and answer its commands with the mock.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const SHA = '5995c42a1b2c3d4e5f60718293a4b5c6d7e8f901'

async function openAbout(page: Page, deck: Partial<MockDeck> = {}): Promise<{ invokes: { cmd: string; args: Record<string, unknown> }[] }> {
  const invokes: { cmd: string; args: Record<string, unknown> }[] = []
  await mockTauri(page, { source: '', onInvoke: (cmd, args) => { invokes.push({ cmd, args }) }, ...deck })
  await page.goto('/about.html')
  return { invokes }
}

function row(page: Page, name: string) {
  return page.locator(`[data-about="${name}"]`)
}

function linksOpened(invokes: { cmd: string; args: Record<string, unknown> }[]): unknown[] {
  return invokes.filter(i => i.cmd === 'open_about_link').map(i => i.args.link)
}

test.describe('functional', () => {
  test('Given a CI build, when the About window opens, then it shows the icon, name, description, version, build, short commit, copyright and license', async ({ page }) => {
    await openAbout(page, {
      aboutInfo: { name: 'Peitho Studio', version: '0.1.0', build: '42', commit: SHA, copyright: 'Copyright (c) 2026 kfly8' },
    })

    await expect(page.locator('img[src="/static/app-icon.svg"]')).toBeVisible()
    await expect(row(page, 'name')).toHaveText('Peitho Studio')
    await expect(page.getByText('Write slides with Peitho. Plain Markdown and HTML, so AI can help you.')).toBeVisible()
    await expect(row(page, 'version')).toHaveText('0.1.0')
    await expect(row(page, 'build')).toHaveText('42')
    await expect(row(page, 'commit')).toHaveText('5995c42')
    await expect(row(page, 'commit')).toBeVisible()
    await expect(row(page, 'copyright')).toHaveText('Copyright (c) 2026 kfly8')
    await expect(page.getByRole('button', { name: 'Website' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'GitHub' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'License' })).toBeVisible()
  })

  test('Given the About window, when each link is clicked, then Rust is asked to open that link by name, never by URL', async ({ page }) => {
    const { invokes } = await openAbout(page)
    await expect(row(page, 'commit')).toHaveText('5995c42')

    await page.getByRole('button', { name: 'Website' }).click()
    await page.getByRole('button', { name: 'GitHub' }).click()
    await page.getByRole('button', { name: 'License' }).click()
    await row(page, 'commit').click()

    await expect.poll(() => linksOpened(invokes)).toEqual(['website', 'github', 'license', 'commit'])
  })

  test('Given a local build with no commit, when the About window opens, then the Commit row is hidden and the build reads dev', async ({ page }) => {
    await openAbout(page, { aboutInfo: { name: 'Peitho Studio', version: '0.1.0', build: 'dev', commit: '', copyright: 'Copyright (c) 2026 kfly8' } })

    await expect(row(page, 'build')).toHaveText('dev')
    await expect(row(page, 'commit')).toBeHidden()
    await expect(page.getByText('Commit', { exact: true })).toBeHidden()
  })

  test('Given Japanese is the chosen UI language, when the About window opens, then its words are in Japanese', async ({ page }) => {
    await openAbout(page, { settings: { uiLanguage: 'ja' } })

    await expect(page.getByText('Peithoでスライドを書く。素のMarkdownとHTMLなので、AIに手伝ってもらえます。')).toBeVisible()
    await expect(page.getByText('バージョン')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Webサイト' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ライセンス' })).toBeVisible()
  })

  test('Given the About window is open, when another window changes the UI language, then the About window follows', async ({ page }) => {
    await openAbout(page)
    await expect(page.getByRole('button', { name: 'Website' })).toBeVisible()

    await page.evaluate(() => {
      (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown) => void })
        .__mockEmitTauriEvent('settings:changed', { uiLanguage: 'ja' })
    })

    await expect(page.getByRole('button', { name: 'Webサイト' })).toBeVisible()
  })
})

test.describe('non-functional', () => {
  test('Given get_about_info answers malformed fields, when the About window opens, then it still renders with those rows blank', async ({ page }) => {
    await openAbout(page, { aboutInfo: { name: 7, version: '0.1.0', build: null, commit: { sha: SHA }, copyright: [] } })

    await expect(row(page, 'name')).toHaveText('Peitho Studio')
    await expect(row(page, 'version')).toHaveText('0.1.0')
    await expect(row(page, 'build')).toHaveText('')
    await expect(row(page, 'commit')).toBeHidden()
  })

  test('Given get_about_info fails, when the About window opens, then its links still work', async ({ page }) => {
    const { invokes } = await openAbout(page, { commandError: cmd => cmd === 'get_about_info' ? 'boom' : null })

    await expect(row(page, 'name')).toHaveText('Peitho Studio')
    await page.getByRole('button', { name: 'GitHub' }).click()
    await expect.poll(() => linksOpened(invokes)).toEqual(['github'])
  })
})
