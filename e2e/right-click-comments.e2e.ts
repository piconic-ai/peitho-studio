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

const SLIDE_MENU = '[data-slide-menu]'

/** The slide menu's buttons, in order (the layout picker's entries aside). */
const slideMenuButtons = (page: Page) => page.locator(`${SLIDE_MENU} > button`)

test.describe('the slide preview', () => {
  test('Given a heading in the preview, when it is right-clicked and Comment… is chosen, then the box opens on that heading as a left-click would, pin and all', async ({ page }) => {
    await openDeck(page)
    await rightClick(page.locator(`${PREVIEW} h1`))
    await expect(page.locator(SLIDE_MENU)).toBeVisible()
    await expect(page.locator(BOX)).toBeHidden()

    await page.locator('[data-slide-menu-item="comment"]').click()

    await expect(page.locator(SLIDE_MENU)).toBeHidden()
    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › heading "Hello"')
    await expect(page.locator(`${BOX} textarea`)).toBeFocused()
    await expect(page.locator('[data-comment-pin]')).toHaveCount(1)
  })

  test('Given the slide shown, when the preview is right-clicked, then the menu is the slide list\'s for that slide: the same items, enabled the same', async ({ page }) => {
    await openDeck(page)
    await page.locator('[data-slide-row="1"]').click()
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Second')
    const shape = () => slideMenuButtons(page).evaluateAll(buttons => buttons.map(button => `${button.textContent?.trim() ?? ''}|${String((button as HTMLButtonElement).disabled)}`))

    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    const fromList = await shape()
    await page.keyboard.press('Escape')
    await rightClick(page.locator(`${PREVIEW} h1`))
    const fromPreview = await shape()

    expect(fromPreview).toEqual(fromList)
    expect(fromPreview.map(entry => entry.split('|')[0])).toEqual(expect.arrayContaining(['Cut⌘X', 'Copy⌘C', 'Paste⌘V', 'Delete⌦', 'Change Layout▸', 'Skip in Present']))
  })

  test('Given the preview\'s menu, when Skip in Present is chosen, then the slide shown is the one marked', async ({ page }) => {
    const deck = await openDeck(page)
    await rightClick(page.locator(`${PREVIEW} h1`))
    await page.locator(SLIDE_MENU).getByRole('button', { name: 'Skip in Present' }).click()
    await expect.poll(() => deck.source).toContain('<!-- {"key":"hello","skip":true} -->')
    expect(deck.source).toContain('---\n\n# Second')
  })

  test('Given the preview right-clicked low on the window, when Change Layout is expanded and a layout chosen, then the menu stays inside the window and the slide shown takes the layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const deck = await openDeck(page, { layouts: ['cover', 'statement', 'quote', 'title-body'] })
    // As low on the slide as it goes: the menu, its picker open, can't fit below.
    const slide = (await page.locator(`${PREVIEW} p >> nth=1`).boundingBox())!
    expect(slide.y).toBeGreaterThan(300)
    await page.mouse.click(slide.x + 4, slide.y + slide.height / 2, { button: 'right' })
    await page.locator(SLIDE_MENU).getByRole('button', { name: /^Change Layout/ }).click()
    const statement = page.locator('button[data-key="statement"]')
    await expect(statement).toBeVisible()
    await expect.poll(async () => { const box = (await page.locator(SLIDE_MENU).boundingBox())!; return box.y + box.height }).toBeLessThanOrEqual(800)

    await statement.click()
    await expect.poll(() => deck.source).toContain('"layout":"statement"')
    expect(deck.source.indexOf('"layout":"statement"')).toBeLessThan(deck.source.indexOf('# Second'))
  })

  test('Given the preview, when it is left-clicked, then the box still opens at once, no menu', async ({ page }) => {
    await openDeck(page)
    await page.locator(`${PREVIEW} p >> nth=0`).click()
    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › paragraph "Some text"')
    await expect(page.locator(SLIDE_MENU)).toBeHidden()
  })

  test('Given the menu open, when Escape is pressed or anywhere else is clicked, then it closes with nothing opened', async ({ page }) => {
    await openDeck(page)
    await rightClick(page.locator(`${PREVIEW} h1`))
    await expect(page.locator(SLIDE_MENU)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator(SLIDE_MENU)).toBeHidden()

    await rightClick(page.locator(`${PREVIEW} h1`))
    await page.mouse.click(5, 300)
    await expect(page.locator(SLIDE_MENU)).toBeHidden()
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

    await expect(menuItems(page)).toHaveText(['Comment…', 'Cut', 'Copy', 'Paste'])
    await expect(menuItem(page, 'cut')).toBeDisabled()
    await expect(menuItem(page, 'copy')).toBeDisabled()
    await expect(menuItem(page, 'paste')).toBeEnabled()
    await menuItem(page, 'comment').click()

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

    await expect(menuItem(page, 'comment')).toHaveText('Comment…')
    await expect(menuItem(page, 'copy')).toBeEnabled()
    await menuItem(page, 'comment').click()

    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › lines L8-L10 "Some text more text"')
    expect((await sendAndRead(page, deck, 'Merge'))[0]).toMatchObject({ startLine: 8, endLine: 10, quote: 'Some text\n\nmore text' })
  })

  test('Given a notes line right-clicked, then the comment is on that line of the notes in deck.md', async ({ page }) => {
    const deck = await openDeck(page, { crit: createFakeCritIpc() })
    await rightClick(line(page, 'then go', 'note'), { x: 4, y: 4 })
    await menuItem(page, 'comment').click()
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

  test('Given a Cut still writing the clipboard, when another slide is opened meanwhile, then neither slide loses text', async ({ page }) => {
    const deck = await openDeck(page, { clipboardDelayMs: 800 })
    await line(page, 'Some text').click({ position: { x: 1, y: 4 } })
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await rightClick(line(page, 'Some text'), { x: 20, y: 4 })
    await menuItem(page, 'cut').click()
    await page.locator('[data-slide-row="1"]').click()
    await expect.poll(() => editorText(page)).toBe('# Second\n\nAnother paragraph')

    await expect.poll(() => deck.clipboardText, { timeout: 3000 }).toBe('Some text')
    await page.waitForTimeout(500)
    expect(await editorText(page)).toBe('# Second\n\nAnother paragraph')
    expect(deck.source).toBe(SOURCE)
    await page.locator('[data-slide-row="0"]').click()
    await expect.poll(() => editorText(page)).toBe('# Hello\n\nSome text\n\nmore text')
  })

  test('Given a Paste still reading the clipboard, when another slide is opened meanwhile, then nothing is pasted into either', async ({ page }) => {
    const deck = await openDeck(page, { clipboardText: 'PASTED', clipboardDelayMs: 800 })
    await rightClick(line(page, 'Some text'), { x: 4, y: 4 })
    await menuItem(page, 'paste').click()
    await page.locator('[data-slide-row="1"]').click()
    await expect.poll(() => editorText(page)).toBe('# Second\n\nAnother paragraph')

    await page.waitForTimeout(1500)
    expect(await editorText(page)).toBe('# Second\n\nAnother paragraph')
    expect(deck.source).toBe(SOURCE)
  })

  test('Given a Paste still reading the clipboard and nothing else happening, then it is pasted where the right-click put the caret', async ({ page }) => {
    await openDeck(page, { clipboardText: 'PASTED', clipboardDelayMs: 500 })
    const last = (await line(page, 'more text').boundingBox())!
    await page.mouse.click(last.x + last.width - 2, last.y + last.height / 2, { button: 'right' })
    await menuItem(page, 'paste').click()
    await expect.poll(() => editorText(page)).toBe('# Hello\n\nSome text\n\nmore textPASTED')
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
    await expect(menuItem(page, 'comment')).toHaveText('Comment…')
    await expect(vimStatus(page)).toContainText('VISUAL LINE')
    await menuItem(page, 'comment').click()
    await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › lines L8-L10 "Some text more text"')
  })
})

test.describe('the slide list\'s row menu', () => {
  test('Given a slide row right-clicked, When Comment… is chosen, Then the box opens on that slide as a whole, and the agent gets it on its lines', async ({ page }) => {
    const deck = await openDeck(page, { crit: createFakeCritIpc() })
    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    const item = page.locator('[data-slide-menu-item="comment"]')
    await expect(item).toHaveText('Comment…')
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
    await expect(page.locator('[data-slide-menu-item="comment"]')).toBeDisabled()
  })
})

test.describe('the comment item, the same in every right-click menu', () => {
  /** The menu's first item is the comment: `Comment…` (or its Japanese),
   * the speech bubble at its left, and set apart from the next item, whose
   * label lines up with its own. */
  async function expectCommentFirst(menu: Locator, label = 'Comment…'): Promise<void> {
    await expect(menu).toBeVisible()
    const items = menu.locator(':scope > button')
    const first = items.first()
    await expect(first).toHaveText(label)
    await expect(first.locator('svg[data-menu-icon="comment"]')).toBeVisible()
    const labelX = async (item: Locator) => (await item.locator('span').first().boundingBox())!.x
    expect(Math.abs(await labelX(first) - await labelX(items.nth(1)))).toBeLessThan(1.5)
    // Nothing else in the menu has the bubble.
    await expect(menu.locator('svg[data-menu-icon="comment"]')).toHaveCount(1)
  }

  test('Given the slides screen, then the slide list row, the slide preview and both editors open their menu with it', async ({ page }) => {
    await openDeck(page)
    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    await expectCommentFirst(page.locator(SLIDE_MENU))
    await page.keyboard.press('Escape')

    await rightClick(page.locator(`${PREVIEW} h1`))
    await expectCommentFirst(page.locator(SLIDE_MENU))
    await page.keyboard.press('Escape')

    for (const which of ['body', 'note'] as const) {
      await rightClick(editorContent(page, which).locator('.cm-line').first(), { x: 4, y: 4 })
      await expectCommentFirst(page.locator(MENU))
      await page.keyboard.press('Escape')
    }
  })

  test('Given the layout screen, then the file editor, the large preview, a layout row and the list\'s empty space open their menu with it; the empty space\'s comment is on every layout', async ({ page }) => {
    await openDeck(page, { layouts: ['cover', 'statement'] })
    await page.locator('[data-studio-mode-option="layouts"]').click()
    await expect(page.locator('[data-layout-row="cover"]')).toBeVisible()
    const layoutMenu = page.locator('[data-menu="layout"]')

    await expect.poll(() => editorText(page, 'layout-html')).toContain('<section')
    await rightClick(editorContent(page, 'layout-html').locator('.cm-line').first(), { x: 4, y: 4 })
    await expectCommentFirst(page.locator(MENU))
    await page.keyboard.press('Escape')

    const large = (await page.locator('[data-layout-selected-preview] [data-layout-thumbnail]').boundingBox())!
    await page.mouse.click(large.x + 10, large.y + 10, { button: 'right' })
    await expectCommentFirst(layoutMenu)
    await page.keyboard.press('Escape')

    await page.locator('[data-layout-row="statement"]').click({ button: 'right' })
    await expectCommentFirst(layoutMenu)
    await page.keyboard.press('Escape')

    const rows = (await page.locator('[data-layout-rows]').boundingBox())!
    await page.mouse.click(rows.x + 10, rows.y + rows.height - 10, { button: 'right' })
    await expectCommentFirst(layoutMenu)
    await layoutMenu.locator('[data-menu-item="comment"]').click()
    await expect(page.locator('[data-comment-target]')).toHaveText('All layouts')
  })

  test('Given Japanese, then the comment item reads コメント… in every kind of menu', async ({ page }) => {
    await openDeck(page, { settings: { uiLanguage: 'ja' }, layouts: ['cover', 'statement'] })
    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    await expectCommentFirst(page.locator(SLIDE_MENU), 'コメント…')
    await page.keyboard.press('Escape')
    await rightClick(editorContent(page).locator('.cm-line').first(), { x: 4, y: 4 })
    await expectCommentFirst(page.locator(MENU), 'コメント…')
    await page.keyboard.press('Escape')
    await page.locator('[data-studio-mode-option="layouts"]').click()
    await page.locator('[data-layout-row="statement"]').click({ button: 'right' })
    await expectCommentFirst(page.locator('[data-menu="layout"]'), 'コメント…')
  })
})

test.describe('the layout file editor\'s Cut and Paste across tabs', () => {
  const HTML = '<section class="peitho-slide layout-cover"><h1>cover</h1></section>'
  const CSS = '.layout-cover { color: red; }'

  async function openLayouts(page: Page, overrides: Partial<MockDeck>): Promise<MockDeck> {
    const deck = await openDeck(page, {
      layouts: ['cover', 'statement'],
      layoutFiles: { cover: { html: HTML, css: CSS }, statement: { html: '<section class="peitho-slide layout-statement"></section>', css: '' } },
      ...overrides,
    })
    await page.locator('[data-studio-mode-option="layouts"]').click()
    await expect.poll(() => editorText(page, 'layout-html')).toBe(HTML)
    return deck
  }

  test('Given a Cut still writing the clipboard, when another tab is shown meanwhile, then neither file loses text', async ({ page }) => {
    const deck = await openLayouts(page, { clipboardDelayMs: 800 })
    await editorContent(page, 'layout-html').click()
    await page.keyboard.press('ControlOrMeta+a')
    await rightClick(editorContent(page, 'layout-html').locator('.cm-line').first(), { x: 20, y: 4 })
    await menuItem(page, 'cut').click()
    await page.locator('[data-layout-tab="css/cover.css"] [data-layout-tab-show]').click()
    await expect.poll(() => editorText(page, 'layout-css')).toBe(CSS)

    await expect.poll(() => deck.clipboardText, { timeout: 3000 }).toBe(HTML)
    await page.waitForTimeout(1500)
    expect(await editorText(page, 'layout-css')).toBe(CSS)
    expect(deck.layoutFiles!.cover).toEqual({ html: HTML, css: CSS })
    await page.locator('[data-layout-tab="layouts/cover.html"] [data-layout-tab-show]').click()
    await expect.poll(() => editorText(page, 'layout-html')).toBe(HTML)
  })

  test('Given a Paste still reading the clipboard, when another tab is shown meanwhile, then nothing is pasted into either file', async ({ page }) => {
    const deck = await openLayouts(page, { clipboardText: 'PASTED', clipboardDelayMs: 800 })
    await rightClick(editorContent(page, 'layout-html').locator('.cm-line').first(), { x: 4, y: 4 })
    await menuItem(page, 'paste').click()
    await page.locator('[data-layout-tab="css/cover.css"] [data-layout-tab-show]').click()
    await expect.poll(() => editorText(page, 'layout-css')).toBe(CSS)

    await page.waitForTimeout(2000)
    expect(await editorText(page, 'layout-css')).toBe(CSS)
    expect(deck.layoutFiles!.cover).toEqual({ html: HTML, css: CSS })
  })
})
