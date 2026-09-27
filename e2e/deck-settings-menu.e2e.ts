// The native Deck menu (`src-tauri/src/deck_menu.rs`) can't be clicked
// from here, so these send the `menu:deck-setting` event Rust would send
// the focused window, and read back what gets saved and what the window
// reports for the menu's check marks (`report_deck_settings`). The marks
// themselves, and which window's values they follow, are Rust's job and
// need a real device. The mock stands in for peitho-core; like it, it
// sizes the canvas from `aspect_ratio`.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const PLAIN_DECK = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'
const DEFAULTS = { page_numbers: 'none', aspect_ratio: '16:9', breaks: 'false', lang: 'en' }

/** Opens `deck`, collecting every settings report the window sends. */
async function openDeck(page: Page, deck: MockDeck): Promise<unknown[]> {
  const reports: unknown[] = []
  deck.onInvoke = (cmd, args) => { if (cmd === 'report_deck_settings') reports.push(args.settings) }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  return reports
}

async function pick(page: Page, payload: unknown, toWindow = 'main'): Promise<void> {
  await page.evaluate(({ payload, toWindow }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent('menu:deck-setting', payload, toWindow)
  }, { payload, toWindow })
}

async function menu(page: Page, item: 'undo' | 'redo'): Promise<void> {
  await page.evaluate(event => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, null, 'main')
  }, `menu:${item}`)
}

/** The preview's canvas width, which follows the deck's aspect ratio. */
function previewCanvasWidth(page: Page): Promise<number> {
  return page.locator('[data-preview-host]').evaluate(el => parseFloat((el as HTMLElement).style.getPropertyValue('--peitho-canvas-width')))
}

test('Given a deck with no frontmatter, when it is opened, then the Deck menu is told every setting is at its default', async ({ page }) => {
  const reports = await openDeck(page, { source: PLAIN_DECK })

  await expect.poll(() => reports.at(-1)).toEqual(DEFAULTS)
})

test('Given a 16:9 deck, when Aspect Ratio > 4:3 is picked, then aspect_ratio: 4:3 is saved, the preview turns 4:3, and the menu is told', async ({ page }) => {
  const deck: MockDeck = { source: PLAIN_DECK }
  const reports = await openDeck(page, deck)
  await expect.poll(() => previewCanvasWidth(page)).toBe(1280)

  await pick(page, { key: 'aspect_ratio', choice: '4:3' })

  await expect.poll(() => deck.source).toMatch(/^---\naspect_ratio: 4:3\n---\n/)
  await expect.poll(() => previewCanvasWidth(page)).toBe(960)
  await expect.poll(() => reports.at(-1)).toEqual({ ...DEFAULTS, aspect_ratio: '4:3' })
})

test('Given 4:3 picked, when Edit > Undo and then Redo are chosen, then the key is removed and put back, one press each', async ({ page }) => {
  const deck: MockDeck = { source: PLAIN_DECK }
  const reports = await openDeck(page, deck)
  await pick(page, { key: 'aspect_ratio', choice: '4:3' })
  await expect.poll(() => deck.source).toContain('aspect_ratio: 4:3')

  await menu(page, 'undo')
  await expect.poll(() => deck.source).toBe(PLAIN_DECK)
  await expect.poll(() => reports.at(-1)).toEqual(DEFAULTS)

  await menu(page, 'redo')
  await expect.poll(() => deck.source).toContain('aspect_ratio: 4:3')
})

test('Given 4:3, when 16:9 (the default) is picked, then the key is removed rather than written', async ({ page }) => {
  const deck: MockDeck = { source: `---\ntime: 1m\naspect_ratio: 4:3\n---\n${PLAIN_DECK}` }
  await openDeck(page, deck)

  await pick(page, { key: 'aspect_ratio', choice: '16:9' })

  await expect.poll(() => deck.source).toBe(`---\ntime: 1m\n---\n${PLAIN_DECK}`)
})

test('Given line breaks off, when they are turned on and then off, then breaks: true is saved and then removed', async ({ page }) => {
  const deck: MockDeck = { source: PLAIN_DECK }
  const reports = await openDeck(page, deck)

  await pick(page, { key: 'breaks', choice: 'true' })
  await expect.poll(() => deck.source).toContain('breaks: true\n')
  await expect.poll(() => reports.at(-1)).toEqual({ ...DEFAULTS, breaks: 'true' })

  await pick(page, { key: 'breaks', choice: 'false' })
  await expect.poll(() => deck.source).toBe(PLAIN_DECK)
})

