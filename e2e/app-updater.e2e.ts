import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { initialUpdateStatus } from '../domain/updates'
import { editorContent, moveToEditorEnd } from './helpers/codeEditor'
const SOURCE = '<!-- {"key":"one"} -->\n# Slide One\n'
async function emit(page: Page, event: string, payload: unknown) {
  await page.evaluate(({ event, payload }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown) => void }).__mockEmitTauriEvent(event, payload)
  }, { event, payload })
}
async function setup(page: Page, deck: MockDeck) {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
}
test('manual checks show current and failure; update settings remain coherent', async ({ page }) => {
  const deck: MockDeck = { source: SOURCE }
  await setup(page, deck)
  await emit(page, 'menu:check-updates', null)
  await expect(page.locator('[data-update-status]')).toContainText('up to date')
  const panel = page.getByRole('dialog', { name: 'Settings' })
  await panel.locator('[data-setting=auto-check-updates]').uncheck()
  await panel.locator('[data-setting=auto-update]').check()
  await expect(panel.locator('[data-setting=auto-check-updates]')).toBeChecked()
  await panel.locator('[data-setting=auto-check-updates]').uncheck()
  await expect(panel.locator('[data-setting=auto-update]')).not.toBeChecked()
  deck.commandError = cmd => cmd === 'check_for_updates' ? 'Offline' : null
  await panel.getByRole('button', { name: 'Check for updates' }).click()
  await expect(panel.getByRole('alert')).toContainText('Offline')
  await expect(panel.locator('[data-update-status]')).not.toContainText('up to date')
})
test('normal updates can be dismissed, while security updates keep their notice and allow editing', async ({ page }) => {
  const deck: MockDeck = { source: SOURCE, updateStatus: { ...initialUpdateStatus(), phase: 'available', version: '1.1.0' } }
  await setup(page, deck)
  const notice = page.locator('[data-update-notice]')
  await expect(notice).toBeVisible()
  await notice.getByRole('button', { name: 'Later' }).click()
  await expect(notice).toBeHidden()
  deck.updateStatus = { ...deck.updateStatus!, dismissed: false, security: 'Unsafe previews' }
  await emit(page, 'updates:changed', deck.updateStatus)
  await expect(notice).toContainText('Unsafe previews')
  await expect(notice.getByRole('button', { name: 'Later' })).toBeHidden()
  await editorContent(page).click()
  await moveToEditorEnd(page)
  await page.keyboard.type(' Still editing')
  await expect(editorContent(page)).toContainText('Still editing')
  await notice.getByRole('button', { name: 'View update' }).click()
  await page.getByRole('button', { name: 'Update when I quit', exact: true }).click()
  await expect(page.locator('[data-update-status]')).toContainText('Quit Peitho Studio')
})
for (const fails of [false, true]) {
  test(`quit-for-update ${fails ? 'refuses a failed save' : 'flushes unsaved edits'} before acknowledging`, async ({ page }) => {
    const deck: MockDeck = { source: SOURCE, updateSaveAcks: [] }
    await setup(page, deck)
    await editorContent(page).click()
    await moveToEditorEnd(page)
    await page.keyboard.type(' Pending edit')
    if (fails) deck.commandError = cmd => cmd === 'save_deck_source' ? 'Disk full' : null
    await emit(page, 'updates:changed', { ...initialUpdateStatus(), phase: 'saving' })
    await emit(page, 'updates:before-exit', 7)
    await expect.poll(() => deck.updateSaveAcks).toEqual([{ token: 7, saved: !fails }])
    if (!fails) expect(deck.source).toContain('Pending edit')
    await emit(page, 'updates:changed', { ...initialUpdateStatus(), phase: 'ready', error: fails ? 'Save failed' : null })
    await expect(page.getByRole('alert').filter({ hasText: 'Saving all open decks' })).toBeHidden()
    await editorContent(page).click()
    await page.keyboard.type(' Continue')
    await expect(editorContent(page)).toContainText('Continue')
  })
}
