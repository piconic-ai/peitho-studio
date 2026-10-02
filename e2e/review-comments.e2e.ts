// The preview's comments for the Coding Agent (todo/archive/review-comment-ui.md):
// click a part of the preview, write a comment, send the comments to the
// agent waiting in crit, and read its replies under them.
//
// The deck renders with edit annotations the way peitho-core's
// `EditAnnotations::On` writes them (`mockTauri`'s `editAnnotations`), and
// crit is `ipc/fakeCritIpc.ts` answering the `crit_*` commands — the real
// round trip against the bundled crit is `src-tauri/src/crit.rs`'s
// `round_trip` tests. Not covered here: peitho-core's real annotations
// (pinned by `engine::pipeline`'s tests) and a real WKWebView.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { fillEditor } from './helpers/codeEditor'
import { FAKE_CRIT_PATH, createFakeCritIpc, type FakeCritIpc } from '../ipc/fakeCritIpc'
import type { NewReviewComment } from '../domain/critReview'

const SOURCE = '---\nlang: en\n---\n\n# Hello\n\nSome text\n\n- item one\n- item two\n\n![](img/photo.png)\n\n---\n\n# Second\n\nAnother paragraph\n'

const PREVIEW = '[data-preview-host]'
const BOX = '[data-comment-box]'
const SEND = '[data-review-send]'

async function openDeck(page: Page, crit: FakeCritIpc, source = SOURCE): Promise<MockDeck> {
  const deck: MockDeck = { source, deckPath: '/decks/talk/deck.md', editAnnotations: true, crit }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Hello')
  return deck
}

async function comment(page: Page, target: string, text: string): Promise<void> {
  await page.locator(`${PREVIEW} ${target}`).click()
  await expect(page.locator(BOX)).toBeVisible()
  await page.locator(`${BOX} textarea`).fill(text)
  await page.locator('[data-comment-add]').click()
  await expect(page.locator(BOX)).toBeHidden()
}

function sentComments(crit: FakeCritIpc): NewReviewComment[] {
  return crit.calls.filter(call => call.method === 'addComments').flatMap(call => call.args[0] as NewReviewComment[])
}

test('Given a deck, When a heading in the preview is clicked, Then a box opens naming the slide and the heading, and a pin marks the spot', async ({ page }) => {
  await openDeck(page, createFakeCritIpc({ session: 'none' }))
  await page.locator(`${PREVIEW} h1`).click()
  await expect(page.locator(BOX)).toBeVisible()
  await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › heading "Hello"')
  await expect(page.locator(`${BOX} textarea`)).toBeFocused()
  await expect(page.locator('[data-comment-pin]')).toHaveCount(1)
})

test('Given a deck, When a list item or a paragraph is clicked, Then the box names that kind of element', async ({ page }) => {
  await openDeck(page, createFakeCritIpc({ session: 'none' }))
  await page.locator(`${PREVIEW} li >> nth=1`).click()
  await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › list item "item two"')
  await page.locator(`${PREVIEW} p >> nth=0`).click()
  await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1 › paragraph "Some text"')
})

test('Given a deck, When an image (nothing annotated) is clicked, Then the comment is on the whole slide', async ({ page }) => {
  await openDeck(page, createFakeCritIpc({ session: 'none' }))
  await page.locator(`${PREVIEW} img`).click()
  await expect(page.locator('[data-comment-target]')).toHaveText('Slide 1')
})

test('Given text is being selected by dragging across the preview, Then no comment box opens', async ({ page }) => {
  await openDeck(page, createFakeCritIpc({ session: 'none' }))
  const box = (await page.locator(`${PREVIEW} p >> nth=0`).boundingBox())!
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator(BOX)).toBeHidden()
})

test('Given the comment box is open, When it is cancelled with Escape, Then nothing is filed', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'none' })
  await openDeck(page, crit)
  await page.locator(`${PREVIEW} h1`).click()
  await page.locator(`${BOX} textarea`).fill('never mind')
  await page.keyboard.press('Escape')
  await expect(page.locator(BOX)).toBeHidden()
  await expect(page.locator('[data-review-row]')).toHaveCount(0)
  await expect(page.locator('[data-comment-pin]')).toHaveCount(0)
})