test('Given an English deck, when Language > 日本語 is picked and undone, then lang: ja is saved and removed again', async ({ page }) => {
  const deck: MockDeck = { source: PLAIN_DECK }
  await openDeck(page, deck)

  await pick(page, { key: 'lang', choice: 'ja' })
  await expect.poll(() => deck.source).toMatch(/^---\nlang: ja\n---\n/)

  await menu(page, 'undo')
  await expect.poll(() => deck.source).toBe(PLAIN_DECK)
})

test('Given page numbers off, when Page Numbers > 1/N is picked and undone, then page_numbers is saved and removed again', async ({ page }) => {
  const deck: MockDeck = { source: PLAIN_DECK }
  const reports = await openDeck(page, deck)

  await pick(page, { key: 'page_numbers', choice: 'current_of_total' })
  await expect.poll(() => deck.source).toContain('page_numbers: current_of_total\n')
  await expect.poll(() => reports.at(-1)).toEqual({ ...DEFAULTS, page_numbers: 'current_of_total' })

  await menu(page, 'undo')
  await expect.poll(() => deck.source).toBe(PLAIN_DECK)
})

test('Given values the menu does not offer, when the deck is opened, then those settings are reported as unknown; picking a choice replaces the value', async ({ page }) => {
  const deck: MockDeck = { source: `---\nlang: fr\npage_numbers: both\n---\n${PLAIN_DECK}` }
  const reports = await openDeck(page, deck)
  await expect.poll(() => reports.at(-1)).toEqual({ ...DEFAULTS, lang: null, page_numbers: null })

  await pick(page, { key: 'lang', choice: 'ja' })

  await expect.poll(() => deck.source).toContain('lang: ja\n')
  expect(deck.source).not.toContain('fr')
  await expect.poll(() => reports.at(-1)).toEqual({ ...DEFAULTS, lang: 'ja', page_numbers: null })
})

test.describe('robustness', () => {
  test('Given a pick of the value already in place, a malformed pick, or one sent to another window, then nothing is saved', async ({ page }) => {
    const deck: MockDeck = { source: `---\nlang: ja\n---\n${PLAIN_DECK}` }
    await openDeck(page, deck)
    const invoked: string[] = []
    deck.invokedCommands = invoked

    await pick(page, { key: 'lang', choice: 'ja' })
    await pick(page, { key: 'lang', choice: 'fr' })
    await pick(page, { key: 'pointer_color', choice: 'red' })
    await pick(page, null)
    await pick(page, { key: 'lang', choice: 'en' }, 'another-window')
    // A later, valid pick still lands, so the ones before it had their turn.
    await pick(page, { key: 'breaks', choice: 'true' })
    await expect.poll(() => deck.source).toContain('breaks: true')

    expect(deck.source).toContain('lang: ja\n')
    expect(invoked.filter(cmd => cmd === 'save_deck_source')).toHaveLength(1)
  })

  test('Given peitho refuses the change, when 4:3 is picked, then the file is untouched, the menu is not told, and there is nothing to undo', async ({ page }) => {
    const deck: MockDeck = {
      source: PLAIN_DECK,
      commandError: (cmd, args) => cmd === 'render_draft' && String(args.content).includes('aspect_ratio') ? 'parse error: aspect_ratio' : null,
    }
    const reports = await openDeck(page, deck)
    await expect.poll(() => reports.length).toBeGreaterThan(0)

    await pick(page, { key: 'aspect_ratio', choice: '4:3' })

    await expect(page.getByText('parse error: aspect_ratio')).toBeVisible()
    expect(deck.source).toBe(PLAIN_DECK)
    expect(reports.at(-1)).toEqual(DEFAULTS)

    const invoked: string[] = []
    deck.invokedCommands = invoked
    await menu(page, 'undo')
    await page.waitForTimeout(200)
    expect(invoked).not.toContain('save_deck_source')
  })

  test('Given a pick and its undo, then each change is reported exactly once', async ({ page }) => {
    const deck: MockDeck = { source: PLAIN_DECK }
    const reports = await openDeck(page, deck)
    await expect.poll(() => reports.length).toBe(1)

    await pick(page, { key: 'lang', choice: 'ja' })
    await expect.poll(() => reports.length).toBe(2)
    await menu(page, 'undo')
    await expect.poll(() => reports.length).toBe(3)
    expect(reports).toEqual([DEFAULTS, { ...DEFAULTS, lang: 'ja' }, DEFAULTS])
  })
})
