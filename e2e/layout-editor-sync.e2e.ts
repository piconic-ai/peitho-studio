// The layout editor and the Coding Agent editing the same layout
// (todo/layout-editor-sync.md): the agent's (or an external editor's)
// write to `layouts/*.html` / `css/*.css` reaches the open editor, and
// unsaved typing is never dropped by it.
//
// The watcher is mocked (`emitLayoutFilesChanged` stands for
// `watch_layout_dirs`' report, `layoutFilesStamp` for the files'
// fingerprint): these tests cover the frontend's handling of a change.
// That the real watcher reports a change once per burst, and only for
// layout files, is peitho.rs's own Rust tests.
import { test, expect, type Page } from '@playwright/test'
import { emitLayoutFilesChanged, mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, editorText, fillEditor } from './helpers/codeEditor'

const SOURCE = [
  '<!-- {"key":"cover","layout":"title-slide"} -->\n# Cover',
  '<!-- {"key":"quote","layout":"quote"} -->\n# Quote',
].join('\n\n---\n\n') + '\n'

const MINE = '<section class="peitho-slide layout-quote"><h1>mine</h1></section>'
const AGENT = '<section class="peitho-slide layout-quote"><h1>agent</h1></section>'
const ORIGINAL = '<section class="peitho-slide layout-quote"><h1>quote</h1></section>'

function deckOf(overrides: Partial<MockDeck> = {}): MockDeck {
  return {
    source: SOURCE,
    layouts: ['title-slide', 'quote'],
    layoutFiles: { quote: { html: ORIGINAL, css: '' }, 'title-slide': { html: '<section class="peitho-slide layout-title-slide"><h1>title</h1></section>', css: null } },
    layoutFilesStamp: 'v1',
    invokedCommands: [],
    ...overrides,
  }
}

async function openQuote(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await page.locator('[data-studio-mode-option="layouts"]').click()
  await page.locator('[data-layout-row="quote"]').click()
  await expect.poll(() => editorText(page, 'layout-html')).toBe(ORIGINAL)
}

/** The agent rewrites the quote layout's HTML on disk, and the watcher
 * reports it. */
async function agentWrites(page: Page, deck: MockDeck, html: string, stamp: string): Promise<void> {
  deck.layoutFiles!.quote = { html, css: '' }
  deck.layoutFilesStamp = stamp
  await emitLayoutFilesChanged(page)
}

function count(deck: MockDeck, cmd: string): number {
  return (deck.invokedCommands ?? []).filter(invoked => invoked === cmd).length
}

function pressUndo(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent('menu:undo', null, 'main')
  })
}

const thumbnail = (page: Page) => page.locator('[data-layout-row="quote"] [data-layout-canvas]')

test('Given the layout open with nothing unsaved, when the agent rewrites its file, then the editor, its row and the slides show the new layout without waiting for crit', async ({ page }) => {
  const deck = deckOf()
  await openQuote(page, deck)
  const rendersBefore = count(deck, 'render_draft')

  await agentWrites(page, deck, AGENT, 'agent-1')

  await expect.poll(() => editorText(page, 'layout-html')).toBe(AGENT)
  await expect(thumbnail(page).locator('h1')).toHaveText('agent')
  await expect.poll(() => count(deck, 'render_draft')).toBeGreaterThan(rendersBefore)
  await expect(page.locator('[data-layout-conflict]')).toBeHidden()
  await expect(page.locator('[data-layout-unsaved]')).toBeHidden()
})

test('Given the agent\'s change in the editor, when Edit > Undo is chosen there, then the text before it comes back and is saved over the agent\'s', async ({ page }) => {
  const deck = deckOf()
  await openQuote(page, deck)
  await agentWrites(page, deck, AGENT, 'agent-1')
  await expect.poll(() => editorText(page, 'layout-html')).toBe(AGENT)

  await editorContent(page, 'layout-html').click()
  await pressUndo(page)

  await expect.poll(() => editorText(page, 'layout-html')).toBe(ORIGINAL)
  await expect.poll(() => deck.layoutFiles?.quote.html).toBe(ORIGINAL)
})

test('Given unsaved typing, when the agent rewrites the file, then the typing stays, nothing is saved over the agent\'s file, and a notice offers both sides', async ({ page }) => {
  const deck = deckOf()
  await openQuote(page, deck)

  await fillEditor(page, MINE, 'layout-html')
  await agentWrites(page, deck, AGENT, 'agent-1')

  await expect(page.locator('[data-layout-conflict]')).toBeVisible()
  await page.waitForTimeout(1_500)
  expect(await editorText(page, 'layout-html')).toBe(MINE)
  expect(deck.layoutFiles?.quote.html).toBe(AGENT)
  expect(count(deck, 'save_layout')).toBe(0)

  // Leaving the layout waits for the choice.
  await page.locator('[data-layout-row="title-slide"]').click()
  await expect(page.locator('[data-layout-notice]')).toContainText('load them or keep your edits')
  await expect(page.locator('[data-layout-row="quote"]')).toHaveAttribute('aria-current', 'true')
})

test('Given a conflict, when Load from disk is chosen, then the editor shows the agent\'s file and Undo brings the typing back', async ({ page }) => {
  const deck = deckOf()
  await openQuote(page, deck)
  await fillEditor(page, MINE, 'layout-html')
  await agentWrites(page, deck, AGENT, 'agent-1')
  await expect(page.locator('[data-layout-conflict]')).toBeVisible()

  await page.locator('[data-layout-conflict-load]').click()

  await expect.poll(() => editorText(page, 'layout-html')).toBe(AGENT)
  await expect(page.locator('[data-layout-conflict]')).toBeHidden()
  await expect(page.locator('[data-layout-unsaved]')).toBeHidden()
  expect(count(deck, 'save_layout')).toBe(0)

  await editorContent(page, 'layout-html').click()
  await pressUndo(page)
  await expect.poll(() => editorText(page, 'layout-html')).toBe(MINE)
})

