// "Change Layout" with a layout the slide's content doesn't fit. The picker
// marks layouts `check_slide_layouts` says the slide doesn't fit (⚠, with
// peitho-core's reason on hover), but choosing one still pins it: a new
// slide (a lone heading) has to be able to take a layout whose image is
// required before the image is added. The build error that leaves until the
// content fits shows in the error bar like any other.
//
// `check_slide_layouts` is mocked here (see helpers/mockTauri.ts): these
// tests cover the frontend's handling of its verdicts. Whether the verdicts
// themselves match peitho-core is `engine::layout_fit`'s own Rust tests.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorText, fillEditor } from './helpers/codeEditor'
import type { LayoutVerdict } from '../domain/layoutFit'
import type { RenderErrorPayload } from '../domain/render'
import { extractPageComment, splitSlides } from '../domain/slides'

const MISSING_BODY = "unassigned content remains for missing 'body' slot"
const NO_BODY = "slot 'body' got 0 item(s), but layout 'statement' allows 1..*"
const MISSING_IMAGE = "slot 'image' got 0 item(s), but layout 'title-body-image' allows 1..1"
const ERROR_BAR = '.bg-destructive\\/10'

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

test('Given a slide with a body, when the user chooses a layout with nowhere to put the body, then the layout is pinned anyway and the menu closes', async ({ page }) => {
  const deck: MockDeck = { source: SOURCE, layouts: ['cover', 'statement'], layoutVerdicts: verdictsByContent }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

  await openLayoutPicker(page, 1)
  const cover = pickerEntry(page, 'cover')
  await expect(cover).toHaveAttribute('data-layout-mismatch', 'true')
  await expect(cover).toHaveAttribute('title', `"cover" doesn't fit this slide: ${MISSING_BODY}`)
  await expect(cover).toContainText('⚠')
  await expect(pickerEntry(page, 'statement')).toHaveAttribute('data-layout-mismatch', 'false')
  await expect(pickerEntry(page, 'statement')).not.toContainText('⚠')

  await cover.click()

  await expect(cover).toBeHidden()
  await expect.poll(() => deck.source.split(/^---$/m)[1]).toContain('"layout":"cover"')
})

test('Given a new slide holding only a heading, when the user chooses the image layout it is missing an image for, then the layout is pinned', async ({ page }) => {
  const deck: MockDeck = {
    source: '<!-- {"key":"intro","layout":"title-body"} -->\n# Intro\n\nHello.\n',
    layouts: ['title-body', 'title-body-image'],
    layoutVerdicts: () => [
      { layout: 'title-body', fit: { kind: 'fits' } },
      { layout: 'title-body-image', fit: { kind: 'mismatch', reason: MISSING_IMAGE } },
    ],
  }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByText('New Slide', { exact: true }).click()
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)

  await openLayoutPicker(page, 1)
  await expect(pickerEntry(page, 'title-body-image')).toHaveAttribute('data-layout-mismatch', 'true')
  await pickerEntry(page, 'title-body-image').click()

  await expect.poll(() => deck.source.split(/^---$/m)[1]).toContain('"layout":"title-body-image"')
})


/** peitho-core's refusal of a non-draft slide pinned to the image layout
 * without an image — attributed to that slide, as the real engine does. */
function missingImageError(content: string): RenderErrorPayload | null {
  const ranges = splitSlides(content)
  for (let i = 0; i < ranges.length; i++) {
    const { config } = extractPageComment(ranges[i].text)
    if (config.draft === true || config.layout !== 'title-body-image' || ranges[i].text.includes('![')) continue
    const key = config.key ?? null
    return {
      kind: 'Arity', line: 1, originFile: null, message: MISSING_IMAGE, help: 'add content for the image slot',
      headline: `slide ${String(i + 1)}${key === null ? '' : ` ('${key}')`}: ${MISSING_IMAGE}`,
      slide: { number: i + 1, key },
    }
  }
  return null
}

test('Given a deck whose only slide holds just a heading, when the user chooses the image layout, then the pin is saved though nothing is left to render, and adding the image renders it', async ({ page }) => {
  const deck: MockDeck = {
    source: '<!-- {"key":"only","layout":"title-body"} -->\n# Only\n',
    layouts: ['title-body', 'title-body-image'],
    renderError: missingImageError,
    layoutVerdicts: () => [
      { layout: 'title-body', fit: { kind: 'fits' } },
      { layout: 'title-body-image', fit: { kind: 'mismatch', reason: MISSING_IMAGE } },
    ],
  }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  await openLayoutPicker(page, 0)
  await pickerEntry(page, 'title-body-image').click()

  await expect.poll(() => deck.source).toContain('"layout":"title-body-image"')
  await expect(page.locator(ERROR_BAR)).toContainText(MISSING_IMAGE)

  await page.locator('[data-slide-row="0"]').click()
  await expect.poll(() => editorText(page)).toBe('# Only')
  await fillEditor(page, '# Only\n\n![](img/photo.png)')
  await expect.poll(() => deck.source, { timeout: 10_000 }).toContain('![](img/photo.png)')
  await expect(page.locator(ERROR_BAR)).toBeHidden({ timeout: 10_000 })
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
  await expect(pickerEntry(page, 'statement')).toHaveAttribute('data-layout-mismatch', 'true')
  await pickerEntry(page, 'cover').click()

  await expect(pickerEntry(page, 'cover')).toBeHidden()
  await expect.poll(() => deck.source.split(/^---$/m)[0]).toContain('"layout":"cover"')
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
  await fillEditor(page, '# Cover\n\nA brand-new paragraph.')
  // Let the slow save lane try (and fail) so the draft is still dirty.
  await expect(page.getByText('simulated save failure')).toBeVisible({ timeout: 5_000 })

  await openLayoutPicker(page, 0)

  await expect(pickerEntry(page, 'cover')).toHaveAttribute('data-layout-mismatch', 'true')
  expect(contents.at(-1)).toContain('A brand-new paragraph.')
  expect(deck.source).toBe(SOURCE)
})

test.describe('non-functional', () => {
  test('Given the fit check is still running, when the user clicks a layout, then it is applied without waiting for the check', async ({ page }) => {
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
    // Nothing is marked before the check answers.
    await expect(pickerEntry(page, 'cover')).toHaveAttribute('data-layout-mismatch', 'false')
    await pickerEntry(page, 'cover').click()

    await expect.poll(() => deck.source.split(/^---$/m)[1]).toContain('"layout":"cover"')
  })

  test('Given the fit check fails, when the user chooses a layout, then it is applied and nothing is marked', async ({ page }) => {
    const deck: MockDeck = {
      source: SOURCE,
      layouts: ['cover', 'statement'],
      commandError: cmd => (cmd === 'check_slide_layouts' ? 'deck has no slides' : null),
    }
    await mockTauri(page, deck)
    await page.goto('/')
    await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

    await openLayoutPicker(page, 0)
    await expect(pickerEntry(page, 'statement')).toHaveAttribute('data-layout-mismatch', 'false')
    await pickerEntry(page, 'statement').click()

    await expect.poll(() => deck.source.split(/^---$/m)[0]).toContain('"layout":"statement"')
  })
})
