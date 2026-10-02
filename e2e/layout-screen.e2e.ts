// The layout screen (todo/layout-screen.md): the header's Slides / Layouts
// switch, the deck's layouts listed with how many slides use each, Apply to
// Slide, New Layout, Duplicate, Delete (moving a used layout's slides to
// another first) and editing a layout's HTML/CSS.
//
// The layout file commands are mocked (helpers/mockTauri.ts): these tests
// cover the frontend's handling of them. What the files themselves become,
// and the check that no slide changes layout, is `engine::layout_files`'s
// own Rust tests.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import type { LayoutVerdict } from '../domain/layoutFit'

const SOURCE = [
  '<!-- {"key":"cover","layout":"title-slide"} -->\n# Cover',
  '<!-- {"key":"intro","layout":"title-body"} -->\n# Intro\n\nText.',
  '<!-- {"key":"more","layout":"title-body"} -->\n# More\n\nText.',
].join('\n\n---\n\n') + '\n'

function deckOf(overrides: Partial<MockDeck> = {}): MockDeck {
  return { source: SOURCE, layouts: ['title-slide', 'title-body', 'quote'], invokedCommands: [], ...overrides }
}

async function openLayoutScreen(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await page.locator('[data-studio-mode-option="layouts"]').click()
  await expect(page.locator('[data-layout-screen]')).toBeVisible()
}

function row(page: Page, name: string) {
  return page.locator(`[data-layout-row="${name}"]`)
}

function slideConfigs(source: string): unknown[] {
  return source.split(/^---$/m).map(text => {
    const match = /<!-- (\{.*\}) -->/.exec(text)
    return match ? JSON.parse(match[1]) : {}
  })
}

test('Given an open deck, when the header switches to Layouts, then every layout is listed with how many slides use it, and switching back shows the slides again', async ({ page }) => {
  await openLayoutScreen(page, deckOf())

  await expect(page.locator('[data-layout-row]')).toHaveCount(3)
  await expect(row(page, 'title-slide')).toContainText('Title slide')
  await expect(row(page, 'title-slide').locator('[data-layout-usage]')).toHaveText('1 slide')
  await expect(row(page, 'title-body').locator('[data-layout-usage]')).toHaveText('2 slides')
  await expect(row(page, 'quote').locator('[data-layout-usage]')).toHaveText('Unused')
  await expect(page.locator('[data-panel="slides"]')).toBeHidden()

  await page.locator('[data-studio-mode-option="slides"]').click()
  await expect(page.locator('[data-layout-screen]')).toBeHidden()
  await expect(page.locator('[data-panel="slides"]')).toBeVisible()
})

test('Given a slide selected in Slides, when a layout is applied from the layout screen, then deck.md pins that slide to it and Undo takes it back', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await page.locator('[data-apply-layout]').click()

  await expect.poll(() => slideConfigs(deck.source)[0]).toEqual({ key: 'cover', layout: 'quote' })
  await expect(page.getByText('Applied the quote layout to the slide')).toBeVisible()

  await page.evaluate(() => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent('menu:undo', null, 'main')
  })
  await expect.poll(() => slideConfigs(deck.source)[0]).toEqual({ key: 'cover', layout: 'title-slide' })
})

test('Given a layout the selected slide does not fit, when it is applied, then the reason shows and deck.md is untouched', async ({ page }) => {
  const verdicts = (): LayoutVerdict[] => [
    { layout: 'title-slide', fit: { kind: 'fits' } },
    { layout: 'title-body', fit: { kind: 'fits' } },
    { layout: 'quote', fit: { kind: 'mismatch', reason: "unassigned content remains for missing 'body' slot" } },
  ]
  const deck = deckOf({ layoutVerdicts: verdicts })
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await page.locator('[data-apply-layout]').click()

  await expect(page.locator('[data-layout-notice]')).toContainText(`"quote" doesn't fit this slide: unassigned content remains for missing 'body' slot`)
  expect(deck.source).toBe(SOURCE)
  expect(deck.invokedCommands).not.toContain('save_deck_source')
})

