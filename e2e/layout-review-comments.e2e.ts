// Comments on layouts for the Coding Agent (todo/layout-review-comments.md):
// on the layout screen, right-click a layout (or the list's empty space),
// write a comment on that layout (or on every layout), send it to the agent
// waiting in crit, and see the layouts refreshed once the agent changed
// their files.
//
// crit is `ipc/fakeCritIpc.ts` answering the `crit_*` commands — the real
// round trip against the bundled crit (layout comments landing on their
// files, review-level comments, the agent joining with the same arguments)
// is `src-tauri/src/crit.rs`'s `round_trip` tests. Not covered here: a real
// agent editing real layout files, and a real WKWebView.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { FAKE_CRIT_PATH, createFakeCritIpc, type FakeCritIpc } from '../ipc/fakeCritIpc'
import type { NewLayoutComment } from '../domain/critReview'

const SOURCE = [
  '<!-- {"key":"cover","layout":"cover"} -->\n# Cover',
  '<!-- {"key":"intro","layout":"title-body"} -->\n# Intro\n\nText.',
].join('\n\n---\n\n') + '\n'

const BOX = '[data-comment-box]'
const SEND = '[data-review-send]'

async function openLayoutScreen(page: Page, crit: FakeCritIpc, overrides: Partial<MockDeck> = {}): Promise<MockDeck> {
  const deck: MockDeck = { source: SOURCE, deckPath: '/decks/talk/deck.md', layouts: ['cover', 'title-body'], invokedCommands: [], crit, ...overrides }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await page.locator('[data-studio-mode-option="layouts"]').click()
  await expect(page.locator('[data-layout-screen]')).toBeVisible()
  return deck
}

/** Writes `text` in the box the layout menu's comment item opens: on
 * layout `name`, or — without one — on every layout (the list's empty
 * space). */
async function commentOnLayout(page: Page, name: string | null, text: string): Promise<void> {
  if (name === null) {
    const box = (await page.locator('[data-layout-rows]').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10, { button: 'right' })
    await page.locator('[data-layout-menu-item="comment-all-layouts"]').click()
  } else {
    await page.locator(`[data-layout-row="${name}"]`).click({ button: 'right' })
    await page.locator('[data-layout-menu-item="comment-layout"]').click()
  }
  await expect(page.locator(BOX)).toBeVisible()
  await expect(page.locator(`${BOX} textarea`)).toBeFocused()
  await page.locator(`${BOX} textarea`).fill(text)
  await page.locator('[data-comment-add]').click()
  await expect(page.locator(BOX)).toBeHidden()
}

function sentLayoutComments(crit: FakeCritIpc): NewLayoutComment[] {
  return crit.calls.filter(call => call.method === 'addLayoutComments').flatMap(call => call.args[0] as NewLayoutComment[])
}

function count(deck: MockDeck, cmd: string): number {
  return (deck.invokedCommands ?? []).filter(invoked => invoked === cmd).length
}

test('Given the layout screen, When a layout is commented on from its menu, Then the box names the layout and the comment waits unsent in the comments column', async ({ page }) => {
  await openLayoutScreen(page, createFakeCritIpc())
  await page.locator('[data-layout-row="cover"]').click({ button: 'right' })
  await page.locator('[data-layout-menu-item="comment-layout"]').click()
  await expect(page.locator('[data-comment-target]')).toHaveText('Layout cover')
  await page.locator(`${BOX} textarea`).fill('Darker title')
  await page.locator('[data-comment-add]').click()

  const unsent = page.locator('[data-review-row="unsent-comment"]')
  await expect(unsent).toHaveCount(1)
  await expect(unsent.locator('[data-review-target]')).toHaveText('Layout cover')
  await expect(unsent).toContainText('Darker title')
})

