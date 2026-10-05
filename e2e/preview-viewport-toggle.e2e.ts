// The preview pane's PC / phone toggle (todo/archive/preview-viewport-toggle.md).
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
//
// Phone display has a second choice, its shape, picked from a menu the ▾
// beside the Phone segment opens: a device's proportion (a small phone, the
// standard phone by default, a large phone or a tablet —
// todo/viewport-device-presets.md) or the deck's own ("same ratio as PC"),
// which by design gives the same
// canvas size as PC display. The header's controls are icons, with their
// words in `aria-label`/`title`.
//
// On a device preset the slide is drawn at the device's real CSS width (the
// canvas scaled by device width / canvas width), centred; a panel too small
// for that fits it instead and says "Scaled to N%".
import { test, expect, type Locator, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { fillEditor } from './helpers/codeEditor'
import { previewCanvasScale, type PhoneShape } from '../domain/viewport'

// The slide preview's own switch: the layout list has one too.
const PREVIEW_PANE = '[data-panel="preview"]'
const TOGGLE = `${PREVIEW_PANE} [data-viewport-toggle]`
const MENU_BUTTON = `${PREVIEW_PANE} [data-phone-shape-menu-button]`
const MENU = `${PREVIEW_PANE} [data-phone-shape-menu]`
const OPTION = (shape: PhoneShape): string => `${PREVIEW_PANE} [data-phone-shape-option="${shape}"]`
const PREVIEW = '[data-preview-host]'
const THUMBNAILS = '[data-slide-canvas-key]:not([data-preview-host])'

// The canvas height a 1280-wide deck gets in PC display and in phone display
// (the standard phone, 390x664), and the probe colours below.
const PC_HEIGHT = '720px'
const PHONE_HEIGHT = '2179px'
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

async function openDeck(page: Page, deck: MockDeck, firstKey = 'wide'): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })
  await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', firstKey)
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

/** How far the preview's `--peitho-thumb-scale` is from what its canvas
 * should be drawn at in the host's current box (`previewCanvasScale`: filling
 * the box, or a device's real width in phone display). 0 means the scale
 * follows the canvas. */
async function scaleMisfit(page: Page): Promise<number> {
  const { box, canvas, scale, deviceWidth } = await page.locator(PREVIEW).evaluate(el => {
    const host = el as HTMLElement
    const read = (name: string): number => parseFloat(host.style.getPropertyValue(name))
    const { width, height } = host.getBoundingClientRect()
    const device = host.dataset.previewDeviceWidth ?? ''
    return {
      box: { width, height },
      canvas: { width: read('--peitho-canvas-width'), height: read('--peitho-canvas-height') },
      scale: read('--peitho-thumb-scale'),
      deviceWidth: device === '' ? null : Number(device),
    }
  })
  return Math.abs(scale - previewCanvasScale(box, canvas, deviceWidth))
}

/** The slide's box as drawn on screen (after its scale), in CSS px. */
const previewSlideBox = (page: Page): Promise<{ width: number; height: number } | null> => page.locator(PREVIEW).evaluate(host => {
  const slide = host.shadowRoot?.querySelector('.peitho-slide')
  if (!slide) return null
  const { width, height } = slide.getBoundingClientRect()
  return { width, height }
})

/** The preview's "Scaled to N%" label, shown only while a device is drawn
 * smaller than its real size. */
const SCALE_LABEL = `${PREVIEW_PANE} [data-preview-scale-label]`

/** A window big enough for the preview pane to hold even the large phone at
 * real size (430 wide, 740 tall). */
async function useRoomyWindow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 2400, height: 1400 })
}

const previewScale = (page: Page): Promise<number> => page.locator(PREVIEW).evaluate(el => parseFloat((el as HTMLElement).style.getPropertyValue('--peitho-thumb-scale')))

/** How many slides the preview's shadow root holds (there must only be one). */
const previewSlideCount = (page: Page): Promise<number | undefined> => page.locator(PREVIEW).evaluate(host => host.shadowRoot?.querySelectorAll('.peitho-slide').length)

/** The canvas height every slide-list thumbnail was mounted with. */
const thumbnailHeights = (page: Page): Promise<string[]> => page.locator(THUMBNAILS).evaluateAll(hosts => hosts.map(host => (host as HTMLElement).style.getPropertyValue('--peitho-canvas-height')))

/** The first heading of the slide the preview currently shows. */
const previewHeading = (page: Page): Promise<string | null> => page.locator(PREVIEW).evaluate(host => host.shadowRoot?.querySelector('h1')?.textContent ?? null)

/** Counts every time the preview's mount effect runs: it ends each run by
 * observing the host, so a canvas memo that handed out a fresh object per edit
 * would show up as one count per keystroke. Call it before `openDeck`; it
 * returns the reader. */
