// Isolating a slide the real engine refuses (helpers/realEngine.ts): a
// slot violation on one slide of three leaves the other two rendered by
// peitho-core itself, the broken one an ERROR row; another slide saves
// around it with nothing of the isolation on disk; the fix renders it.
// The mocked counterpart is isolate-broken-slides.e2e.ts.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { mockTauri } from './helpers/mockTauri'
import { realEngineAvailable, startRealEngine } from './helpers/realEngine'
import { editorText, fillEditor } from './helpers/codeEditor'
import type { RenderOutcome } from '../domain/render'

const ERROR_BAR = '.bg-destructive\\/10'
const PREVIEW_ERROR = '[data-preview-build-error]'
const THUMBNAIL_CANVAS = '[data-slide-row] [data-slide-canvas-key]'
const ERROR_BADGE = '[data-slide-status="error"]'
const SELECTED = '.border-\\[\\#eab308\\]'

// Slide `b` puts two paragraphs where `title-slide`'s subtitle slot takes
// one — an arity violation peitho-core attributes to that slide. `a` and
// `c` build.
const SOURCE = '---\ntime: 1m\n---\n<!-- {"key":"a","layout":"title-slide"} -->\n# A\n\nFine\n\n---\n\n<!-- {"key":"b","layout":"title-slide"} -->\n# B\n\nOne\n\nTwo\n\n---\n\n<!-- {"key":"c","layout":"title-slide"} -->\n# C\n\nAlso fine\n'

test.skip(!realEngineAvailable(), 'needs `cargo build --example e2e_engine` in src-tauri/')

test('Given a deck with one slide the real engine refuses, when opened, then the other two render, the broken one is an ERROR row, and saving another slide writes no draft mark', async ({ page }) => {
  const engine = startRealEngine()
  try {
    const deckPath = await engine.newDeck(mkdtempSync(join(tmpdir(), 'peitho-e2e-')))
    writeFileSync(deckPath, SOURCE)
    const outcome = await engine.invoke(deckPath, 'render_draft', { content: SOURCE }) as RenderOutcome
    expect(outcome.kind).toBe('failed')
    if (outcome.kind !== 'failed') return
    expect(outcome.error.slide?.number).toBe(2)

    const deck = { source: SOURCE, deckPath, realEngine: (cmd: string, args: Record<string, unknown>) => engine.invoke(deckPath, cmd, args) }
    await mockTauri(page, deck)
    await page.goto('/')
    await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })

    // peitho-core rendered `a` and `c`; `b` is isolated, selected, with
    // the engine's own error in the preview pane and the error bar.
    await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(2, { timeout: 10_000 })
    await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
    await expect(page.locator('[data-slide-row="1"]').locator(SELECTED)).toBeVisible()
    await expect.poll(() => editorText(page)).toBe('# B\n\nOne\n\nTwo')
    await expect(page.locator(PREVIEW_ERROR)).toHaveAttribute('data-preview-build-error-scope', 'slide')
    await expect(page.locator(PREVIEW_ERROR)).toContainText(outcome.error.headline)
    await expect(page.locator(ERROR_BAR)).toContainText(`1 slide doesn't build: ${outcome.error.headline}`)

    // Slide `c` is edited and saved around the broken one: the file holds
    // the edit, `b` as it was, and no draft mark anywhere.
    await page.locator('[data-slide-row="2"]').click()
    await expect.poll(() => editorText(page)).toBe('# C\n\nAlso fine')
    await fillEditor(page, '# C\n\nEdited')
    await expect.poll(() => deck.source, { timeout: 10_000 }).toContain('# C\n\nEdited')
    expect(deck.source).toContain('# B\n\nOne\n\nTwo\n')
    expect(deck.source).not.toContain('draft')
    expect(readFileSync(deckPath, 'utf8')).not.toContain('draft')
    await expect(page.locator('[data-slide-row="1"]').locator(ERROR_BADGE)).toBeVisible()
    await expect(page.locator('[data-preview-host] h1')).toContainText('C')

    // Fixing `b` renders it: three thumbnails, no badge, no error.
    await page.locator('[data-slide-row="1"]').click()
    await expect.poll(() => editorText(page)).toBe('# B\n\nOne\n\nTwo')
    await fillEditor(page, '# B\n\nOne')
    await expect.poll(() => deck.source, { timeout: 10_000 }).toContain('# B\n\nOne\n')
    await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3, { timeout: 10_000 })
    await expect(page.locator(ERROR_BADGE)).toHaveCount(0)
    await expect(page.locator(ERROR_BAR)).toBeHidden()
    await expect(page.locator(PREVIEW_ERROR)).toBeHidden()
  } finally {
    engine.stop()
  }
})