test('Given no review session, When the first comment is added, Then Studio starts one, the thumbnail counts it, and sending waits for the agent with what to ask it', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'none' })
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')

  await expect(page.locator('[data-slide-row="0"] [data-slide-comment-count]')).toHaveText('1')
  await expect(page.locator('[data-slide-row="1"] [data-slide-comment-count]')).toBeHidden()
  const unsentRow = page.locator('[data-review-row="unsent-comment"]')
  await expect(unsentRow.locator('[data-review-target]')).toHaveText('Slide 1 › heading "Hello"')
  await expect(unsentRow).toContainText('Make it bigger')
  await expect(unsentRow.locator('[data-review-agent]')).toBeHidden()
  await expect(unsentRow.locator('[data-review-time]')).toHaveText(/^\d\d:\d\d$/)
  await expect.poll(() => crit.calls.map(call => call.method)).toContain('startSession')
  // The card asks for the agent; the line doesn't repeat it.
  await expect(page.locator('[data-review-say]')).toBeHidden()
  await expect(page.locator('[data-agent-connect]')).toBeVisible()
  await expect(page.locator(SEND)).toBeDisabled()
})

const CONNECT = '[data-agent-connect]'
const CRIT_QUOTED = `'${FAKE_CRIT_PATH}'`

test('Given no agent is connected, Then a card walks through connecting one, with a prompt and a command naming the deck and the bundled crit', async ({ page }) => {
  await openDeck(page, createFakeCritIpc({ session: 'none' }))

  await expect(page.locator(CONNECT)).toBeVisible()
  await expect(page.locator(`${CONNECT} ol > li`)).toHaveCount(3)
  const prompt = page.locator('[data-agent-connect-prompt]')
  await expect(prompt).toContainText(`1. Run: cd /decks/talk && ${CRIT_QUOTED} --no-open deck.md`)
  await expect(prompt).toContainText(`use ${CRIT_QUOTED} instead.`)
  // The terminal route is folded away until asked for.
  await expect(page.locator('[data-agent-connect-command]')).toBeHidden()
  await page.locator('[data-agent-connect-terminal] summary').click()
  await expect(page.locator('[data-agent-connect-command]')).toHaveText(`cd /decks/talk && ${CRIT_QUOTED} --no-open deck.md`)
})

test('Given the card, When the prompt and then the command are copied, Then each lands on the clipboard and its button says so', async ({ page }) => {
  const deck = await openDeck(page, createFakeCritIpc({ session: 'none' }))

  await page.locator('[data-agent-connect-copy-prompt]').click()
  await expect(page.locator('[data-agent-connect-copy-prompt]')).toHaveText('Copied')
  await expect.poll(() => deck.clipboardText).toContain('Start a review loop for my Peitho deck.')

  await page.locator('[data-agent-connect-terminal] summary').click()
  await page.locator('[data-agent-connect-copy-command]').click()
  await expect(page.locator('[data-agent-connect-copy-command]')).toHaveText('Copied')
  await expect.poll(() => deck.clipboardText).toBe(`cd /decks/talk && ${CRIT_QUOTED} --no-open deck.md`)
  await expect(page.locator('[data-agent-connect-copy-prompt]')).toHaveText('Copy Prompt')
})

test('Given the card, When the agent connects, Then the card goes away and the panel says the agent is waiting', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'none' })
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await expect(page.locator(CONNECT)).toBeVisible()

  crit.agentConnects()

  await expect(page.locator(CONNECT)).toBeHidden()
  await expect(page.locator('[data-review-status]')).toBeHidden()
})

