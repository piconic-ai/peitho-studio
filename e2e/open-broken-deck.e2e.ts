// A deck peitho-core refuses to build (a slot violation, an unknown
// frontmatter key — written by an agent or another editor, or an old deck
// a newer peitho rejects) opens in the editor all the same, from its
// source alone: the error bar and the preview pane show peitho-core's
// error until a fixed source renders (todo/open-broken-deck.md). The mock
// stands in for peitho-core with `renderError`, the structured refusal
// `open_deck`/`render_draft` answer; the same flow against the real
// engine is `real-engine-open-broken-deck.e2e.ts`.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorText, fillEditor } from './helpers/codeEditor'
import type { RenderErrorPayload } from '../domain/render'

const ERROR_BAR = '.bg-destructive\\/10'
const PREVIEW_ERROR = '[data-preview-build-error]'
const THUMBNAIL_CANVAS = '[data-slide-row] [data-slide-canvas-key]'
const SELECTED_ROW = '[data-slide-row] .border-\\[\\#eab308\\]'

const SOURCE = '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n'

const SLIDE_TWO_ERROR: RenderErrorPayload = {
  kind: 'Arity',
  line: 8,
  originFile: null,
  message: "slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  help: 'use a layout with a body slot or remove one paragraph',
  headline: "slide 2 ('two'), line 8: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  slide: { number: 2, key: 'two' },
}

const FRONTMATTER_ERROR: RenderErrorPayload = {
  kind: 'Parse',
  line: 2,
  originFile: null,
  message: 'invalid deck frontmatter: unknown field `fontss`',
  help: 'use only the supported deck frontmatter keys',
  headline: 'line 2: invalid deck frontmatter: unknown field `fontss`',
  slide: null,
}

async function openBroken(page: Page, deck: MockDeck): Promise<MockDeck> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })
  return deck
}

function brokenDeck(overrides: Partial<MockDeck> = {}): MockDeck {
  return {
    source: SOURCE,
    deckPath: '/decks/broken/deck.md',
    renderError: content => (content.includes('BROKEN') ? SLIDE_TWO_ERROR : null),
    ...overrides,
  }
}

test('Given a deck peitho-core refuses, when it is opened, then the editor opens on its source with the broken slide selected and the error shown', async ({ page }) => {
  await openBroken(page, brokenDeck())

  // The editor, not the welcome screen, with the deck's path in the header.
  await expect(page.getByText('Peitho Studio', { exact: true })).toHaveCount(0)
  await expect(page.getByText('/decks/broken/deck.md', { exact: true })).toBeVisible()

  // Every slide of the source is listed — as a placeholder, nothing having
  // rendered — and the slide the error names is the one open for editing.
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(0)
  await expect(page.locator('[data-slide-row="1"]').locator(SELECTED_ROW.replace('[data-slide-row] ', ''))).toBeVisible()
  await expect.poll(() => editorText(page)).toBe('# Two\n\nBROKEN')

  // peitho-core's error — its headline and help — in the error bar and,
  // with no slide to preview, in the preview pane.
  const errorBar = page.locator(ERROR_BAR)
  await expect(errorBar).toBeVisible()
  await expect(errorBar).toContainText(SLIDE_TWO_ERROR.headline)
  await expect(errorBar).toContainText(SLIDE_TWO_ERROR.help)
  const previewError = page.locator(PREVIEW_ERROR)
  await expect(previewError).toBeVisible()
  await expect(previewError).toContainText(SLIDE_TWO_ERROR.headline)
  await expect(previewError).toContainText(SLIDE_TWO_ERROR.help)
  await expect(previewError).toContainText("This deck doesn't build yet")
})

test('Given a broken deck is open, when nothing is done for longer than the error bar\'s usual timeout, then the error is still there', async ({ page }) => {
  await openBroken(page, brokenDeck())
  await expect(page.locator(ERROR_BAR)).toBeVisible()

  // The transient-error timer is 6 seconds; a deck that doesn't build has
  // nothing else to show, so its error stays.
  await page.waitForTimeout(6_500)
  await expect(page.locator(ERROR_BAR)).toBeVisible()
  await expect(page.locator(ERROR_BAR)).toContainText(SLIDE_TWO_ERROR.headline)
  await expect(page.locator(PREVIEW_ERROR)).toBeVisible()
})

test('Given a broken deck is open, when the broken slide is fixed in the editor and saved, then the deck renders and the error goes away', async ({ page }) => {
  const deck = await openBroken(page, brokenDeck())
  await expect(page.locator(ERROR_BAR)).toBeVisible()

  await fillEditor(page, '# Two\n\nFixed')

  // The save went through (the render passed), every slide now has a
  // thumbnail, the open slide a preview, and no error is shown anywhere.
  await expect.poll(() => deck.source).toContain('# Two\n\nFixed')
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3)
  await expect(page.locator('[data-preview-host] h1')).toHaveText('Two')
  await expect(page.locator(ERROR_BAR)).toBeHidden()
  await expect(page.locator(PREVIEW_ERROR)).toBeHidden()
})

test('Given a broken deck is open, when a fix leaves another slide broken, then nothing is saved and the error bar shows the new error', async ({ page }) => {
  const slideThreeError: RenderErrorPayload = {
    ...SLIDE_TWO_ERROR,
    line: 13,
    headline: "slide 3, line 13: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
    slide: { number: 3, key: null },
  }
  const deck = await openBroken(page, brokenDeck({
    source: '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n\nSTILL\n',
    renderError: content => (content.includes('BROKEN') ? SLIDE_TWO_ERROR : content.includes('STILL') ? slideThreeError : null),
  }))
  await expect(page.locator(ERROR_BAR)).toContainText("slide 2 ('two')")

  await fillEditor(page, '# Two\n\nFixed')

  // The save is blocked (as any save of a draft that doesn't build is),
  // and the error bar names what is still wrong — slide 3 now.
  await expect(page.locator(ERROR_BAR)).toContainText('slide 3, line 13', { timeout: 5_000 })
  await expect(page.locator(ERROR_BAR)).not.toContainText("slide 2 ('two')")
  expect(deck.source).toContain('BROKEN')
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(0)
  // Not a transient error either: it stays past the timer.
  await page.waitForTimeout(6_500)
  await expect(page.locator(ERROR_BAR)).toContainText('slide 3, line 13')
})

test('Given a deck whose frontmatter peitho-core refuses (no slide to blame), when it is opened, then the first slide is open and the error shows', async ({ page }) => {
  await openBroken(page, brokenDeck({
    source: '---\nfontss: x\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n',
    renderError: content => (content.includes('fontss') ? FRONTMATTER_ERROR : null),
  }))

  await expect(page.locator('[data-slide-row="0"]').locator(SELECTED_ROW.replace('[data-slide-row] ', ''))).toBeVisible()
  await expect(page.locator(ERROR_BAR)).toContainText('line 2: invalid deck frontmatter')
  await expect(page.locator(PREVIEW_ERROR)).toContainText('unknown field `fontss`')
})

test('Given a broken deck is open, when the Recent Decks list is read, then the deck was remembered like any other', async ({ page }) => {
  const invoked: string[] = []
  await openBroken(page, brokenDeck({ invokedCommands: invoked }))
  // `remember_recent_deck` runs Rust-side inside `open_deck`; what the
  // frontend can show is that `open_deck` itself completed (the editor is
  // up) rather than rejecting — the mock answers it the way peitho.rs
  // does for a deck that doesn't build.
  expect(invoked).toContain('open_deck')
  expect(invoked).toContain('read_deck_source')
})
