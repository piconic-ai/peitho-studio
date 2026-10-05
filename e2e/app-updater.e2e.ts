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
test('the settings panel holds only the update settings, which stay coherent; checking lives in its own window', async ({ page }) => {
  const deck: MockDeck = { source: SOURCE, updateStatus: { ...initialUpdateStatus(), phase: 'available', version: '1.1.0' } }
  await setup(page, deck)
  await emit(page, 'menu:settings', null)
  const panel = page.getByRole('dialog', { name: 'Settings' })
  await expect(panel.locator('[data-setting=auto-check-updates]')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Check for updates' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Release notes' })).toHaveCount(0)
  await expect(panel.locator('[data-update-status]')).toHaveCount(0)
  await panel.locator('[data-setting=auto-check-updates]').uncheck()
  await expect(panel.getByText('Security update notifications are also off.')).toBeVisible()
  await panel.locator('[data-setting=auto-update]').check()
  await expect(panel.locator('[data-setting=auto-check-updates]')).toBeChecked()
  await panel.locator('[data-setting=auto-check-updates]').uncheck()
  await expect(panel.locator('[data-setting=auto-update]')).not.toBeChecked()
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
  await notice.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(notice).toContainText('Updates when you quit the app.')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
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

test('a failed deck-setting save blocks update-exit even with a clean editor, and a successful retry clears it', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered = false
  const deck: MockDeck = {
    source: SOURCE, updateSaveAcks: [],
    beforeSave: async () => { entered = true; await gate; throw new Error('Disk full') },
  }
  await setup(page, deck)
  const pick = { key: 'aspect_ratio', choice: '4:3' }
  await emit(page, 'menu:deck-setting', pick)
  await expect.poll(() => entered).toBe(true)
  await emit(page, 'updates:changed', { ...initialUpdateStatus(), phase: 'saving' })
  await emit(page, 'updates:before-exit', 11)
  expect(deck.updateSaveAcks).toEqual([])
  release()
  await expect.poll(() => deck.updateSaveAcks).toEqual([{ token: 11, saved: false }])
  expect(deck.source).not.toContain('aspect_ratio: 4:3')
  await emit(page, 'updates:changed', { ...initialUpdateStatus(), phase: 'ready', error: 'Save failed' })
  deck.beforeSave = undefined
  await emit(page, 'menu:deck-setting', pick)
  await expect.poll(() => deck.source).toContain('aspect_ratio: 4:3')
  await emit(page, 'updates:changed', { ...initialUpdateStatus(), phase: 'saving' })
  await emit(page, 'updates:before-exit', 12)
  await expect.poll(() => deck.updateSaveAcks).toEqual([{ token: 11, saved: false }, { token: 12, saved: true }])
})

test('a completed overlapping body save cannot hide an in-flight structural save or its failure', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let structuralStarted = false
  const deck: MockDeck = {
    source: SOURCE + '\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n', updateSaveAcks: [],
    beforeSave: async source => {
      if (source.includes('aspect_ratio: 4:3')) { structuralStarted = true; await gate; throw new Error('Structural save failed') }
    },
  }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
  await editorContent(page).click()
  await moveToEditorEnd(page)
  await page.keyboard.type(' Pending body')
  await emit(page, 'menu:deck-setting', { key: 'aspect_ratio', choice: '4:3' })
  await expect.poll(() => structuralStarted).toBe(true)
  await page.locator('[data-slide-row]').nth(1).click()
  await expect.poll(() => deck.source).toContain('Pending body')
  expect(deck.source).not.toContain('aspect_ratio: 4:3')
  await emit(page, 'updates:changed', { ...initialUpdateStatus(), phase: 'saving' })
  await emit(page, 'updates:before-exit', 13)
  expect(deck.updateSaveAcks).toEqual([])
  release()
  await expect.poll(() => deck.updateSaveAcks).toEqual([{ token: 13, saved: false }])
})

test('a successful revised body save clears its older failed snapshot for update-exit', async ({ page }) => {
  let failures = 0
  const deck: MockDeck = { source: SOURCE, updateSaveAcks: [], commandError: cmd => {
    if (cmd !== 'save_deck_source') return null
    failures++
    return 'Disk full'
  } }
  await setup(page, deck)
  await editorContent(page).click()
  await moveToEditorEnd(page)
  await page.keyboard.type(' First unsaved draft')
  await expect.poll(() => failures).toBeGreaterThan(0)
  expect(deck.source).not.toContain('First unsaved draft')
  deck.commandError = undefined
  await page.keyboard.type(' Revised after recovery')
  await expect.poll(() => deck.source).toContain('Revised after recovery')
  await emit(page, 'updates:changed', { ...initialUpdateStatus(), phase: 'saving' })
  await emit(page, 'updates:before-exit', 14)
  await expect.poll(() => deck.updateSaveAcks).toEqual([{ token: 14, saved: true }])
})

test('failed draft remains on its slide until a successful save before navigation', async ({ page }) => {
  let failures = 0
  const deck: MockDeck = {
    source: SOURCE + '\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n', updateSaveAcks: [],
    commandError: cmd => {
      if (cmd !== 'save_deck_source') return null
      failures++
      return 'Disk full'
    },
  }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
  await editorContent(page).click()
  await moveToEditorEnd(page)
  await page.keyboard.type(' Retained failed draft')
  await expect.poll(() => failures).toBeGreaterThan(0)
  const beforeSwitch = failures
  await page.locator('[data-slide-row]').nth(1).click()
  await expect.poll(() => failures).toBeGreaterThan(beforeSwitch)
  await expect(editorContent(page)).toContainText('Retained failed draft')
  expect(deck.source).not.toContain('Retained failed draft')
  await emit(page, 'updates:changed', { ...initialUpdateStatus(), phase: 'saving' })
  await emit(page, 'updates:before-exit', 15)
  await expect.poll(() => deck.updateSaveAcks).toEqual([{ token: 15, saved: false }])
  await emit(page, 'updates:changed', initialUpdateStatus())
  deck.commandError = undefined
  await emit(page, 'menu:deck-setting', { key: 'aspect_ratio', choice: '4:3' })
  await expect.poll(() => deck.source).toContain('aspect_ratio: 4:3')
  expect(deck.source).toContain('Retained failed draft')
  await page.locator('[data-slide-row]').nth(1).click()
  await expect(editorContent(page)).toContainText('Slide Two')
  await emit(page, 'updates:changed', { ...initialUpdateStatus(), phase: 'saving' })
  await emit(page, 'updates:before-exit', 16)
  await expect.poll(() => deck.updateSaveAcks).toEqual([{ token: 15, saved: false }, { token: 16, saved: true }])
})
