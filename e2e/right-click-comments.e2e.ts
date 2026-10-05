// Right-click to comment, everywhere a comment makes sense: the app's own
// menu (`domain/commentMenu.ts`, `components/ContextMenu.tsx`) in place of
// the webview's, on the slide preview, the slide body and notes editors,
// the layout screen's file editor and its large preview, and in the slide
// list's and layout list's row menus. Left-clicks keep what they did: on a
// preview it opens a comment, in an editor it edits.
//
// crit is `ipc/fakeCritIpc.ts`; the OS clipboard is the mock's stand-in
// (`plugin:clipboard-manager|*`). Not covered here: a real WKWebView's
// native menu staying away, and the real clipboard.
import { test, expect, type Locator, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, editorText } from './helpers/codeEditor'
import { createFakeCritIpc, type FakeCritIpc } from '../ipc/fakeCritIpc'
import type { NewReviewComment } from '../domain/critReview'

const SOURCE = '---\nlang: en\n---\n\n<!-- {"key":"hello"} -->\n# Hello\n\nSome text\n\nmore text\n\n<!--\nsay hi\nthen go\n-->\n\n---\n\n# Second\n\nAnother paragraph\n'

const PREVIEW = '[data-preview-host]'
const BOX = '[data-comment-box]'
const MENU = '[data-menu="comment"]'

async function openDeck(page: Page, overrides: Partial<MockDeck> = {}): Promise<MockDeck> {
  const deck: MockDeck = { source: SOURCE, deckPath: '/decks/talk/deck.md', editAnnotations: true, crit: createFakeCritIpc({ session: 'none' }), ...overrides }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Hello')
  return deck
}

const menuItems = (page: Page, menu = MENU) => page.locator(`${menu}:visible [data-menu-item]`)
const menuItem = (page: Page, action: string, menu = MENU) => page.locator(`${menu} [data-menu-item="${action}"]`)

function sentComments(crit: FakeCritIpc): NewReviewComment[] {
  return crit.calls.filter(call => call.method === 'addComments').flatMap(call => call.args[0] as NewReviewComment[])
}

async function rightClick(target: Locator, position?: { x: number; y: number }): Promise<void> {
  await target.click({ button: 'right', position })
}

test.describe('the slide preview', () => {
  test('Given a heading in the preview, when it is right-clicked and Comment… is chosen, then the box opens on that heading as a left-click would, pin and all', async ({ page }) => {
    await openDeck(page)
    await rightClick(page.locator(`${PREVIEW} h1`))
    await expect(menuItems(page)).toHaveText(['Comment…'])
    await expect(page.locator(BOX)).toBeHidden()

    await menuItem(page, 'comment').click()

    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › heading "Hello"')
    await expect(page.locator(`${BOX} textarea`)).toBeFocused()
    await expect(page.locator('[data-comment-pin]')).toHaveCount(1)
  })

  test('Given the preview, when it is left-clicked, then the box still opens at once, no menu', async ({ page }) => {
    await openDeck(page)
    await page.locator(`${PREVIEW} p >> nth=0`).click()
    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › paragraph "Some text"')
    await expect(page.locator(MENU)).toBeHidden()
  })

  test('Given the menu open, when Escape is pressed or anywhere else is clicked, then it closes with nothing opened', async ({ page }) => {
    await openDeck(page)
    await rightClick(page.locator(`${PREVIEW} h1`))
    await expect(page.locator(MENU)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator(MENU)).toBeHidden()

    await rightClick(page.locator(`${PREVIEW} h1`))
    await page.mouse.click(5, 300)
    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.locator(BOX)).toBeHidden()
  })
})

