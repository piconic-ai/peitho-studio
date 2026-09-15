// "Change Layout" with a layout the slide's content doesn't fit (see
// todo/layout-picker-mismatch-error.md). Previously the choice went straight
// to `commitChange`, the menu closed, and the only sign of trouble was
// peitho-core's raw build error flashing in the status bar. Now the picker
// dims layouts `check_slide_layouts` says the slide doesn't fit, and choosing
// one anyway keeps the menu open with the reason — deck.md untouched.
//
// `check_slide_layouts` is mocked here (see helpers/mockTauri.ts): these
// tests cover the frontend's handling of its verdicts. Whether the verdicts
// themselves match peitho-core is `engine::layout_fit`'s own Rust tests.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import type { LayoutVerdict } from '../domain/layoutFit'

const MISSING_BODY = "unassigned content remains for missing 'body' slot"
const NO_BODY = "slot 'body' got 0 item(s), but layout 'statement' allows 1..*"

const SOURCE = '<!-- {"key":"cover","layout":"cover"} -->\n# Cover\n\n---\n\n<!-- {"key":"what","layout":"statement"} -->\n# What\n\nA paragraph.\n'

/** A stand-in for peitho-core: a slide with a body only fits `statement`,
 * a title-only one only fits `cover`. */
function verdictsByContent(content: string, slideIndex: number): LayoutVerdict[] {
  const slide = content.split(/^---$/m)[slideIndex] ?? ''
  const hasBody = slide.replace(/<!--[\s\S]*?-->/g, '').split('\n').some(line => line.trim() !== '' && !line.startsWith('#'))
  return hasBody
    ? [{ layout: 'cover', fit: { kind: 'mismatch', reason: MISSING_BODY } }, { layout: 'statement', fit: { kind: 'fits' } }]
    : [{ layout: 'cover', fit: { kind: 'fits' } }, { layout: 'statement', fit: { kind: 'mismatch', reason: NO_BODY } }]
}

async function openLayoutPicker(page: Page, slideIndex: number): Promise<void> {
  await page.locator(`[data-slide-row="${String(slideIndex)}"]`).click({ button: 'right' })
  await page.getByRole('button', { name: /^Change Layout/ }).click()
}

function pickerEntry(page: Page, layout: string) {
  return page.locator(`button[data-key="${layout}"]`)
}

/** Clicks a dimmed (`aria-disabled="true"`) entry. Playwright's actionability
 * check treats `aria-disabled` as disabled and would wait forever, but a real
 * click still lands — which is the point: the picker explains the refusal. */
async function clickDimmedEntry(page: Page, layout: string): Promise<void> {
  await pickerEntry(page, layout).click({ force: true })
}

test('Given a slide with a body, when the user chooses a layout with nowhere to put the body, then the menu stays open with the reason and deck.md is untouched', async ({ page }) => {
  const deck: MockDeck = { source: SOURCE, layouts: ['cover', 'statement'], layoutVerdicts: verdictsByContent, invokedCommands: [] }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

  await openLayoutPicker(page, 1)
  const cover = pickerEntry(page, 'cover')
  await expect(cover).toHaveAttribute('aria-disabled', 'true')
  await expect(cover).toHaveAttribute('title', `"cover" doesn't fit this slide: ${MISSING_BODY}`)
  await expect(pickerEntry(page, 'statement')).toHaveAttribute('aria-disabled', 'false')

  const commandsBeforeChoice = deck.invokedCommands!.length
  await clickDimmedEntry(page, 'cover')

  const notice = page.getByRole('alert')
  await expect(notice).toBeVisible()
  await expect(notice).toHaveText(`"cover" doesn't fit this slide: ${MISSING_BODY}`)
  // Still open: the picker entries are still there to choose from.
  await expect(pickerEntry(page, 'statement')).toBeVisible()
  expect(deck.source).toBe(SOURCE)
  expect(deck.invokedCommands!.slice(commandsBeforeChoice)).not.toContain('render_draft')
  expect(deck.invokedCommands!.slice(commandsBeforeChoice)).not.toContain('save_deck_source')
})

