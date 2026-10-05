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
import { editorContent, editorText, fillEditor, moveToEditorEnd } from './helpers/codeEditor'

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
  // The list takes its first width (as wide as the editor) a frame after the
  // screen shows: measuring columns before then reads them mid-change.
  const width = async (selector: string) => (await page.locator(selector).boundingBox())?.width ?? 0
  await expect.poll(async () => Math.abs(await width('[data-layout-list]') - await width('[data-layout-editor]'))).toBeLessThanOrEqual(1)
}

function row(page: Page, name: string) {
  return page.locator(`[data-layout-row="${name}"]`)
}

/** Right-clicks the list's empty space below the rows — scrolled into view
 * first: the rows can fill the column, the list starting half the screen
 * wide with thumbnails as tall as that makes them. */
async function rightClickListSpace(page: Page): Promise<void> {
  const list = page.locator('[data-layout-rows]')
  await list.evaluate(el => { el.scrollTop = el.scrollHeight })
  const box = await list.boundingBox()
  if (!box) throw new Error('the layout list has no box')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10, { button: 'right' })
}

/** Runs a layout menu item: on layout `name`'s row (the selected row by
 * default), or, for New Layout, on the list's empty space below the rows. */
async function act(page: Page, action: 'apply' | 'edit' | 'duplicate' | 'delete' | 'new-layout', name?: string): Promise<void> {
  if (action === 'new-layout') {
    await rightClickListSpace(page)
  } else {
    const target = name === undefined ? page.locator('[data-layout-row][aria-current="true"]') : row(page, name)
    await target.click({ button: 'right' })
  }
  await page.locator(`[data-layout-menu-item="${action}"]`).click()
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

test('Given layouts named like Object prototype members, when the screen opens, then each is listed with its own usage and opens', async ({ page }) => {
  const source = SOURCE.replace('"layout":"title-slide"', '"layout":"constructor"')
  await openLayoutScreen(page, deckOf({ source, layouts: ['constructor', 'title-body', 'toString'] }))

  await expect(row(page, 'constructor').locator('[data-layout-usage]')).toHaveText('1 slide')
  await expect(row(page, 'toString').locator('[data-layout-usage]')).toHaveText('Unused')
  await row(page, 'toString').click()
  await expect.poll(() => editorText(page, 'layout-html')).toBe('<section class="peitho-slide layout-toString"></section>')
})

function layoutMenu(page: Page) {
  return page.locator('[data-layout-menu]')
}

function layoutMenuItem(page: Page, action: string) {
  return page.locator(`[data-layout-menu-item="${action}"]`)
}

test('Given a layout row, when it is right-clicked, then a menu offers Apply, Edit, Duplicate, Delete and a comment on it; Escape and a click outside close it', async ({ page }) => {
  await openLayoutScreen(page, deckOf())

  await row(page, 'quote').click({ button: 'right' })
  await expect(layoutMenu(page)).toBeVisible()
  await expect(layoutMenu(page).locator('[data-layout-menu-item]')).toHaveText(['Apply to Slide', 'Edit Layout', 'Duplicate Layout', 'Delete Layout', 'Comment on This Layout…'])
  await expect(layoutMenuItem(page, 'apply')).toBeEnabled()

  await page.keyboard.press('Escape')
  await expect(layoutMenu(page)).toBeHidden()

  await row(page, 'quote').click({ button: 'right' })
  await expect(layoutMenu(page)).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(layoutMenu(page)).toBeHidden()
})

test('Given the layout menu, when each item is chosen, then it acts on the right-clicked layout', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click({ button: 'right' })
  await layoutMenuItem(page, 'edit').click()
  await expect(row(page, 'quote')).toHaveAttribute('aria-current', 'true')
  await expect(layoutMenu(page)).toBeHidden()

  await row(page, 'quote').click({ button: 'right' })
  await layoutMenuItem(page, 'apply').click()
  await expect.poll(() => slideConfigs(deck.source)[0]).toEqual({ key: 'cover', layout: 'quote' })

  await row(page, 'title-slide').click({ button: 'right' })
  await layoutMenuItem(page, 'duplicate').click()
  await expect(row(page, 'title-slide-copy')).toHaveAttribute('aria-current', 'true')

  await row(page, 'quote').click({ button: 'right' })
  await layoutMenuItem(page, 'delete').click()
  await expect(page.locator('[data-delete-layout-panel]')).toContainText('1 slide uses "quote"')
})

test('Given a layout the selected slide does not fit, when its row is right-clicked, then Apply is off with the reason', async ({ page }) => {
  const verdicts = (): LayoutVerdict[] => [
    { layout: 'title-slide', fit: { kind: 'fits' } },
    { layout: 'title-body', fit: { kind: 'fits' } },
    { layout: 'quote', fit: { kind: 'mismatch', reason: "unassigned content remains for missing 'body' slot" } },
  ]
  const deck = deckOf({ layoutVerdicts: verdicts })
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click({ button: 'right' })
  await expect(layoutMenuItem(page, 'apply')).toBeDisabled()
  await expect(layoutMenuItem(page, 'apply')).toHaveAttribute('title', "unassigned content remains for missing 'body' slot")
  expect(deck.invokedCommands).not.toContain('save_deck_source')
  await page.keyboard.press('Escape')
  await row(page, 'title-body').click({ button: 'right' })
  await expect(layoutMenuItem(page, 'apply')).toBeEnabled()
})

test('Given the deck\'s only layout, when its row is right-clicked, then Delete is off with the reason', async ({ page }) => {
  await openLayoutScreen(page, deckOf({ layouts: ['title-body'], source: SOURCE.replaceAll('title-slide', 'title-body') }))

  await row(page, 'title-body').click({ button: 'right' })
  await expect(layoutMenuItem(page, 'delete')).toBeDisabled()
  await expect(layoutMenuItem(page, 'delete')).toHaveAttribute('title', "The deck's only layout can't be deleted")
  await expect(layoutMenuItem(page, 'edit')).toBeEnabled()
})

test('Given empty space in the layout list, when it is right-clicked, then the menu offers New Layout, which opens the form, and a comment on every layout', async ({ page }) => {
  await openLayoutScreen(page, deckOf())

  await rightClickListSpace(page)

  await expect(layoutMenu(page).locator('[data-layout-menu-item]')).toHaveText(['New Layout', 'Comment on All Layouts…'])
  await layoutMenuItem(page, 'new-layout').click()
  await expect(page.locator('[data-new-layout-form]')).toBeVisible()
  await expect(layoutMenu(page)).toBeHidden()
})

test('Given a slide selected in Slides, when a layout is applied from the layout screen, then deck.md pins that slide to it and Undo takes it back', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await act(page, 'apply')

  await expect.poll(() => slideConfigs(deck.source)[0]).toEqual({ key: 'cover', layout: 'quote' })
  await expect(page.getByText('Applied the quote layout to the slide')).toBeVisible()

  await page.evaluate(() => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent('menu:undo', null, 'main')
  })
  await expect.poll(() => slideConfigs(deck.source)[0]).toEqual({ key: 'cover', layout: 'title-slide' })
})