test('Given New Layout, when a name is typed, then a taken one is refused before sending, and a new one is created from the chosen template and selected', async ({ page }) => {
  const deck = deckOf()
  const created: unknown[] = []
  deck.onInvoke = (cmd, args) => { if (cmd === 'create_layout') created.push(args) }
  await openLayoutScreen(page, deck)

  await page.locator('[data-new-layout]').click()
  await page.locator('[data-new-layout-name]').fill('Quote')
  await expect(page.locator('[data-new-layout-form] [role="alert"]')).toHaveText('The deck already has a layout with this name')
  await expect(page.locator('[data-create-layout]')).toBeDisabled()

  await page.locator('[data-new-layout-name]').fill('pull-quote')
  await page.locator('[data-new-layout-template]').selectOption('two-column')
  await page.locator('[data-create-layout]').click()

  await expect(row(page, 'pull-quote')).toBeVisible()
  await expect(row(page, 'pull-quote')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-new-layout-form]')).toBeHidden()
  expect(created).toEqual([{ content: SOURCE, name: 'pull-quote', template: 'two-column' }])
})

test('Given a layout, when it is duplicated, then the copy appears in the list, selected', async ({ page }) => {
  await openLayoutScreen(page, deckOf())

  await row(page, 'quote').click()
  await page.locator('[data-duplicate-layout]').click()

  await expect(row(page, 'quote-copy')).toHaveAttribute('aria-current', 'true')
})

test('Given an unused layout, when it is deleted and confirmed, then it leaves the list and deck.md is untouched', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await page.locator('[data-delete-layout]').click()
  await expect(page.locator('[data-delete-layout-panel]')).toContainText('Delete "quote"?')
  await page.locator('[data-confirm-delete-layout]').click()

  await expect(row(page, 'quote')).toHaveCount(0)
  expect(deck.layouts).toEqual(['title-slide', 'title-body'])
  expect(deck.source).toBe(SOURCE)
})

function pressUndo(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent('menu:undo', null, 'main')
  })
}

function layoutsOf(source: string): unknown[] {
  return slideConfigs(source).map(config => (config as { layout?: string }).layout)
}

test('Given a layout two slides use, when it is deleted, then a layout to move them to must be picked, and confirming moves both slides and deletes it', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'title-body').click()
  await page.locator('[data-delete-layout]').click()
  const panel = page.locator('[data-delete-layout-panel]')
  await expect(panel).toContainText('2 slides use "Title and body"')
  await expect(page.locator('[data-confirm-delete-layout]')).toBeDisabled()
  // The layout being deleted isn't offered as its own replacement.
  await expect(page.locator('[data-delete-replacement] option[value="title-body"]')).toHaveCount(0)

  await page.locator('[data-delete-replacement]').selectOption('quote')
  await page.locator('[data-confirm-delete-layout]').click()

  await expect(row(page, 'title-body')).toHaveCount(0)
  expect(deck.layouts).toEqual(['title-slide', 'quote'])
  expect(slideConfigs(deck.source)).toEqual([
    { key: 'cover', layout: 'title-slide' },
    { key: 'intro', layout: 'quote' },
    { key: 'more', layout: 'quote' },
  ])
})

// The move is part of the deletion, which can't be undone: undoing it
// would point the slides back at a layout whose file is gone, a render that
// can never succeed. So Undo skips it and reaches the step before.
test('Given slides moved off a deleted layout, when Undo is pressed, then the move stays and Undo reaches the change made before the deletion', async ({ page }) => {
  const deck = deckOf({ rejectUnknownLayouts: true })
  await openLayoutScreen(page, deck)
  await row(page, 'quote').click()
  await page.locator('[data-apply-layout]').click()
  await expect.poll(() => layoutsOf(deck.source)).toEqual(['quote', 'title-body', 'title-body'])

  await row(page, 'title-body').click()
  await page.locator('[data-delete-layout]').click()
  await page.locator('[data-delete-replacement]').selectOption('quote')
  await page.locator('[data-confirm-delete-layout]').click()
  await expect(row(page, 'title-body')).toHaveCount(0)
  expect(layoutsOf(deck.source)).toEqual(['quote', 'quote', 'quote'])

  await pressUndo(page)

  await expect.poll(() => layoutsOf(deck.source)).toEqual(['title-slide', 'quote', 'quote'])
})

