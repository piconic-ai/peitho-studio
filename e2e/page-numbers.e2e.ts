// Deck > Page Numbers (Off / 1 / 1/N) writes the deck's frontmatter
// `page_numbers`, and the slide context menu's Hide Page Number writes a
// slide's `page_number:false` (see `setPageNumbers` and
// `toggleSlidePageNumber` in `components/Studio.tsx`). The native menu
// can't be clicked from here, so these send the `menu:deck-setting` event
// Rust would, and read back what the window reports for the menu's check
// marks. The mock stands in for peitho-core, so this checks what gets
// saved, not how the number looks on a slide — that comes from the theme
// CSS and needs a real device.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const PLAIN_DECK = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'
const NUMBERED_DECK = `---\npage_numbers: current\n---\n<!-- {"key":"one","page_number":false} -->\n# Slide One\n\n---\n\n<!-- {"page_number":false} -->\n# Slide Two\n`

type Choice = 'none' | 'current' | 'current_of_total'

/** Opens `deck`, returning the `page_numbers` value of every settings
 * report the window sends the Deck menu (`null`: a value it doesn't
 * offer). */
async function openDeck(page: Page, deck: MockDeck): Promise<(string | null)[]> {
  const reported: (string | null)[] = []
  deck.onInvoke = (cmd, args) => {
    if (cmd === 'report_deck_settings') reported.push((args.settings as { page_numbers: string | null }).page_numbers)
  }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  return reported
}

async function emit(page: Page, event: string, payload: unknown): Promise<void> {
  await page.evaluate(({ event, payload }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, payload, 'main')
  }, { event, payload })
}

/** Deck > Page Numbers > `choice`. */
function pickPageNumbers(page: Page, choice: Choice): Promise<void> {
  return emit(page, 'menu:deck-setting', { key: 'page_numbers', choice })
}

function menu(page: Page, item: 'undo' | 'redo'): Promise<void> {
  return emit(page, `menu:${item}`, null)
}

async function contextMenuItem(page: Page, row: number, item: string) {
  await page.locator(`[data-slide-row="${row}"]`).click({ button: 'right' })
  return page.getByRole('button', { name: item, exact: true })
}

test('Given a deck, when it is opened, then the header has no page-number control of its own', async ({ page }) => {
  await openDeck(page, { source: `---\npage_numbers: both\n---\n${PLAIN_DECK}` })

  await expect(page.locator('[data-page-numbers]')).toHaveCount(0)
  await expect(page.locator('[data-page-numbers-unknown]')).toHaveCount(0)
})

test('Given a deck with no frontmatter, when Page Numbers > 1/N is picked, then page_numbers: current_of_total is saved and the menu is told', async ({ page }) => {
  const deck: MockDeck = { source: PLAIN_DECK }
  const reported = await openDeck(page, deck)
  await expect.poll(() => reported.at(-1)).toBe('none')

  await pickPageNumbers(page, 'current_of_total')

  await expect.poll(() => deck.source).toMatch(/^---\npage_numbers: current_of_total\n---\n/)
  await expect.poll(() => reported.at(-1)).toBe('current_of_total')
})

test('Given numbers shown with two slides hiding theirs, when Off is picked, then the key and both page_number:false are removed, leaving a deck peitho accepts', async ({ page }) => {
  const deck: MockDeck = { source: NUMBERED_DECK }
  const reported = await openDeck(page, deck)
  await expect.poll(() => reported.at(-1)).toBe('current')

  await pickPageNumbers(page, 'none')

  await expect.poll(() => deck.source).not.toContain('page_number')
  // The frontmatter held nothing else, so the whole block went with it:
  // peitho refuses an empty ---/--- block, and `<!-- {} -->` too.
  expect(deck.source.startsWith('---')).toBe(false)
  expect(deck.source).not.toContain('<!-- {} -->')
  expect(deck.source).toContain('<!-- {"key":"one"} -->\n# Slide One')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
  await expect.poll(() => reported.at(-1)).toBe('none')
})