test('Given no session, When an agent\'s own crit starts one and waits in it, Then within a few seconds the card goes away', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'none' })
  await openDeck(page, crit)
  await expect(page.locator(CONNECT)).toBeVisible()

  crit.agentStartsSession()

  await expect(page.locator(CONNECT)).toBeHidden({ timeout: 8_000 })
  await expect(page.locator('[data-review-status]')).toHaveText('Click anything on a slide and tell me what to change.')
})

test('Given an agent already waiting, Then no card is shown', async ({ page }) => {
  await openDeck(page, createFakeCritIpc())
  await expect(page.locator('[data-review-status]')).toHaveText('Click anything on a slide and tell me what to change.')
  await expect(page.locator(CONNECT)).toBeHidden()
})

test('Given no bundled crit (a dev build without crit:fetch), Then the card falls back to crit on the agent\'s PATH', async ({ page }) => {
  await openDeck(page, createFakeCritIpc({ session: 'none', critPath: null }))
  await expect(page.locator('[data-agent-connect-command]')).toHaveText('cd /decks/talk && crit --no-open deck.md')
})

test('Given an agent connects without Studio hearing an event, Then within a few seconds Studio sees it waiting and sending opens up', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'none' })
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await expect(page.locator(SEND)).toBeDisabled()

  crit.agentConnects({ silent: true })

  await expect(page.locator(SEND)).toBeEnabled({ timeout: 8_000 })
  await expect(page.locator('[data-review-status]')).toBeHidden()
})

test('Given an agent connects and waits, When the comments are sent, Then crit gets their lines, Markdown and labels, and the agent\'s reply shows under the comment', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'none' })
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await comment(page, 'li >> nth=0', 'Reword this')
  await expect(page.locator(SEND)).toBeDisabled()

  crit.agentConnects()
  await expect(page.locator(SEND)).toBeEnabled()
  await expect(page.locator('[data-review-status]')).toBeHidden()
  await page.locator(SEND).click()

  await expect.poll(() => crit.calls.map(call => call.method)).toContain('finish')
  expect(sentComments(crit)).toEqual([
    { startLine: 5, endLine: 5, body: '[Slide 1 › heading "Hello"] Make it bigger', quote: 'Hello', author: 'Peitho Studio' },
    { startLine: 9, endLine: 9, body: '[Slide 1 › list item "item one"] Reword this', quote: 'item one', author: 'Peitho Studio' },
  ])
  // Sent: the rows are crit's threads now, and no agent waits until it
  // comes back.
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(2)
  await expect(page.locator('[data-review-row="unsent-comment"]')).toHaveCount(0)
  await expect(page.locator(SEND)).toBeDisabled()
  await expect(page.locator('[data-comment-pin="sent"]')).toHaveCount(2)
  await expect(page.locator('[data-slide-row="0"] [data-slide-comment-count]')).toHaveText('2')

  crit.reply('c_1', 'Made it bigger')
  const replyRow = page.locator('[data-review-row="reply"]')
  await expect(replyRow).toContainText('Made it bigger')
  // The agent's words carry its icon and name.
  await expect(replyRow.locator('[data-review-agent]')).toBeVisible()
  await expect(replyRow.locator('[data-review-agent]')).toHaveText('Agent')
})

test('Given the agent replied, When the user replies back and the agent waits again, Then the reply goes to that comment', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
  crit.reply('c_1', 'Made it bigger')
  await expect(page.locator('[data-review-row="reply"]')).toHaveCount(1)

  // Reply sits under the agent's last word, not on the comment.
  await expect(page.locator('[data-review-row="comment"] [data-review-reply]')).toBeHidden()
  await page.locator('[data-review-row="reply"] [data-review-reply]').click()
  await expect(page.locator('[data-review-row="reply"] [data-review-reply]')).toBeHidden()
  // The box opens under the thread it answers: after the agent's reply.
  await expect(page.locator('[data-review-row="reply"] [data-review-reply-box]')).toBeVisible()
  await page.locator('[data-review-reply-box]:visible textarea').fill('Still too small')
  await page.locator('[data-review-reply-add]:visible').click()
  await expect(page.locator('[data-review-row="unsent-reply"]')).toContainText('Still too small')
  await expect(page.locator(SEND)).toBeDisabled()

  crit.agentConnects()
  await page.locator(SEND).click()
  await expect.poll(() => crit.calls.filter(call => call.method === 'addReplies').map(call => call.args[0]))
    .toEqual([[{ commentId: 'c_1', body: 'Still too small', author: 'Peitho Studio' }]])
  await expect(page.locator('[data-review-row="reply"]')).toHaveCount(2)
})