test('Given an undo step that would pin a slide back to a layout, when that layout is deleted, then the undo history is forgotten instead of failing on every Undo', async ({ page }) => {
  const deck = deckOf({ rejectUnknownLayouts: true })
  await openLayoutScreen(page, deck)
  // Undoing this would pin the cover back to `title-slide`.
  await row(page, 'quote').click()
  await page.locator('[data-apply-layout]').click()
  await expect.poll(() => layoutsOf(deck.source)).toEqual(['quote', 'title-body', 'title-body'])

  await row(page, 'title-slide').click()
  await page.locator('[data-delete-layout]').click()
  await page.locator('[data-confirm-delete-layout]').click()
  await expect(row(page, 'title-slide')).toHaveCount(0)
  await expect(page.getByText('Deleted the title-slide layout — undo history cleared')).toBeVisible()

  const before = deck.source
  await pressUndo(page)
  await pressUndo(page)

  await expect(page.getByText("names layout 'title-slide'")).toHaveCount(0)
  expect(deck.source).toBe(before)
})

test('Given a delete the deck refuses, then the reason shows, nothing is moved, and the layout stays', async ({ page }) => {
  const deck = deckOf({ commandError: cmd => (cmd === 'check_layout_removal' ? "removing the 'title-body' layout would stop slide 2 from building" : null) })
  await openLayoutScreen(page, deck)

  await row(page, 'title-body').click()
  await page.locator('[data-delete-layout]').click()
  await page.locator('[data-delete-replacement]').selectOption('quote')
  await page.locator('[data-confirm-delete-layout]').click()

  await expect(page.locator('[data-layout-notice]')).toContainText('would stop slide 2 from building')
  await expect(row(page, 'title-body')).toBeVisible()
  expect(deck.source).toBe(SOURCE)
  expect(deck.invokedCommands).not.toContain('delete_layout')
})

test('Given the deck\'s only layout, then Delete is off', async ({ page }) => {
  await openLayoutScreen(page, deckOf({ layouts: ['title-body'], source: SOURCE.replaceAll('title-slide', 'title-body') }))
  await row(page, 'title-body').click()
  await expect(page.locator('[data-delete-layout]')).toBeDisabled()
})

test('Given a layout\'s CSS edited, when saved, then the files are written and Save turns off; HTML that does not parse is refused with the reason and kept unsaved', async ({ page }) => {
  const deck = deckOf({ layoutFiles: { quote: { html: '<section class="peitho-slide layout-quote"></section>', css: '.peitho-slide.layout-quote {}' } } })
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await expect(page.locator('[data-layout-html]')).toHaveValue('<section class="peitho-slide layout-quote"></section>')
  await page.locator('[data-layout-tab="css"]').click()
  await page.locator('[data-layout-css]').fill('.peitho-slide.layout-quote { color: red; }')
  await page.locator('[data-save-layout]').click()

  await expect.poll(() => deck.layoutFiles?.quote.css).toBe('.peitho-slide.layout-quote { color: red; }')
  await expect(page.locator('[data-save-layout]')).toBeDisabled()

  await page.locator('[data-layout-tab="html"]').click()
  await page.locator('[data-layout-html]').fill('<div>no section</div>')
  await page.locator('[data-save-layout]').click()

  await expect(page.locator('[data-layout-editor-message]')).toContainText('a layout needs a <section> element')
  await expect(page.locator('[data-layout-html]')).toHaveValue('<div>no section</div>')
  expect(deck.layoutFiles?.quote.html).toBe('<section class="peitho-slide layout-quote"></section>')
})

test('Given unsaved edits to a layout, when another layout is clicked, then the edits stay open and a notice says to save or revert first', async ({ page }) => {
  await openLayoutScreen(page, deckOf())

  await row(page, 'quote').click()
  await page.locator('[data-layout-html]').fill('<section>edited</section>')
  await row(page, 'title-slide').click()

  await expect(row(page, 'quote')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-layout-notice]')).toContainText('Save or revert')
  await page.locator('[data-revert-layout]').click()
  await row(page, 'title-slide').click()
  await expect(row(page, 'title-slide')).toHaveAttribute('aria-current', 'true')
})

test('Given the layout screen, when Delete or an arrow key is pressed outside a text field, then no slide is deleted or moved', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await page.locator('[data-layout-preview]').click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('ArrowDown')

  await page.locator('[data-studio-mode-option="slides"]').click()
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  expect(deck.source).toBe(SOURCE)
})
