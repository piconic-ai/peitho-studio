// The preview pane's PC / phone toggle (todo/preview-viewport-toggle.md).
// Pressing it hands the preview slide a phone-shaped canvas: the deck's width
// grown to the phone's proportion, fed to the slide host as
// `--peitho-canvas-width/height`. A deck whose CSS branches on the canvas's
// own shape (`@container`) then lays itself out for a tall canvas.
//
// This runs on Chrome against a mocked backend, so it pins the frontend's
// own wiring (toggle -> Studio's canvas memos -> SlidePreview's mount effect
// -> the host's variables and scale). What it cannot show is the real
// WKWebView painting the result or a real deck's CSS; those stay on the
// human checklist in the todo.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { containScale } from '../domain/geometry'

const TOGGLE = '[data-viewport-toggle]'
const PREVIEW = '[data-preview-host]'
const THUMBNAILS = '[data-slide-canvas-key]:not([data-preview-host])'

// The canvas height a 1280-wide deck gets in PC display and in phone display
// (390x844), and the probe colours below.
const PC_HEIGHT = '720px'
const PHONE_HEIGHT = '2770px'
const BLUE = 'rgb(0, 0, 255)'
const RED = 'rgb(255, 0, 0)'

// The middle slide opts out of the phone canvas, as a layout authored in
// absolute 16:9 coordinates does. Keys are pinned so that retyping a title
// below never changes which slide is selected.
const SOURCE = [
  '<!-- {"key":"wide"} -->\n# Wide slide\n',
  '<!-- {"key":"arcade"} -->\n# Fixed arcade\n',
  '<!-- {"key":"another"} -->\n# Another slide\n',
].join('\n---\n\n')

function fragmentFor(title: string): string {
  const fixed = title.startsWith('Fixed') ? ' data-canvas="fixed"' : ''
  return `<section class="peitho-slide"${fixed}><h1>${title}</h1><p class="layout-probe">probe</p></section>`
}

// What the built-in theme gives `.peitho-slide` (its size from the canvas
// variables), plus the one thing a deck must add to react to the canvas's
// shape: `container-type: size`. The probe is blue on a landscape canvas and
// red on a portrait one.
const CONTAINER_QUERY_CSS = `
.peitho-slide { width: var(--peitho-canvas-width, 1280px); height: var(--peitho-canvas-height, 720px); container-type: size; }
.peitho-slide .layout-probe { color: ${BLUE}; }
@container (max-aspect-ratio: 1) { .peitho-slide .layout-probe { color: ${RED}; } }
`

const deckWith = (overrides: Partial<MockDeck> = {}): MockDeck => ({ source: SOURCE, fragmentFor, css: CONTAINER_QUERY_CSS, ...overrides })

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })
  await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'wide')
}

function inlineVar(page: Page, selector: string, name: string): Promise<string> {
  return page.locator(selector).first().evaluate((el, n) => (el as HTMLElement).style.getPropertyValue(n), name)
}

const previewCanvasHeight = (page: Page): Promise<string> => inlineVar(page, PREVIEW, '--peitho-canvas-height')
const previewCanvasWidth = (page: Page): Promise<string> => inlineVar(page, PREVIEW, '--peitho-canvas-width')

/** The colour the deck's own `@container` rule gives the probe inside the preview. */
function previewProbeColor(page: Page): Promise<string | null> {
  return page.locator(PREVIEW).evaluate(host => {
    const probe = host.shadowRoot?.querySelector('.layout-probe')
    return probe ? getComputedStyle(probe).color : null
  })
}

/** How far the preview's `--peitho-thumb-scale` is from what fitting its
 * canvas into the host's current box gives (`containScale`). 0 means the
 * scale follows the canvas. */
async function scaleMisfit(page: Page): Promise<number> {
  const { box, canvas, scale } = await page.locator(PREVIEW).evaluate(el => {
    const host = el as HTMLElement
    const read = (name: string): number => parseFloat(host.style.getPropertyValue(name))
    const { width, height } = host.getBoundingClientRect()
    return {
      box: { width, height },
      canvas: { width: read('--peitho-canvas-width'), height: read('--peitho-canvas-height') },
      scale: read('--peitho-thumb-scale'),
    }
  })
  return Math.abs(scale - containScale(box, canvas))
}

const previewScale = (page: Page): Promise<number> => page.locator(PREVIEW).evaluate(el => parseFloat((el as HTMLElement).style.getPropertyValue('--peitho-thumb-scale')))

/** How many slides the preview's shadow root holds (there must only be one). */
const previewSlideCount = (page: Page): Promise<number | undefined> => page.locator(PREVIEW).evaluate(host => host.shadowRoot?.querySelectorAll('.peitho-slide').length)

async function press(page: Page, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) await page.locator(TOGGLE).click()
}