test.describe('the slide body and notes editors', () => {
  const line = (page: Page, text: string, which: 'body' | 'note' = 'body') => editorContent(page, which).locator('.cm-line', { hasText: text })

  async function sendAndRead(page: Page, deck: MockDeck, text: string): Promise<NewReviewComment[]> {
    await page.locator(`${BOX} textarea`).fill(text)
    await page.locator('[data-comment-add]').click()
    await page.locator('[data-review-send]').click()
    await expect.poll(() => sentComments(deck.crit!).length).toBe(1)
    return sentComments(deck.crit!)
  }

  test('Given a body line right-clicked with nothing selected, then the menu offers a comment on this line and Paste, Cut and Copy off; the comment goes on that line of deck.md', async ({ page }) => {
    const deck = await openDeck(page, { crit: createFakeCritIpc() })
    await rightClick(line(page, 'Some text'), { x: 4, y: 4 })

    await expect(menuItems(page)).toHaveText(['Comment on This Line…', 'Cut', 'Copy', 'Paste'])
    await expect(menuItem(page, 'cut')).toBeDisabled()
    await expect(menuItem(page, 'copy')).toBeDisabled()
    await expect(menuItem(page, 'paste')).toBeEnabled()
    await menuItem(page, 'comment-lines').click()

    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › lines L8 "Some text"')
    await expect(page.locator(`${BOX} textarea`)).toBeFocused()
    expect(await sendAndRead(page, deck, 'Shorter')).toEqual([{
      startLine: 8, endLine: 8, quote: 'Some text', author: 'Peitho Studio',
      body: '[Slide 1 (key: hello) › lines L8 "Some text"] Shorter',
    }])
  })

  test('Given body lines selected, when a right-click lands inside them, then the comment is on the selected lines', async ({ page }) => {
    const deck = await openDeck(page, { crit: createFakeCritIpc() })
    await line(page, 'Some text').click({ position: { x: 1, y: 4 } })
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+End')
    await rightClick(line(page, 'Some text'), { x: 20, y: 4 })

    await expect(menuItem(page, 'comment-lines')).toHaveText('Comment on Selected Lines…')
    await expect(menuItem(page, 'copy')).toBeEnabled()
    await menuItem(page, 'comment-lines').click()

    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › lines L8-L10 "Some text more text"')
    expect((await sendAndRead(page, deck, 'Merge'))[0]).toMatchObject({ startLine: 8, endLine: 10, quote: 'Some text\n\nmore text' })
  })

  test('Given a notes line right-clicked, then the comment is on that line of the notes in deck.md', async ({ page }) => {
    const deck = await openDeck(page, { crit: createFakeCritIpc() })
    await rightClick(line(page, 'then go', 'note'), { x: 4, y: 4 })
    await menuItem(page, 'comment-lines').click()
    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › lines L14 "then go"')
    expect((await sendAndRead(page, deck, 'Say more'))[0]).toMatchObject({ startLine: 14, endLine: 14, quote: 'then go' })
  })

  test('Given text selected in the body, then Copy puts it on the clipboard, Paste puts it where the right-click put the caret, and Cut takes it out', async ({ page }) => {
    const deck = await openDeck(page, { clipboardText: null })
    await line(page, 'Some text').click({ position: { x: 1, y: 4 } })
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await rightClick(line(page, 'Some text'), { x: 20, y: 4 })
    await menuItem(page, 'copy').click()
    await expect.poll(() => deck.clipboardText).toBe('Some text')

    // A right-click at the end of the last line puts the caret there.
    const last = (await line(page, 'more text').boundingBox())!
    await page.mouse.click(last.x + last.width - 2, last.y + last.height / 2, { button: 'right' })
    await expect(menuItem(page, 'copy')).toBeDisabled()
    await menuItem(page, 'paste').click()
    await expect.poll(() => editorText(page)).toBe('# Hello\n\nSome text\n\nmore textSome text')
    await expect(editorContent(page)).toBeFocused()

    await line(page, 'Some text').first().click({ position: { x: 1, y: 4 } })
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await rightClick(line(page, 'Some text').first(), { x: 20, y: 4 })
    await menuItem(page, 'cut').click()
    await expect.poll(() => editorText(page)).toBe('# Hello\n\n\n\nmore textSome text')
    expect(deck.clipboardText).toBe('Some text')
  })

  test('Given an empty clipboard, when Paste is chosen, then nothing changes', async ({ page }) => {
    await openDeck(page, { clipboardText: null })
    await rightClick(line(page, 'Some text'), { x: 4, y: 4 })
    await menuItem(page, 'paste').click()
    await expect(page.locator(MENU)).toBeHidden()
    expect(await editorText(page)).toBe('# Hello\n\nSome text\n\nmore text')
  })

  test('Given the body, when it is left-clicked, then it edits as before and no menu opens', async ({ page }) => {
    await openDeck(page)
    await line(page, 'more text').click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect.poll(() => editorText(page)).toBe('# Hello\n\nSome text\n\nmore text!')
    await expect(page.locator(MENU)).toBeHidden()
  })

  test('adversarial: Given a right-click near the bottom of the window, then the menu stays inside the window', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 600 })
    await openDeck(page)
    const editor = (await editorContent(page).boundingBox())!
    await page.mouse.click(editor.x + editor.width - 4, Math.min(editor.y + editor.height, 600) - 4, { button: 'right' })
    const menu = page.locator(MENU)
    await expect(menu).toBeVisible()
    await expect.poll(async () => { const box = (await menu.boundingBox())!; return box.y + box.height }).toBeLessThanOrEqual(600)
    const box = (await menu.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(1200)
  })
})

