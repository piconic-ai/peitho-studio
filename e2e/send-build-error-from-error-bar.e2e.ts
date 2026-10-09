// The error bar's button on a build error sends it to the agent waiting in
// crit (todo/send-build-error-from-error-bar.md), and a build error stays
// in the bar until it is fixed or sent. Typing that doesn't build is
// written to disk first — the slide being edited isolated, as
// isolate-broken-slides.e2e.ts has it, or the whole text as written when
// nothing can be isolated — since the agent can only fix what is in
// deck.md. The comment itself and the round are
// auto-report-build-error.e2e.ts's: the same `[Build error]` comment,
// sent by the disk's render of what was just written. crit is
// `ipc/fakeCritIpc.ts`.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, slotErrorAt, type MockDeck } from './helpers/mockTauri'
import { editorText, fillEditor } from './helpers/codeEditor'
import { createFakeCritIpc, type FakeCritIpc } from '../ipc/fakeCritIpc'
import type { NewReviewComment } from '../domain/critReview'
import type { RenderErrorPayload } from '../domain/render'

const SOURCE = '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nFine\n\n---\n\n# Three\n'
const BROKEN_TWO = '# Two\n\nBROKEN'
const SLIDE_TWO_MESSAGE = "slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1"
/** The `[Build error]` comment for slide 2 with `BROKEN` on `line` of
 * deck.md: line 8 as `SOURCE` is written, line 7 once the slide editor
 * saved the slide (`replaceSlideText` lays the slide out its own way). */
function slideTwoComment(line: number): NewReviewComment {
  return {
    startLine: line,
    endLine: line,
    quote: 'BROKEN',
    body: `[Build error] slide 2 ('two'), line ${String(line)}: ${SLIDE_TWO_MESSAGE}\n= help: use a layout with a body slot or remove one paragraph\nFix the deck so \`peitho build\` passes, then reply.`,
    author: 'Peitho Studio',
  }
}

const FRONTMATTER_SOURCE = '---\nfontss: x\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n'
const FRONTMATTER_ERROR: RenderErrorPayload = {
  kind: 'Parse',
  line: 2,
  originFile: null,
  message: 'invalid deck frontmatter: unknown field `fontss`',
  help: 'use only the supported deck frontmatter keys',
  headline: 'line 2: invalid deck frontmatter: unknown field `fontss`',
  slide: null,
}

const STATUS = 'footer'
const ERROR_BAR = '.bg-destructive\\/10'
const SEND = '[data-error-action="send"]'
const COPY = '[data-error-action="copy"]'
const ERROR_BADGE = '[data-slide-status="error"]'
const THUMBNAIL_CANVAS = '[data-slide-row] [data-slide-canvas-key]'
const SOURCE_TOGGLE = '[data-source-toggle]'

function deckWith(crit: FakeCritIpc, overrides: Partial<MockDeck> = {}): MockDeck {
  return { source: SOURCE, deckPath: '/decks/talk/deck.md', renderError: slotErrorAt('BROKEN'), editAnnotations: true, crit, ...overrides }
}

async function open(page: Page, deck: MockDeck): Promise<MockDeck> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })
  return deck
}

function methods(crit: FakeCritIpc): string[] {
  return crit.calls.map(call => call.method)
}

function sentComments(crit: FakeCritIpc): NewReviewComment[] {
  return crit.calls.filter(call => call.method === 'addComments').flatMap(call => call.args[0] as NewReviewComment[])
}

/** Opens slide 2 and types text that doesn't build: the save is refused
 * and the bar shows why, with the deck on disk untouched. */
async function breakSlideTwo(page: Page, deck: MockDeck): Promise<void> {
  await page.locator('[data-slide-row="1"]').click()
  await expect.poll(() => editorText(page)).toBe('# Two\n\nFine')
  await fillEditor(page, BROKEN_TWO)
  await expect(page.locator(ERROR_BAR)).toContainText(`slide 2 ('two'), line`)
  await expect(page.locator(ERROR_BAR)).toContainText(SLIDE_TWO_MESSAGE)
  await page.waitForTimeout(800)
  expect(deck.source).toBe(SOURCE)
}

test('Given typing that does not build, when nothing is done for longer than the error bar\'s usual timeout, then the error is still there — and goes once the typing builds', async ({ page }) => {
  const deck = await open(page, deckWith(createFakeCritIpc()))
  await breakSlideTwo(page, deck)

  await page.waitForTimeout(6_500)
  await expect(page.locator(ERROR_BAR)).toBeVisible()
  await expect(page.locator(ERROR_BAR)).toContainText(SLIDE_TWO_MESSAGE)
  await expect(page.locator(SEND)).toBeVisible()
  await expect(page.locator(COPY)).toBeHidden()

  await fillEditor(page, '# Two\n\nFixed')
  await expect(page.locator(ERROR_BAR)).toBeHidden()
  await expect.poll(() => deck.source).toContain('# Two\n\nFixed')
})