test('Given a title-only slide, when the user chooses a layout it fits, then the layout is pinned and the menu closes', async ({ page }) => {
  const deck: MockDeck = {
    source: '<!-- {"key":"cover","layout":"statement"} -->\n# Cover\n\n---\n\n<!-- {"key":"what","layout":"statement"} -->\n# What\n\nA paragraph.\n',
    layouts: ['cover', 'statement'],
    layoutVerdicts: verdictsByContent,
  }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

  await openLayoutPicker(page, 0)
  await expect(pickerEntry(page, 'statement')).toHaveAttribute('aria-disabled', 'true')
  await pickerEntry(page, 'cover').click()

  await expect(pickerEntry(page, 'cover')).toBeHidden()
  await expect.poll(() => deck.source.split(/^---$/m)[0]).toContain('"layout":"cover"')
  await expect(page.getByRole('alert')).toBeHidden()
})

test('Given a refused layout, when the menu is closed and reopened, then the old reason is gone', async ({ page }) => {
  const deck: MockDeck = { source: SOURCE, layouts: ['cover', 'statement'], layoutVerdicts: verdictsByContent }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

  await openLayoutPicker(page, 1)
  await clickDimmedEntry(page, 'cover')
  await expect(page.getByRole('alert')).toBeVisible()

  await page.keyboard.press('Escape')
  await openLayoutPicker(page, 1)

  await expect(pickerEntry(page, 'cover')).toBeVisible()
  await expect(page.getByRole('alert')).toBeHidden()
})

test('Given unsaved edits that give a title-only slide a body, when its layouts are checked, then the check judges the edited content', async ({ page }) => {
  const contents: string[] = []
  const deck: MockDeck = {
    source: SOURCE,
    layouts: ['cover', 'statement'],
    layoutVerdicts: (content, slideIndex) => { contents.push(content); return verdictsByContent(content, slideIndex) },
    // Keep the edit unsaved, so the only place it exists is the editor's draft.
    commandError: cmd => (cmd === 'save_deck_source' ? 'simulated save failure' : null),
  }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

  await page.locator('[data-slide-row="0"]').click()
  const body = page.locator('textarea').first()
  await body.fill('# Cover\n\nA brand-new paragraph.')
  // Let the slow save lane try (and fail) so the draft is still dirty.
  await expect(page.getByText('simulated save failure')).toBeVisible({ timeout: 5_000 })

  await openLayoutPicker(page, 0)

  await expect(pickerEntry(page, 'cover')).toHaveAttribute('aria-disabled', 'true')
  expect(contents.at(-1)).toContain('A brand-new paragraph.')
  expect(deck.source).toBe(SOURCE)
})

test.describe('non-functional', () => {
  test('Given the fit check is still running, when the user clicks a layout, then nothing is applied and the picker says it is still checking', async ({ page }) => {
    const deck: MockDeck = {
      source: SOURCE,
      layouts: ['cover', 'statement'],
      layoutVerdicts: verdictsByContent,
      checkSlideLayoutsDelayMs: 1_500,
    }
    await mockTauri(page, deck)
    await page.goto('/')
    await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

    await openLayoutPicker(page, 1)
    await expect(pickerEntry(page, 'statement')).toHaveAttribute('aria-disabled', 'true')
    await clickDimmedEntry(page, 'cover')
    await expect(page.getByRole('alert')).toHaveText(/^Still checking which layouts fit this slide/)
    expect(deck.source).toBe(SOURCE)

    // Once the answer lands, the fitting layout becomes choosable.
    await expect(pickerEntry(page, 'statement')).toHaveAttribute('aria-disabled', 'false', { timeout: 5_000 })
    await expect(pickerEntry(page, 'cover')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('alert')).toBeHidden()
    expect(deck.source).toBe(SOURCE)
  })

  test('Given the fit check fails, when the user chooses a layout, then it is applied as before (never blocked)', async ({ page }) => {
    const deck: MockDeck = {
      source: SOURCE,
      layouts: ['cover', 'statement'],
      commandError: cmd => (cmd === 'check_slide_layouts' ? 'deck has no slides' : null),
    }
    await mockTauri(page, deck)
    await page.goto('/')
    await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

    await openLayoutPicker(page, 0)
    await expect(pickerEntry(page, 'statement')).toHaveAttribute('aria-disabled', 'false')
    await pickerEntry(page, 'statement').click()

    await expect.poll(() => deck.source.split(/^---$/m)[0]).toContain('"layout":"statement"')
  })
})