test('Given a sent comment, When it is resolved, Then crit marks it resolved and the slide no longer counts it', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
  await page.locator('[data-review-row="comment"] [data-review-resolve]').click()
  await expect(page.locator('[data-slide-row="0"] [data-slide-comment-count]')).toBeHidden()
  // Resolved threads are left out until asked for.
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(0)
  const toggle = page.locator('[data-review-show-resolved]')
  await expect(toggle).toHaveText('Show resolved (1)')
  await toggle.click()
  await expect(page.locator('[data-review-row="comment"] [data-review-resolved]')).toBeVisible()
  await expect(page.locator('[data-review-row="comment"] [data-review-resolve]')).toBeHidden()
  await expect(toggle).toHaveText('Hide resolved')
  await toggle.click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(0)
})

test('Given an unsent reply, When its thread is resolved, Then the reply is not sent: it stays listed to be discarded and sending closes', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
  crit.reply('c_1', 'Made it bigger')
  crit.agentConnects()
  await page.locator('[data-review-row="reply"] [data-review-reply]').click()
  await page.locator('[data-review-reply-box]:visible textarea').fill('Still too small')
  await page.locator('[data-review-reply-add]:visible').click()
  await expect(page.locator(SEND)).toBeEnabled()

  await page.locator('[data-review-row="comment"] [data-review-resolve]').click()

  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(0)
  await expect(page.locator('[data-review-row="unsent-reply"]')).toContainText('Still too small')
  await expect(page.locator(SEND)).toBeDisabled()
  await page.locator('[data-review-row="unsent-reply"] [data-review-discard]').click()
  await expect(page.locator('[data-review-row="unsent-reply"]')).toHaveCount(0)
  expect(crit.calls.map(call => call.method)).not.toContain('addReplies')
})

test('Given a comment sent while no agent waited, When the agent comes back, Then Send hands it over again', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  const count = page.locator('[data-review-send-count]')
  await expect(count).toHaveText('1')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
  // Handed to nobody: the agent never answers, and while it's away Send
  // stays closed — and the panel says it's at work, not that it's missing.
  await expect(page.locator(SEND)).toBeDisabled()
  await expect(count).toHaveText('1')
  await expect(page.locator(CONNECT)).toBeHidden()
  // The agent's work shows on the Send button, not as a line.
  await expect(page.locator(SEND)).toHaveAttribute('data-review-send-state', 'thinking')
  await expect(page.locator(SEND)).toContainText('Thinking…')
  await expect(page.locator('[data-review-say]')).toBeHidden()

  crit.agentConnects()

  await expect(page.locator(SEND)).toBeEnabled()
  await page.locator(SEND).click()
  await expect.poll(() => crit.calls.filter(call => call.method === 'finish').length).toBe(2)
  expect(crit.calls.filter(call => call.method === 'addComments')).toHaveLength(1)

  // Once the agent answers, nothing waits on it any more.
  crit.reply('c_1', 'Made it bigger')
  crit.agentConnects()
  await expect(count).toBeHidden()
  await expect(page.locator(SEND).locator('span').first()).toHaveText('Send')
  await expect(page.locator(SEND)).toBeDisabled()
})

