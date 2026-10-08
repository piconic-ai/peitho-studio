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
import { emitLayoutFilesChanged, mockTauri, slotErrorAt, type MockDeck } from './helpers/mockTauri'
import { editorText, fillEditor, moveToEditorEnd } from './helpers/codeEditor'

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

test('Given slide 2 was edited into text that still does not build, when New Slide is chosen on another row, then nothing is saved — the refused typing is not written by the way', async ({ page }) => {
  const deck = await open(page, brokenDeck())
  await expect.poll(() => editorText(page)).toBe('# Two\n\nBROKEN')
  await fillEditor(page, '# Two\n\nNew invalid BROKEN content')
  await expect(page.locator(ERROR_BAR)).toContainText("slide 2 ('two'), line 8", { timeout: 5_000 })
  await page.waitForTimeout(1_000)
  expect(deck.source).toBe(SOURCE)

  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByText('New Slide', { exact: true }).click()

  // The insertion carries slide 2's typing, which doesn't build: refused
  // as a whole, with the error naming slide 2 at its new row.
  await expect(page.locator(ERROR_BAR)).toContainText("slide 3 ('two')", { timeout: 5_000 })
  await page.waitForTimeout(1_000)
  expect(deck.source).toBe(SOURCE)
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
})

test('Given slide 2 is isolated, when a heading of slide 3 is edited on the canvas, then the edit lands in slide 3\'s own text', async ({ page }) => {
  const deck = await open(page, brokenDeck({ editAnnotations: true }))
  await page.locator('[data-slide-row="2"]').click()
  await expect(page.locator('[data-preview-host] h1')).toHaveText('Three')

  // The annotations were rendered from a copy with slide 2 marked draft;
  // they still point at slide 3's text in the deck as written.
  await page.locator('[data-preview-host] h1').dblclick()
  const field = page.locator('[data-preview-host] [data-studio-edit]')
  await expect(field).toHaveText('Three')
  await field.fill('Third')
  await field.press('Meta+Enter')

  await expect.poll(() => editorText(page)).toBe('# Third')
  await expect.poll(() => deck.source).toContain('# Third\n')
  expect(deck.source).toContain('<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n')
  expect(deck.source).not.toContain('draft')
})

test('Given slide 2 is isolated after multibyte text and a section it starts, when a heading of slide 3 is edited on the canvas, then the edit still lands in slide 3', async ({ page }) => {
  const source = '---\ntime: 3m\n---\n# 日本語の一枚目\n\n---\n\n<!-- {"key":"two","section":"壊れた節","time":"1m"} -->\n# Two\n\nBROKEN\n\n---\n\n<!-- {"section":"B","time":"2m"} -->\n# Three\n'
  const deck = await open(page, brokenDeck({ source, editAnnotations: true }))
  await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
  await page.locator('[data-slide-row="2"]').click()
  await expect(page.locator('[data-preview-host] h1')).toHaveText('Three')

  await page.locator('[data-preview-host] h1').dblclick()
  const field = page.locator('[data-preview-host] [data-studio-edit]')
  await expect(field).toHaveText('Three')
  await field.fill('三枚目')
  await field.press('Meta+Enter')

  await expect.poll(() => editorText(page)).toBe('# 三枚目')
  await expect.poll(() => deck.source).toContain('# 三枚目\n')
  expect(deck.source).toContain('time: 3m')
  expect(deck.source).toContain('"section":"壊れた節","time":"1m"')
  expect(deck.source).not.toContain('draft')
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

// --- Renders other than a save's while a slide is isolated ---

const SLIDE_TWO_HELP = 'use a layout with a body slot'

function renders(deck: MockDeck): number {
  return (deck.invokedCommands ?? []).filter(cmd => cmd === 'render_draft').length
}

test('Given slide 2 is isolated, when slide 3 is typed in, then the preview follows the typing around slide 2 before any save, with no error flashed for slide 2', async ({ page }) => {
  await open(page, brokenDeck())
  await page.locator('[data-slide-row="2"]').click()
  await expect.poll(() => editorText(page)).toBe('# Three')

  await fillEditor(page, '# Three typed')
  // The fast lane renders a beat after typing (80ms); the save, which
  // would render too, waits 600ms. Well before it, the preview shows the
  // typing — rendered without slide 2 from the start — and the error bar
  // never showed slide 2's refusal of the draft.
  await expect(page.locator('[data-preview-host] h1')).toHaveText('Three typed', { timeout: 400 })
  await expect(page.locator(ERROR_BAR)).not.toContainText(SLIDE_TWO_HELP)
  await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
  await expect(page.locator(ERROR_BAR)).toContainText("1 slide doesn't build")
})

test('Given slide 2 is isolated, when a layout file changes on disk, then the deck renders again around it, with no error flashed for slide 2', async ({ page }) => {
  const deck = await open(page, brokenDeck({ layoutFilesStamp: 'v1', invokedCommands: [] }))
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(2)
  const before = renders(deck)

  deck.layoutFilesStamp = 'v2'
  await emitLayoutFilesChanged(page)

  await expect.poll(() => renders(deck)).toBeGreaterThan(before)
  await page.waitForTimeout(500)
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(2)
  await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
  await expect(page.locator(ERROR_BAR)).toContainText("1 slide doesn't build")
  await expect(page.locator(ERROR_BAR)).not.toContainText(SLIDE_TWO_HELP)
})

test('Given slide 2 is isolated, when a layout file changes so that it builds, then it renders and its badge goes', async ({ page }) => {
  let refuses = true
  const deck = await open(page, brokenDeck({
    layoutFilesStamp: 'v1',
    renderError: content => (refuses ? slotErrorAt('BROKEN')(content) : null),
  }))
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)

  refuses = false
  deck.layoutFilesStamp = 'v2'
  await emitLayoutFilesChanged(page)

  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3, { timeout: 5_000 })
  await expect(page.locator(ERROR_BADGE)).toHaveCount(0)
  await expect(page.locator(ERROR_BAR)).toBeHidden()
})

test('Given the opening render is still in flight, when typing is taken back to the saved text before it lands, then the deck still renders — the render superseded by the typing is not the one waited on', async ({ page }) => {
  await open(page, brokenDeck({ renderDraftDelayMs: 1_000 }))
  await expect.poll(() => editorText(page)).toBe('# Two\n\nBROKEN')

  await moveToEditorEnd(page)
  await page.keyboard.type('x')
  await page.waitForTimeout(200)
  await page.keyboard.press('Backspace')

  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(2, { timeout: 10_000 })
  await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
})

test('Given a keyless slide 3 is isolated, when a `---` typed into slide 1 splits it in two, then the save goes through and the ERROR row follows slide 3 down', async ({ page }) => {
  const deck = await open(page, brokenDeck({ source: '# One\n\n---\n\n# Two\n\n---\n\n# Three\n\nBROKEN\n' }))
  await expect(page.locator('[data-slide-row="2"]').locator(ERROR_BADGE)).toBeVisible()
  await page.locator('[data-slide-row="0"]').click()
  await expect.poll(() => editorText(page)).toBe('# One')

  await fillEditor(page, '# One\n\n---\n\n# One and a half')

  await expect.poll(() => deck.source).toContain('# One and a half')
  expect(deck.source).not.toContain('draft')
  await expect(page.locator('[data-slide-row]')).toHaveCount(4)
  await expect(page.locator('[data-slide-row="3"]').locator(ERROR_BADGE)).toBeVisible()
  await expect(page.locator(ERROR_BADGE)).toHaveCount(1)
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3)
})