test('Given the layout the selected slide already uses, when it is applied, then the screen says so instead of reporting it applied', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'title-slide').click()
  await act(page, 'apply')

  await expect(page.locator('[data-layout-notice]')).toContainText('The slide already uses the title-slide layout')
  await expect(page.getByText('Applied the title-slide layout to the slide')).toHaveCount(0)
  expect(deck.invokedCommands).not.toContain('save_deck_source')
})

test('Given a layout whose render fails, when it is applied, then the failure shows on the screen instead of reporting it applied', async ({ page }) => {
  const deck = deckOf({
    commandError: (cmd, args) => (cmd === 'render_draft' && layoutsOf(args.content as string)[0] === 'quote' ? "slide 1 doesn't build on 'quote'" : null),
  })
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await act(page, 'apply')

  await expect(page.locator('[data-layout-notice]')).toContainText("slide 1 doesn't build on 'quote'")
  await expect(page.getByText('Applied the quote layout to the slide')).toHaveCount(0)
  expect(deck.source).toBe(SOURCE)
})

test('Given New Layout, when a name is typed, then a taken one is refused before sending, and a new one is created from the chosen template and selected', async ({ page }) => {
  const deck = deckOf()
  const created: unknown[] = []
  deck.onInvoke = (cmd, args) => { if (cmd === 'create_layout') created.push(args) }
  await openLayoutScreen(page, deck)

  await act(page, 'new-layout')
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
  await act(page, 'duplicate')

  await expect(row(page, 'quote-copy')).toHaveAttribute('aria-current', 'true')
})

test('Given an unused layout, when it is deleted and confirmed, then it leaves the list and deck.md is untouched', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await act(page, 'delete')
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
  await act(page, 'delete')
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
  await act(page, 'apply')
  await expect.poll(() => layoutsOf(deck.source)).toEqual(['quote', 'title-body', 'title-body'])

  await row(page, 'title-body').click()
  await act(page, 'delete')
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
  await act(page, 'apply')
  await expect.poll(() => layoutsOf(deck.source)).toEqual(['quote', 'title-body', 'title-body'])

  await row(page, 'title-slide').click()
  await act(page, 'delete')
  await page.locator('[data-confirm-delete-layout]').click()
  await expect(row(page, 'title-slide')).toHaveCount(0)
  await expect(page.getByText('Deleted the title-slide layout — undo history cleared')).toBeVisible()

  const before = deck.source
  await pressUndo(page)
  await pressUndo(page)

  await expect(page.getByText("names layout 'title-slide'")).toHaveCount(0)
  expect(deck.source).toBe(before)
})

test('Given a delete that fails after the slides were moved, then they are moved back and the layout stays', async ({ page }) => {
  const deck = deckOf({ commandError: cmd => (cmd === 'delete_layout' ? 'failed to delete layouts/title-body.html: permission denied' : null) })
  await openLayoutScreen(page, deck)

  await row(page, 'title-body').click()
  await act(page, 'delete')
  await page.locator('[data-delete-replacement]').selectOption('quote')
  await page.locator('[data-confirm-delete-layout]').click()

  await expect(page.locator('[data-layout-notice]')).toContainText('permission denied')
  await expect(row(page, 'title-body')).toBeVisible()
  await expect.poll(() => deck.source).toBe(SOURCE)
})

// The move, the file deletion and moving the slides back run as one unit
// behind earlier operations: an Undo pressed meanwhile waits for it, so it
// can't shift the slides the move-back addresses by position.
test('Given a deletion that fails while Undo is pressed, then the slides are moved back first and the Undo lands after, on the right slides', async ({ page }) => {
  const deck = deckOf({
    deleteLayoutDelayMs: 1_500,
    commandError: cmd => (cmd === 'delete_layout' ? 'failed to delete layouts/title-body.html: permission denied' : null),
  })
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })
  // Undoing this puts the cover back at the top, shifting every slide.
  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByRole('button', { name: /^Delete/ }).click()
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  await page.locator('[data-studio-mode-option="layouts"]').click()
  await row(page, 'title-body').click()
  await act(page, 'delete')
  await page.locator('[data-delete-replacement]').selectOption('quote')
  await page.locator('[data-confirm-delete-layout]').click()
  await expect.poll(() => layoutsOf(deck.source)).toEqual(['quote', 'quote'])
  await pressUndo(page)

  await expect(page.locator('[data-layout-notice]')).toContainText('permission denied')
  await expect.poll(() => layoutsOf(deck.source)).toEqual(['title-slide', 'title-body', 'title-body'])
})

test('Given a delete the deck refuses, then the reason shows, nothing is moved, and the layout stays', async ({ page }) => {
  const deck = deckOf({ commandError: cmd => (cmd === 'check_layout_removal' ? "removing the 'title-body' layout would stop slide 2 from building" : null) })
  await openLayoutScreen(page, deck)

  await row(page, 'title-body').click()
  await act(page, 'delete')
  await page.locator('[data-delete-replacement]').selectOption('quote')
  await page.locator('[data-confirm-delete-layout]').click()

  await expect(page.locator('[data-layout-notice]')).toContainText('would stop slide 2 from building')
  await expect(row(page, 'title-body')).toBeVisible()
  expect(deck.source).toBe(SOURCE)
  expect(deck.invokedCommands).not.toContain('delete_layout')
})

test('Given the layout screen, then it has no toolbar or New Layout button: every operation is in the right-click menus', async ({ page }) => {
  await openLayoutScreen(page, deckOf())
  await row(page, 'quote').click()
  for (const selector of ['[data-apply-layout]', '[data-duplicate-layout]', '[data-delete-layout]', '[data-new-layout]']) {
    await expect(page.locator(selector)).toHaveCount(0)
  }
  await expect(page.locator('[data-delete-layout-panel]')).toBeHidden()
  await expect(page.locator('[data-new-layout-form]')).toBeHidden()
})

test('Given the delete and New Layout modals, when Escape or a click outside is used, then they close without changing anything', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await act(page, 'delete', 'title-body')
  await expect(page.locator('[data-delete-layout-panel]')).toBeVisible()
  await expect(page.locator('[data-delete-replacement]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-delete-layout-panel]')).toBeHidden()

  await act(page, 'delete', 'quote')
  await page.mouse.click(5, 5)
  await expect(page.locator('[data-delete-layout-panel]')).toBeHidden()

  await act(page, 'new-layout')
  await expect(page.locator('[data-new-layout-name]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-new-layout-form]')).toBeHidden()

  await act(page, 'new-layout')
  await page.mouse.click(5, 5)
  await expect(page.locator('[data-new-layout-form]')).toBeHidden()
  expect(deck.source).toBe(SOURCE)
  expect(deck.layouts).toEqual(['title-slide', 'title-body', 'quote'])
})

