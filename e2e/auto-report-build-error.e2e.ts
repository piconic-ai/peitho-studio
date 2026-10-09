// A deck on disk that doesn't build gets reported to the agent waiting in
// crit by Studio itself (todo/auto-report-build-error.md): each error goes
// in as a `[Build error]` comment on its line and the round is finished,
// with nothing for the user to write — as soon as an agent waits, once per
// error since the deck last built. crit is `ipc/fakeCritIpc.ts` answering
// the `crit_*` commands; peitho-core's refusal is `renderError`
// (`slotErrorAt`, which the frontend isolates — `isolate-broken-slides
// .e2e.ts` — or a frontmatter error nothing can isolate). Not covered
// here: the bundled crit itself, and an agent actually fixing the deck.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, slotErrorAt, type MockDeck } from './helpers/mockTauri'
import { editorText, fillEditor } from './helpers/codeEditor'
import { createFakeCritIpc, type FakeCritIpc } from '../ipc/fakeCritIpc'
import type { NewReviewComment } from '../domain/critReview'
import type { RenderErrorPayload } from '../domain/render'

const SOURCE = '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n'
const SLIDE_TWO_HEADLINE = "slide 2 ('two'), line 8: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1"
const SLIDE_TWO_COMMENT: NewReviewComment = {
  startLine: 8,
  endLine: 8,
  quote: 'BROKEN',
  body: `[Build error] ${SLIDE_TWO_HEADLINE}\n= help: use a layout with a body slot or remove one paragraph\nFix the deck so \`peitho build\` passes, then reply.`,
  author: 'Peitho Studio',
}

const STATUS = 'footer'
const ERROR_BADGE = '[data-slide-status="error"]'
const PREVIEW = '[data-preview-host]'
const ERROR_BAR = '.bg-destructive\\/10'

function brokenDeck(crit: FakeCritIpc, overrides: Partial<MockDeck> = {}): MockDeck {
  return { source: SOURCE, deckPath: '/decks/broken/deck.md', renderError: slotErrorAt('BROKEN'), editAnnotations: true, crit, ...overrides }
}

async function open(page: Page, deck: MockDeck, rows = 3): Promise<MockDeck> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(rows, { timeout: 10_000 })
  return deck
}

function methods(crit: FakeCritIpc): string[] {
  return crit.calls.map(call => call.method)
}

function sentComments(crit: FakeCritIpc): NewReviewComment[] {
  return crit.calls.filter(call => call.method === 'addComments').flatMap(call => call.args[0] as NewReviewComment[])
}

/** The deck changes on disk (the agent, or another editor, wrote it). */
async function changeOnDisk(page: Page, deck: MockDeck, source: string): Promise<void> {
  deck.source = source
  await page.evaluate(() => {
    (window as unknown as { __mockEmitTauriEvent?: (event: string, payload: unknown) => void }).__mockEmitTauriEvent?.('deck-file-changed', null)
  })
}

test('Given an agent waiting, when a deck with a broken slide is opened, then its error is commented on its line, the round is finished, and the status bar says so', async ({ page }) => {
  const crit = createFakeCritIpc()
  await open(page, brokenDeck(crit))

  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([SLIDE_TWO_COMMENT])
  expect(methods(crit).indexOf('addComments')).toBeLessThan(methods(crit).indexOf('finish'))
  await expect(page.locator(STATUS)).toHaveText('Sent the build error to the AI.')

  // The comment is a thread in the panel, on the broken slide, with
  // nothing left unsent.
  const row = page.locator('[data-review-row="comment"]')
  await expect(row).toHaveCount(1)
  await expect(row.locator('[data-review-target]')).toHaveText('Build error')
  await expect(row).toContainText(SLIDE_TWO_HEADLINE)
  await expect(page.locator('[data-review-row="unsent-comment"]')).toHaveCount(0)
  await expect(page.locator('[data-slide-row="1"] [data-slide-comment-count]')).toHaveText('1')
  await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
})

test('Given the agent replies to the reported error, then its reply shows under the comment', async ({ page }) => {
  const crit = createFakeCritIpc()
  await open(page, brokenDeck(crit))
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)

  crit.reply('c_1', 'Removed the extra paragraph')
  const reply = page.locator('[data-review-row="reply"]')
  await expect(reply).toContainText('Removed the extra paragraph')
  await expect(reply.locator('[data-review-agent]')).toHaveText('Agent')
})

