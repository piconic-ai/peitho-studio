// Opening a deck peitho-core actually refuses (helpers/realEngine.ts): the
// structured error the real engine answers — its slide number and line —
// is what the editor opens on, and fixing the slide renders the deck.
// The mocked counterpart is open-broken-deck.e2e.ts.
import { mkdtempSync, writeFileSync } from 'node:fs'
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
const SELECTED = '.border-\\[\\#eab308\\]'

// Slide 2 puts two paragraphs where `title-slide`'s subtitle slot takes
// one — an arity violation peitho-core attributes to that slide and line.
const SOURCE = '---\ntime: 1m\n---\n<!-- {"key":"a","layout":"title-slide"} -->\n# A\n\nFine\n\n---\n\n<!-- {"key":"b","layout":"title-slide"} -->\n# B\n\nOne\n\nTwo\n'

test.skip(!realEngineAvailable(), 'needs `cargo build --example e2e_engine` in src-tauri/')

test('Given a deck the real engine refuses, when opened, then the editor shows its error on the slide it names, and the fix renders', async ({ page }) => {
  const engine = startRealEngine()
  try {
    const deckPath = await engine.newDeck(mkdtempSync(join(tmpdir(), 'peitho-e2e-')))
    writeFileSync(deckPath, SOURCE)
    // What peitho-core says about this deck, straight from the engine.
    const outcome = await engine.invoke(deckPath, 'render_draft', { content: SOURCE }) as RenderOutcome
    expect(outcome.kind).toBe('failed')
    if (outcome.kind !== 'failed') return
    expect(outcome.error.slide?.number).toBe(2)
    expect(outcome.error.line).not.toBeNull()
    expect(outcome.error.headline).toContain("slide 2 ('b')")

    const deck = { source: SOURCE, deckPath, realEngine: (cmd: string, args: Record<string, unknown>) => engine.invoke(deckPath, cmd, args) }
    await mockTauri(page, deck)
    await page.goto('/')

    // The editor opens on the deck's source, with the slide the engine
    // blamed selected, and the engine's own headline (line number
    // included) in the error bar and the preview pane.
    await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
    await expect(page.locator('[data-slide-row="1"]').locator(SELECTED)).toBeVisible()
    await expect.poll(() => editorText(page)).toBe('# B\n\nOne\n\nTwo')
    await expect(page.locator(ERROR_BAR)).toContainText(outcome.error.headline)
    await expect(page.locator(ERROR_BAR)).toContainText(outcome.error.help)
    await expect(page.locator(PREVIEW_ERROR)).toContainText(outcome.error.headline)
    await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(0)

    // Fixing the slide saves and renders: real thumbnails, a real preview,
    // and no error left.
    await fillEditor(page, '# B\n\nOne')
    await expect.poll(() => deck.source).toContain('# B\n\nOne\n')
    await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(2)
    await expect(page.locator('[data-preview-host] h1')).toContainText('B')
    await expect(page.locator(ERROR_BAR)).toBeHidden()
    await expect(page.locator(PREVIEW_ERROR)).toBeHidden()
  } finally {
    engine.stop()
  }
})
