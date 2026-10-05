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
    // Below the rows, which can fill the column.
    await page.locator('[data-layout-rows]').evaluate(el => { el.scrollTop = el.scrollHeight })
    const box = (await page.locator('[data-layout-rows]').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10, { button: 'right' })
    await page.locator('[data-menu="layout"] [data-menu-item="comment-all-layouts"]').click()
  } else {
    await page.locator(`[data-layout-row="${name}"]`).click({ button: 'right' })
    await page.locator('[data-menu="layout"] [data-menu-item="comment-layout"]').click()
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
  await page.locator('[data-menu="layout"] [data-menu-item="comment-layout"]').click()
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
  const readsBefore = count(deck, 'read_deck_file')

  deck.layoutFilesStamp = 'v2'
  crit.reply('c_1', 'Made the title darker')
  await expect(page.locator('[data-review-row="reply"]')).toContainText('Made the title darker')
  await expect.poll(() => count(deck, 'preview_layouts')).toBeGreaterThan(previewsBefore)
  await expect.poll(() => count(deck, 'render_draft')).toBeGreaterThan(rendersBefore)
  // The layout shown is read again, so its editor holds the agent's version.
  await expect.poll(() => count(deck, 'read_deck_file')).toBeGreaterThan(readsBefore)
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

test('Given Studio started the deck\'s session before the deck had layout folders, Then the connect command joins that session by id rather than naming the folders', async ({ page }) => {
  await openLayoutScreen(page, createFakeCritIpc({ session: 'none', sessionDirs: ['layouts', 'css'] }))
  // The first comment starts Studio's session.
  await commentOnLayout(page, 'cover', 'Darker title')
  await expect(page.locator('[data-agent-connect-prompt]')).toContainText(`1. Run: cd /decks/talk && '${FAKE_CRIT_PATH}' --no-open --session fake-session`)
})

// A left-click on the selected layout's large preview opens the comment box
// on that layout, as a click on the slide preview does on the slide; the label
// names the slot clicked, read from the `slot-<name>` class peitho-core
// wraps each filled slot's content in (`render_slot`). The mocked
// `preview_layouts` hands every layout the fragment below.
test.describe('a click on the selected layout\'s large preview', () => {
  const FRAGMENT = '<section class="peitho-slide"><h1><span class="slot-title">Placeholder title</span></h1>'
    + '<div class="body" style="margin-top: 200px"><div class="slot-body"><p>Placeholder body copy.</p></div></div></section>'

  async function openWithThumbnails(page: Page, crit: FakeCritIpc): Promise<MockDeck> {
    const deck = await openLayoutScreen(page, crit, { layoutFragment: FRAGMENT })
    // Opened on the selected slide's layout (a click on its thumbnail now
    // would open the box).
    await expect(page.locator('[data-layout-row="cover"]')).toHaveAttribute('aria-current', 'true')
    return deck
  }

  /** The large preview, drawing layout `name` once it's selected. */
  function thumbnail(page: Page, name: string) {
    return page.locator(`[data-layout-selected-preview="${name}"] [data-layout-thumbnail]`)
  }

  async function centerOf(page: Page, selector: string, name: string): Promise<{ x: number; y: number }> {
    const box = await page.locator(`[data-layout-selected-preview="${name}"] [data-layout-selected-canvas="${name}"] ${selector}`).boundingBox()
    if (!box) throw new Error(`${selector} has no box`)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  test('Given the selected layout, When a slot in its thumbnail is clicked, Then the box names the layout and the slot, and the agent gets it on the layout\'s files', async ({ page }) => {
    const crit = createFakeCritIpc()
    await openWithThumbnails(page, crit)

    const title = await centerOf(page, '.slot-title', 'cover')
    await page.mouse.click(title.x, title.y)

    await expect(page.locator(BOX)).toBeVisible()
    await expect(page.locator('[data-comment-target]')).toHaveText('Layout cover › slot "title"')
    await expect(page.locator(`${BOX} textarea`)).toBeFocused()
    await page.locator(`${BOX} textarea`).fill('Bigger title')
    await page.locator('[data-comment-add]').click()
    await expect(page.locator('[data-review-row="unsent-comment"] [data-review-target]')).toHaveText('Layout cover › slot "title"')

    await page.locator(SEND).click()
    await expect.poll(() => sentLayoutComments(crit)).toEqual([
      { layout: 'cover', body: '[Layout cover › slot "title" (layouts/cover.html, css/cover.css)] Bigger title', author: 'Peitho Studio' },
    ])
    await expect(page.locator('[data-review-row="comment"] [data-review-target]')).toHaveText('Layout cover › slot "title"')
  })

  test('Given the selected layout, When its thumbnail is clicked where no slot is, Then the box is on the whole layout', async ({ page }) => {
    await openWithThumbnails(page, createFakeCritIpc())
    const box = (await thumbnail(page, 'cover').boundingBox())!
    await page.mouse.click(box.x + box.width - 3, box.y + box.height - 3)
    await expect(page.locator('[data-comment-target]')).toHaveText('Layout cover › whole layout')
  })

  test('Given a layout not selected, When its small thumbnail is clicked, Then it is selected and drawn large, and no box opens; a click on the large preview opens it', async ({ page }) => {
    await openWithThumbnails(page, createFakeCritIpc())

    await page.locator('[data-layout-row="title-body"]').click()
    await expect(page.locator('[data-layout-row="title-body"]')).toHaveAttribute('aria-current', 'true')
    await expect(page.locator(BOX)).toBeHidden()

    const body = await centerOf(page, '.slot-body', 'title-body')
    await page.mouse.click(body.x, body.y)
    await expect(page.locator('[data-comment-target]')).toHaveText('Layout title-body › slot "body"')
  })

  test('adversarial: Given the selected thumbnail, When the mouse is dragged across it or it is right-clicked, Then no box opens, and the right-click opens the layout menu', async ({ page }) => {
    await openWithThumbnails(page, createFakeCritIpc())
    const title = await centerOf(page, '.slot-title', 'cover')

    await page.mouse.move(title.x - 20, title.y)
    await page.mouse.down()
    await page.mouse.move(title.x + 20, title.y, { steps: 5 })
    await page.mouse.up()
    await expect(page.locator(BOX)).toBeHidden()

    await page.mouse.click(title.x, title.y, { button: 'right' })
    await expect(page.locator('[data-menu="layout"]')).toBeVisible()
    await expect(page.locator(BOX)).toBeHidden()
  })

  test('adversarial: Given a click near the window\'s bottom-right corner, Then the box stays inside the window', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 })
    await openWithThumbnails(page, createFakeCritIpc())
    const box = (await thumbnail(page, 'cover').boundingBox())!
    await page.mouse.click(box.x + box.width - 3, box.y + box.height - 3)

    await expect(page.locator(BOX)).toBeVisible()
    const shown = (await page.locator(BOX).boundingBox())!
    const viewport = page.viewportSize()!
    expect(shown.x).toBeGreaterThanOrEqual(0)
    expect(shown.y).toBeGreaterThanOrEqual(0)
    expect(shown.x + shown.width).toBeLessThanOrEqual(viewport.width)
    expect(shown.y + shown.height).toBeLessThanOrEqual(viewport.height)
  })
})

test('Given an open comment box, When the screen is switched between slides and layouts, Then the box closes and nothing is filed', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openLayoutScreen(page, crit)
  await page.locator('[data-layout-row="cover"]').click({ button: 'right' })
  await page.locator('[data-menu="layout"] [data-menu-item="comment-layout"]').click()
  await expect(page.locator(BOX)).toBeVisible()
  await page.locator(`${BOX} textarea`).fill('Half-written')

  await page.locator('[data-studio-mode-option="slides"]').click()
  await expect(page.locator(BOX)).toBeHidden()
  await expect(page.locator('[data-review-row]')).toHaveCount(0)

  await page.locator('[data-preview-host] h1').first().click()
  await expect(page.locator(BOX)).toBeVisible()
  await page.locator('[data-studio-mode-option="layouts"]').click()
  await expect(page.locator(BOX)).toBeHidden()
})
