// A section header's name/time editor gets focus when it opens, and closes,
// saving what was typed, when the user presses anywhere outside it. Two
// causes kept it open: the name input's focusing `ref` never ran on opening
// (so nothing ever blurred), and the slide list's rows and the column
// dividers `preventDefault()` their `mousedown` for the hand-rolled drags,
// which also keeps the browser from moving focus. Driven through the real
// frontend against the mocked IPC bridge.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

function twoSectionDeck(): MockDeck {
  return {
    source: [
      '---',
      'time: 2m',
      '---',
      '<!-- {"section":"Intro","time":"1m"} -->',
      '# Intro',
      '',
      '---',
      '',
      '<!-- {"section":"Body","time":"1m"} -->',
      '# Body',
      '',
    ].join('\n'),
  }
}

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
}

function row(page: Page, index: number) {
  return page.locator(`[data-slide-row="${String(index)}"]`)
}

async function renameIntroWithoutCommitting(page: Page): Promise<void> {
  await row(page, 0).getByLabel('Edit section name and time').click()
  await row(page, 0).getByLabel('Section name', { exact: true }).fill('Opening')
}

test('Given the Intro header being edited, when another slide\'s thumbnail is clicked, then the editor closes and the new name is saved', async ({ page }) => {
  const deck = twoSectionDeck()
  await openDeck(page, deck)
  await renameIntroWithoutCommitting(page)

  await row(page, 1).locator('button[title]').click()

  await expect(row(page, 0).getByLabel('Section name', { exact: true })).toHaveCount(0)
  await expect(row(page, 0).getByLabel('Edit section name and time')).toHaveText('Opening1m')
  await expect.poll(() => deck.source).toContain('"section":"Opening"')
})

test('Given the Intro header being edited, when its own slide\'s thumbnail is clicked, then the editor closes too', async ({ page }) => {
  await openDeck(page, twoSectionDeck())
  await renameIntroWithoutCommitting(page)

  await row(page, 0).locator('button[title]').click()

  await expect(row(page, 0).getByLabel('Section name', { exact: true })).toHaveCount(0)
})

test('Given the Intro header being edited, when the preview pane is clicked, then the editor closes', async ({ page }) => {
  await openDeck(page, twoSectionDeck())
  await renameIntroWithoutCommitting(page)

  await page.mouse.click(page.viewportSize()!.width - 40, page.viewportSize()!.height / 2)

  await expect(row(page, 0).getByLabel('Section name', { exact: true })).toHaveCount(0)
})

test('Given the Intro header being edited, when its seconds spinner is clicked, then the editor stays open', async ({ page }) => {
  await openDeck(page, twoSectionDeck())
  await renameIntroWithoutCommitting(page)

  await row(page, 0).getByLabel('Section seconds').click()

  await expect(row(page, 0).getByLabel('Section name', { exact: true })).toHaveValue('Opening')
  await expect(row(page, 0).getByLabel('Section seconds')).toBeFocused()
})

test('Given the Intro header being edited, when a column divider is pressed, then the editor closes', async ({ page }) => {
  await openDeck(page, twoSectionDeck())
  await renameIntroWithoutCommitting(page)

  await page.locator('.cursor-col-resize').first().click()

  await expect(row(page, 0).getByLabel('Section name', { exact: true })).toHaveCount(0)
})

test('Given the Intro header being edited, when the Markdown editor is clicked, then the editor closes and the new name is saved', async ({ page }) => {
  const deck = twoSectionDeck()
  await openDeck(page, deck)
  await renameIntroWithoutCommitting(page)

  await page.locator('textarea').first().click()

  await expect(row(page, 0).getByLabel('Section name', { exact: true })).toHaveCount(0)
  await expect.poll(() => deck.source).toContain('"section":"Opening"')
})

test('Given the Intro header just opened for editing, then its name field has focus', async ({ page }) => {
  await openDeck(page, twoSectionDeck())

  await row(page, 0).getByLabel('Edit section name and time').click()

  await expect(row(page, 0).getByLabel('Section name', { exact: true })).toBeFocused()
})

test('Given the Intro header just opened, with nothing typed, when the Markdown editor is clicked, then the editor closes', async ({ page }) => {
  await openDeck(page, twoSectionDeck())
  await row(page, 0).getByLabel('Edit section name and time').click()

  await page.locator('textarea').first().click()

  await expect(row(page, 0).getByLabel('Section name', { exact: true })).toHaveCount(0)
})