test('Given an agent waiting and typing that does not build, when the error is sent, then the slide is saved broken, the error is commented on its line, and the round is finished — once', async ({ page }) => {
  const crit = createFakeCritIpc()
  const deck = await open(page, deckWith(crit))
  await breakSlideTwo(page, deck)
  expect(methods(crit)).not.toContain('addComments')

  await page.locator(SEND).click()

  // Written as typed, isolated: the other slides render, the broken one
  // wears the badge, and nothing is left unsaved in the editor.
  await expect.poll(() => deck.source).toContain(BROKEN_TWO)
  await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
  await expect.poll(() => editorText(page)).toBe(BROKEN_TWO)

  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([slideTwoComment(7)])
  expect(methods(crit).indexOf('addComments')).toBeLessThan(methods(crit).indexOf('finish'))
  await expect(page.locator(STATUS)).toHaveText('Sent the build error to the agent.')
  await page.waitForTimeout(500)
  expect(methods(crit).filter(method => method === 'finish')).toHaveLength(1)

  // The error stays shown, as the deck's own now, with the button still
  // there for another send.
  await expect(page.locator(ERROR_BAR)).toContainText("1 slide doesn't build")
  await expect(page.locator(SEND)).toBeVisible()
  await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
  await expect(page.locator('[data-review-row="unsent-comment"]')).toHaveCount(0)
})

test('Given no agent waiting, when the error is sent, then it is written and waits, the status bar says so, and it goes when the agent comes', async ({ page }) => {
  const crit = createFakeCritIpc({ session: 'working' })
  const deck = await open(page, deckWith(crit))
  await breakSlideTwo(page, deck)

  await page.locator(SEND).click()

  await expect.poll(() => deck.source).toContain(BROKEN_TWO)
  await expect(page.locator(STATUS)).toHaveText('Waiting for an agent to send the build error to.')
  await page.waitForTimeout(300)
  expect(methods(crit)).not.toContain('addComments')

  crit.agentConnects()

  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([slideTwoComment(7)])
  await expect(page.locator(STATUS)).toHaveText('Sent the build error to the agent.')
})

test('Given the deck on disk was reported already, when the user sends its error again, then the same error goes once more', async ({ page }) => {
  const crit = createFakeCritIpc()
  await open(page, deckWith(crit, { source: SOURCE.replace('# Two\n\nFine', BROKEN_TWO) }))
  // The deck opened broken: auto-reported, like auto-report-build-error.e2e.ts.
  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toEqual([slideTwoComment(8)])
  await expect(page.locator(ERROR_BAR)).toContainText("1 slide doesn't build")

  // The agent's next round: it waits again, with the deck unchanged — the
  // report of its own sends nothing more.
  crit.agentConnects()
  await page.waitForTimeout(500)
  expect(sentComments(crit)).toHaveLength(1)

  await page.locator(SEND).click()

  await expect.poll(() => sentComments(crit)).toEqual([slideTwoComment(8), slideTwoComment(8)])
  await expect.poll(() => methods(crit).filter(method => method === 'finish')).toHaveLength(2)
  await expect(page.locator(STATUS)).toHaveText('Sent the build error to the agent.')
})

test('Given a frontmatter error typed in the deck source editor, when it is sent, then the text is written as it is and the error goes to the agent', async ({ page }) => {
  const crit = createFakeCritIpc()
  const deck = await open(page, deckWith(crit, {
    source: FRONTMATTER_SOURCE,
    renderError: content => (content.includes('fontss') ? FRONTMATTER_ERROR : null),
  }))
  // Opened broken: reported once. The agent then waits for its next round.
  await expect.poll(() => methods(crit)).toContain('finish')
  expect(sentComments(crit)).toHaveLength(1)
  crit.agentConnects()

  await page.locator(SOURCE_TOGGLE).click()
  await expect(page.locator('[data-editor="source"]')).toBeVisible()
  // Still broken, differently written: the save is refused, the text stays.
  const retyped = FRONTMATTER_SOURCE.replace('fontss: x', 'fontss: y')
  await fillEditor(page, retyped, 'source')
  await page.waitForTimeout(1_300)
  expect(deck.source).toBe(FRONTMATTER_SOURCE)
  await expect(page.locator(ERROR_BAR)).toContainText('unknown field `fontss`')
  await expect(page.locator(SEND)).toBeVisible()

  await page.locator(SEND).click()

  await expect.poll(() => deck.source).toBe(retyped)
  await expect.poll(() => sentComments(crit)).toHaveLength(2)
  expect(sentComments(crit)[1]).toMatchObject({ startLine: 2, endLine: 2, quote: 'fontss: y' })
  expect(sentComments(crit)[1].body).toContain('[Build error] line 2: invalid deck frontmatter')
  await expect(page.locator(STATUS)).toHaveText('Sent the build error to the agent.')
  // The deck on disk doesn't build at all now: no thumbnails, the source
  // editor still offered.
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(0)
  await expect(page.locator(SOURCE_TOGGLE)).toBeVisible()
})

test('Given an error that is not a build error, then the bar still offers to copy it', async ({ page }) => {
  const deck = await open(page, deckWith(createFakeCritIpc(), { commandError: cmd => (cmd === 'present_deck' ? 'simulated present_deck failure' : null) }))
  await page.getByRole('button', { name: 'Present', exact: true }).click()
  await expect(page.locator(ERROR_BAR)).toContainText('simulated present_deck failure')
  await expect(page.locator(COPY)).toBeVisible()
  await expect(page.locator(SEND)).toBeHidden()
  expect(deck.source).toBe(SOURCE)
})
