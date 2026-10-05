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