test('Given a pin on a list item, When the preview switches to the phone shape and back, Then the pin stays on that item', async ({ page }) => {
  await openDeck(page, createFakeCritIpc())
  const item = page.locator(`${PREVIEW} li >> nth=1`)
  await comment(page, 'li >> nth=1', 'Reword this')
  const pin = page.locator('[data-comment-pin]')
  // The pin's bottom-left corner is its point; it must sit on the item.
  async function pinOnItem(): Promise<boolean> {
    const [p, box] = [await pin.boundingBox(), await item.boundingBox()]
    if (p === null || box === null) return false
    const point = { x: p.x, y: p.y + p.height }
    return point.x >= box.x - 1 && point.x <= box.x + box.width + 1 && point.y >= box.y - 1 && point.y <= box.y + box.height + 1
  }
  await expect.poll(pinOnItem).toBe(true)

  await page.getByRole('switch', { name: 'Preview as phone' }).click()
  await expect.poll(pinOnItem).toBe(true)
  await page.getByRole('switch', { name: 'Preview as phone' }).click()
  await expect.poll(pinOnItem).toBe(true)
})

test('Given the agent taken to be at work, When Reconnect is chosen (its session was closed), Then the connect card comes back until it waits again', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator(SEND).click()
  await expect(page.locator(SEND)).toHaveAttribute('data-review-send-state', 'thinking')
  const reconnect = page.locator('[data-review-reconnect]')
  await expect(reconnect).toBeVisible()
  await expect(page.locator(CONNECT)).toBeHidden()

  await reconnect.click()

  await expect(page.locator(CONNECT)).toBeVisible()
  await expect(page.locator(SEND)).toHaveAttribute('data-review-send-state', 'idle')
  await expect(reconnect).toBeHidden()

  crit.agentConnects()
  await expect(page.locator(CONNECT)).toBeHidden()
})

test('Given a pin on the phone-shaped preview, When the slide reflows on its own (a web font or an image arriving late), Then the pin follows its element', async ({ page }) => {
  await openDeck(page, createFakeCritIpc())
  await page.getByRole('switch', { name: 'Preview as phone' }).click()
  const item = page.locator(`${PREVIEW} li >> nth=1`)
  await comment(page, 'li >> nth=1', 'Reword this')
  const pin = page.locator('[data-comment-pin]')
  // Where the pin's point (its bottom-left corner) sits against the item.
  async function pinOffset(): Promise<string> {
    const [p, box] = [await pin.boundingBox(), await item.boundingBox()]
    if (p === null || box === null) return ''
    return `${String(Math.round(p.x - box.x))},${String(Math.round(p.y + p.height - box.y))}`
  }
  await expect.poll(pinOffset).not.toBe('')
  await page.waitForTimeout(300)
  const offset = await pinOffset()
  const before = await item.boundingBox()

  // What a late font or image does: the text above the item grows.
  await page.locator(`${PREVIEW} h1`).evaluate(heading => { (heading as HTMLElement).style.paddingTop = '300px' })
  await expect.poll(async () => ((await item.boundingBox())?.y ?? 0) - (before?.y ?? 0)).toBeGreaterThan(30)
  await expect.poll(pinOffset).toBe(offset)
})

test('Given comments sent before the window reloaded, Then their pins show again, on their element or the slide\'s corner', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'li >> nth=1', 'Reword this')
  await comment(page, 'img', 'Swap the photo')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(2)

  await page.reload()
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(2)
  const pins = page.locator('[data-comment-pin="sent"]')
  await expect(pins).toHaveCount(2)
  // The one on the list item sits on that item's top-left corner.
  const item = page.locator(`${PREVIEW} li >> nth=1`)
  await expect.poll(async () => {
    const [p, box] = [await pins.first().boundingBox(), await item.boundingBox()]
    return p !== null && box !== null && Math.abs(p.x - box.x) <= 1 && Math.abs(p.y + p.height - box.y) <= 1
  }).toBe(true)
  await page.locator('[data-slide-row="1"]').click()
  await expect(page.locator('[data-comment-pin]')).toHaveCount(0)
})