test.describe('vim mode', () => {
  const vimStatus = (page: Page) => page.locator('[data-editor="body"] .cm-vim-panel')

  test('Given insert mode, when the body is right-clicked and the menu is closed with Escape, then the editor is still in insert mode', async ({ page }) => {
    await openDeck(page, { settings: { vimMode: true } })
    await editorContent(page).click()
    await page.keyboard.type('i')
    await expect(vimStatus(page)).toContainText('--INSERT--')

    await rightClick(editorContent(page).locator('.cm-line', { hasText: 'Some text' }), { x: 4, y: 4 })
    await expect(page.locator(MENU)).toBeVisible()
    await page.keyboard.press('Escape')

    await expect(page.locator(MENU)).toBeHidden()
    await expect(vimStatus(page)).toContainText('--INSERT--')
  })

  test('Given lines picked in visual line mode, when they are right-clicked, then the comment is on them and visual mode is left as it was', async ({ page }) => {
    await openDeck(page, { settings: { vimMode: true } })
    await editorContent(page).click()
    await page.keyboard.type('gg2jVjj')
    await expect(vimStatus(page)).toContainText('VISUAL LINE')

    await rightClick(editorContent(page).locator('.cm-line', { hasText: 'Some text' }), { x: 4, y: 4 })
    await expect(menuItem(page, 'comment-lines')).toHaveText('Comment on Selected Lines…')
    await expect(vimStatus(page)).toContainText('VISUAL LINE')
    await menuItem(page, 'comment-lines').click()
    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › lines L8-L10 "Some text more text"')
  })
})

test.describe('the slide list\'s row menu', () => {
  test('Given a slide row right-clicked, When Comment on This Slide… is chosen, Then the box opens on that slide as a whole, and the agent gets it on its lines', async ({ page }) => {
    const deck = await openDeck(page, { crit: createFakeCritIpc() })
    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    const item = page.locator('[data-slide-menu-item="comment-slide"]')
    await expect(item).toHaveText('Comment on This Slide…')
    await item.click()

    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 2')
    await expect(page.locator(`${BOX} textarea`)).toBeFocused()
    await page.locator(`${BOX} textarea`).fill('Cut this one')
    await page.locator('[data-comment-add]').click()
    await page.locator('[data-review-send]').click()
    await expect.poll(() => sentComments(deck.crit!)).toEqual([{
      startLine: 19, endLine: 21, quote: '', author: 'Peitho Studio', body: '[Slide 2] Cut this one',
    }])
  })

  test('Given empty list space right-clicked, Then the comment on a slide is off', async ({ page }) => {
    await openDeck(page)
    const list = (await page.locator('[data-panel="slides"]').boundingBox())!
    await page.mouse.click(list.x + 40, list.y + list.height - 20, { button: 'right' })
    await expect(page.locator('[data-slide-menu-item="comment-slide"]')).toBeDisabled()
  })
})