test('Given comments on a layout and on every layout, When they are sent, Then the agent gets each as a request on the layout files, labelled with them', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openLayoutScreen(page, crit)
  await commentOnLayout(page, 'cover', 'Darker title')
  await commentOnLayout(page, null, 'Calmer colors overall')
  await expect(page.locator(SEND)).toBeEnabled()
  await page.locator(SEND).click()

  await expect.poll(() => sentLayoutComments(crit)).toEqual([
    { layout: 'cover', body: '[Layout cover (layouts/cover.html, css/cover.css)] Darker title', author: 'Peitho Studio' },
    { layout: null, body: '[All layouts (layouts/, css/)] Calmer colors overall', author: 'Peitho Studio' },
  ])
  // Nothing went to deck.md's lines, and the round was finished.
  expect(crit.calls.some(call => call.method === 'addComments')).toBe(false)
  await expect.poll(() => crit.calls.some(call => call.method === 'finish')).toBe(true)
  // Sent: the rows are crit's threads, named by layout without the files.
  const rows = page.locator('[data-review-row="comment"]')
  await expect(rows).toHaveCount(2)
  await expect(rows.locator('[data-review-target]')).toHaveText(['Layout cover', 'All layouts'])
  await expect(page.locator('[data-review-row="unsent-comment"]')).toHaveCount(0)
})

test('Given a sent layout comment, When the agent rewrites the layout files and replies, Then the layouts and the slides are rendered again', async ({ page }) => {
  const crit = createFakeCritIpc()
  const deck = await openLayoutScreen(page, crit, { layoutFilesStamp: 'v1' })
  await commentOnLayout(page, 'cover', 'Darker title')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
  const previewsBefore = count(deck, 'preview_layouts')
  const rendersBefore = count(deck, 'render_draft')
  const readsBefore = count(deck, 'read_layout')

  deck.layoutFilesStamp = 'v2'
  crit.reply('c_1', 'Made the title darker')
  await expect(page.locator('[data-review-row="reply"]')).toContainText('Made the title darker')
  await expect.poll(() => count(deck, 'preview_layouts')).toBeGreaterThan(previewsBefore)
  await expect.poll(() => count(deck, 'render_draft')).toBeGreaterThan(rendersBefore)
  // The layout shown is read again, so its editor holds the agent's version.
  await expect.poll(() => count(deck, 'read_layout')).toBeGreaterThan(readsBefore)
})

test('adversarial: Given the agent only replies and no layout file changed, Then the layouts are not rendered again', async ({ page }) => {
  const crit = createFakeCritIpc()
  const deck = await openLayoutScreen(page, crit, { layoutFilesStamp: 'v1' })
  await commentOnLayout(page, 'cover', 'Darker title')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
  const previewsBefore = count(deck, 'preview_layouts')

  crit.reply('c_1', 'Looks fine as it is')
  await expect(page.locator('[data-review-row="reply"]')).toContainText('Looks fine as it is')
  // Give a refresh that shouldn't happen the time it would take.
  await page.waitForTimeout(500)
  expect(count(deck, 'preview_layouts')).toBe(previewsBefore)
})

test('Given a layout comment\'s thread, When it is clicked from the slides screen, Then the layout screen opens on that layout', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openLayoutScreen(page, crit)
  await commentOnLayout(page, 'title-body', 'More room for the body')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)

  await page.locator('[data-studio-mode-option="slides"]').click()
  await expect(page.locator('[data-layout-screen]')).toBeHidden()
  await page.locator('[data-review-row="comment"]').click()
  await expect(page.locator('[data-layout-screen]')).toBeVisible()
  await expect(page.locator('[data-layout-row="title-body"]')).toHaveAttribute('aria-current', 'true')
})

test('Given a deck with layout folders and no agent yet, Then the connect command names them, so the agent joins Studio\'s session', async ({ page }) => {
  await openLayoutScreen(page, createFakeCritIpc({ session: 'none', sessionDirs: ['layouts', 'css'] }))
  await expect(page.locator('[data-agent-connect-prompt]')).toContainText(`1. Run: cd /decks/talk && '${FAKE_CRIT_PATH}' --no-open deck.md layouts css`)
})