test('Given a comment\'s pin on the slide, When it is clicked, Then its thread is shown and lit up, and no new comment starts', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await comment(page, 'li >> nth=1', 'Reword this')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(2)
  await expect(page.locator('[data-comment-pin="sent"]')).toHaveCount(2)

  await page.locator('[data-panel="review"] [data-panel-toggle]').click()
  await expect(page.locator('[data-panel="review"]')).toBeHidden()
  await page.locator('[data-comment-pin="sent"] >> nth=1').click()

  await expect(page.locator('[data-panel="review"]')).toBeVisible()
  await expect(page.locator('[data-panel-rail]')).toBeHidden()
  await expect(page.locator(BOX)).toBeHidden()
  const lit = page.locator('[data-review-row][data-review-highlighted="true"]')
  await expect(lit).toHaveCount(1)
  await expect(lit).toContainText('Reword this')
  await expect(lit).toBeInViewport()
  // It fades after a moment.
  await expect(lit).toHaveCount(0, { timeout: 5_000 })
})

test('Given a comment on another slide, When its row is clicked, Then that slide opens; a click on its buttons does not', async ({ page }) => {
  await openDeck(page, createFakeCritIpc())
  await page.locator('[data-slide-row="1"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Second')
  await comment(page, 'h1', 'Retitle')
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Hello')

  await page.locator('[data-review-row="unsent-comment"] [data-review-discard]').hover()
  await page.locator('[data-review-row="unsent-comment"] p').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Second')

  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Hello')
  await page.locator('[data-review-row="unsent-comment"] [data-review-discard]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Hello')
})

test('Given a sent comment on a slide that sets its key, When crit moves its lines onto another slide, Then it stays on its own slide', async ({ page }) => {
  // crit carries a comment forward from the deck as the round began, so a
  // slide added in Studio before commenting can shift it onto the next one.
  const crit = createFakeCritIpc()
  const source = '<!-- {"key":"hello"} -->\n# Hello\n\nSome text\n\n---\n\n<!-- {"key":"second"} -->\n# Second\n\nAnother paragraph\n'
  await openDeck(page, crit, source)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator(SEND).click()
  await expect.poll(() => sentComments(crit).map(sent => sent.body)).toEqual(['[Slide 1 (key: hello) › heading "Hello"] Make it bigger'])
  await expect(page.locator('[data-review-row="comment"] [data-review-target]')).toHaveText('Slide 1 › heading "Hello"')

  crit.moveComment('c_1', { start: 9, end: 9 })
  await page.locator('[data-slide-row="1"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Second')
  await expect(page.locator('[data-slide-row="0"] [data-slide-comment-count]')).toHaveText('1')
  await expect(page.locator('[data-slide-row="1"] [data-slide-comment-count]')).toBeHidden()
  await page.locator('[data-review-row="comment"] p').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Hello')
})

test('Given comments sent at different times, Then they read oldest first', async ({ page }) => {
  let minute = 0
  const crit = createFakeCritIpc({ now: () => new Date(Date.UTC(2026, 8, 29, 1, minute++)).toISOString() })
  await openDeck(page, crit)
  await comment(page, 'h1', 'First')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
  crit.agentConnects()
  await comment(page, 'li >> nth=0', 'Second')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(2)
  await expect(page.locator('[data-review-row="comment"] p')).toHaveText(['First', 'Second'])
})

test('Given an unsent comment, When lines are added above its element before sending, Then it is sent at the element\'s new line', async ({ page }) => {
  const crit = createFakeCritIpc()
  const deck = await openDeck(page, crit)
  await comment(page, 'li >> nth=1', 'Fix')
  await fillEditor(page, 'Intro\n\nMore intro\n\n# Hello\n\nSome text\n\n- item one\n- item two\n\n![](img/photo.png)\n')
  await expect.poll(() => deck.source).toContain('More intro')

  await page.locator(SEND).click()
  await expect.poll(() => sentComments(crit)).toEqual([
    { startLine: 13, endLine: 13, body: '[Slide 1 › list item "item two"] Fix', quote: 'item two', author: 'Peitho Studio' },
  ])
})