test.describe('Given a 16:9 deck (1280x720) with a normal slide selected', () => {
  test('when the user presses the phone toggle, then the preview canvas becomes 1280x2770, and pressing again restores 1280x720', async ({ page }) => {
    await openDeck(page, deckWith())
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'false')
    expect(await previewCanvasWidth(page)).toBe('1280px')
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)

    await press(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    expect(await previewCanvasWidth(page)).toBe('1280px')

    await press(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    expect(await previewCanvasWidth(page)).toBe('1280px')
  })

  test('when the user presses the phone toggle, then the slide shrinks to fit the tall canvas, and PC display brings the old size back', async ({ page }) => {
    await openDeck(page, deckWith())
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    const pcScale = await previewScale(page)

    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    // The host's own box never changed size, so only a re-fit against the new
    // canvas moves this (see `observeCanvasScale`).
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    expect(await previewScale(page)).toBeLessThan(pcScale)

    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    expect(await previewScale(page)).toBeCloseTo(pcScale, 3)
  })

  test('when the deck\'s CSS branches on the canvas\'s shape with @container, then phone display fires the tall-canvas branch and PC display does not', async ({ page }) => {
    await openDeck(page, deckWith())
    await expect.poll(() => previewProbeColor(page)).toBe(BLUE)

    await press(page)
    await expect.poll(() => previewProbeColor(page)).toBe(RED)

    await press(page)
    await expect.poll(() => previewProbeColor(page)).toBe(BLUE)
  })

  test('when the user presses the phone toggle, then the thumbnails keep the deck\'s own canvas', async ({ page }) => {
    await openDeck(page, deckWith())

    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    const thumbnailHeights = await page.locator(THUMBNAILS).evaluateAll(hosts => hosts.map(host => (host as HTMLElement).style.getPropertyValue('--peitho-canvas-height')))
    expect(thumbnailHeights).toEqual([PC_HEIGHT, PC_HEIGHT, PC_HEIGHT])
  })

  test('when the user presses the phone toggle, then the layout picker keeps the deck\'s own canvas', async ({ page }) => {
    await openDeck(page, deckWith({ layouts: ['cover'], layoutFragment: fragmentFor('Layout') }))

    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    await page.locator('[data-slide-row="0"]').click({ button: 'right' })
    await page.getByRole('button', { name: /^Change Layout/ }).click()
    const pickerCanvas = 'button[data-key="cover"] div'
    await expect(page.locator(pickerCanvas)).toHaveCount(1)
    expect(await inlineVar(page, pickerCanvas, '--peitho-canvas-height')).toBe(PC_HEIGHT)
  })
})

test.describe('Given a slide marked data-canvas="fixed"', () => {
  test('when the user presses the phone toggle, then the preview canvas stays 1280x720 and the tall-canvas branch does not fire', async ({ page }) => {
    await openDeck(page, deckWith())
    await page.locator('[data-slide-row="1"]').click()
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'arcade')

    await press(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')

    // "Nothing changed" cannot be polled for, so let two frames pass first:
    // a wrong canvas would have been applied (and the tall-canvas branch
    // fired) by then.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await previewProbeColor(page)).toBe(BLUE)
    expect(await previewCanvasWidth(page)).toBe('1280px')
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)
  })

  test('when phone display is on and the user moves between fixed and ordinary slides, then each slide gets its own canvas', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    await page.locator('[data-slide-row="1"]').click()
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'arcade')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)

    await page.locator('[data-slide-row="2"]').click()
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'another')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    await expect.poll(() => previewProbeColor(page)).toBe(RED)
  })
})

test.describe('Given a 4:3 deck (960x720)', () => {
  test('when the user presses the phone toggle, then the preview canvas becomes 960x2078 (the phone\'s proportion, rounded to a whole pixel)', async ({ page }) => {
    await openDeck(page, deckWith({ canvas: { width: 960, height: 720 } }))
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)

    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe('2078px')
    expect(await previewCanvasWidth(page)).toBe('960px')
  })
})

test.describe('Given the phone toggle (non-functional behavior)', () => {
  test('when it is pressed many times in quick succession, then the preview ends in the state the last press asked for, with a single slide mounted and the scale fitted', async ({ page }) => {
    await openDeck(page, deckWith())

    await press(page, 7)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    await expect.poll(() => previewProbeColor(page)).toBe(RED)
    expect(await previewSlideCount(page)).toBe(1)

    await press(page, 4)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')
    await press(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    expect(await previewSlideCount(page)).toBe(1)
  })

  test('when the user edits the selected slide in phone display, then the preview follows the text without re-mounting, and the canvas stays 1280x2770', async ({ page }) => {
    // Counts every time the preview's mount effect runs: it ends each run by
    // observing the host. A canvas memo that handed out a fresh object per
    // edit would re-run it on every keystroke.
    await page.addInitScript(() => {
      const counter = window as unknown as { __previewObserveCalls: number }
      counter.__previewObserveCalls = 0
      const observe = ResizeObserver.prototype.observe
      ResizeObserver.prototype.observe = function (target: Element, options?: ResizeObserverOptions) {
        if (target.hasAttribute('data-preview-host')) counter.__previewObserveCalls += 1
        return observe.call(this, target, options)
      }
    })
    const observeCalls = (): Promise<number> => page.evaluate(() => (window as unknown as { __previewObserveCalls: number }).__previewObserveCalls)
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    const before = await observeCalls()
    expect(before).toBeGreaterThan(0)

    const previewHeading = (): Promise<string | null> => page.locator(PREVIEW).evaluate(host => host.shadowRoot?.querySelector('h1')?.textContent ?? null)
    await page.locator('[data-slide-row="0"]').click()
    const afterSelecting = await observeCalls()
    for (const title of ['Wide slide, edited', 'Wide slide, edited again', 'Wide slide, edited a third time']) {
      await page.locator('textarea').first().fill(`# ${title}\n`)
      await expect.poll(previewHeading).toBe(title)
    }

    expect(await observeCalls()).toBe(afterSelecting)
    expect(await previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    expect(await previewProbeColor(page)).toBe(RED)
  })

  test('when the page is reloaded, then the preview starts in PC display again (the choice is not persisted)', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    await page.reload()
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'wide')
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'false')
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)
  })
})