test('Given a layout\'s CSS edited, when typing pauses, then the files are saved on their own with no Save button; HTML that does not parse is refused with the reason and kept unsaved', async ({ page }) => {
  const deck = deckOf({ layoutFiles: { quote: { html: '<section class="peitho-slide layout-quote"></section>', css: '.peitho-slide.layout-quote {}' } } })
  await openLayoutScreen(page, deck)
  await expect(page.locator('[data-save-layout]')).toHaveCount(0)
  await expect(page.locator('[data-revert-layout]')).toHaveCount(0)

  await row(page, 'quote').click()
  await expect.poll(() => editorText(page, 'layout-html')).toBe('<section class="peitho-slide layout-quote"></section>')
  await page.locator('[data-layout-tab="css/quote.css"] [data-layout-tab-show]').click()
  await fillEditor(page, '.peitho-slide.layout-quote { color: red; }', 'layout-css')

  await expect.poll(() => deck.layoutFiles?.quote.css).toBe('.peitho-slide.layout-quote { color: red; }')
  await expect(page.locator('[data-layout-unsaved]')).toBeHidden()

  await page.locator('[data-layout-tab="layouts/quote.html"] [data-layout-tab-show]').click()
  await fillEditor(page, '<div>no section</div>', 'layout-html')

  await expect(page.locator('[data-layout-editor-message]')).toContainText('a layout needs a <section> element')
  await expect.poll(() => editorText(page, 'layout-html')).toBe('<div>no section</div>')
  await expect(page.locator('[data-layout-unsaved]')).toBeVisible()
  expect(deck.layoutFiles?.quote.html).toBe('<section class="peitho-slide layout-quote"></section>')

  // Fixed, the next pause saves it.
  await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>fixed</h1></section>', 'layout-html')
  await expect.poll(() => deck.layoutFiles?.quote.html).toBe('<section class="peitho-slide layout-quote"><h1>fixed</h1></section>')
  await expect(page.locator('[data-layout-editor-message]')).toBeHidden()
})

test('Given typing that keeps going, then the layout is saved once it pauses, not on every keystroke', async ({ page }) => {
  const saves: string[] = []
  const deck = deckOf({
    layoutFiles: { quote: { html: '<section></section>', css: null } },
    onInvoke: (cmd, args) => { if (cmd === 'save_deck_file') saves.push(args.text as string) },
  })
  await openLayoutScreen(page, deck)
  await row(page, 'quote').click()
  await expect.poll(() => editorText(page, 'layout-html')).toBe('<section></section>')

  await editorContent(page, 'layout-html').click()
  await page.keyboard.press('ControlOrMeta+End')
  for (const key of 'abcdef') {
    await page.keyboard.type(key)
    await page.waitForTimeout(150)
  }

  await expect.poll(() => saves).toEqual(['<section></section>abcdef'])
  await page.waitForTimeout(1_500)
  expect(saves).toEqual(['<section></section>abcdef'])
})

test('Given typing while a save is still running, then the newer text is saved after it, never overwritten by the older one', async ({ page }) => {
  const saves: string[] = []
  const deck = deckOf({
    layoutFiles: { quote: { html: '<section></section>', css: null } },
    saveLayoutDelayMs: 800,
    onInvoke: (cmd, args) => { if (cmd === 'save_deck_file') saves.push(args.text as string) },
  })
  await openLayoutScreen(page, deck)
  await row(page, 'quote').click()

  await fillEditor(page, '<section>one</section>', 'layout-html')
  await expect(page.locator('[data-layout-saving]')).toBeVisible()
  await fillEditor(page, '<section>two</section>', 'layout-html')

  await expect.poll(() => deck.layoutFiles?.quote.html, { timeout: 8_000 }).toBe('<section>two</section>')
  expect(saves).toEqual(['<section>one</section>', '<section>two</section>'])
  await expect(page.locator('[data-layout-unsaved]')).toBeHidden()
  await expect.poll(() => editorText(page, 'layout-html')).toBe('<section>two</section>')
})

test('Given an edit that would stop a slide from building, when it is autosaved, then the deck source goes along for the check, and its refusal shows in the editor with the edit kept unsaved', async ({ page }) => {
  const saves: unknown[] = []
  const deck = deckOf({
    layoutFiles: { 'title-body': { html: '<section class="peitho-slide layout-title-body"></section>', css: null } },
    onInvoke: (cmd, args) => { if (cmd === 'save_deck_file') saves.push(args) },
    commandError: cmd => (cmd === 'save_deck_file' ? "this edit to the 'title-body' layout would stop slide 2 ('intro') from building on 'title-body'" : null),
  })
  await openLayoutScreen(page, deck)

  await row(page, 'title-body').click()
  await fillEditor(page, '<section class="peitho-slide layout-title-body"><h1>no body</h1></section>', 'layout-html')

  await expect(page.locator('[data-layout-editor-message]')).toContainText("would stop slide 2 ('intro') from building")
  await expect.poll(() => editorText(page, 'layout-html')).toBe('<section class="peitho-slide layout-title-body"><h1>no body</h1></section>')
  await expect(page.locator('[data-layout-unsaved]')).toBeVisible()
  // A refused draft isn't tried again until it's edited.
  await page.waitForTimeout(1_500)
  expect(saves).toEqual([{
    content: SOURCE, path: 'layouts/title-body.html', text: '<section class="peitho-slide layout-title-body"><h1>no body</h1></section>',
    base: '<section class="peitho-slide layout-title-body"></section>',
  }])
  expect(deck.layoutFiles?.['title-body'].html).toBe('<section class="peitho-slide layout-title-body"></section>')
})

/** Opens the deck with every `save_deck_source` failing, types into the
 * first slide's body so its draft can't be saved, and switches to the
 * layout screen. */
async function openWithUnsavableDraft(page: Page, deck: MockDeck): Promise<void> {
  let failures = 0
  deck.commandError = cmd => {
    if (cmd !== 'save_deck_source') return null
    failures++
    return 'Disk full'
  }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await editorContent(page).click()
  await moveToEditorEnd(page)
  await page.keyboard.type(' Unsaved')
  await expect.poll(() => failures).toBeGreaterThan(0)
  await page.locator('[data-studio-mode-option="layouts"]').click()
  await expect(page.locator('[data-layout-screen]')).toBeVisible()
}

// Layout files are checked against the deck as saved: a draft that can't
// be saved isn't what the deck reopens with.
test('Given a slide draft that cannot be saved, when a layout edit is autosaved, then it is refused before the check and the edit stays unsaved', async ({ page }) => {
  const deck = deckOf()
  await openWithUnsavableDraft(page, deck)

  await row(page, 'quote').click()
  await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>edited</h1></section>', 'layout-html')

  await expect(page.locator('[data-layout-editor-message]')).toContainText('could not be saved')
  await expect(page.locator('[data-layout-unsaved]')).toBeVisible()
  expect(deck.invokedCommands).not.toContain('save_deck_file')
})

