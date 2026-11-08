// CSS viewport geometries exercise available space; native page zoom is
// verified separately in WKWebView, never imitated with CSS zoom here.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { mockTauri } from './helpers/mockTauri'
import { realEngineAvailable, startRealEngine } from './helpers/realEngine'
import { editorText } from './helpers/codeEditor'

const EDITOR = '#panel-editor'
const DIVIDER = '[data-panel="editor"] + div'
const ERROR = '.bg-destructive\\/10'
const layouts = [
  ['blank', ''], ['title-slide', '# Cover\n\nSubtitle'],
  ['title-body', '# Title\n\nBody'], ['one-column-text', '# Title\n\nBody'],
  ['two-column', '# Title\n\n::: {slot=left}\n\nLeft\n\n:::\n\n::: {slot=right}\n\nRight\n\n:::'],
  ['section-title-description', '# Title\n\n::: {slot=subtitle}\n\nSubtitle\n\n:::\n\nDescription'],
  ['big-number', '# 42\n\nDescription'], ['caption', 'Caption'],
  ['main-point', '# Point'], ['section-header', '# Section'], ['title-only', '# Title'],
  ['title-body-image', '# Title\n\nBody\n\n::: {slot=image}\n\n![Image](image.png)\n\n:::'],
]

async function width(page: Page, selector = EDITOR): Promise<number> {
  return page.locator(selector).evaluate(el => el.getBoundingClientRect().width)
}
async function drag(page: Page, delta: number, divider = DIVIDER): Promise<void> {
  const box = await page.locator(divider).boundingBox()
  if (!box) throw new Error(`Missing divider ${divider}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
}
async function toggle(page: Page, panel: string): Promise<void> {
  await page.locator(`[data-panel-toggle="${panel}"]:visible`).click()
}
async function contained(page: Page): Promise<void> {
  const geometry = await page.locator('[data-panel]:visible').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect()
    return { panel: el.getAttribute('data-panel'), left: r.left, right: r.right, viewport: innerWidth }
  }))
  for (const r of geometry) {
    expect.soft(r.left, `${r.panel} left`).toBeGreaterThanOrEqual(-1)
    expect.soft(r.right, `${r.panel} right`).toBeLessThanOrEqual(r.viewport + 1)
  }
}
async function growToAvailable(page: Page): Promise<void> {
  const before = await width(page)
  const preview = await width(page, '[data-panel="preview"]')
  const available = Math.max(before, before + preview - 180)
  await drag(page, 5000)
  expect.soft(await width(page), 'editor reaches available space while reserving 180 CSS px for preview').toBeCloseTo(available, 0)
  expect.soft(await width(page, '[data-panel="preview"]'), 'usable preview').toBeGreaterThanOrEqual(179)
  await contained(page)
}
async function scenario(page: Page, info: TestInfo, body: string, run: () => Promise<void>, layout = 'title-body'): Promise<void> {
  const engine = startRealEngine()
  const fixtureDir = mkdtempSync(join(tmpdir(), 'peitho-resize-sweep-'))
  try {
    const deckPath = await engine.newDeck(fixtureDir)
    writeFileSync(join(deckPath, '..', 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDa8AAAAASUVORK5CYII=', 'base64'))
    const source = `<!-- {"key":"resize","layout":"${layout}"} -->\n${body}\n`
    writeFileSync(deckPath, source)
    const layoutFiles = Object.fromEntries(layouts.map(([name]) => [name, {
      html: readFileSync(join(deckPath, '..', 'layouts', `${name}.html`), 'utf8'),
      css: readFileSync(join(deckPath, '..', 'css', `${name}.css`), 'utf8'),
    }]))
    const deck = { source, deckPath, layouts: layouts.map(([name]) => name), layoutFiles,
      realEngine: async (cmd: string, args: Record<string, unknown>) => {
        const result = await engine.invoke(deckPath, cmd, args)
        // The headless engine does not start the native AssetServer. Give
        // the transport a base URL so the normal review UI is available.
        if (typeof result === 'object' && result !== null && 'kind' in result && result.kind === 'rendered') {
          return { ...result, assetBaseUrl: 'http://localhost:9/' }
        }
        return result
      },
    }
    await mockTauri(page, deck)
    await page.goto('/')
    await page.locator('[data-slide-row="0"]').click()
    await expect(page.locator('[data-preview-host] .peitho-slide')).toBeVisible()
    await expect(page.locator(ERROR)).toBeHidden()
    const original = await editorText(page)
    const originalNote = await editorText(page, 'note')
    try { await run() } finally {
      const markdown = await editorText(page)
      await info.attach('resize-evidence', { body: JSON.stringify({ markdown, source: deck.source, viewport: page.viewportSize(), editor: await width(page) }), contentType: 'application/json' })
      expect.soft(await editorText(page, 'note'), 'Speaker notes unchanged').toBe(originalNote)
      expect.soft(markdown, 'Markdown unchanged by divider operations').toBe(original)
      expect.soft(deck.source, 'full deck unchanged').toBe(source)
      await expect.soft(page.locator(ERROR)).toBeHidden()
    }
  } finally {
    engine.stop()
    rmSync(fixtureDir, { recursive: true, force: true })
  }
}

test.skip(!realEngineAvailable(), 'needs cargo build --example e2e_engine')
for (const [layout, body] of layouts) {
  test(`${layout}: real rendering is independent of editor width`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await scenario(page, info, body, async () => {
      const before = await width(page)
      await drag(page, 300)
      expect.soft(await width(page), 'cross 640 CSS px with room').toBeCloseTo(before + 300, 0)
      await drag(page, -5000)
      expect.soft(await width(page), 'minimum after left drag').toBeCloseTo(180, 0)
      await growToAvailable(page)
    }, layout)
  })
}
for (const viewport of [960, 1200, 1440, 1800, 2400]) {
  test(`${viewport} CSS viewport${viewport === 960 ? " with review folded" : ""}: repeated drag, minimum and available maximum`, async ({ page }, info) => {
    await page.setViewportSize({ width: viewport, height: 900 })
    await scenario(page, info, '# Title\n\nBody', async () => {
      // At 960 CSS px, fold review first so both columns have room for
      // their existing 180 px minimum before exercising positive movement.
      if (viewport === 960) await toggle(page, 'review')
      await drag(page, -5000)
      expect.soft(await width(page)).toBeCloseTo(180, 0)
      const spare = Math.max(0, await width(page, '[data-panel="preview"]') - 180)
      await drag(page, 100)
      expect.soft(await width(page)).toBeCloseTo(180 + Math.min(100, spare), 0)
      await growToAvailable(page)
      await drag(page, -100)
      const afterLeft = await width(page)
      await drag(page, 100)
      expect.soft(await width(page)).toBeCloseTo(afterLeft + 100, 0)
      await contained(page)
    })
  })
}
for (const [name, body] of [
  ['long-line', '# Title\n\n' + 'UnbrokenText'.repeat(100)],
  ['long-text', '# Title\n\n' + Array.from({ length: 12 }, (_, i) => `Paragraph ${i} with several words for wrapping.`).join('\n\n')],
  ['notes', '# Title\n\nBody\n\n<!--\nSpeaker notes with a long line ' + 'notes '.repeat(50) + '\n-->'],
]) {
  test(`${name}: content remains unchanged while widening`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await scenario(page, info, body, () => growToAvailable(page))
  })
}
for (const folded of [[], ['slides'], ['review'], ['slides', 'review']]) {
  test(`folded ${folded.join('+') || 'none'}: available width follows visible siblings`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await scenario(page, info, '# Title\n\nBody', async () => {
      // Review starts folded in the browser fixture; open it explicitly.
      const review = page.locator('[data-panel="review"]')
      if (!await review.isVisible()) await toggle(page, 'review')
      for (const panel of folded) await toggle(page, panel)
      await growToAvailable(page)
      await toggle(page, 'preview')
      await expect(page.locator(DIVIDER)).toBeHidden()
      await contained(page)
      await toggle(page, 'preview')
      await growToAvailable(page)
    })
  })
}
test('viewport resize after and during drag recomputes available width', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await scenario(page, info, '# Title\n\nBody', async () => {
    await drag(page, 100)
    await page.setViewportSize({ width: 2400, height: 900 })
    await growToAvailable(page)
    await drag(page, -5000)
    const box = await page.locator(DIVIDER).boundingBox()
    if (!box) throw new Error('Missing divider')
    await page.mouse.move(box.x + 2, box.y + 100)
    await page.mouse.down()
    await page.setViewportSize({ width: 1200, height: 900 })
    await page.mouse.move(1100, box.y + 100, { steps: 5 })
    await page.mouse.up()
    await contained(page)
    expect.soft(await width(page, '[data-panel="preview"]')).toBeGreaterThanOrEqual(179)
  })
})
test('shared side panel resizers retain existing 180 to 640 bounds in both directions', async ({ page }, info) => {
  await page.setViewportSize({ width: 2400, height: 900 })
  await scenario(page, info, '# Title\n\nBody', async () => {
    await drag(page, 2000, '[data-panel="slides"] + div')
    expect.soft(await width(page, '#panel-slides')).toBeCloseTo(640, 0)
    await drag(page, -2000, '[data-panel="slides"] + div')
    expect.soft(await width(page, '#panel-slides')).toBeCloseTo(180, 0)
    if (!await page.locator('[data-panel="review"]').isVisible()) await toggle(page, 'review')
    await drag(page, -2000, 'div:has(+ [data-panel="review"])')
    expect.soft(await width(page, '#panel-review')).toBeCloseTo(640, 0)
    await drag(page, 2000, 'div:has(+ [data-panel="review"])')
    expect.soft(await width(page, '#panel-review')).toBeCloseTo(180, 0)
    await contained(page)
  })
})
test('layout screen keeps list initialization and shared resizer caps', async ({ page }, info) => {
  await page.setViewportSize({ width: 2400, height: 900 })
  await scenario(page, info, '# Title\n\nBody', async () => {
    await page.locator('[data-studio-mode-option="layouts"]').click()
    await expect(page.locator('[data-layout-row]')).toHaveCount(12)
    expect.soft(await width(page, '#panel-layouts')).toBeLessThanOrEqual(640)
    await drag(page, 2000, '[data-panel="files"] + div')
    expect.soft(await width(page, '[data-panel="files"] .panel-content')).toBeCloseTo(640, 0)
    await drag(page, -2000, '[data-panel="files"] + div')
    expect.soft(await width(page, '[data-panel="files"] .panel-content')).toBeCloseTo(180, 0)
    await drag(page, -2000, '[data-panel="layout-editor"] + div')
    expect.soft(await width(page, '#panel-layouts')).toBeCloseTo(640, 0)
    await drag(page, 2000, '[data-panel="layout-editor"] + div')
    expect.soft(await width(page, '#panel-layouts')).toBeCloseTo(180, 0)
    await contained(page)
    await page.locator('[data-studio-mode-option="slides"]').click()
  })
})
test('960 CSS viewport with every panel open: no growth when preview has no spare room', async ({ page }, info) => {
  await page.setViewportSize({ width: 960, height: 900 })
  await scenario(page, info, '# Title\n\nBody', async () => {
    const before = await width(page)
    const preview = await width(page, '[data-panel="preview"]')
    expect(preview).toBeLessThan(180)
    const rightBefore = await page.locator('[data-panel="review"]').evaluate(el => el.getBoundingClientRect().right)
    await drag(page, 500)
    expect.soft(await width(page), 'already constrained editor does not grow').toBeCloseTo(before, 0)
    const rightAfter = await page.locator('[data-panel="review"]').evaluate(el => el.getBoundingClientRect().right)
    expect.soft(rightAfter, 'existing narrow geometry is not pushed farther out').toBeLessThanOrEqual(Math.max(960, rightBefore) + 1)
    await drag(page, -5000)
    expect.soft(await width(page), 'constrained editor can still shrink').toBeCloseTo(180, 0)
    const previewAfterShrink = await width(page, '[data-panel="preview"]')
    const available = 180 + Math.max(0, previewAfterShrink - 180)
    await drag(page, 500)
    expect.soft(await width(page), 'regrowth uses only space actually freed for preview').toBeCloseTo(available, 0)
  })
})

async function assertViewportRefit(page: Page, info: TestInfo, stage: string): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const geometry = await page.locator('[data-panel]:visible').evaluateAll(els => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    panels: els.map(el => {
      const rect = el.getBoundingClientRect()
      return { panel: el.getAttribute('data-panel'), left: rect.left, width: rect.width, right: rect.right }
    }),
  }))
  await info.attach(stage, { body: JSON.stringify({ ...geometry, markdown: await editorText(page) }), contentType: 'application/json' })
  expect.soft(geometry.scrollWidth, `${stage}: no horizontal overflow`).toBeLessThanOrEqual(geometry.viewport + 1)
  await contained(page)
  expect.soft(await width(page, '[data-panel="preview"]'), `${stage}: preview keeps usable space`).toBeGreaterThanOrEqual(179)
}

async function assertSmallLeftDrag(page: Page, info: TestInfo): Promise<void> {
  // A failing overflow layout can put the divider outside the viewport.
  // Bring the actual divider into view before exercising real mouse input.
  await page.locator(DIVIDER).scrollIntoViewIfNeeded()
  const before = await width(page)
  await drag(page, -20)
  const after = await width(page)
  await info.attach('small-left-drag', { body: JSON.stringify({ before, after, markdown: await editorText(page) }), contentType: 'application/json' })
  expect.soft(after, 'next 20 CSS px left drag starts from rendered editor width').toBeCloseTo(before - 20, 0)
}

test('idle viewport refit: grow at 2400, shrink to 1440, then expand again', async ({ page }, info) => {
  await page.setViewportSize({ width: 2400, height: 900 })
  await scenario(page, info, '# Title\n\nBody', async () => {
    await growToAvailable(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await assertViewportRefit(page, info, 'idle-shrink')
    await assertSmallLeftDrag(page, info)
    await page.setViewportSize({ width: 2400, height: 900 })
    await assertViewportRefit(page, info, 'expanded-again')
  })
})

test('idle viewport refit: repeated wide and narrow viewport cycles', async ({ page }, info) => {
  await page.setViewportSize({ width: 2400, height: 900 })
  await scenario(page, info, '# Title\n\nBody', async () => {
    for (let cycle = 1; cycle <= 2; cycle++) {
      await page.setViewportSize({ width: 2400, height: 900 })
      await growToAvailable(page)
      await page.setViewportSize({ width: 1440, height: 900 })
      await assertViewportRefit(page, info, `cycle-${cycle}-narrow`)
    }
    await assertSmallLeftDrag(page, info)
  })
})

test('idle viewport refit: preview hidden and reshown after wide editor preference', async ({ page }, info) => {
  await page.setViewportSize({ width: 2400, height: 900 })
  await scenario(page, info, '# Title\n\nBody', async () => {
    await growToAvailable(page)
    await toggle(page, 'preview')
    await page.setViewportSize({ width: 1440, height: 900 })
    await contained(page)
    await toggle(page, 'preview')
    await assertViewportRefit(page, info, 'preview-reshown-narrow')
    await assertSmallLeftDrag(page, info)
    await page.setViewportSize({ width: 2400, height: 900 })
    await assertViewportRefit(page, info, 'preview-reshown-expanded')
  })
})