test('Given an agent waiting, when a deck nothing can isolate (a frontmatter error) is opened, then the error is commented on its line of the frontmatter', async ({ page }) => {
  const error: RenderErrorPayload = {
    kind: 'Parse',
    line: 2,
    originFile: null,
    message: 'invalid deck frontmatter: unknown field `fontss`',
    help: 'use only the supported deck frontmatter keys',
    headline: 'line 2: invalid deck frontmatter: unknown field `fontss`',
    slide: null,
  }
  const crit = createFakeCritIpc()
  await open(page, brokenDeck(crit, { source: '---\nfontss: x\n---\n\n# One\n\n---\n\n# Two\n', renderError: () => error }), 2)

  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([{
    startLine: 2,
    endLine: 2,
    quote: 'fontss: x',
    body: `[Build error] ${error.headline}\n= help: ${error.help}\nFix the deck so \`peitho build\` passes, then reply.`,
    author: 'Peitho Studio',
  }])
  await expect(page.locator(STATUS)).toHaveText('Sent the build error to the AI.')
})

test('Given the agent is at work (not waiting), when the deck breaks, then the error waits and goes when the agent comes to wait', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'working' })
  await open(page, brokenDeck(crit))
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)
  await page.waitForTimeout(300)
  expect(methods(crit)).not.toContain('addComments')
  await expect(page.locator(STATUS)).not.toHaveText('Sent the build error to the AI.')

  crit.agentConnects()

  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([SLIDE_TWO_COMMENT])
  await expect(page.locator(STATUS)).toHaveText('Sent the build error to the AI.')
})

test('Given the agent is at work, when its edit moves the waiting error to another line, then the error goes on that line when it comes to wait', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'working' })
  const deck = await open(page, brokenDeck(crit))
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)

  // Two lines added above slide 2: the same error, two lines down.
  await changeOnDisk(page, deck, SOURCE.replace('# One\n', '# One\n\nAn intro line\n'))
  await expect(page.locator(STATUS)).toHaveText('Reloaded — the deck changed on disk.')
  await page.waitForTimeout(300)
  expect(methods(crit)).not.toContain('addComments')

  crit.agentConnects()

  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([{
    ...SLIDE_TWO_COMMENT,
    startLine: 10,
    endLine: 10,
    body: SLIDE_TWO_COMMENT.body.replace('line 8', 'line 10'),
  }])
})

test('Given the agent is at work, when the deck is fixed on disk before it waits, then nothing is sent', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'working' })
  const deck = await open(page, brokenDeck(crit))
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)

  await changeOnDisk(page, deck, SOURCE.replace('BROKEN', 'Fixed outside'))
  await expect(page.locator(ERROR_BADGE)).toHaveCount(0)
  crit.agentConnects()

  await page.waitForTimeout(500)
  expect(methods(crit)).not.toContain('addComments')
  expect(methods(crit)).not.toContain('finish')
})

test('Given an error was sent, when the agent\'s edit leaves the same error on another line and breaks another slide, then only the new error is sent', async ({ page }) => {
  const crit = createFakeCritIpc()
  const deck = await open(page, brokenDeck(crit))
  await expect.poll(() => methods(crit)).toContain('finish')
  crit.agentConnects()

  // A line added above slide 2 moves its error; slide 4 is new, and broken.
  await changeOnDisk(page, deck, '# One\n\nAn intro line\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n\n---\n\n# Four\n\nBROKEN\n')
  await expect(page.locator('[data-slide-row]')).toHaveCount(4)
  await expect(page.locator(ERROR_BADGE)).toHaveCount(2)

  await expect.poll(() => methods(crit).filter(method => method === 'finish')).toHaveLength(2)
  const sent = sentComments(crit)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual({
    startLine: 20,
    endLine: 20,
    quote: 'BROKEN',
    body: "[Build error] slide 4, line 20: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1\n= help: use a layout with a body slot or remove one paragraph\nFix the deck so `peitho build` passes, then reply.",
    author: 'Peitho Studio',
  })
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(2)
})

test('Given an error was sent and the deck then built, when it breaks the same way again, then the error is sent again', async ({ page }) => {
  const crit = createFakeCritIpc()
  const deck = await open(page, brokenDeck(crit))
  await expect.poll(() => methods(crit)).toContain('finish')
  crit.agentConnects()

  await changeOnDisk(page, deck, SOURCE.replace('BROKEN', 'Fixed outside'))
  await expect(page.locator(ERROR_BADGE)).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(methods(crit).filter(method => method === 'finish')).toHaveLength(1)

  await changeOnDisk(page, deck, SOURCE)
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)
  await expect.poll(() => methods(crit).filter(method => method === 'finish')).toHaveLength(2)
  expect(sentComments(crit)).toEqual([SLIDE_TWO_COMMENT, SLIDE_TWO_COMMENT])
})

