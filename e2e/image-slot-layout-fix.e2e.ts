// An image put on a slide whose layout has no slot for one: peitho-core's
// "no slot accepts image" build error now comes with a way out in the error
// bar (todo/image-slot-layout-suggestion.md) — the "Change Layout" picker
// when another layout of the deck fits the slide, or adding the built-in
// `title-body-image` layout when none does.
//
// peitho-core is mocked (see helpers/mockTauri.ts): `render_draft` fails
// with its real error text for an image on a layout without an image slot,
// `check_slide_layouts` answers from the same rule, and `add_image_layout`
// just records that the layout now exists. Whether the real engine agrees
// — what gets written, and that no other slide changes — is
// `engine::image_layout`'s own Rust tests.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, moveToEditorEnd } from './helpers/codeEditor'
import type { LayoutVerdict } from '../domain/layoutFit'

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]
const IMAGE_LAYOUTS = new Set(['photo', 'title-body-image'])

/** A stand-in for peitho-core's layouts: `layouts` are the deck's, of which
 * only `photo` and `title-body-image` take an image. */
interface FakeEngine {
  layouts: string[]
}

function slidesOf(content: string): string[] {
  return content.split(/^---$/m)
}

function pinOf(slide: string): string | undefined {
  return /"layout":"([^"]+)"/.exec(slide)?.[1]
}

function keyOf(slide: string, index: number): string {
  return /"key":"([^"]+)"/.exec(slide)?.[1] ?? `slide-${String(index + 1)}`
}

/** The layout a slide ends up on, or `null` for no match — a pin wins, a
 * lone layout is used as is, otherwise the one that takes (or doesn't take)
 * an image, as the slide needs. */
function layoutOf(engine: FakeEngine, slide: string): string | null {
  const pin = pinOf(slide)
  if (pin !== undefined) return engine.layouts.includes(pin) ? pin : null
  if (engine.layouts.length === 1) return engine.layouts[0]
  const hasImage = slide.includes('![](')
  const matches = engine.layouts.filter(layout => IMAGE_LAYOUTS.has(layout) === hasImage)
  return matches.length === 1 ? matches[0] : null
}

/** `render_draft`'s error for `content`, worded as peitho-core words it. */
function renderError(engine: FakeEngine, content: string): string | null {
  const slides = slidesOf(content)
  for (const [index, slide] of slides.entries()) {
    if (!slide.includes('![](')) continue
    const layout = layoutOf(engine, slide) ?? engine.layouts[0]
    if (IMAGE_LAYOUTS.has(layout)) continue
    return `slide ${String(index + 1)} ('${keyOf(slide, index)}'), line 3: no slot accepts image in layout '${layout}'\n  = help: add exactly one slot with accepts="image" or remove the image`
  }
  return null
}

function verdicts(engine: FakeEngine, content: string, slideIndex: number): LayoutVerdict[] {
  const hasImage = (slidesOf(content)[slideIndex] ?? '').includes('![](')
  return engine.layouts.map(layout => (
    IMAGE_LAYOUTS.has(layout) || !hasImage
      ? { layout, fit: { kind: 'fits' } }
      : { layout, fit: { kind: 'mismatch', reason: `no slot accepts image in layout '${layout}'` } }
  ))
}

interface Invocation { cmd: string; args: Record<string, unknown> }

async function openDeck(page: Page, source: string, engine: FakeEngine, overrides: Partial<MockDeck> = {}): Promise<{ deck: MockDeck; invocations: Invocation[] }> {
  const invocations: Invocation[] = []
  const deck: MockDeck = {
    source,
    layouts: engine.layouts,
    layoutVerdicts: (content, slideIndex) => verdicts(engine, content, slideIndex),
    commandError: (cmd, args) => (cmd === 'render_draft' ? renderError(engine, args.content as string) : null),
    addImageLayout: () => {
      engine.layouts.push('title-body-image')
      return ['layouts/title-body-image.html', 'css/title-body-image.css']
    },
    onInvoke: (cmd, args) => { invocations.push({ cmd, args }) },
    ...overrides,
  }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(slidesOf(source).length, { timeout: 10_000 })
  return { deck, invocations }
}

async function pasteImage(page: Page): Promise<void> {
  await moveToEditorEnd(page)
  await editorContent(page).evaluate((content, bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }))
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, PNG_BYTES)
}

const fixButton = (page: Page) => page.locator('[data-image-slot-fix]')
const errorBar = (page: Page) => page.getByText('no slot accepts image in layout')

// Studio pins a new slide to the layout of the one before it, so a slide
// pinned to a layout with no image slot is the common case.
const PINNED = '<!-- {"key":"one","layout":"title-body-code"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two","layout":"title-body-code"} -->\n# Slide Two\n'
const UNPINNED = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'