test('Given numbers turned off, when Edit > Undo is chosen once, then the setting and every slide\'s page_number:false come back together', async ({ page }) => {
  const deck: MockDeck = { source: NUMBERED_DECK }
  const reported = await openDeck(page, deck)
  await pickPageNumbers(page, 'none')
  await expect.poll(() => deck.source).not.toContain('page_number')

  await menu(page, 'undo')

  await expect.poll(() => deck.source).toContain('page_numbers: current\n')
  expect(deck.source.match(/"page_number":false/g)).toHaveLength(2)
  await expect.poll(() => reported.at(-1)).toBe('current')

  await menu(page, 'redo')
  await expect.poll(() => deck.source).not.toContain('page_number')
})

test('Given a deck showing numbers, when "Hide Page Number" is chosen on a slide and then again, then its page_number:false is written and then removed', async ({ page }) => {
  const deck: MockDeck = { source: `---\npage_numbers: current\n---\n${PLAIN_DECK}` }
  await openDeck(page, deck)

  await (await contextMenuItem(page, 1, 'Hide Page Number')).click()
  await expect.poll(() => deck.source).toContain('<!-- {"key":"two","page_number":false} -->')

  await (await contextMenuItem(page, 1, 'Hide Page Number')).click()
  await expect.poll(() => deck.source).not.toContain('page_number":')
  expect(deck.source).toContain('<!-- {"key":"two"} -->')
})

test('Given a deck with numbers off, when a slide is right-clicked, then "Hide Page Number" is disabled', async ({ page }) => {
  await openDeck(page, { source: PLAIN_DECK })

  await expect(await contextMenuItem(page, 0, 'Hide Page Number')).toBeDisabled()
})

test('Given a deck with an unknown page_numbers value, when it is opened, then the menu is told it is none of its choices; picking one replaces it', async ({ page }) => {
  const deck: MockDeck = { source: `---\npage_numbers: both\n---\n${PLAIN_DECK}` }
  const reported = await openDeck(page, deck)
  await expect.poll(() => reported.at(-1)).toBeNull()

  await pickPageNumbers(page, 'current')

  await expect.poll(() => deck.source).toContain('page_numbers: current\n')
  expect(deck.source).not.toContain('both')
  await expect.poll(() => reported.at(-1)).toBe('current')
})

test.describe('robustness', () => {
  test('Given peitho refuses the change, when 1 is picked, then the deck file is untouched, the menu still shows Off, and there is nothing to undo', async ({ page }) => {
    const deck: MockDeck = {
      source: PLAIN_DECK,
      commandError: (cmd, args) => cmd === 'render_draft' && String(args.content).includes('page_numbers') ? 'parse error: page_numbers' : null,
    }
    const reported = await openDeck(page, deck)
    await expect.poll(() => reported.length).toBeGreaterThan(0)

    await pickPageNumbers(page, 'current')

    await expect(page.getByText('parse error: page_numbers')).toBeVisible()
    expect(deck.source).toBe(PLAIN_DECK)
    expect(reported).toEqual(['none'])

    // No step was recorded for the failed change, so Undo has nothing to take.
    const invoked: string[] = []
    deck.invokedCommands = invoked
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await menu(page, 'undo')
    await page.waitForTimeout(200)
    expect(invoked).not.toContain('save_deck_source')
    expect(deck.source).toBe(PLAIN_DECK)
  })

  test('Given 1 is already in place, when it is picked again, then nothing is saved', async ({ page }) => {
    const deck: MockDeck = { source: `---\npage_numbers: current\n---\n${PLAIN_DECK}` }
    await openDeck(page, deck)
    const invoked: string[] = []
    deck.invokedCommands = invoked

    await pickPageNumbers(page, 'current')
    // A later pick still goes through, so the first one had its turn.
    await pickPageNumbers(page, 'none')
    await expect.poll(() => deck.source).not.toContain('page_numbers')

    expect(invoked.filter(cmd => cmd === 'save_deck_source')).toHaveLength(1)
  })
})
