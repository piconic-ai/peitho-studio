import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { mockTauri } from './helpers/mockTauri'
import { realEngineAvailable, startRealEngine } from './helpers/realEngine'
import { editorText, fillEditor } from './helpers/codeEditor'
import { createFakeCritIpc } from '../ipc/fakeCritIpc'

const ERROR_BAR = '.bg-destructive\\/10'

async function menuHistory(page: Page, item: 'undo' | 'redo'): Promise<void> {
  await page.evaluate(event => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent(event, null, 'main')
  }, `menu:${item}`)
}
const CASES = [
  { layout: 'blank', body: '' },
  { layout: 'title-slide', body: '# Title\n\nSubtitle' },
  { layout: 'title-body', body: '# Title\n\nOriginal body\n\n- First\n- Second' },
  { layout: 'one-column-text', body: '# Title\n\nOriginal body' },
  { layout: 'two-column', body: '# Title\n\n::: {slot=left}\n\nLeft\n\n:::\n\n::: {slot=right}\n\nRight\n\n:::' },
  { layout: 'section-title-description', body: '# Title\n\n::: {slot=subtitle}\n\nSubtitle\n\n:::\n\nDescription' },
  { layout: 'big-number', body: '# 42%\n\nGrowth' },
  { layout: 'caption', body: 'Caption' },
  { layout: 'main-point', body: '# Main point' },
  { layout: 'section-header', body: '# Section' },
  { layout: 'title-only', body: '# Title' },
]

test.skip(!realEngineAvailable(), 'needs `cargo build --example e2e_engine` in src-tauri/')

const RECOVERY_CASES = [
  ...CASES.map(c => ({ ...c, which: 'body' as const })),
  { layout: 'title-body', body: '# Title\n\nOriginal body', which: 'source' as const },
]

for (const { layout, body, which } of RECOVERY_CASES) {
  test(`Given an invalid HTML ${which} draft in ${layout}, when Undo restores the saved text, then the stale build error disappears without sending it`, async ({ page }) => {
    const engine = startRealEngine()
    try {
      const deckPath = await engine.newDeck(mkdtempSync(join(tmpdir(), 'peitho-recovery-')))
      const source = `---\ntime: 1m\n---\n<!-- {"key":"s","layout":"${layout}"} -->\n${body}\n`
      const initial = which === 'source' ? source.replace('time: 1m', 'fontss: x') : source
      writeFileSync(deckPath, initial)
      const crit = createFakeCritIpc()
      const deck = { source: initial, deckPath, crit, realEngine: (cmd: string, args: Record<string, unknown>) => engine.invoke(deckPath, cmd, args) }
      await mockTauri(page, deck)
      await page.goto('/')
      await page.locator('[data-slide-row="0"]').click()
      await expect.poll(() => editorText(page)).toBe(body)
      if (which === 'source') {
        await page.locator('[data-source-toggle]').click()
        await fillEditor(page, source, 'source')
        await expect.poll(() => deck.source).toBe(source)
        await expect(page.locator(ERROR_BAR)).toBeHidden()
      }
      const commentsBefore = crit.calls.filter(call => call.method === 'addComments')
      const original = which === 'source' ? source : body
      const html = '<h1 style="color:cyan">Live update verified</h1>'
      await fillEditor(page, which === 'source' ? source.replace(body, html) : html, which)
      await expect(page.locator(ERROR_BAR)).toContainText("unsupported construct 'html'")
      await expect(page.locator('[data-error-send-hint]')).toBeVisible()
      expect(deck.source).toBe(source)
      await menuHistory(page, 'undo')
      await expect.poll(() => editorText(page, which)).toBe(original)
      await expect(page.locator(ERROR_BAR)).toBeHidden()
      await expect(page.locator('[data-error-send-hint]')).toBeHidden()
      expect(deck.source).toBe(source)
      expect(crit.calls.filter(call => call.method === 'addComments')).toEqual(commentsBefore)
      await menuHistory(page, 'redo')
      await expect.poll(() => editorText(page, which)).toContain(html)
      await expect(page.locator(ERROR_BAR)).toContainText("unsupported construct 'html'")
      await menuHistory(page, 'undo')
      await expect.poll(() => editorText(page, which)).toBe(original)
      await expect(page.locator(ERROR_BAR)).toBeHidden()
    } finally { engine.stop() }
  })
}