test.describe('functional', () => {
  test('Given a deck with a layout that takes an image, when an image is pasted onto a slide pinned to one that does not, then the error bar opens the layout picker for that slide and choosing the fitting layout fixes it', async ({ page }) => {
    const { deck } = await openDeck(page, PINNED, { layouts: ['photo', 'title-body-code'] })

    await pasteImage(page)

    await expect(errorBar(page)).toBeVisible()
    await expect(fixButton(page)).toHaveText('Choose a Layout That Fits…')
    await fixButton(page).click()

    const photo = page.locator('button[data-key="photo"]')
    await expect(photo).toBeVisible()
    await expect(photo).toHaveAttribute('aria-disabled', 'false')
    await expect(page.locator('button[data-key="title-body-code"]')).toHaveAttribute('aria-disabled', 'true')
    await photo.click()

    await expect.poll(() => slidesOf(deck.source)[0]).toContain('"layout":"photo"')
    expect(slidesOf(deck.source)[0]).toContain('![](img/')
    expect(slidesOf(deck.source)[1]).toContain('"layout":"title-body-code"')
    await expect(errorBar(page)).toBeHidden()
  })

  test('Given a deck with no layout that takes an image, when an image is pasted onto a pinned slide and the image layout is added from the error bar, then that slide is re-pinned to it and renders', async ({ page }) => {
    const { deck, invocations } = await openDeck(page, PINNED, { layouts: ['title-body-code'] })

    await pasteImage(page)

    await expect(fixButton(page)).toHaveText('Add an Image Layout')
    await fixButton(page).click()

    await expect.poll(() => slidesOf(deck.source)[0]).toContain('"layout":"title-body-image"')
    const call = invocations.find(invocation => invocation.cmd === 'add_image_layout')
    expect(call?.args.slideIndex).toBe(0)
    // Rust checks the deck as it will be: the draft's image, the new pin.
    expect(slidesOf(call?.args.content as string)[0]).toContain('"layout":"title-body-image"')
    expect(slidesOf(call?.args.content as string)[0]).toContain('![](img/')
    expect(slidesOf(deck.source)[0]).toContain('![](img/')
    expect(slidesOf(deck.source)[1]).toContain('"layout":"title-body-code"')
    await expect(errorBar(page)).toBeHidden()
    await expect(page.getByText('Added the title-body-image layout to layouts/')).toBeVisible()
  })

  test('Given a deck with one layout and unpinned slides, when the image layout is added from the error bar, then the slide keeps no pin and its image is saved', async ({ page }) => {
    const { deck, invocations } = await openDeck(page, UNPINNED, { layouts: ['title-body-code'] })

    await pasteImage(page)
    await fixButton(page).click()

    await expect.poll(() => slidesOf(deck.source)[0]).toContain('![](img/')
    expect(slidesOf(deck.source)[0]).not.toContain('"layout"')
    const call = invocations.find(invocation => invocation.cmd === 'add_image_layout')
    expect(slidesOf(call?.args.content as string)[0]).not.toContain('"layout"')
    await expect(errorBar(page)).toBeHidden()
  })

  test('Given the image layout being added, when the command has not answered yet, then the button is disabled and says so until it does', async ({ page }) => {
    const engine: FakeEngine = { layouts: ['title-body-code'] }
    let finish = () => {}
    const { invocations } = await openDeck(page, PINNED, engine, {
      addImageLayout: () => new Promise<string[]>(resolve => {
        finish = () => {
          engine.layouts.push('title-body-image')
          resolve(['layouts/title-body-image.html', 'css/title-body-image.css'])
        }
      }),
    })

    await pasteImage(page)
    await fixButton(page).click()

    await expect(fixButton(page)).toBeDisabled()
    await expect(fixButton(page)).toHaveText('Adding the Image Layout…')
    await fixButton(page).click({ force: true })
    expect(invocations.filter(invocation => invocation.cmd === 'add_image_layout')).toHaveLength(1)

    finish()
    await expect(errorBar(page)).toBeHidden()
    await expect(page.getByText('Added the title-body-image layout to layouts/')).toBeVisible()
  })

  test('Given the image layout would break another slide, when it is added from the error bar, then the reason is shown and the slide keeps its pin', async ({ page }) => {
    const { deck } = await openDeck(page, PINNED, { layouts: ['title-body-code'] }, {
      commandError: (cmd, args) => {
        if (cmd === 'add_image_layout') return "adding the 'title-body-image' layout would stop slide 2 ('two') from building on 'title-body-code' — pick its layout explicitly first"
        return cmd === 'render_draft' ? renderError({ layouts: ['title-body-code'] }, args.content as string) : null
      },
    })

    await pasteImage(page)
    await fixButton(page).click()

    await expect(page.getByText(/Could not add the image layout: .*would stop slide 2 \('two'\)/)).toBeVisible()
    await expect(fixButton(page)).toBeHidden()
    expect(deck.source).toBe(PINNED)
  })

  test('Given a build error that is not about an image slot, when it is shown, then no fix is offered', async ({ page }) => {
    await openDeck(page, PINNED, { layouts: ['title-body-code'] }, {
      commandError: cmd => (cmd === 'render_draft' ? "slide 1 ('one'), line 3: unassigned content remains for missing 'body' slot" : null),
    })

    await moveToEditorEnd(page)
    await page.keyboard.type('\n\nMore text')

    await expect(page.getByText('unassigned content remains')).toBeVisible()
    await expect(fixButton(page)).toBeHidden()
  })
})

test.describe('non-functional', () => {
  test('Given an image slot error with a fix offered, when the usual six seconds pass, then the error bar stays so the fix can still be used', async ({ page }) => {
    await openDeck(page, PINNED, { layouts: ['title-body-code'] })

    await pasteImage(page)
    await expect(fixButton(page)).toBeVisible()

    await page.waitForTimeout(7_000)
    await expect(errorBar(page)).toBeVisible()
    await expect(fixButton(page)).toBeVisible()
  })
})