for (const action of ['create', 'duplicate', 'delete'] as const) {
  test(`Given a slide draft that cannot be saved, when a layout is ${action === 'create' ? 'created' : action === 'duplicate' ? 'duplicated' : 'deleted'}, then it is refused before reaching the deck`, async ({ page }) => {
    const deck = deckOf()
    await openWithUnsavableDraft(page, deck)

    await row(page, 'quote').click()
    if (action === 'create') {
      await act(page, 'new-layout')
      await page.locator('[data-new-layout-name]').fill('pull-quote')
      await page.locator('[data-create-layout]').click()
    } else if (action === 'duplicate') {
      await act(page, 'duplicate')
    } else {
      await act(page, 'delete')
      await page.locator('[data-confirm-delete-layout]').click()
    }

    await expect(page.locator('[data-layout-notice]')).toContainText('could not be saved')
    for (const cmd of ['create_layout', 'duplicate_layout', 'check_layout_removal', 'delete_layout']) expect(deck.invokedCommands).not.toContain(cmd)
    await expect(row(page, 'quote')).toBeVisible()
  })
}

test('Given a slide draft that saves, when a layout edit is autosaved, then the draft is saved first and the check runs against it', async ({ page }) => {
  const saves: { content: string }[] = []
  const deck = deckOf({ renderDraftDelayMs: 300, onInvoke: (cmd, args) => { if (cmd === 'save_deck_file') saves.push(args as { content: string }) } })
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await editorContent(page).click()
  await moveToEditorEnd(page)
  await page.keyboard.type(' Typed')
  await page.locator('[data-studio-mode-option="layouts"]').click()
  await row(page, 'quote').click()
  await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>edited</h1></section>', 'layout-html')

  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0].content).toContain('Typed')
  expect(saves[0].content).toBe(deck.source)
})

test('Given a pending edit to a layout, when another layout is clicked before the pause, then the edit is saved first and the other layout opens', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await fillEditor(page, '<section>edited</section>', 'layout-html')
  await row(page, 'title-slide').click()

  await expect(row(page, 'title-slide')).toHaveAttribute('aria-current', 'true')
  expect(deck.layoutFiles?.quote.html).toBe('<section>edited</section>')
})

test('Given a pending edit to a layout, when the window switches to Slides, then it is saved first', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await fillEditor(page, '<section>edited</section>', 'layout-html')
  await page.locator('[data-studio-mode-option="slides"]').click()

  await expect(page.locator('[data-layout-screen]')).toBeHidden()
  expect(deck.layoutFiles?.quote.html).toBe('<section>edited</section>')
})

test('Given an edit the check refuses, when another layout is chosen, then it opens beside it while the refused tab keeps its edit; Slides or a new layout is held back with a notice', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await row(page, 'quote').click()
  await fillEditor(page, '<div>no section</div>', 'layout-html')
  await expect(page.locator('[data-layout-editor-message]')).toContainText('a layout needs a <section> element')

  // Another layout opens in tabs of its own; the refused one stays open.
  await row(page, 'title-slide').click()
  await expect(row(page, 'title-slide')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-layout-tab="layouts/title-slide.html"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-layout-tab="layouts/quote.html"] [data-layout-tab-dirty]')).toBeVisible()

  // Leaving the screen is held back, the refused tab shown with a notice.
  await page.locator('[data-studio-mode-option="slides"]').click()
  await expect(page.locator('[data-layout-notice]')).toContainText('could not be saved')
  await expect(page.locator('[data-layout-screen]')).toBeVisible()
  await expect(page.locator('[data-layout-tab="layouts/quote.html"]')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => editorText(page, 'layout-html')).toBe('<div>no section</div>')

  await act(page, 'new-layout')
  await page.locator('[data-new-layout-name]').fill('pull-quote')
  await page.locator('[data-create-layout]').click()
  await expect(page.locator('[data-new-layout-form]')).toContainText('could not be saved')
  await page.keyboard.press('Escape')
  expect(deck.invokedCommands).not.toContain('create_layout')

  // Fixed, it saves and the window can go to Slides.
  await fillEditor(page, '<section>fixed</section>', 'layout-html')
  await expect.poll(() => deck.layoutFiles?.quote?.html).toBe('<section>fixed</section>')
  await page.locator('[data-studio-mode-option="slides"]').click()
  await expect(page.locator('[data-layout-screen]')).toBeHidden()
})

test('Given a pending edit to a layout, when the window is asked to close, then the edit is saved and the window closes; one that can\'t be saved keeps it open with a notice', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)
  const flushBeforeClose = () => page.evaluate(() => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent('layout:flush-before-close', null, 'main')
  })

  await row(page, 'quote').click()
  await fillEditor(page, '<div>no section</div>', 'layout-html')
  await expect(page.locator('[data-layout-editor-message]')).toContainText('a layout needs a <section> element')
  await flushBeforeClose()
  await expect(page.locator('[data-layout-notice]')).toContainText('close the window again')
  expect(deck.invokedCommands).not.toContain('plugin:window|close')

  await fillEditor(page, '<section>edited</section>', 'layout-html')
  await flushBeforeClose()
  await expect.poll(() => deck.invokedCommands).toContain('plugin:window|close')
  expect(deck.layoutFiles?.quote.html).toBe('<section>edited</section>')
})

test('Given a layout edit, then the window\'s close is told a draft is pending until it is saved', async ({ page }) => {
  const reports: boolean[] = []
  const deck = deckOf({ onInvoke: (cmd, args) => { if (cmd === 'report_layout_draft') reports.push(args.pending as boolean) } })
  await openLayoutScreen(page, deck)
  await row(page, 'quote').click()

  await fillEditor(page, '<section>edited</section>', 'layout-html')

  await expect.poll(() => reports).toContain(true)
  await expect.poll(() => deck.layoutFiles?.quote?.html).toBe('<section>edited</section>')
  await expect.poll(() => reports.at(-1)).toBe(false)
})

test('Given the layout screen, when Delete or an arrow key is pressed outside a text field, then no slide is deleted or moved', async ({ page }) => {
  const deck = deckOf()
  await openLayoutScreen(page, deck)

  await page.locator('[data-layout-list-header]').click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('Delete')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('ArrowDown')

  await page.locator('[data-studio-mode-option="slides"]').click()
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  expect(deck.source).toBe(SOURCE)
})

