// A deck with a slide peitho-core refuses still renders every other slide
// (todo/isolate-broken-slides.md): the broken slide is isolated — rendered
// as a draft, in memory only — and shows in the list as a placeholder with
// an ERROR badge, its error in the preview pane when selected, and the
// error bar counting the slides left out. The rest of the deck stays
// editable and saveable around it; the `draft` mark never reaches disk.
// `slotErrorAt` stands in for peitho-core's slot check (which never blames
// a draft slide); the same flow against the real engine is
// `real-engine-isolate-broken-slides.e2e.ts`.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, slotErrorAt, type MockDeck } from './helpers/mockTauri'
import { editorText, fillEditor } from './helpers/codeEditor'

const ERROR_BAR = '.bg-destructive\\/10'
const PREVIEW_ERROR = '[data-preview-build-error]'
const THUMBNAIL_CANVAS = '[data-slide-row] [data-slide-canvas-key]'
const SELECTED = '.border-\\[\\#eab308\\]'
const ERROR_BADGE = '[data-slide-status="error"]'

const SOURCE = '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n'
const SLIDE_TWO_HEADLINE = "slide 2 ('two'), line 8: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1"

function brokenDeck(overrides: Partial<MockDeck> = {}): MockDeck {
  return { source: SOURCE, deckPath: '/decks/broken/deck.md', renderError: slotErrorAt('BROKEN'), ...overrides }
}

async function open(page: Page, deck: MockDeck, rows = 3): Promise<MockDeck> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(rows, { timeout: 10_000 })
  return deck
}

test('Given a deck whose slide 2 does not build, when it is opened, then the other slides render and slide 2 is an ERROR row with its error in the preview and the error bar', async ({ page }) => {
  await open(page, brokenDeck())

  // The two slides that build have thumbnails; slide 2 is a placeholder
  // wearing ERROR, and is the one selected (the error named it).
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(2)
  const row = page.locator('[data-slide-row="1"]')
  await expect(row.locator(ERROR_BADGE)).toBeVisible()
  expect(await row.locator(ERROR_BADGE).evaluate(el => (el as HTMLElement).innerText)).toBe('ERROR')
  await expect(page.locator('[data-slide-row="0"] [data-slide-status]')).toHaveCount(0)
  await expect(page.locator('[data-slide-row="2"] [data-slide-status]')).toHaveCount(0)
  await expect(row.locator(SELECTED)).toBeVisible()
  await expect.poll(() => editorText(page)).toBe('# Two\n\nBROKEN')

  // The preview pane shows this slide's error — about the slide, not the
  // deck — and the error bar counts the slides left out.
  const previewError = page.locator(PREVIEW_ERROR)
  await expect(previewError).toBeVisible()
  await expect(previewError).toHaveAttribute('data-preview-build-error-scope', 'slide')
  await expect(previewError).toContainText("This slide doesn't build")
  await expect(previewError).toContainText(SLIDE_TWO_HEADLINE)
  await expect(previewError).toContainText('use a layout with a body slot')
  await expect(page.locator(ERROR_BAR)).toContainText(`1 slide doesn't build: ${SLIDE_TWO_HEADLINE}`)
})

test('non-functional: Given a deck with one broken slide, when it is opened, then isolating it costs two renders past open_deck\'s own — the refusal and the one without the slide', async ({ page }) => {
  const invoked: string[] = []
  await open(page, brokenDeck({ invokedCommands: invoked }))
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)
  await page.waitForTimeout(500)
  expect(invoked.filter(cmd => cmd === 'render_draft')).toHaveLength(2)
})

test('Given a broken slide is isolated, when another slide is selected, then its preview shows and the error pane goes', async ({ page }) => {
  await open(page, brokenDeck())
  await expect(page.locator(PREVIEW_ERROR)).toBeVisible()

  await page.locator('[data-slide-row="2"]').click()
  await expect(page.locator('[data-preview-host] h1')).toHaveText('Three')
  await expect(page.locator(PREVIEW_ERROR)).toBeHidden()
  // The error bar keeps counting, whichever slide is open.
  await expect(page.locator(ERROR_BAR)).toContainText("1 slide doesn't build")
})

test('Given two slides do not build, when the deck is opened, then both are isolated, within the limit', async ({ page }) => {
  const deck = await open(page, brokenDeck({
    source: '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n\n---\n\n# Four\n\nBROKEN\n',
  }), 4)
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(2)
  await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
  await expect(page.locator('[data-slide-row="3"]').locator(ERROR_BADGE)).toBeVisible()
  await expect(page.locator(ERROR_BAR)).toContainText(`2 slides don't build: ${SLIDE_TWO_HEADLINE}`)
  // Isolation is in memory: the file still carries no draft mark.
  expect(deck.source).not.toContain('draft')
})

