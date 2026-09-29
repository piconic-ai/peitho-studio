// The preview's comments for the Coding Agent (todo/review-comment-ui.md):
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
  await expect(page.locator('[data-review-row="unsent-comment"]')).toContainText('[Slide 1 › heading "Hello"] Make it bigger')
  await expect.poll(() => crit.calls.map(call => call.method)).toContain('startSession')
  await expect(page.locator('[data-review-status]')).toHaveText('Connect your Coding Agent to send comments.')
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
  await expect(page.locator('[data-review-status]')).toHaveText('The agent is waiting for your comments.')
})

test('Given no session, When an agent\'s own crit starts one and waits in it, Then within a few seconds the card goes away', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'none' })
  await openDeck(page, crit)
  await expect(page.locator(CONNECT)).toBeVisible()

  crit.agentStartsSession()

  await expect(page.locator(CONNECT)).toBeHidden({ timeout: 8_000 })
  await expect(page.locator('[data-review-status]')).toHaveText('Click a part of the preview to comment on it.')
})

test('Given an agent already waiting, Then no card is shown', async ({ page }) => {
  await openDeck(page, createFakeCritIpc())
  await expect(page.locator('[data-review-status]')).toHaveText('Click a part of the preview to comment on it.')
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
  await expect(page.locator('[data-review-status]')).toHaveText('The agent is waiting for your comments.')
})

test('Given an agent connects and waits, When the comments are sent, Then crit gets their lines, Markdown and labels, and the agent\'s reply shows under the comment', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'none' })
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await comment(page, 'li >> nth=0', 'Reword this')
  await expect(page.locator(SEND)).toBeDisabled()

  crit.agentConnects()
  await expect(page.locator(SEND)).toBeEnabled()
  await expect(page.locator('[data-review-status]')).toHaveText('The agent is waiting for your comments.')
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
  await expect(page.locator('[data-review-row="reply"]')).toContainText('Made it bigger')
})

test('Given the agent replied, When the user replies back and the agent waits again, Then the reply goes to that comment', async ({ page }) => {
  const crit = createFakeCritIpc()
  await openDeck(page, crit)
  await comment(page, 'h1', 'Make it bigger')
  await page.locator(SEND).click()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
  crit.reply('c_1', 'Made it bigger')
  await expect(page.locator('[data-review-row="reply"]')).toHaveCount(1)

  await page.locator('[data-review-row="comment"] [data-review-reply]').click()
  await page.locator('[data-review-reply-box] textarea').fill('Still too small')
  await page.locator('[data-review-reply-add]').click()
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
  await expect(page.locator('[data-review-row="comment"]')).toContainText('Resolved')
  await expect(page.locator('[data-slide-row="0"] [data-slide-comment-count]')).toBeHidden()
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