// The layout editor is the same CodeMirror editor as the slide body
// (`dom/codeEditor.ts`), so vim mode reaches it too.
test.describe('the layout editor in vim mode', () => {
  const QUOTE_FILES = { quote: { html: '<section class="peitho-slide layout-quote">\n  <h1>quote</h1>\n</section>', css: '.peitho-slide.layout-quote {}' } }

  function vimStatus(page: Page, which: 'layout-html' | 'layout-css' = 'layout-html') {
    return page.locator(`[data-editor="${which}"] .cm-vim-panel`)
  }

  async function emitEvent(page: Page, event: string, payload: unknown): Promise<void> {
    await page.evaluate(({ event, payload }) => {
      (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
        .__mockEmitTauriEvent(event, payload, 'main')
    }, { event, payload })
  }

  test('Given vim mode is on, when "dd" is typed in the layout HTML, then vim deletes the line and the layout has unsaved changes', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ settings: { vimMode: true }, layoutFiles: QUOTE_FILES }))
    await row(page, 'quote').click()
    await expect.poll(() => editorText(page, 'layout-html')).toBe(QUOTE_FILES.quote.html)

    await editorContent(page, 'layout-html').click()
    await page.keyboard.type('gg0dd')

    await expect.poll(() => editorText(page, 'layout-html')).toBe('  <h1>quote</h1>\n</section>')
    await expect(vimStatus(page)).toBeVisible()
    await expect(page.locator('[data-layout-unsaved]')).toBeVisible()
  })

  test('Given the layout editor, when vim mode is turned on and off from Settings, then the change takes effect at once', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ layoutFiles: QUOTE_FILES }))
    await row(page, 'quote').click()
    await page.locator('[data-layout-tab="css/quote.css"] [data-layout-tab-show]').click()
    await editorContent(page, 'layout-css').click()
    await expect(vimStatus(page, 'layout-css')).toHaveCount(0)

    await emitEvent(page, 'settings:changed', { vimMode: true })
    await expect(vimStatus(page, 'layout-css')).toBeVisible()

    await emitEvent(page, 'settings:changed', { vimMode: false })
    await expect(vimStatus(page, 'layout-css')).toHaveCount(0)
    await editorContent(page, 'layout-css').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('dd')
    await expect.poll(() => editorText(page, 'layout-css')).toBe('.peitho-slide.layout-quote {}dd')
  })

  test('Given vim mode is on, when Escape leaves insert mode in the layout editor, then only vim reacts', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ settings: { vimMode: true }, layoutFiles: QUOTE_FILES }))
    await row(page, 'quote').click()

    await editorContent(page, 'layout-html').click()
    await page.keyboard.type('i')
    await expect(vimStatus(page)).toContainText('INSERT')
    await page.keyboard.press('Escape')

    await expect(vimStatus(page)).not.toContainText('INSERT')
    await expect(row(page, 'quote')).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('[data-layout-screen]')).toBeVisible()
    await expect.poll(() => editorText(page, 'layout-html')).toBe(QUOTE_FILES.quote.html)
  })

  test('Given vim mode is on and focus in the layout editor, when Delete is chosen from the menu, then the modal takes focus so vim keys don\'t reach the editor', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ settings: { vimMode: true }, layoutFiles: QUOTE_FILES }))
    await row(page, 'quote').click()
    await editorContent(page, 'layout-html').click()

    await act(page, 'delete', 'quote')
    await expect(page.locator('[data-delete-layout-panel]')).toBeVisible()
    await page.keyboard.type('dd')

    await expect.poll(() => editorText(page, 'layout-html')).toBe(QUOTE_FILES.quote.html)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-delete-layout-panel]')).toBeHidden()
  })

  test('Given typing in the layout editor after a slide change, when Edit > Undo is chosen there, then the typing is undone and the slide change stays', async ({ page }) => {
    const deck = deckOf({ layoutFiles: QUOTE_FILES })
    await openLayoutScreen(page, deck)
    await row(page, 'quote').click()
    await act(page, 'apply')
    await expect.poll(() => slideConfigs(deck.source)[0]).toEqual({ key: 'cover', layout: 'quote' })

    await editorContent(page, 'layout-html').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('X')
    await expect.poll(() => editorText(page, 'layout-html')).toBe(QUOTE_FILES.quote.html + 'X')
    await pressUndo(page)

    await expect.poll(() => editorText(page, 'layout-html')).toBe(QUOTE_FILES.quote.html)
    expect(slideConfigs(deck.source)[0]).toEqual({ key: 'cover', layout: 'quote' })
  })
})

test('Given a long line in the layout HTML, then it is not wrapped but scrolls sideways, while the slide body still wraps', async ({ page }) => {
  const long = `<section class="peitho-slide layout-quote">${'<span>wide</span>'.repeat(60)}</section>`
  await openLayoutScreen(page, deckOf({ layoutFiles: { quote: { html: long, css: null } } }))
  await row(page, 'quote').click()
  await expect.poll(() => editorText(page, 'layout-html')).toBe(long)

  await expect(editorContent(page, 'layout-html')).not.toHaveClass(/cm-lineWrapping/)
  const scroller = page.locator('[data-editor="layout-html"] .cm-scroller')
  await expect.poll(() => scroller.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await expect(editorContent(page, 'body')).toHaveClass(/cm-lineWrapping/)
})

// The screen's arrangement: the editor on the left, the list (which also
// shows the layout being edited) on its right, the comments column last.
test.describe('the layout screen\'s arrangement', () => {
  test('Given the layout screen, then the editor, the list and the comments column stand left to right, with no separate preview', async ({ page }) => {
    await openLayoutScreen(page, deckOf())

    const editor = await page.locator('[data-layout-editor]').boundingBox()
    const list = await page.locator('[data-layout-list]').boundingBox()
    const comments = await page.locator('[data-panel="review"]').boundingBox()
    if (!editor || !list || !comments) throw new Error('a column has no box')
    expect(editor.x + editor.width).toBeLessThanOrEqual(list.x)
    expect(list.x + list.width).toBeLessThanOrEqual(comments.x)
    await expect(page.locator('[data-layout-preview]')).toHaveCount(0)
  })

  test('Given the layout screen, then the list column has no text heading, only the PC / Phone switch over it', async ({ page }) => {
    await openLayoutScreen(page, deckOf())

    const header = page.locator('[data-layout-list-header]')
    // What's on screen (the shape menu, closed, holds hidden text).
    expect((await header.innerText()).trim()).toBe('')
    await expect(page.locator('[data-layout-list]').getByText('Layouts', { exact: true })).toHaveCount(0)
    await expect(header.locator('[data-viewport-toggle]')).toBeVisible()
  })

  test('Given the layout screen shown for the first time, then the list is as wide as the editor; a width dragged to stays after going to Slides and back', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    const width = async (selector: string) => (await page.locator(selector).boundingBox())?.width ?? 0

    await expect.poll(async () => Math.abs(await width('[data-layout-list]') - await width('[data-layout-editor]'))).toBeLessThanOrEqual(1)

    const before = await page.locator('[data-layout-list]').boundingBox()
    if (!before) throw new Error('the list has no box')
    await page.mouse.move(before.x - 2, before.y + 200)
    await page.mouse.down()
    await page.mouse.move(before.x - 42, before.y + 200, { steps: 5 })
    await page.mouse.up()
    const dragged = await width('[data-layout-list]')
    expect(dragged).toBeCloseTo(before.width + 40, 0)

    await page.locator('[data-studio-mode-option="slides"]').click()
    await page.locator('[data-studio-mode-option="layouts"]').click()
    await expect(page.locator('[data-layout-screen]')).toBeVisible()
    await page.waitForTimeout(100)
    expect(await width('[data-layout-list]')).toBeCloseTo(dragged, 0)
  })

  test('Given the layout screen, when the divider between the editor and the list is dragged left, then the list grows and the editor shrinks by as much', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    const before = await page.locator('[data-layout-list]').boundingBox()
    const editorBefore = await page.locator('[data-layout-editor]').boundingBox()
    if (!before || !editorBefore) throw new Error('a column has no box')

    // The divider is the 4px strip just left of the list.
    await page.mouse.move(before.x - 2, before.y + 200)
    await page.mouse.down()
    await page.mouse.move(before.x - 62, before.y + 200, { steps: 5 })
    await page.mouse.up()

    const after = await page.locator('[data-layout-list]').boundingBox()
    const editorAfter = await page.locator('[data-layout-editor]').boundingBox()
    expect(after?.width).toBeCloseTo(before.width + 60, 0)
    expect(editorAfter?.width).toBeCloseTo(editorBefore.width - 60, 0)
  })
})