test('Given an unsent comment whose element was edited away, When it is sent, Then it goes to its slide\'s lines', async ({ page }) => {
  const crit = createFakeCritIpc()
  const deck = await openDeck(page, crit)
  await comment(page, 'p >> nth=0', 'Fix')
  await fillEditor(page, '# Hello\n\nOther text\n')
  await page.locator(SEND).click()
  await expect.poll(() => sentComments(crit)).toHaveLength(1)
  // The slide's lines in the deck as saved: its heading to its last line.
  const lines = deck.source.split('\n')
  expect(sentComments(crit)).toEqual([{
    startLine: lines.indexOf('# Hello') + 1,
    endLine: lines.indexOf('Other text') + 1,
    body: '[Slide 1 › paragraph "Some text"] Fix',
    quote: '',
    author: 'Peitho Studio',
  }])
})

test('Given an unsent comment, When it is edited in place, Then Save puts the new text in, Cancel and Escape keep the old, and the slide does not change', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  const row = page.locator('[data-review-row="unsent-comment"]')
  await page.locator('[data-slide-row="1"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Second')

  await row.locator('[data-review-edit]').click()
  await expect(row.locator('[data-review-bubble]')).toBeHidden()
  await expect(row.locator('[data-review-edit-box] textarea')).toBeFocused()
  await expect(row.locator('[data-review-edit-box] textarea')).toHaveValue('Make it bigger')
  await row.locator('[data-review-edit-box] textarea').fill('Make it much bigger')
  await row.locator('[data-review-edit-save]').click()
  await expect(row.locator('[data-review-bubble]')).toHaveText('Make it much bigger')
  await expect(row.locator('[data-review-edit-box]')).toBeHidden()
  // The editor's own buttons are not a click on the row.
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Second')

  await row.locator('[data-review-edit]').click()
  await row.locator('[data-review-edit-box] textarea').fill('   ')
  await expect(row.locator('[data-review-edit-save]')).toBeDisabled()
  await row.locator('[data-review-edit-box] textarea').press('Escape')
  await expect(row.locator('[data-review-bubble]')).toHaveText('Make it much bigger')

  await row.locator('[data-review-edit]').click()
  await row.locator('[data-review-edit-box] textarea').fill('Make it huge')
  await row.locator('[data-review-edit-box] button', { hasText: 'Cancel' }).click()
  await expect(row.locator('[data-review-bubble]')).toHaveText('Make it much bigger')
})

test('Given an unsent comment being edited, When Send is pressed, Then it goes as it reads in the editor', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator('[data-review-row="unsent-comment"] [data-review-edit]').click()
  // The application focuses and positions the caret on the next frame.
  // Let that finish before Playwright selects and replaces the field.
  await expect(page.locator('[data-review-edit-box]:visible textarea')).toBeFocused()
  await page.locator('[data-review-edit-box]:visible textarea').fill('Make it red')
  await page.locator(SEND).click()
  await expect.poll(() => sentComments(crit).map(sent => sent.body)).toEqual(['[Slide 1 › heading "Hello"] Make it red'])
  await expect(page.locator('[data-review-edit-box]:visible')).toHaveCount(0)
})

test('Given an unsent reply, When it is edited, Then the new text is what gets sent', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator(SEND).click()
  crit.reply('c_1', 'Made it bigger')
  await page.locator('[data-review-row="reply"] [data-review-reply]').click()
  await page.locator('[data-review-reply-box]:visible textarea').fill('Still small')
  await page.locator('[data-review-reply-add]:visible').click()

  const row = page.locator('[data-review-row="unsent-reply"]')
  await row.locator('[data-review-edit]').click()
  await row.locator('[data-review-edit-box] textarea').fill('Still too small')
  await row.locator('[data-review-edit-box] textarea').press('Meta+Enter')
  await expect(row.locator('[data-review-bubble]')).toHaveText('Still too small')

  crit.agentConnects()
  await page.locator(SEND).click()
  await expect.poll(() => crit.calls.filter(call => call.method === 'addReplies').map(call => call.args[0]))
    .toEqual([[{ commentId: 'c_1', body: 'Still too small', author: 'Peitho Studio' }]])
})