async function countPreviewMounts(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const counter = window as unknown as { __previewObserveCalls: number }
    counter.__previewObserveCalls = 0
    const observe = ResizeObserver.prototype.observe
    ResizeObserver.prototype.observe = function (target: Element, options?: ResizeObserverOptions) {
      if (target.hasAttribute('data-preview-host')) counter.__previewObserveCalls += 1
      return observe.call(this, target, options)
    }
  })
  return () => page.evaluate(() => (window as unknown as { __previewObserveCalls: number }).__previewObserveCalls)
}

/** A window short enough that the preview pane fits the standard phone's
 * 1280x2179 canvas by its height. In the default 1280x720 window the narrow
 * pane fits both that canvas and the deck's by their width, so the scale
 * would not move between them. */
async function useShortWindow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 560 })
}

async function press(page: Page, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) await page.locator(TOGGLE).click()
}

/** Opens the shape menu from its ▾ and picks `shape` (phone display only). */
async function chooseShape(page: Page, shape: PhoneShape): Promise<void> {
  await page.locator(MENU_BUTTON).click()
  await page.locator(OPTION(shape)).click()
}

/** Phone display with the shape menu open (the state most menu tests start from). */
async function openShapeMenu(page: Page): Promise<void> {
  await press(page)
  await page.locator(MENU_BUTTON).click()
  await expect(page.locator(MENU)).toBeVisible()
}

/** The pill the PC / Phone switch (and, in phone display, the ▾) sits in,
 * and the header row that holds the pill. */
const pill = (page: Page): Locator => page.locator(TOGGLE).locator('xpath=..')
const headerRow = (page: Page): Locator => page.locator(TOGGLE).locator('xpath=../../..')

/** The background colour `locator`'s element is painted with. */
const fillOf = (locator: Locator): Promise<string> => locator.evaluate(el => getComputedStyle(el).backgroundColor)

const twoFrames = (page: Page): Promise<unknown> => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

/** The computed styles a test compares, read off `locator`'s element. */
function computed(locator: Locator, names: readonly string[]): Promise<Record<string, string>> {
  return locator.evaluate((el, wanted) => {
    const style = getComputedStyle(el)
    return Object.fromEntries(wanted.map(name => [name, style.getPropertyValue(name)]))
  }, names)
}