// Live preview while the layout is edited (`preview_layout_draft`, mocked:
// the draft HTML is the preview's fragment), drawn in the selected row's
// thumbnail.
test.describe('the selected row while the layout is edited', () => {
  const QUOTE = { quote: { html: '<section class="peitho-slide layout-quote"><h1>saved</h1></section>', css: '' } }
  const thumbnail = (page: Page, name: string) => row(page, name).locator('[data-layout-canvas]')
  const selected = (page: Page) => page.locator('[data-layout-row][aria-current="true"] [data-layout-canvas]')

  test('Given an edit to the layout HTML, when typing pauses, then the selected row\'s thumbnail shows the draft before it is saved, and the other rows keep their saved look', async ({ page }) => {
    // The save is held back, so the row is seen drawing the draft itself.
    const deck = deckOf({ layoutFiles: QUOTE, layoutFragment: '<h1>saved</h1>', saveLayoutDelayMs: 3_000 })
    await openLayoutScreen(page, deck)
    await row(page, 'quote').click()
    await expect(selected(page).locator('h1')).toHaveText('saved')

    await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>draft</h1></section>', 'layout-html')

    await expect(thumbnail(page, 'quote').locator('h1')).toHaveText('draft')
    await expect(thumbnail(page, 'title-slide').locator('h1')).toHaveText('saved')
    await expect(thumbnail(page, 'title-body').locator('h1')).toHaveText('saved')
    expect(deck.layoutFiles?.quote.html).toBe(QUOTE.quote.html)

    await expect.poll(() => deck.layoutFiles?.quote.html, { timeout: 8_000 }).toBe('<section class="peitho-slide layout-quote"><h1>draft</h1></section>')
    await expect(thumbnail(page, 'quote').locator('h1')).toHaveText('draft')
  })

  test('Given a draft that does not render, then the last good thumbnail stays and the error shows by the editor; typing goes on', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ layoutFiles: QUOTE, layoutFragment: '<h1>saved</h1>' }))
    await row(page, 'quote').click()
    await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>good</h1></section>', 'layout-html')
    await expect(selected(page).locator('h1')).toHaveText('good')

    await fillEditor(page, '<div>broken</div>', 'layout-html')

    await expect(page.locator('[data-layout-editor] [data-layout-preview-error]')).toContainText('a layout needs a <section> element')
    await expect(selected(page).locator('h1')).toHaveText('good')
    await page.keyboard.type('!')
    await expect.poll(() => editorText(page, 'layout-html')).toBe('<div>broken</div>!')

    await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>fixed</h1></section>', 'layout-html')
    await expect(selected(page).locator('h1')).toHaveText('fixed')
    await expect(page.locator('[data-layout-preview-error]')).toBeHidden()
  })

  test('Given an earlier draft whose preview answers last, then the latest draft is the one the row shows', async ({ page }) => {
    await openLayoutScreen(page, deckOf({
      layoutFiles: QUOTE,
      layoutFragment: '<h1>saved</h1>',
      layoutDraftPreviewDelayMs: html => (html.includes('slow') ? 1_200 : 0),
    }))
    await row(page, 'quote').click()

    await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>slow</h1></section>', 'layout-html')
    await page.waitForTimeout(400)
    await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>fast</h1></section>', 'layout-html')

    await expect(selected(page).locator('h1')).toHaveText('fast')
    await page.waitForTimeout(1_200)
    await expect(selected(page).locator('h1')).toHaveText('fast')
  })

  test('Given a draft naming an asset, then the row loads it from the deck\'s asset server', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ layoutFiles: QUOTE, layoutFragment: '<h1>saved</h1>' }))
    await row(page, 'quote').click()

    await fillEditor(page, '<section class="peitho-slide layout-quote"><img src="assets/bbbb-logo.png"><h1>draft</h1></section>', 'layout-html')

    await expect(selected(page).locator('img')).toHaveAttribute('src', 'http://localhost:9/assets/bbbb-logo.png')
  })

  test('Given a font face added in the draft CSS, then it is registered for the row while a draft, and the draft\'s own registration is dropped once it is saved', async ({ page }) => {
    // The save is held back long enough to see the draft's registration.
    const deck = deckOf({ layoutFiles: QUOTE, layoutFragment: '<h1>saved</h1>', saveLayoutDelayMs: 2_000 })
    await openLayoutScreen(page, deck)
    await row(page, 'quote').click()
    await page.locator('[data-layout-tab="css/quote.css"] [data-layout-tab-show]').click()
    const fontFamilies = () => page.evaluate(() => [...document.fonts].map(face => face.family.replace(/"/g, '')))
    const draftFonts = () => page.evaluate(() => document.querySelector('style[data-peitho-draft-fonts]')?.textContent ?? '')

    await fillEditor(page, '@font-face { font-family: "DraftFace"; src: url(fonts/draft.woff2); }\n.peitho-slide.layout-quote h1 { font-family: "DraftFace"; }', 'layout-css')

    await expect.poll(fontFamilies).toContain('DraftFace')
    await expect.poll(draftFonts).toContain('http://localhost:9/fonts/draft.woff2')

    // Saved, the deck's own CSS carries the face from then on.
    await expect.poll(() => deck.layoutFiles?.quote.css, { timeout: 8_000 }).toContain('DraftFace')
    await expect.poll(draftFonts).toBe('')
  })

  test('Given a draft redefining a font family the deck defines, then the draft\'s face is registered under a preview-only name, leaving the deck\'s own family alone', async ({ page }) => {
    const deckCss = '@font-face { font-family: "DeckFace"; src: url(fonts/deck.woff2); }\n.peitho-slide { font-family: "DeckFace"; }'
    // Refused, the draft stays one for the whole test.
    await openLayoutScreen(page, deckOf({ layoutFiles: QUOTE, layoutFragment: '<h1>saved</h1>', css: deckCss, commandError: cmd => (cmd === 'save_deck_file' ? 'held back' : null) }))
    await row(page, 'quote').click()
    await page.locator('[data-layout-tab="css/quote.css"] [data-layout-tab-show]').click()
    const draftFonts = () => page.evaluate(() => document.querySelector('style[data-peitho-draft-fonts]')?.textContent ?? '')

    await fillEditor(page, '@font-face { font-family: "DeckFace"; src: url(fonts/other.woff2); }\n.peitho-slide.layout-quote h1 { font: italic 2rem/1.2 DeckFace, serif !important; }', 'layout-css')

    await expect.poll(draftFonts).toContain('fonts/other.woff2')
    // The row's own sheet names the draft's face by its preview-only name.
    const rowCss = () => thumbnail(page, 'quote').evaluate(host =>
      (host.shadowRoot?.adoptedStyleSheets ?? []).flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)).join('\n'))
    await expect.poll(rowCss).toContain('"DeckFace (Peitho draft)", serif !important')
    expect(await draftFonts()).not.toMatch(/font-family:\s*"DeckFace"\s*;/)
    const families = await page.evaluate(() => [...document.fonts].map(face => face.family.replace(/"/g, '')))
    expect(families.filter(family => family === 'DeckFace')).toHaveLength(1)
  })

  test('Given a draft drawn in the row, when it is saved and another layout is opened, then the row draws its saved files, and the newly opened one its own', async ({ page }) => {
    const deck = deckOf({ layoutFiles: QUOTE, layoutFragment: '<h1>saved</h1>' })
    await openLayoutScreen(page, deck)
    await row(page, 'quote').click()
    await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>draft</h1></section>', 'layout-html')
    await expect(thumbnail(page, 'quote').locator('h1')).toHaveText('draft')

    await expect.poll(() => deck.layoutFiles?.quote.html).toBe('<section class="peitho-slide layout-quote"><h1>draft</h1></section>')
    await row(page, 'title-body').click()
    await expect(row(page, 'title-body')).toHaveAttribute('aria-current', 'true')
    // The mock's `preview_layouts` draws a layout's saved HTML.
    await expect(thumbnail(page, 'quote').locator('h1')).toHaveText('draft')
    await expect(thumbnail(page, 'title-body').locator('h1')).toHaveText('saved')
  })
})

// The PC / Phone switch over the list: the same switch, and the same state,
// as the slide preview's.
test.describe('the layout list\'s PC / Phone switch', () => {
  const toggle = (page: Page) => page.locator('[data-layout-list] [data-viewport-toggle]')
  const ratio = async (page: Page, name: string) => {
    const box = await row(page, name).locator('[data-layout-row-thumbnail]').boundingBox()
    if (!box) throw new Error('the thumbnail has no box')
    return box.height / box.width
  }

  test('Given the layout list in PC display, when Phone is switched on, then every thumbnail takes the phone\'s tall shape, and back in PC display the deck\'s', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ layoutFragment: '<h1>saved</h1>' }))
    const pc = await ratio(page, 'quote')
    expect(pc).toBeLessThan(1)

    await toggle(page).click()

    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
    for (const name of ['title-slide', 'title-body', 'quote']) {
      await expect.poll(() => ratio(page, name)).toBeGreaterThan(1.5)
      await expect(row(page, name).locator('[data-layout-canvas] h1')).toHaveText('saved')
    }

    await toggle(page).click()
    await expect.poll(() => ratio(page, 'quote')).toBeCloseTo(pc, 1)
  })

  test('Given the layout list, then the switch sits at its top-left, level with the editor\'s tabs, with no rule under its row', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    const header = page.locator('[data-layout-list-header]')
    const list = (await page.locator('[data-layout-list]').boundingBox())!
    const pill = (await toggle(page).boundingBox())!
    expect(pill.x - list.x).toBeLessThanOrEqual(12)

    const tabs = (await page.locator('[data-layout-editor-toolbar]').boundingBox())!
    const row = (await header.boundingBox())!
    expect(row.y).toBeCloseTo(tabs.y, 0)
    expect(row.height).toBeCloseTo(tabs.height, 0)
    expect(await header.evaluate(el => getComputedStyle(el).borderBottomWidth)).toBe('0px')
  })

  test('Given the list narrowed against the window\'s right edge, when the phone shape menu opens, then it stays inside the window', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    await page.locator('[data-panel="review"] [data-panel-toggle]').click()
    await expect(page.locator('[data-panel="review"]')).toBeHidden()
    // Drag the divider right as far as it goes: the list at its narrowest.
    const list = (await page.locator('[data-layout-list]').boundingBox())!
    await page.mouse.move(list.x - 2, list.y + 200)
    await page.mouse.down()
    await page.mouse.move(list.x + 600, list.y + 200, { steps: 5 })
    await page.mouse.up()

    await toggle(page).click()
    await page.locator('[data-layout-list] [data-phone-shape-menu-button]').click()
    const menu = page.locator('[data-layout-list] [data-phone-shape-menu]')
    await expect(menu).toBeVisible()
    const viewport = page.viewportSize()!
    await expect.poll(async () => {
      const box = (await menu.boundingBox())!
      return box.x >= 0 && box.x + box.width <= viewport.width
    }).toBe(true)
  })

  test('Given phone display in a wide list and a short window, then the selected layout\'s large preview fits in its share of the list\'s height at the canvas\'s proportion, centered, leaving room for the grid, and follows a window resize', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 560 })
    await openLayoutScreen(page, deckOf({ layoutFragment: '<h1>saved</h1>' }))
    // The divider dragged left as far as it goes: the list at its widest.
    const list = (await page.locator('[data-layout-list]').boundingBox())!
    await page.mouse.move(list.x - 2, list.y + 200)
    await page.mouse.down()
    await page.mouse.move(list.x - 600, list.y + 200, { steps: 5 })
    await page.mouse.up()
    await toggle(page).click()

    const selected = page.locator('[data-layout-selected-preview]')
    const fits = async () => {
      const area = (await page.locator('[data-layout-list-body]').boundingBox())!
      const thumb = (await selected.locator('[data-layout-thumbnail]').boundingBox())!
      const row = (await selected.boundingBox())!
      const canvas = await selected.locator('[data-layout-selected-canvas]').evaluate(el => ({
        width: parseFloat(el.style.getPropertyValue('--peitho-canvas-width')),
        height: parseFloat(el.style.getPropertyValue('--peitho-canvas-height')),
      }))
      return {
        inside: thumb.y >= area.y && thumb.y + thumb.height <= area.y + area.height * 0.6,
        ratio: Math.abs(thumb.height / thumb.width - canvas.height / canvas.width) < 0.02,
        tall: canvas.height > canvas.width,
        centered: Math.abs((thumb.x + thumb.width / 2) - (row.x + row.width / 2)) <= 1,
        height: thumb.height,
      }
    }
    await expect.poll(async () => { const f = await fits(); return f.inside && f.ratio && f.tall && f.centered }).toBe(true)
    const before = (await fits()).height

    await page.setViewportSize({ width: 1400, height: 460 })
    await expect.poll(async () => { const f = await fits(); return f.inside && f.ratio && f.height < before - 50 }).toBe(true)
  })

  test('Given PC display in a very short window, then the large preview fits the list\'s visible height too', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 300 })
    await openLayoutScreen(page, deckOf({ layoutFragment: '<h1>saved</h1>' }))
    const selected = page.locator('[data-layout-selected-preview]')
    await expect.poll(async () => {
      const area = (await page.locator('[data-layout-list-body]').boundingBox())!
      const thumb = (await selected.locator('[data-layout-thumbnail]').boundingBox())!
      return thumb.y + thumb.height <= area.y + area.height && thumb.height > 0
    }).toBe(true)
  })

  test('Given phone display, when the deck\'s own shape is picked from the list\'s menu, then the thumbnails return to the deck\'s proportion while phone display stays on', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    const pc = await ratio(page, 'quote')
    await toggle(page).click()
    await expect.poll(() => ratio(page, 'quote')).toBeGreaterThan(1.5)

    await page.locator('[data-layout-list] [data-phone-shape-menu-button]').click()
    await page.locator('[data-layout-list] [data-phone-shape-option="deck"]').click()

    await expect.poll(() => ratio(page, 'quote')).toBeCloseTo(pc, 1)
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
  })

  test('Given phone display, when the tablet is picked in the layout list, then the thumbnails take the tablet\'s proportion, the slide preview shows the tablet too, and a small phone picked there comes back to the list', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    await toggle(page).click()
    // The standard phone, 1280x2179.
    await expect.poll(() => ratio(page, 'quote')).toBeCloseTo(2179 / 1280, 1)

    await page.locator('[data-layout-list] [data-phone-shape-menu-button]').click()
    await page.locator('[data-layout-list] [data-phone-shape-option="tablet"]').click()
    for (const name of ['title-slide', 'title-body', 'quote']) {
      await expect.poll(() => ratio(page, name)).toBeCloseTo(1608 / 1280, 1)
    }

    await page.locator('[data-studio-mode-option="slides"]').click()
    const previewCanvasHeight = () => page.locator('[data-preview-host]').evaluate(el => (el as HTMLElement).style.getPropertyValue('--peitho-canvas-height'))
    await expect.poll(previewCanvasHeight).toBe('1608px')
    await page.locator('[data-panel="preview"] [data-phone-shape-menu-button]').click()
    await expect(page.locator('[data-panel="preview"] [data-phone-shape-option="tablet"]')).toHaveAttribute('aria-checked', 'true')
    await page.locator('[data-panel="preview"] [data-phone-shape-option="small-phone"]').click()
    await expect.poll(previewCanvasHeight).toBe('1871px')

    await page.locator('[data-studio-mode-option="layouts"]').click()
    await expect.poll(() => ratio(page, 'quote')).toBeCloseTo(1871 / 1280, 1)
    await page.locator('[data-layout-list] [data-phone-shape-menu-button]').click()
    await expect(page.locator('[data-layout-list] [data-phone-shape-option="small-phone"]')).toHaveAttribute('aria-checked', 'true')
  })

  test('Given Phone switched on in the layout list, when the window goes to Slides, then the preview is in phone display too; switched off there, the layout list is back in PC display', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    const pc = await ratio(page, 'quote')
    await toggle(page).click()

    await page.locator('[data-studio-mode-option="slides"]').click()
    const slidesToggle = page.locator('[data-panel="preview"] [data-viewport-toggle]')
    await expect(slidesToggle).toHaveAttribute('aria-checked', 'true')
    await slidesToggle.click()
    await expect(slidesToggle).toHaveAttribute('aria-checked', 'false')

    await page.locator('[data-studio-mode-option="layouts"]').click()
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => ratio(page, 'quote')).toBeCloseTo(pc, 1)
  })

  test('Given a draft drawn in the selected row, when Phone is switched on, then the row keeps drawing the draft on the tall canvas', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ layoutFiles: { quote: { html: '<section class="peitho-slide layout-quote"><h1>saved</h1></section>', css: '' } }, layoutFragment: '<h1>saved</h1>' }))
    await row(page, 'quote').click()
    await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>draft</h1></section>', 'layout-html')
    await expect(row(page, 'quote').locator('[data-layout-canvas] h1')).toHaveText('draft')

    await toggle(page).click()

    await expect.poll(() => ratio(page, 'quote')).toBeGreaterThan(1.5)
    await expect(row(page, 'quote').locator('[data-layout-canvas] h1')).toHaveText('draft')
    await expect(row(page, 'title-body').locator('[data-layout-canvas] h1')).toHaveText('saved')
  })

  test('Given phone display in a wide list and a tall window, then the large preview is capped at the device\'s CSS width (standard phone 390, small phone 375), and PC display takes the column\'s width again', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 3000 })
    await openLayoutScreen(page, deckOf({ layoutFragment: '<h1>saved</h1>' }))
    // The divider dragged left as far as it goes: the list at its widest.
    const list = (await page.locator('[data-layout-list]').boundingBox())!
    await page.mouse.move(list.x - 2, list.y + 200)
    await page.mouse.down()
    await page.mouse.move(list.x - 600, list.y + 200, { steps: 5 })
    await page.mouse.up()
    const width = async () => (await page.locator('[data-layout-selected-preview] [data-layout-thumbnail]').boundingBox())!.width
    await expect.poll(width).toBeGreaterThan(430)
    const pcWidth = await width()

    await toggle(page).click()
    await expect.poll(width).toBe(390)

    await page.locator('[data-layout-list] [data-phone-shape-menu-button]').click()
    await page.locator('[data-layout-list] [data-phone-shape-option="small-phone"]').click()
    await expect.poll(width).toBe(375)
    expect(await ratio(page, 'quote')).toBeCloseTo(1871 / 1280, 1)

    await toggle(page).click()
    await expect.poll(width).toBeCloseTo(pcWidth, 0)
  })

  test('Given phone display on the tablet in a list narrower than it, then the large preview stays within the column (the cap never widens it)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 3000 })
    await openLayoutScreen(page, deckOf())
    const listWidth = (await page.locator('[data-layout-list]').boundingBox())!.width
    expect(listWidth).toBeLessThan(820)
    await toggle(page).click()
    await page.locator('[data-layout-list] [data-phone-shape-menu-button]').click()
    await page.locator('[data-layout-list] [data-phone-shape-option="tablet"]').click()
    await expect.poll(() => ratio(page, 'quote')).toBeCloseTo(1608 / 1280, 1)
    const box = (await page.locator('[data-layout-selected-preview] [data-layout-thumbnail]').boundingBox())!
    expect(box.width).toBeLessThanOrEqual(listWidth - 32 + 0.5)
  })

  test('Given a layout whose slide opts out with data-canvas="fixed", when Phone is switched on, then its thumbnail keeps the deck\'s shape', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ layoutFragment: '<section class="peitho-slide" data-canvas="fixed"><h1>fixed</h1></section>' }))
    const pc = await ratio(page, 'quote')

    await toggle(page).click()

    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
    await expect(row(page, 'quote').locator('[data-layout-canvas] h1')).toHaveText('fixed')
    expect(await ratio(page, 'quote')).toBeCloseTo(pc, 1)
  })
})