for (const phase of ['body preview', 'body autosave', 'source autosave', 'body preview corrected', 'body autosave corrected', 'source autosave corrected']) {
  test(`Given an HTML ${phase} render still in flight, when the text is restored or corrected, then the stale failure cannot return`, async ({ page }) => {
    const engine = startRealEngine()
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let pending = 0
    const which = phase.startsWith('source') ? 'source' : 'body'
    const expectedRenders = phase.startsWith('body autosave') ? 2 : 1
    const corrected = phase.endsWith('corrected')
    try {
      const deckPath = await engine.newDeck(mkdtempSync(join(tmpdir(), 'peitho-recovery-')))
      const body = '# Title\n\nOriginal body'
      const source = `---\ntime: 1m\n---\n<!-- {"key":"s","layout":"title-body"} -->\n${body}\n`
      const initial = which === 'source' ? source.replace('time: 1m', 'fontss: x') : source
      writeFileSync(deckPath, initial)
      const deck = {
        source: initial, deckPath,
        realEngine: async (cmd: string, args: Record<string, unknown>) => {
          const result = await engine.invoke(deckPath, cmd, args)
          if (cmd === 'render_draft' && typeof args.content === 'string' && args.content.includes('<h1>')) {
            pending++
            await gate
          }
          return result
        },
      }
      await mockTauri(page, deck)
      await page.goto('/')
      await page.locator('[data-slide-row="0"]').click()
      await expect.poll(() => editorText(page)).toBe(body)
      if (which === 'source') {
        await page.locator('[data-source-toggle]').click()
        await fillEditor(page, source, 'source')
        await expect.poll(() => deck.source).toBe(source)
        await expect(page.locator(ERROR_BAR)).toBeHidden()
      }
      await page.evaluate(() => {
        const ipc = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__
        const invoke = ipc.invoke
        ipc.invoke = async (cmd, args) => {
          const result = await invoke(cmd, args)
          if (cmd === 'render_draft' && typeof args.content === 'string' && args.content.includes('<h1>')) {
            window.setTimeout(() => {
              const root = document.documentElement
              root.dataset.staleRenderDelivered = String(Number(root.dataset.staleRenderDelivered ?? '0') + 1)
            }, 0)
          }
          return result
        }
      })
      const html = '<h1>Invalid HTML</h1>'
      await fillEditor(page, which === 'source' ? source.replace(body, html) : html, which)
      await expect.poll(() => pending).toBe(expectedRenders)
      const restoredBody = corrected ? '# Corrected\n\nOriginal body' : body
      const restored = which === 'source' ? source.replace(body, restoredBody) : restoredBody
      if (corrected) await fillEditor(page, restored, which)
      else await menuHistory(page, 'undo')
      await expect.poll(() => editorText(page, which)).toBe(restored)
      release()
      await expect(page.locator('html')).toHaveAttribute('data-stale-render-delivered', String(expectedRenders))
      expect(await page.locator(ERROR_BAR).isHidden()).toBe(true)
      expect(deck.source).toBe(source)
    } finally { release(); engine.stop() }
  })
}

for (const recovery of ['preview cancel', 'body Undo', 'valid preview'] as const) {
  test(`Given an invalid source draft, when ${recovery} restores or renders the body, then the source error remains available to send`, async ({ page }) => {
    const engine = startRealEngine()
    try {
      const deckPath = await engine.newDeck(mkdtempSync(join(tmpdir(), 'peitho-cross-editor-')))
      const body = '# Title\n\nOriginal body'
      const source = `---\ntime: 1m\n---\n<!-- {"key":"s","layout":"title-body"} -->\n${body}\n`
      const broken = source.replace('time: 1m', 'fontss: x')
      writeFileSync(deckPath, broken)
      let validBodyRenders = 0
      const deck = {
        source: broken, deckPath,
        realEngine: async (cmd: string, args: Record<string, unknown>) => {
          const result = await engine.invoke(deckPath, cmd, args)
          if (cmd === 'render_draft' && typeof args.content === 'string' && args.content.includes('Changed')) validBodyRenders++
          return result
        },
      }
      await mockTauri(page, deck)
      await page.goto('/')
      await page.locator('[data-source-toggle]').click()
      await fillEditor(page, source, 'source')
      await expect.poll(() => deck.source).toBe(source)
      await expect(page.locator(ERROR_BAR)).toBeHidden()
      await fillEditor(page, broken, 'source')
      await expect(page.locator(ERROR_BAR)).toContainText('unknown field `fontss`')
      await expect(page.locator('[data-error-send-hint]')).toBeVisible()
      await page.clock.install()
      await page.clock.pauseAt(new Date(Date.now() + 1000))
      await page.locator('[data-preview-host] h1').click()
      await page.keyboard.insertText('Changed')
      if (recovery === 'valid preview') {
        await page.clock.runFor(100)
        await expect.poll(() => validBodyRenders).toBeGreaterThan(0)
      }
      if (recovery === 'body Undo') await menuHistory(page, 'undo')
      else await page.keyboard.press('Escape')
      await page.clock.runFor(100)
      await expect.poll(() => editorText(page)).toBe(body)
      await expect.poll(() => editorText(page, 'source')).toBe(broken)
      expect(deck.source).toBe(source)
      await expect(page.locator(ERROR_BAR)).toContainText('unknown field `fontss`')
      await expect(page.locator('[data-error-send-hint]')).toBeVisible()
    } finally { engine.stop() }
  })
}