test('Given a conflict, when Keep my edits is chosen, then the typing is saved over the agent\'s file', async ({ page }) => {
  const deck = deckOf()
  await openQuote(page, deck)
  await fillEditor(page, MINE, 'layout-html')
  await agentWrites(page, deck, AGENT, 'agent-1')
  await expect(page.locator('[data-layout-conflict]')).toBeVisible()

  await page.locator('[data-layout-conflict-keep]').click()

  await expect.poll(() => deck.layoutFiles?.quote.html).toBe(MINE)
  await expect(page.locator('[data-layout-conflict]')).toBeHidden()
  expect(await editorText(page, 'layout-html')).toBe(MINE)
})

test('Given a draft the check refused, when the agent rewrites the file, then it is a conflict too, not a silent replace', async ({ page }) => {
  const deck = deckOf()
  await openQuote(page, deck)
  await fillEditor(page, '<div>no section</div>', 'layout-html')
  await expect(page.locator('[data-layout-editor-message]')).toContainText('a layout needs a <section> element')

  await agentWrites(page, deck, AGENT, 'agent-1')

  await expect(page.locator('[data-layout-conflict]')).toBeVisible()
  expect(await editorText(page, 'layout-html')).toBe('<div>no section</div>')
})

test('Given Studio\'s own autosave, when the watcher reports that write, then the editor is not rewritten and nothing is read or drawn again', async ({ page }) => {
  const deck = deckOf()
  await openQuote(page, deck)
  await fillEditor(page, MINE, 'layout-html')
  await expect.poll(() => deck.layoutFiles?.quote.html).toBe(MINE)
  await expect(page.locator('[data-layout-unsaved]')).toBeHidden()
  // The save's own redraw has run.
  await page.waitForTimeout(300)
  const reads = count(deck, 'read_layout')
  const previews = count(deck, 'preview_layouts')

  await emitLayoutFilesChanged(page)
  await page.waitForTimeout(500)

  expect(count(deck, 'read_layout')).toBe(reads)
  expect(count(deck, 'preview_layouts')).toBe(previews)
  expect(await editorText(page, 'layout-html')).toBe(MINE)
  // The save is its only step: one Undo goes back to the original.
  await editorContent(page, 'layout-html').click()
  await pressUndo(page)
  await expect.poll(() => editorText(page, 'layout-html')).toBe(ORIGINAL)
})

test('adversarial: Given unsaved typing, when another layout\'s file changes on disk, then its row is drawn again and the open editor is left alone, with no conflict', async ({ page }) => {
  const deck = deckOf({ saveLayoutDelayMs: 5_000 })
  await openQuote(page, deck)
  await fillEditor(page, MINE, 'layout-html')

  deck.layoutFiles!['title-slide'] = { html: '<section class="peitho-slide layout-title-slide"><h1>retitled</h1></section>', css: null }
  deck.layoutFilesStamp = 'agent-1'
  await emitLayoutFilesChanged(page)

  await expect(page.locator('[data-layout-row="title-slide"] [data-layout-canvas] h1')).toHaveText('retitled')
  await expect(page.locator('[data-layout-conflict]')).toBeHidden()
  expect(await editorText(page, 'layout-html')).toBe(MINE)
})

test('adversarial: Given the watcher reporting the same change twice, then the editor takes it once and adds one Undo step', async ({ page }) => {
  const deck = deckOf()
  await openQuote(page, deck)

  await agentWrites(page, deck, AGENT, 'agent-1')
  await emitLayoutFilesChanged(page)
  await expect.poll(() => editorText(page, 'layout-html')).toBe(AGENT)
  await page.waitForTimeout(300)

  await editorContent(page, 'layout-html').click()
  await pressUndo(page)
  await expect.poll(() => editorText(page, 'layout-html')).toBe(ORIGINAL)
})

test('adversarial: Given the agent rewrites the file while an autosave is running, then the save does not overwrite it, and Load from disk shows the agent\'s file', async ({ page }) => {
  const deck = deckOf({ saveLayoutDelayMs: 1_500 })
  await openQuote(page, deck)

  await fillEditor(page, MINE, 'layout-html')
  await expect(page.locator('[data-layout-saving]')).toBeVisible()
  await agentWrites(page, deck, AGENT, 'agent-1')

  await expect(page.locator('[data-layout-conflict]')).toBeVisible()
  await expect(page.locator('[data-layout-saving]')).toBeHidden({ timeout: 5_000 })
  await page.waitForTimeout(1_500)
  expect(deck.layoutFiles?.quote.html).toBe(AGENT)
  expect(await editorText(page, 'layout-html')).toBe(MINE)

  await page.locator('[data-layout-conflict-load]').click()
  await expect.poll(() => editorText(page, 'layout-html')).toBe(AGENT)
})

test('adversarial: Given an invalid draft fixed while its save is running, then the refusal does not stick to the fix, which is saved next', async ({ page }) => {
  const deck = deckOf({ saveLayoutDelayMs: 1_500 })
  await openQuote(page, deck)

  await fillEditor(page, '<div>invalid</div>', 'layout-html')
  await expect(page.locator('[data-layout-saving]')).toBeVisible()
  await fillEditor(page, MINE, 'layout-html')

  await expect.poll(() => deck.layoutFiles?.quote.html, { timeout: 8_000 }).toBe(MINE)
  await expect(page.locator('[data-layout-editor-message]')).toBeHidden()
})