test('Given more slides do not build than the isolation limit, when the deck is opened, then isolation gives up and the deck opens without a render', async ({ page }) => {
  const slides = Array.from({ length: 7 }, (_, i) => `# Slide ${String(i + 1)}\n\nBROKEN\n`)
  await open(page, brokenDeck({ source: slides.join('\n---\n\n') }), 7)
  await expect(page.locator(PREVIEW_ERROR)).toHaveAttribute('data-preview-build-error-scope', 'deck')
  await expect(page.locator(PREVIEW_ERROR)).toContainText("This deck doesn't build yet")
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(0)
  await expect(page.locator(ERROR_BADGE)).toHaveCount(0)
})

test('Given slide 2 is isolated, when slide 3 is edited and saved, then it saves as written — no draft mark on disk — and slide 2 stays an ERROR row', async ({ page }) => {
  const deck = await open(page, brokenDeck())
  await page.locator('[data-slide-row="2"]').click()
  await expect.poll(() => editorText(page)).toBe('# Three')

  await fillEditor(page, '# Three\n\nEdited')

  await expect.poll(() => deck.source).toContain('# Three\n\nEdited')
  // The broken slide is saved exactly as it was: no draft mark, nothing
  // of the isolation reaches the file.
  expect(deck.source).toContain('<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n')
  expect(deck.source).not.toContain('draft')
  await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(2)
  await expect(page.locator('[data-preview-host] h1')).toHaveText('Three')
  // Saved, and the error bar still counts the slide left out.
  await expect(page.locator('footer')).toContainText('Saved')
  await expect(page.locator(ERROR_BAR)).toContainText("1 slide doesn't build")
})

test('Given slide 2 is isolated, when editing slide 3 breaks it too, then that save is blocked and the error names slide 3', async ({ page }) => {
  const deck = await open(page, brokenDeck())
  await page.locator('[data-slide-row="2"]').click()
  await expect.poll(() => editorText(page)).toBe('# Three')

  await fillEditor(page, '# Three\n\nBROKEN')

  await expect(page.locator(ERROR_BAR)).toContainText('slide 3, line', { timeout: 5_000 })
  await page.waitForTimeout(1_500)
  expect(deck.source).toBe(SOURCE)
  // Slide 2 is still the only isolated one; slide 3 keeps its last render.
  await expect(page.locator('[data-slide-row="2"]').locator(ERROR_BADGE)).toHaveCount(0)
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(2)
})

test('Given slide 2 is isolated, when it is fixed and saved, then its badge goes, it renders, and the error bar clears', async ({ page }) => {
  const deck = await open(page, brokenDeck())
  await expect.poll(() => editorText(page)).toBe('# Two\n\nBROKEN')

  await fillEditor(page, '# Two\n\nFixed')

  await expect.poll(() => deck.source).toContain('# Two\n\nFixed')
  expect(deck.source).not.toContain('draft')
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3)
  await expect(page.locator(ERROR_BADGE)).toHaveCount(0)
  await expect(page.locator('[data-preview-host] h1')).toHaveText('Two')
  await expect(page.locator(ERROR_BAR)).toBeHidden()
  await expect(page.locator(PREVIEW_ERROR)).toBeHidden()
})

test('Given slide 2 is isolated, when its edit still does not build, then nothing is saved and the error bar shows the new error', async ({ page }) => {
  const deck = await open(page, brokenDeck())
  await expect.poll(() => editorText(page)).toBe('# Two\n\nBROKEN')

  await fillEditor(page, '# Two\n\nStill BROKEN')

  await expect(page.locator(ERROR_BAR)).toContainText("slide 2 ('two'), line 8", { timeout: 5_000 })
  await page.waitForTimeout(1_500)
  expect(deck.source).toBe(SOURCE)
  await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
})

test('Given slide 2 is isolated, when a slide is inserted above it, then the save goes through and the ERROR row follows the slide', async ({ page }) => {
  const deck = await open(page, brokenDeck())
  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByText('New Slide', { exact: true }).click()

  await expect(page.locator('[data-slide-row]')).toHaveCount(4)
  await expect.poll(() => deck.source).toContain('# New Slide')
  expect(deck.source).not.toContain('draft')
  await expect(page.locator('[data-slide-row="2"]').locator(ERROR_BADGE)).toBeVisible()
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3)
})

test('Given slide 2 is isolated, when the file changes on disk with slide 2 fixed, then the badge goes and it renders', async ({ page }) => {
  const deck = await open(page, brokenDeck())
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)

  deck.source = SOURCE.replace('BROKEN', 'Fixed outside')
  await page.evaluate(() => {
    (window as unknown as { __mockEmitTauriEvent?: (event: string, payload: unknown) => void }).__mockEmitTauriEvent?.('deck-file-changed', null)
  })

  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3, { timeout: 5_000 })
  await expect(page.locator(ERROR_BADGE)).toHaveCount(0)
  await expect(page.locator(ERROR_BAR)).toBeHidden()
})
