// The deck header's page-number control (Off / 1 / 1/N) writes the deck's
// frontmatter `page_numbers`, and the slide context menu's Hide Page Number
// writes a slide's `page_number:false` (see `setPageNumbers` and
// `toggleSlidePageNumber` in `components/Studio.tsx`). The mock stands in
// for peitho-core, so this checks what gets saved, not how the number looks
// on a slide — that comes from the theme CSS and needs a real device.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const PLAIN_DECK = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'
const NUMBERED_DECK = `---\npage_numbers: current\n---\n<!-- {"key":"one","page_number":false} -->\n# Slide One\n\n---\n\n<!-- {"page_number":false} -->\n# Slide Two\n`

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
}

function choice(page: Page, value: 'none' | 'current' | 'current_of_total') {
  return page.locator(`[data-page-numbers="${value}"]`)
}

async function menu(page: Page, item: 'undo' | 'redo'): Promise<void> {
  await page.evaluate(event => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, null, 'main')
  }, `menu:${item}`)
}

async function contextMenuItem(page: Page, row: number, item: string) {
  await page.locator(`[data-slide-row="${row}"]`).click({ button: 'right' })
  return page.getByRole('button', { name: item, exact: true })
}

test('Given a deck with no frontmatter, when the user picks "1/N", then page_numbers: current_of_total is saved and "1/N" shows as selected', async ({ page }) => {
  const deck: MockDeck = { source: PLAIN_DECK }
  await openDeck(page, deck)
  await expect(choice(page, 'none')).toHaveAttribute('aria-checked', 'true')

  await choice(page, 'current_of_total').click()

  await expect.poll(() => deck.source).toMatch(/^---\npage_numbers: current_of_total\n---\n/)
  await expect(choice(page, 'current_of_total')).toHaveAttribute('aria-checked', 'true')
  await expect(choice(page, 'none')).toHaveAttribute('aria-checked', 'false')
})

test('Given numbers shown with two slides hiding theirs, when the user picks "Off", then the key and both page_number:false are removed, leaving a deck peitho accepts', async ({ page }) => {
  const deck: MockDeck = { source: NUMBERED_DECK }
  await openDeck(page, deck)
  await expect(choice(page, 'current')).toHaveAttribute('aria-checked', 'true')

  await choice(page, 'none').click()

  await expect.poll(() => deck.source).not.toContain('page_number')
  // The frontmatter held nothing else, so the whole block went with it:
  // peitho refuses an empty ---/--- block, and `<!-- {} -->` too.
  expect(deck.source.startsWith('---')).toBe(false)
  expect(deck.source).not.toContain('<!-- {} -->')
  expect(deck.source).toContain('<!-- {"key":"one"} -->\n# Slide One')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
  await expect(choice(page, 'none')).toHaveAttribute('aria-checked', 'true')
})

test('Given numbers turned off, when Edit > Undo is chosen once, then the setting and every slide\'s page_number:false come back together', async ({ page }) => {
  const deck: MockDeck = { source: NUMBERED_DECK }
  await openDeck(page, deck)
  await choice(page, 'none').click()
  await expect.poll(() => deck.source).not.toContain('page_number')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  await menu(page, 'undo')

  await expect.poll(() => deck.source).toContain('page_numbers: current\n')
  expect(deck.source.match(/"page_number":false/g)).toHaveLength(2)
  await expect(choice(page, 'current')).toHaveAttribute('aria-checked', 'true')

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

test('Given a deck with an unknown page_numbers value, when it is opened, then no option is selected and a marker explains the value; picking an option replaces it', async ({ page }) => {
  const deck: MockDeck = { source: `---\npage_numbers: both\n---\n${PLAIN_DECK}` }
  await openDeck(page, deck)

  for (const value of ['none', 'current', 'current_of_total'] as const) {
    await expect(choice(page, value)).toHaveAttribute('aria-checked', 'false')
  }
  await expect(page.locator('[data-page-numbers-unknown]')).toBeVisible()
  await expect(page.locator('[data-page-numbers-unknown]')).toHaveAttribute('title', /both/)

  await choice(page, 'current').click()

  await expect.poll(() => deck.source).toContain('page_numbers: current\n')
  expect(deck.source).not.toContain('both')
  await expect(page.locator('[data-page-numbers-unknown]')).toBeHidden()
})

test.describe('robustness', () => {
  test('Given peitho refuses the change, when the user picks "1", then the deck file is untouched, "Off" stays selected, and there is nothing to undo', async ({ page }) => {
    const deck: MockDeck = {
      source: PLAIN_DECK,
      commandError: (cmd, args) => cmd === 'render_draft' && String(args.content).includes('page_numbers') ? 'parse error: page_numbers' : null,
    }
    await openDeck(page, deck)

    await choice(page, 'current').click()

    await expect(page.getByText('parse error: page_numbers')).toBeVisible()
    expect(deck.source).toBe(PLAIN_DECK)
    await expect(choice(page, 'none')).toHaveAttribute('aria-checked', 'true')
    await expect(choice(page, 'current')).toHaveAttribute('aria-checked', 'false')

    // No step was recorded for the failed change, so Undo has nothing to take.
    const invoked: string[] = []
    deck.invokedCommands = invoked
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await menu(page, 'undo')
    await page.waitForTimeout(200)
    expect(invoked).not.toContain('save_deck_source')
    expect(deck.source).toBe(PLAIN_DECK)
  })

  test('Given "1" is already selected, when it is clicked again, then nothing is saved', async ({ page }) => {
    const deck: MockDeck = { source: `---\npage_numbers: current\n---\n${PLAIN_DECK}` }
    await openDeck(page, deck)
    const invoked: string[] = []
    deck.invokedCommands = invoked

    await choice(page, 'current').click()
    // A later pick still goes through, so the first one had its turn.
    await choice(page, 'none').click()
    await expect.poll(() => deck.source).not.toContain('page_numbers')

    expect(invoked.filter(cmd => cmd === 'save_deck_source')).toHaveLength(1)
  })
})