test('Given the agent is at work, when the broken slide is fixed in the editor but the save fails, then the error on disk still goes when the agent comes to wait', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'working' })
  const deck = await open(page, brokenDeck(crit, { commandError: cmd => (cmd === 'save_deck_source' ? 'disk full' : null) }))
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)
  await expect.poll(() => editorText(page)).toBe('# Two\n\nBROKEN')

  // The draft renders — every slide, no ERROR row — but never lands.
  await fillEditor(page, '# Two\n\nFixed')
  await expect(page.locator(ERROR_BADGE)).toHaveCount(0)
  await expect(page.locator(ERROR_BAR)).toContainText('disk full')
  expect(deck.source).toBe(SOURCE)

  crit.agentConnects()

  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([SLIDE_TWO_COMMENT])
})

test('Given the user wrote a comment but did not send it, when the agent comes to wait, then the build error goes alone and the comment stays unsent', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'working' })
  await open(page, brokenDeck(crit))
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('One')
  await page.locator(`${PREVIEW} h1`).click({ button: 'right' })
  await page.locator('[data-slide-menu-item="comment"]').click()
  await page.locator('[data-comment-box] textarea').fill('Make it bigger')
  await page.locator('[data-comment-add]').click()
  await expect(page.locator('[data-review-row="unsent-comment"]')).toHaveCount(1)

  crit.agentConnects()

  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([SLIDE_TWO_COMMENT])
  await expect(page.locator('[data-review-row="unsent-comment"]')).toHaveCount(1)
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
})

test('Given crit refused the comment once, when the deck changes on disk with the same error, then the error is sent then', async ({ page }) => {
  const crit = createFakeCritIpc()
  let refusals = 0
  const invoked: string[] = []
  const deck = await open(page, brokenDeck(crit, { invokedCommands: invoked, commandError: cmd => (cmd === 'crit_add_comments' && refusals++ === 0 ? 'the review file is locked' : null) }))
  await expect(page.locator('[data-review-error]')).toContainText('the review file is locked')
  await page.waitForTimeout(300)
  expect(invoked.filter(cmd => cmd === 'crit_add_comments')).toHaveLength(1)
  expect(methods(crit)).not.toContain('finish')

  // A blank line at the end: the same error, on the same line.
  await changeOnDisk(page, deck, `${SOURCE}\n`)

  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([SLIDE_TWO_COMMENT])
  await expect(page.locator(STATUS)).toHaveText('Sent the build error to the AI.')
  await expect(page.locator('[data-review-error]')).toBeHidden()
})

test('Given crit refused the comment once, when the agent comes to wait again after the user\'s own round, then the error is sent then', async ({ page }) => {
  const crit = createFakeCritIpc()
  let refusals = 0
  const invoked: string[] = []
  await open(page, brokenDeck(crit, { invokedCommands: invoked, commandError: cmd => (cmd === 'crit_add_comments' && refusals++ === 0 ? 'the review file is locked' : null) }))
  await expect(page.locator('[data-review-error]')).toContainText('the review file is locked')
  await page.waitForTimeout(300)
  expect(invoked.filter(cmd => cmd === 'crit_add_comments')).toHaveLength(1)

  // The user's own comment goes, finishing the round — which is not the
  // agent coming again: the held error isn't sent with it.
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('One')
  await page.locator(`${PREVIEW} h1`).click({ button: 'right' })
  await page.locator('[data-slide-menu-item="comment"]').click()
  await page.locator('[data-comment-box] textarea').fill('Make it bigger')
  await page.locator('[data-comment-add]').click()
  await page.locator('[data-review-send]').click()
  await expect.poll(() => methods(crit)).toContain('finish')
  await expect(page.locator('[data-review-send]')).toHaveAttribute('data-review-send-state', 'thinking')
  expect(sentComments(crit).map(comment => comment.body)).toEqual(['[Slide 1 › heading "One"] Make it bigger'])

  crit.agentConnects()

  await expect.poll(() => methods(crit).filter(method => method === 'finish')).toHaveLength(2)
  expect(sentComments(crit).map(comment => comment.body)).toEqual(['[Slide 1 › heading "One"] Make it bigger', SLIDE_TWO_COMMENT.body])
  await expect(page.locator(STATUS)).toHaveText('Sent the build error to the AI.')
})

test('Given crit refuses the comment, then the review panel shows the failure, the round is not finished, and nothing is retried on its own', async ({ page }) => {
  const crit = createFakeCritIpc()
  const invoked: string[] = []
  await open(page, brokenDeck(crit, { invokedCommands: invoked, commandError: cmd => (cmd === 'crit_add_comments' ? 'the review file is locked' : null) }))

  await expect(page.locator('[data-review-error]')).toBeVisible()
  await expect(page.locator('[data-review-error]')).toContainText('the review file is locked')
  await page.waitForTimeout(500)
  expect(invoked.filter(cmd => cmd === 'crit_add_comments')).toHaveLength(1)
  expect(methods(crit)).not.toContain('finish')
  await expect(page.locator(STATUS)).not.toHaveText('Sent the build error to the AI.')
})