test.describe('Given a 16:9 deck (1280x720) with a normal slide selected', () => {
  test('when the user presses the phone toggle, then the preview canvas becomes 1280x2179, and pressing again restores 1280x720', async ({ page }) => {
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
    await useShortWindow(page)
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

    expect(await thumbnailHeights(page)).toEqual([PC_HEIGHT, PC_HEIGHT, PC_HEIGHT])
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
    await twoFrames(page)
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
  test('when the user presses the phone toggle, then the preview canvas becomes 960x1634 (the phone\'s proportion, rounded to a whole pixel)', async ({ page }) => {
    await openDeck(page, deckWith({ canvas: { width: 960, height: 720 } }))
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)

    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe('1634px')
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

  test('when the user edits the selected slide in phone display, then the preview follows the text without re-mounting, and the canvas stays 1280x2179', async ({ page }) => {
    const observeCalls = await countPreviewMounts(page)
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    const before = await observeCalls()
    expect(before).toBeGreaterThan(0)

    await page.locator('[data-slide-row="0"]').click()
    const afterSelecting = await observeCalls()
    for (const title of ['Wide slide, edited', 'Wide slide, edited again', 'Wide slide, edited a third time']) {
      await fillEditor(page, `# ${title}\n`)
      await expect.poll(() => previewHeading(page)).toBe(title)
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

test.describe('Given the preview header', () => {
  test('when a slide is selected, then the switch shows icons instead of the words "PC" and "Phone", and keeps its accessible name and titles', async ({ page }) => {
    await openDeck(page, deckWith())

    await expect(page.locator(TOGGLE)).toHaveText('')
    await expect(page.locator(`${TOGGLE} svg`)).toHaveCount(2)
    await expect(page.locator(TOGGLE)).toHaveAttribute('role', 'switch')
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-label', 'Preview as phone')
    await expect(page.locator(`${TOGGLE} > span`).nth(0)).toHaveAttribute('title', 'PC')
    await expect(page.locator(`${TOGGLE} > span`).nth(1)).toHaveAttribute('title', 'Phone')
    // Decorative: the labels above are the accessible ones.
    await expect(page.locator(`${TOGGLE} svg`).nth(0)).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator(`${TOGGLE} svg`).nth(1)).toHaveAttribute('aria-hidden', 'true')
    await expect(page.getByRole('switch', { name: 'Preview as phone' })).toHaveCount(1)
  })

  test('when the icons render, then each is the drawing it should be (monitor, smartphone, tall and wide rectangles), stroked and at its full size', async ({ page }) => {
    await openDeck(page, deckWith())
    await openShapeMenu(page)

    const describeIcons = (selector: string): Promise<{ namespace: string | null, tags: string[], width: number, height: number, stroke: string }[]> =>
      page.locator(selector).evaluateAll(svgs => svgs.map(svg => {
        const box = svg.getBoundingClientRect()
        return {
          namespace: svg.namespaceURI,
          // A child parsed outside the SVG namespace would be flagged with "!".
          tags: [...svg.children].map(child => `${child.namespaceURI === 'http://www.w3.org/2000/svg' ? '' : '!'}${child.tagName}`),
          width: box.width,
          height: box.height,
          stroke: getComputedStyle(svg).stroke,
        }
      }))

    // Each icon under the title it belongs to: the monitor (a rect and its
    // stand) under "PC", the smartphone (a rect and its dot) under "Phone".
    const segments = await page.locator(`${TOGGLE} > span`).evaluateAll(spans => spans.map(span => ({
      title: span.getAttribute('title'),
      tags: [...span.querySelectorAll('svg > *')].map(child => child.tagName),
    })))
    expect(segments).toEqual([
      { title: 'PC', tags: ['rect', 'path', 'path'] },
      { title: 'Phone', tags: ['rect', 'path'] },
    ])
    // ...and the menu's own: each device a tall rectangle at its own
    // proportion (the tablet's the widest of them), a wide one for Same ratio.
    const options = await page.locator(`${MENU} [data-phone-shape-option]`).evaluateAll(items => items.map(item => {
      const drawn = (item.querySelector('svg > rect') as SVGGraphicsElement).getBBox()
      return { shape: item.getAttribute('data-phone-shape-option'), tall: drawn.height > drawn.width, ratio: drawn.width / drawn.height }
    }))
    expect(options.map(({ shape, tall }) => ({ shape, tall }))).toEqual([
      { shape: 'small-phone', tall: true },
      { shape: 'phone', tall: true },
      { shape: 'large-phone', tall: true },
      { shape: 'tablet', tall: true },
      { shape: 'deck', tall: false },
    ])
    // The standard phone (390x664) drawn 11x20: its proportion in whole pixels.
    expect(options[1].ratio).toBeCloseTo(11 / 20, 2)
    for (const phone of options.slice(0, 3)) expect(options[3].ratio).toBeGreaterThan(phone.ratio)

    const switchIcons = await describeIcons(`${TOGGLE} svg`)
    const menuIcons = await describeIcons(`${MENU} svg`)
    expect(menuIcons.map(icon => icon.tags)).toEqual([['rect'], ['rect'], ['rect'], ['rect'], ['rect']])

    for (const icon of [...switchIcons, ...menuIcons]) {
      expect(icon.namespace).toBe('http://www.w3.org/2000/svg')
      // Stroked with the current text colour (their fill is none).
      expect(icon.stroke).not.toBe('none')
    }
    for (const icon of switchIcons) {
      expect(icon.width).toBeCloseTo(14, 0)
      expect(icon.height).toBeCloseTo(14, 0)
    }
    for (const icon of menuIcons) {
      expect(icon.width).toBeCloseTo(16, 0)
      expect(icon.height).toBeCloseTo(16, 0)
    }
  })

  test('when the header row is measured, then it has no underline and is still 36px high, and the one pill keeps its outline (no second pill for the shape)', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await expect(page.locator(MENU_BUTTON)).toBeVisible()

    expect(await computed(headerRow(page), ['border-bottom-width', 'border-top-width', 'height'])).toEqual({
      'border-bottom-width': '0px',
      'border-top-width': '0px',
      height: '36px',
    })
    const outline = await computed(pill(page), ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'])
    expect(Object.values(outline)).toEqual(['1px', '1px', '1px', '1px'])
    // The switch inside the pill draws no outline of its own.
    const inner = await computed(page.locator(TOGGLE), ['border-top-width', 'border-bottom-width'])
    expect(Object.values(inner)).toEqual(['0px', '0px'])

    await expect(headerRow(page).locator('.rounded-full')).toHaveCount(1)
  })

  test('when the lit segment moves, then only it carries the highlight (PC lit at first, Phone lit after the press)', async ({ page }) => {
    await openDeck(page, deckWith())
    const fill = (index: number): Promise<string> => fillOf(page.locator(`${TOGGLE} > span`).nth(index))
    const transparent = 'rgba(0, 0, 0, 0)'

    expect(await fill(0)).not.toBe(transparent)
    expect(await fill(1)).toBe(transparent)

    await press(page)
    await expect.poll(() => fill(1)).not.toBe(transparent)
    expect(await fill(0)).toBe(transparent)
  })
})

test.describe('Given the phone shape menu (the ▾ beside the Phone segment)', () => {
  test('when PC display is on, then the ▾ and the menu are hidden and out of the accessibility tree; phone display shows the ▾ inside the same pill, in the Phone segment\'s fill', async ({ page }) => {
    await openDeck(page, deckWith())
    await expect(page.locator(MENU_BUTTON)).toBeHidden()
    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.getByRole('button', { name: 'Device to preview as' })).toHaveCount(0)

    await press(page)
    await expect(page.locator(MENU_BUTTON)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Device to preview as' })).toHaveCount(1)
    await expect(pill(page).locator('[data-phone-shape-menu-button]')).toHaveCount(1)
    await expect(page.locator(MENU_BUTTON)).toHaveAttribute('aria-haspopup', 'menu')
    await expect(page.locator(MENU_BUTTON)).toHaveAttribute('aria-expanded', 'false')
    // Closed until it is asked for.
    await expect(page.locator(MENU)).toBeHidden()
    expect(await fillOf(page.locator(MENU_BUTTON))).toBe(await fillOf(page.locator(`${TOGGLE} > span`).nth(1)))

    await press(page)
    await expect(page.locator(MENU_BUTTON)).toBeHidden()
  })

  test('when the ▾ is pressed, then the menu opens with the four devices and "Same ratio as PC" (Phone checked), each device named with its model and size, and opening it changes neither the mode nor the canvas', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    await page.locator(MENU_BUTTON).click()
    await expect(page.locator(MENU_BUTTON)).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(MENU)).toBeVisible()
    await expect(page.locator(MENU)).toHaveAttribute('role', 'menu')
    await expect(page.getByRole('menuitemradio')).toHaveCount(5)
    await expect(page.locator(OPTION('small-phone'))).toContainText('Small phone')
    await expect(page.locator(OPTION('small-phone'))).toContainText('iPhone SE 375×548')
    await expect(page.locator(OPTION('phone'))).toContainText('Phone')
    await expect(page.locator(OPTION('phone'))).toContainText('iPhone 15 390×664')
    await expect(page.locator(OPTION('large-phone'))).toContainText('Large phone')
    await expect(page.locator(OPTION('large-phone'))).toContainText('iPhone 15 Pro Max 430×740')
    await expect(page.locator(OPTION('tablet'))).toContainText('Tablet')
    await expect(page.locator(OPTION('tablet'))).toContainText('iPad 820×1030')
    await expect(page.locator(OPTION('deck'))).toContainText('Same ratio as PC')
    await expect(page.locator(OPTION('deck'))).toContainText('Keeps the deck\'s own ratio (16:9 / 4:3)')
    await expect(page.locator(`${MENU} [aria-checked="true"]`)).toHaveCount(1)
    await expect(page.locator(OPTION('phone'))).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(OPTION('deck'))).toHaveAttribute('aria-checked', 'false')
    // Only the chosen option carries the check mark.
    await expect(page.locator(OPTION('phone'))).toContainText('✓')
    await expect(page.locator(OPTION('deck'))).not.toContainText('✓')
    await expect(page.locator(OPTION('tablet'))).not.toContainText('✓')

    await twoFrames(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')
    expect(await previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
  })

  test('when the menu is open, then it is fully on screen and in front of the canvas, even for a slide (and content in it) with a huge z-index, and a click on that canvas only closes the menu', async ({ page }) => {
    await openDeck(page, deckWith({ css: `${CONTAINER_QUERY_CSS}.peitho-slide { position: relative; z-index: 100000; } .peitho-slide h1 { position: relative; z-index: 100000; }` }))
    await press(page)
    // A point well inside the canvas (clear of the menu, and of the few pixels
    // the slide overshoots its host), checked to be the canvas while the menu
    // is closed: only then is a click there a click on the canvas.
    const onCanvas = await page.locator(PREVIEW).evaluate(host => {
      const box = host.getBoundingClientRect()
      const x = box.left + 20
      const y = box.bottom - 20
      return { x, y, isCanvas: document.elementFromPoint(x, y) === host }
    })
    expect(onCanvas.isCanvas).toBe(true)

    await page.locator(MENU_BUTTON).click()
    await expect(page.locator(MENU)).toBeVisible()

    const placement = await page.evaluate(({ menu, host }) => {
      const m = document.querySelector(menu)!.getBoundingClientRect()
      const h = document.querySelector(host)!.getBoundingClientRect()
      const x = (Math.max(m.left, h.left) + Math.min(m.right, h.right)) / 2
      const y = (Math.max(m.top, h.top) + Math.min(m.bottom, h.bottom)) / 2
      return {
        overlapsCanvas: m.right > h.left && m.left < h.right && m.bottom > h.top && m.top < h.bottom,
        onScreen: m.left >= 0 && m.top >= 0 && m.right <= window.innerWidth && m.bottom <= window.innerHeight,
        // `!= null` twice over: a point nothing can be hit at is not "frontmost".
        frontmost: (document.elementFromPoint(x, y)?.closest(menu) ?? null) != null,
      }
    }, { menu: MENU, host: PREVIEW })
    expect(placement).toEqual({ overlapsCanvas: true, onScreen: true, frontmost: true })

    // The overlay is above the canvas too: with the menu open, a click on the
    // canvas is the menu's outside click and reaches nothing else.
    await page.mouse.click(onCanvas.x, onCanvas.y)
    await expect(page.locator(MENU)).toBeHidden()
  })

  test('when the user picks "Same ratio as PC", then the canvas becomes 1280x720 (the same size as PC display) and the menu closes; picking "Phone" restores 1280x2179', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    await chooseShape(page, 'deck')
    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.locator(MENU_BUTTON)).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator(OPTION('deck'))).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(OPTION('phone'))).toHaveAttribute('aria-checked', 'false')
    // The check mark follows the choice.
    await expect(page.locator(OPTION('deck'))).toContainText('✓')
    await expect(page.locator(OPTION('phone'))).not.toContainText('✓')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    expect(await previewCanvasWidth(page)).toBe('1280px')
    // The deck's own `@container` branch follows the canvas's shape too.
    await expect.poll(() => previewProbeColor(page)).toBe(BLUE)
    // Phone display is still on, ▾ and all.
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(MENU_BUTTON)).toBeVisible()

    await chooseShape(page, 'phone')
    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.locator(OPTION('phone'))).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(OPTION('phone'))).toContainText('✓')
    await expect(page.locator(OPTION('deck'))).not.toContainText('✓')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    expect(await previewCanvasWidth(page)).toBe('1280px')
    await expect.poll(() => previewProbeColor(page)).toBe(RED)
  })

  test('when each device is picked in turn, then the canvas keeps its 1280 width and takes that device\'s proportion (small 1871, phone 2179, large 2203, tablet 1608), the tall-canvas branch firing for every one, and only the picked device is checked', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    for (const [shape, height] of [['small-phone', '1871px'], ['large-phone', '2203px'], ['tablet', '1608px'], ['phone', '2179px']] as const) {
      await chooseShape(page, shape)
      await expect(page.locator(MENU)).toBeHidden()
      await expect.poll(() => previewCanvasHeight(page)).toBe(height)
      expect(await previewCanvasWidth(page)).toBe('1280px')
      await expect.poll(() => previewProbeColor(page)).toBe(RED)
      await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
      await page.locator(MENU_BUTTON).click()
      await expect(page.locator(`${MENU} [aria-checked="true"]`)).toHaveCount(1)
      await expect(page.locator(OPTION(shape))).toHaveAttribute('aria-checked', 'true')
      await page.keyboard.press('Escape')
      await expect(page.locator(MENU)).toBeHidden()
    }
  })

  test('when the already chosen option is picked again, then nothing changes but the menu closes', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    await chooseShape(page, 'phone')
    await expect(page.locator(MENU)).toBeHidden()
    await twoFrames(page)
    expect(await previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    await expect(page.locator(OPTION('phone'))).toHaveAttribute('aria-checked', 'true')
  })

  test('when Escape is pressed with the menu open, then it closes and nothing else changes', async ({ page }) => {
    await openDeck(page, deckWith())
    await openShapeMenu(page)

    await page.keyboard.press('Escape')
    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.locator(MENU_BUTTON)).toHaveAttribute('aria-expanded', 'false')
    await twoFrames(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(OPTION('phone'))).toHaveAttribute('aria-checked', 'true')
    expect(await previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
  })

  test('when the user clicks outside the menu, then it closes and the click does not reach what is underneath (no slide is selected by it)', async ({ page }) => {
    await openDeck(page, deckWith())
    await openShapeMenu(page)

    const row = (await page.locator('[data-slide-row="1"]').boundingBox())!
    await page.mouse.click(row.x + row.width / 2, row.y + row.height / 2)
    await expect(page.locator(MENU)).toBeHidden()
    await twoFrames(page)
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'wide')
    expect(await previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    // With the menu closed the same click is an ordinary one again.
    await page.locator('[data-slide-row="1"]').click()
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'arcade')
  })

  test('when the ▾ is pressed again while the menu is open (from the keyboard, which the overlay does not shield), then the menu closes, and pressing it once more opens it', async ({ page }) => {
    await openDeck(page, deckWith())
    await openShapeMenu(page)

    await page.locator(MENU_BUTTON).press('Enter')
    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.locator(MENU_BUTTON)).toHaveAttribute('aria-expanded', 'false')

    await page.locator(MENU_BUTTON).press('Enter')
    await expect(page.locator(MENU)).toBeVisible()
    await expect(page.locator(MENU_BUTTON)).toHaveAttribute('aria-expanded', 'true')
  })

  test('when the user right-clicks while the menu is open, then the menu closes and the click opens no native or slide context menu', async ({ page }) => {
    await openDeck(page, deckWith())
    await openShapeMenu(page)
    await page.evaluate(() => {
      window.addEventListener('contextmenu', event => {
        (window as unknown as { __contextMenuPrevented: boolean }).__contextMenuPrevented = event.defaultPrevented
      })
    })

    const row = (await page.locator('[data-slide-row="1"]').boundingBox())!
    await page.mouse.click(row.x + row.width / 2, row.y + row.height / 2, { button: 'right' })
    await expect(page.locator(MENU)).toBeHidden()
    expect(await page.evaluate(() => (window as unknown as { __contextMenuPrevented: boolean }).__contextMenuPrevented)).toBe(true)
    // Nothing underneath was right-clicked: no slide context menu is up.
    await expect(page.getByRole('button', { name: /^Change Layout/ })).toBeHidden()
  })

  test('when the menu is open, then the keyboard shortcuts wait (arrows do not move the slide behind it), and Escape closes it and gives them back', async ({ page }) => {
    await openDeck(page, deckWith())
    await openShapeMenu(page)

    await page.keyboard.press('ArrowDown')
    await twoFrames(page)
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'wide')

    await page.keyboard.press('Escape')
    await expect(page.locator(MENU)).toBeHidden()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'arcade')
  })

  test('when the selection is lost with the menu open (a draft slide is selected), then the menu goes with the header and does not come back open', async ({ page }) => {
    const draftDeck = deckWith({ source: ['<!-- {"key":"first"} -->\n# First\n', '<!-- {"key":"hidden","draft":true} -->\n# Hidden\n', '<!-- {"key":"last"} -->\n# Last\n'].join('\n---\n\n') })
    await openDeck(page, draftDeck, 'first')
    await openShapeMenu(page)

    // The overlay shields the mouse, so select the draft row programmatically.
    await page.locator('[data-slide-row="1"] button[title]').evaluate(select => (select as HTMLElement).click())
    await expect(page.locator(TOGGLE)).toBeHidden()
    await expect(page.locator(MENU)).toBeHidden()

    await page.locator('[data-slide-row="2"]').click()
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'last')
    await expect(page.locator(TOGGLE)).toBeVisible()
    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.locator(`${PREVIEW_PANE} [data-phone-shape-backdrop]`)).toBeHidden()
    await expect(page.locator(MENU_BUTTON)).toHaveAttribute('aria-expanded', 'false')
    // ...and the shortcuts are not held back by a menu nobody can see: ArrowUp
    // walks back onto the draft row, which hides the header again.
    await page.keyboard.press('ArrowUp')
    await expect(page.locator(TOGGLE)).toBeHidden()
  })

  test('when the user leaves phone display with the menu open (from the keyboard), then the menu closes and phone display does not bring it back', async ({ page }) => {
    await openDeck(page, deckWith())
    await openShapeMenu(page)

    await page.locator(TOGGLE).press('Enter')
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator(MENU)).toBeHidden()
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)

    await press(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.locator(MENU_BUTTON)).toHaveAttribute('aria-expanded', 'false')
  })

  test('when the user goes back to PC display and to phone display again, then the chosen shape is kept', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await chooseShape(page, 'deck')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)

    await press(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)

    await press(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(OPTION('deck'))).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(OPTION('phone'))).toHaveAttribute('aria-checked', 'false')
    await twoFrames(page)
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)
  })

  test('when the shape changes, then the slide is re-fitted to the new canvas (and "Same ratio as PC" fits exactly as PC display does)', async ({ page }) => {
    await useShortWindow(page)
    await openDeck(page, deckWith())
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    const pcScale = await previewScale(page)

    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    const tallScale = await previewScale(page)
    expect(tallScale).toBeLessThan(pcScale)

    // The host's own box never changed size, so only a re-fit against the
    // new canvas moves the scale (see `observeCanvasScale`).
    await chooseShape(page, 'deck')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    expect(await previewScale(page)).toBeCloseTo(pcScale, 3)

    await chooseShape(page, 'phone')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    expect(await previewScale(page)).toBeCloseTo(tallScale, 3)
  })

  test('when the shape is chosen many times inside one task, then the preview ends in the last one chosen, with a single slide mounted and the scale fitted', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    // Programmatic clicks, so that no frame passes between two of them.
    const chooseManyTimes = (finalShape: PhoneShape): Promise<void> => page.evaluate(({ button, picks }) => {
      const click = (selector: string): void => (document.querySelector(selector) as HTMLElement).click()
      for (const pick of picks) {
        click(button)
        click(pick)
      }
    }, { button: MENU_BUTTON, picks: [OPTION('deck'), OPTION('phone'), OPTION('deck'), OPTION('phone'), OPTION('deck'), OPTION('phone'), OPTION(finalShape)] })

    await chooseManyTimes('deck')
    await expect(page.locator(OPTION('deck'))).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(MENU)).toBeHidden()
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    expect(await previewSlideCount(page)).toBe(1)

    await chooseManyTimes('phone')
    await expect(page.locator(OPTION('phone'))).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    await expect.poll(() => previewProbeColor(page)).toBe(RED)
    expect(await previewSlideCount(page)).toBe(1)
  })

  test('when a 4:3 deck (960x720) is shown, then the standard phone is 960x1634 and "Same ratio as PC" is the deck\'s own 960x720', async ({ page }) => {
    await openDeck(page, deckWith({ canvas: { width: 960, height: 720 } }))
    expect(await previewCanvasWidth(page)).toBe('960px')
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)

    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe('1634px')
    expect(await previewCanvasWidth(page)).toBe('960px')

    await chooseShape(page, 'deck')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    expect(await previewCanvasWidth(page)).toBe('960px')
  })

  test('when a fixed slide is selected, then its canvas is 1280x720 on the standard phone as well as the same-ratio one (the menu still works, the canvas just does not follow)', async ({ page }) => {
    await openDeck(page, deckWith())
    await page.locator('[data-slide-row="1"]').click()
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'arcade')

    // Phone display with the tall shape: the state in which the fixed rule is
    // the only thing keeping the canvas at 1280x720.
    await press(page)
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-checked', 'true')
    await twoFrames(page)
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)
    expect(await previewProbeColor(page)).toBe(BLUE)

    await chooseShape(page, 'deck')
    await expect(page.locator(OPTION('deck'))).toHaveAttribute('aria-checked', 'true')
    await twoFrames(page)
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)
    expect(await previewProbeColor(page)).toBe(BLUE)

    await chooseShape(page, 'phone')
    await twoFrames(page)
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)
    expect(await previewProbeColor(page)).toBe(BLUE)
  })

  test('when the user moves between fixed and ordinary slides, then a fixed slide is always 1280x720 and an ordinary one follows the shape', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)

    // In the same-ratio shape both kinds of slide are 720 high, so only the
    // tall shape can tell a fixed slide from an ordinary one; the second pass
    // pins that neither kind is disturbed by the shape.
    for (const [shape, ordinaryHeight] of [['phone', PHONE_HEIGHT], ['deck', PC_HEIGHT]] as const) {
      await chooseShape(page, shape)
      await page.locator('[data-slide-row="1"]').click()
      await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'arcade')
      await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
      // A fixed slide never fires the tall-canvas branch, whatever the shape.
      await expect.poll(() => previewProbeColor(page)).toBe(BLUE)
      expect(await previewCanvasWidth(page)).toBe('1280px')
      await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)

      await page.locator('[data-slide-row="2"]').click()
      await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'another')
      await expect.poll(() => previewCanvasHeight(page)).toBe(ordinaryHeight)
      await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    }
  })

  test('when the shape is changed, then the thumbnails keep the deck\'s own canvas in both shapes', async ({ page }) => {
    await openDeck(page, deckWith())

    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    expect(await thumbnailHeights(page)).toEqual([PC_HEIGHT, PC_HEIGHT, PC_HEIGHT])

    await chooseShape(page, 'deck')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    expect(await thumbnailHeights(page)).toEqual([PC_HEIGHT, PC_HEIGHT, PC_HEIGHT])
  })

  test('when the user edits the selected slide in "Same ratio as PC", then the preview follows the text without re-mounting', async ({ page }) => {
    const observeCalls = await countPreviewMounts(page)
    await openDeck(page, deckWith())
    await press(page)
    await chooseShape(page, 'deck')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    await page.locator('[data-slide-row="0"]').click()
    await twoFrames(page)
    const before = await observeCalls()

    for (const title of ['Wide slide, edited', 'Wide slide, edited again']) {
      await fillEditor(page, `# ${title}\n`)
      await expect.poll(() => previewHeading(page)).toBe(title)
    }
    expect(await observeCalls()).toBe(before)
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)
  })

  test('when the page is reloaded, then the shape starts as the standard phone again and the menu is closed (the choice is not persisted)', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await chooseShape(page, 'deck')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)

    await page.reload()
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'wide')
    await expect(page.locator(MENU_BUTTON)).toBeHidden()
    await press(page)
    await expect(page.locator(MENU)).toBeHidden()
    await expect(page.locator(OPTION('phone'))).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
  })
})