test('Given an unsent comment whose text was selected to replace before its editor finished opening, When new text is typed, Then it replaces the old instead of being appended', async ({ page }) => {
  // Holds animation frames once asked to, so the editor's deferred focus
  // can be run between selecting the old text and typing over it — the
  // order a slow CI frame produced, flaking the two tests above.
  await page.addInitScript(() => {
    const held: FrameRequestCallback[] = []
    const raf = window.requestAnimationFrame.bind(window)
    const w = window as unknown as { holdFrames: boolean, runHeldFrames: () => void }
    w.holdFrames = false
    w.runHeldFrames = () => { for (const callback of held.splice(0)) callback(performance.now()) }
    window.requestAnimationFrame = callback => {
      if (!w.holdFrames) return raf(callback)
      held.push(callback)
      return 0
    }
  })
  await openDeck(page, createFakeCritIpc())
  await comment(page, 'h1', 'Make it bigger')
  const row = page.locator('[data-review-row="unsent-comment"]')
  const field = row.locator('[data-review-edit-box] textarea')

  await page.evaluate(() => { (window as unknown as { holdFrames: boolean }).holdFrames = true })
  await row.locator('[data-review-edit]').click()
  await field.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.select() })
  await page.evaluate(() => (window as unknown as { runHeldFrames: () => void }).runHeldFrames())
  await page.keyboard.insertText('Make it red')

  await expect(field).toHaveValue('Make it red')
})

test('Given an unsent comment, When it is discarded, Then it is gone from the panel, the pins and the count', async ({ page }) => {
  await openDeck(page, createFakeCritIpc())
  await comment(page, 'h1', 'Oops')
  await page.locator('[data-review-row="unsent-comment"] [data-review-discard]').click()
  await expect(page.locator('[data-review-row]')).toHaveCount(0)
  await expect(page.locator('[data-comment-pin]')).toHaveCount(0)
  await expect(page.locator('[data-slide-row="0"] [data-slide-comment-count]')).toBeHidden()
})

test('Given sending fails, Then the comments stay unsent and the error is shown', async ({ page }) => {
  const crit = createFakeCritIpc()
  crit.finish = async () => { throw new Error('crit went away') }
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-error]')).toContainText('crit went away')
  await expect(page.locator('[data-review-row="unsent-comment"]')).toHaveCount(1)
})

// Groundwork for comments on layouts (todo/layout-review-comments.md): the
// comments column is the same one in both screens.
test('Given comments on the deck, When the window switches to the layout screen, Then the same comments column shows there, opened and closed together with the slides screen\'s', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)

  await page.locator('[data-studio-mode-option="layouts"]').click()
  await expect(page.locator('[data-layout-screen]')).toBeVisible()
  await expect(page.locator('[data-panel="review"]')).toBeVisible()
  await expect(page.locator('[data-review-row="comment"]')).toContainText('Make it bigger')

  await page.locator('[data-panel="review"] [data-panel-toggle]').click()
  await expect(page.locator('[data-panel="review"]')).toBeHidden()
  await page.locator('[data-studio-mode-option="slides"]').click()
  await expect(page.locator('[data-panel="review"]')).toBeHidden()
  await page.locator('[data-studio-mode-option="layouts"]').click()
  await page.locator('[data-layout-panel-rail] [data-panel-toggle="review"]').click()
  await expect(page.locator('[data-panel="review"]')).toBeVisible()
  await expect(page.locator('[data-layout-panel-rail]')).toBeHidden()
})

test('Given the layout screen, When a comment\'s row is clicked, Then the slides screen comes back with its slide open', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await page.locator('[data-slide-row="1"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Second')
  await comment(page, 'h1', 'Shorter title')
  await page.locator(SEND).click()
  await page.locator('[data-slide-row="0"]').click()

  await page.locator('[data-studio-mode-option="layouts"]').click()
  await page.locator('[data-review-row="comment"]').click()

  await expect(page.locator('[data-layout-screen]')).toBeHidden()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Second')
})