test.describe('Given phone display on a device preset (real size)', () => {
  test('when the panel has room, then the slide is drawn at the device\'s CSS width (small phone 375, standard phone 390), centred, with no scale label', async ({ page }) => {
    await useRoomyWindow(page)
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    await expect.poll(async () => (await previewSlideBox(page))?.width).toBeCloseTo(390, 1)
    const standardBox = await previewSlideBox(page)
    expect(standardBox?.height).toBeCloseTo(390 * 2179 / 1280, 1)
    await expect(page.locator(SCALE_LABEL)).toBeHidden()

    // Centred in the preview area.
    const centring = await page.locator(PREVIEW).evaluate(host => {
      const outer = host.getBoundingClientRect()
      const inner = host.shadowRoot?.querySelector('.peitho-slide')?.getBoundingClientRect()
      if (!inner) return null
      return { dx: (inner.left + inner.right) / 2 - (outer.left + outer.right) / 2, dy: (inner.top + inner.bottom) / 2 - (outer.top + outer.bottom) / 2 }
    })
    expect(Math.abs(centring?.dx ?? 99)).toBeLessThan(1)
    expect(Math.abs(centring?.dy ?? 99)).toBeLessThan(1)

    await chooseShape(page, 'small-phone')
    await expect.poll(() => previewCanvasHeight(page)).toBe('1871px')
    await expect.poll(async () => (await previewSlideBox(page))?.width).toBeCloseTo(375, 1)
    const smallBox = await previewSlideBox(page)
    expect(smallBox?.width ?? Infinity).toBeLessThan(standardBox?.width ?? 0)
    await expect(page.locator(SCALE_LABEL)).toBeHidden()
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
  })

  test('when the panel is narrower than both phones (the default window), then each is fitted to its width, and the label tells them apart by how far each was scaled down', async ({ page }) => {
    await openDeck(page, deckWith())
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PHONE_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    const area = await page.locator(PREVIEW).evaluate(host => host.getBoundingClientRect().width)
    // The premise: this pane is narrower than the small phone.
    expect(area).toBeLessThan(375)
    const label = page.locator(SCALE_LABEL)
    await expect(label).toHaveText(`Scaled to ${String(Math.floor((await previewSlideBox(page))!.width / 390 * 100))}%`)
    const standardLabel = await label.textContent()

    await chooseShape(page, 'small-phone')
    await expect.poll(() => previewCanvasHeight(page)).toBe('1871px')
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    await expect(label).toHaveText(`Scaled to ${String(Math.floor((await previewSlideBox(page))!.width / 375 * 100))}%`)
    expect(await label.textContent()).not.toBe(standardLabel)
  })

  test('when a tablet is picked in a narrow window, then it is fitted to the panel and labelled with how far it was scaled down', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openDeck(page, deckWith())
    await press(page)
    await chooseShape(page, 'tablet')
    await expect.poll(() => previewCanvasHeight(page)).toBe('1608px')
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)

    const box = await previewSlideBox(page)
    const area = await page.locator(PREVIEW).evaluate(host => {
      const { width, height } = host.getBoundingClientRect()
      return { width, height }
    })
    expect(box?.width ?? Infinity).toBeLessThan(820)
    expect(box?.width ?? Infinity).toBeLessThanOrEqual(area.width + 0.5)
    expect(box?.height ?? Infinity).toBeLessThanOrEqual(area.height + 0.5)

    const label = page.locator(SCALE_LABEL)
    await expect(label).toBeVisible()
    const percent = Math.floor((box?.width ?? 0) / 820 * 100)
    await expect(label).toHaveText(`Scaled to ${String(percent)}%`)

    // Back to PC display: the panel is filled again and the label goes.
    await press(page)
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    await expect(label).toBeHidden()
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
  })

  test('when "Same ratio as PC" is picked, then the slide fills the panel as in PC display, with no label', async ({ page }) => {
    await useRoomyWindow(page)
    await openDeck(page, deckWith())
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    const pcWidth = (await previewSlideBox(page))?.width ?? 0
    expect(pcWidth).toBeGreaterThan(430)

    await press(page)
    await chooseShape(page, 'deck')
    await expect.poll(() => previewCanvasHeight(page)).toBe(PC_HEIGHT)
    await expect.poll(() => scaleMisfit(page)).toBeLessThan(0.001)
    expect((await previewSlideBox(page))?.width).toBeCloseTo(pcWidth, 1)
    await expect(page.locator(SCALE_LABEL)).toBeHidden()
  })

  test('when a fixed slide is selected, then it is a 16:9 box at the device\'s width', async ({ page }) => {
    await useRoomyWindow(page)
    await openDeck(page, deckWith())
    await press(page)
    await page.locator('[data-slide-row]').nth(1).click()
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-slide-canvas-key', 'arcade')
    expect(await previewCanvasHeight(page)).toBe(PC_HEIGHT)
    await expect.poll(async () => (await previewSlideBox(page))?.width).toBeCloseTo(390, 1)
    expect((await previewSlideBox(page))?.height).toBeCloseTo(390 * 720 / 1280, 1)

    await chooseShape(page, 'small-phone')
    await expect.poll(async () => (await previewSlideBox(page))?.width).toBeCloseTo(375, 1)
  })

  test('when the UI is in Japanese, then the scale label reads 縮小表示', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openDeck(page, deckWith({ systemLocales: ['ja-JP'] }))
    await press(page)
    await chooseShape(page, 'tablet')
    await expect(page.locator(SCALE_LABEL)).toHaveText(/^縮小表示 \d+%$/)
  })
})
