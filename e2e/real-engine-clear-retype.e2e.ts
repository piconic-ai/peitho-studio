// Clearing a canvas text element and writing into it again, rendered by the
// real engine (helpers/realEngine.ts) so peitho-core's slot contracts
// (arity, routing) judge every intermediate draft, as they do in the app.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { mockTauri } from './helpers/mockTauri'
import { realEngineAvailable, startRealEngine } from './helpers/realEngine'
import { editorText, fillEditor } from './helpers/codeEditor'

const PREVIEW = '[data-preview-host]'
const FIELD = `${PREVIEW} [data-studio-edit]`
const ERROR = '.bg-destructive\\/10'
const FRESH = 'Fresh words'

interface Case { layout: string; body: string; target: string }

const CASES: Case[] = [
  { layout: 'title-slide', body: '# Cover title\n\nCover subtitle', target: 'Cover title' },
  { layout: 'title-slide', body: '# Cover title\n\nCover subtitle', target: 'Cover subtitle' },
  { layout: 'title-body', body: '# Body title\n\nFirst paragraph\n\n- Item one\n- Item two', target: 'First paragraph' },
  { layout: 'title-body', body: '# Body title\n\nFirst paragraph\n\n- Item one\n- Item two', target: 'Item one' },
  { layout: 'title-body', body: '# Body title\n\nOnly paragraph', target: 'Only paragraph' },
  { layout: 'one-column-text', body: '# One column\n\nColumn paragraph', target: 'Column paragraph' },
  { layout: 'two-column', body: '# Columns\n\n::: {slot=left}\n\nLeft text\n\n:::\n\n::: {slot=right}\n\nRight text\n\n:::', target: 'Left text' },
  { layout: 'two-column', body: '# Columns\n\n::: {slot=left}\n\nLeft text\n\n:::\n\n::: {slot=right}\n\nRight text\n\n:::', target: 'Right text' },
  { layout: 'section-title-description', body: '# Section\n\n::: {slot=subtitle}\n\nSub line\n\n:::\n\nDescription text', target: 'Sub line' },
  { layout: 'section-title-description', body: '# Section\n\n::: {slot=subtitle}\n\nSub line\n\n:::\n\nDescription text', target: 'Description text' },
  { layout: 'big-number', body: '# 42%\n\nGrowth this year', target: 'Growth this year' },
  { layout: 'caption', body: 'Caption only text', target: 'Caption only text' },
  { layout: 'main-point', body: '# The main point', target: 'The main point' },
  { layout: 'section-header', body: '# Part two', target: 'Part two' },
  { layout: 'title-only', body: '# Just a title', target: 'Just a title' },
  { layout: 'title-body', body: '# Code title\n\nBefore code\n\n```js\nconst x = 1\n```', target: 'Before code' },
  { layout: 'title-body', body: '# Noted\n\nMain text\n\n::: {slot=footnotes}\n\nA footnote\n\n:::', target: 'A footnote' },
  { layout: 'two-column', body: '# Lists\n\n::: {slot=left}\n\n- Left one\n- Left two\n\n:::\n\n::: {slot=right}\n\nRight text\n\n:::', target: 'Left one' },
]

async function open(page: Page, c: Case): Promise<{ stop: () => void }> {
  const engine = startRealEngine()
  const deckPath = await engine.newDeck(mkdtempSync(join(tmpdir(), 'peitho-e2e-')))
  const source = `---\ntime: 1m\n---\n<!-- {"key":"s","layout":"${c.layout}"} -->\n${c.body}\n`
  writeFileSync(deckPath, source)
  await mockTauri(page, { source, deckPath, realEngine: (cmd, args) => engine.invoke(deckPath, cmd, args) })
  await page.goto('/')
  await page.locator('[data-slide-row="0"]').click()
  await expect(target(page, c)).toBeVisible()
  return engine
}

function target(page: Page, c: Case) {
  return page.locator(PREVIEW).locator('[data-peitho-src]', { hasText: c.target }).last()
}

async function slotOf(page: Page, c: Case): Promise<string> {
  return target(page, c).evaluate(el => el.closest<HTMLElement>('[data-studio-slot]')?.dataset.studioSlot ?? '')
}

async function clearField(page: Page): Promise<void> {
  await expect(page.locator(FIELD)).toBeVisible()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
}

/** The slot left empty for writing into again, or `null` when other blocks
 * remain in it. */
async function emptiedSlot(page: Page, slot: string) {
  const emptied = page.locator(PREVIEW).locator(`[data-studio-slot="${slot}"]`)
  if (await emptied.evaluate(el => el.textContent?.trim() !== '')) return null
  await expect(emptied).toHaveAttribute('data-studio-empty', '')
  return emptied
}

async function expectWrittenInto(page: Page, slot: string): Promise<void> {
  await expect(page.locator(ERROR)).toBeHidden()
  await expect(page.locator(PREVIEW).locator(`[data-studio-slot="${slot}"]`)).toContainText(FRESH)
}

test.skip(!realEngineAvailable(), 'needs `cargo build --example e2e_engine` in src-tauri/')

for (const c of CASES) {
  test(`${c.layout}: clear "${c.target}", then write into the emptied slot`, async ({ page }) => {
    const engine = await open(page, c)
    try {
      const slot = await slotOf(page, c)
      await target(page, c).click()
      await clearField(page)
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(page.locator(FIELD)).toHaveCount(0)
      await expect(page.locator(ERROR)).toBeHidden()
      await expect(page.locator(PREVIEW)).not.toContainText(c.target)
      const emptied = await emptiedSlot(page, slot)
      if (!emptied) return
      await emptied.click()
      await page.keyboard.type(FRESH)
      await page.keyboard.press('ControlOrMeta+Enter')
      await expectWrittenInto(page, slot)
    } finally { engine.stop() }
  })

  test(`${c.layout}: clear "${c.target}" and keep typing in the same edit`, async ({ page }) => {
    const engine = await open(page, c)
    try {
      const slot = await slotOf(page, c)
      await target(page, c).click()
      await clearField(page)
      await page.keyboard.type(FRESH)
      await page.keyboard.press('ControlOrMeta+Enter')
      await expectWrittenInto(page, slot)
    } finally { engine.stop() }
  })
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
}

for (const c of CASES) {
  test(`${c.layout}: line breaks typed into "${c.target}" stay in that element`, async ({ page }) => {
    const engine = await open(page, c)
    try {
      const slot = await slotOf(page, c)
      await target(page, c).click()
      await clearField(page)
      await page.keyboard.type(FRESH)
      await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
      await page.keyboard.type('second line')
      await page.keyboard.press('ControlOrMeta+Enter')
      await expectWrittenInto(page, slot)
    } finally { engine.stop() }
  })

  test(`${c.layout}: delete "${c.target}" as an object, then write where it was`, async ({ page }) => {
    const engine = await open(page, c)
    try {
      const slot = await slotOf(page, c)
      await target(page, c).click()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(300)
      await expect(page.locator(ERROR)).toBeHidden()
      await expect(page.locator(PREVIEW)).not.toContainText(c.target)
      const emptied = await emptiedSlot(page, slot)
      if (!emptied) return
      await emptied.click()
      await page.keyboard.type(FRESH)
      await page.keyboard.press('ControlOrMeta+Enter')
      await expectWrittenInto(page, slot)
    } finally { engine.stop() }
  })

  test(`${c.layout}: Undo after rewriting "${c.target}" restores the original`, async ({ page }) => {
    const engine = await open(page, c)
    try {
      const original = await editorText(page)
      await target(page, c).click()
      await clearField(page)
      await page.keyboard.type(FRESH)
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect.poll(() => editorText(page)).toContain(FRESH)
      for (let i = 0; i < 5 && await editorText(page) !== original; i++) { await undo(page); await page.waitForTimeout(200) }
      expect(await editorText(page)).toBe(original)
      await expect(page.locator(ERROR)).toBeHidden()
      await expect(target(page, c)).toBeVisible()
    } finally { engine.stop() }
  })
}

/** Types `reading` through an IME composition and confirms it as `text` —
 * the composition events a Japanese input method sends. */
async function compose(page: Page, reading: string, text: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  for (let i = 1; i <= reading.length; i++) {
    await cdp.send('Input.imeSetComposition', { text: reading.slice(0, i), selectionStart: i, selectionEnd: i })
  }
  await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  await cdp.send('Input.insertText', { text })
}

for (const c of CASES) {
  test(`${c.layout}: clear "${c.target}" and write Japanese through an IME`, async ({ page }) => {
    const engine = await open(page, c)
    try {
      const slot = await slotOf(page, c)
      await target(page, c).click()
      await clearField(page)
      await compose(page, 'にほんご', '日本語')
      await compose(page, 'のぶん', 'の文')
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(page.locator(ERROR)).toBeHidden()
      await expect(page.locator(PREVIEW).locator(`[data-studio-slot="${slot}"]`)).toContainText('日本語の文')
      expect(await editorText(page)).not.toContain('にほんご')
    } finally { engine.stop() }
  })

  test(`${c.layout}: clear "${c.target}", then write Japanese into the emptied slot`, async ({ page }) => {
    const engine = await open(page, c)
    try {
      const slot = await slotOf(page, c)
      await target(page, c).click()
      await clearField(page)
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(page.locator(PREVIEW)).not.toContainText(c.target)
      const emptied = await emptiedSlot(page, slot)
      if (!emptied) return
      await emptied.click()
      await compose(page, 'にほんご', '日本語')
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(page.locator(ERROR)).toBeHidden()
      await expect(emptied).toContainText('日本語')
    } finally { engine.stop() }
  })
}

for (const c of [
  { layout: 'title-body', body: '# No notes\n\nMain text', target: 'Main text' },
  { layout: 'two-column', body: '# No notes\n\n::: {slot=left}\n\nMain text\n\n:::', target: 'Main text' },
]) {
  test(`${c.layout}: add a footnote to a slide that has none`, async ({ page }) => {
    const engine = await open(page, c)
    try {
      const footnotes = page.locator(PREVIEW).locator('[data-studio-slot="footnotes"]')
      await expect(footnotes).toHaveAttribute('data-studio-empty', '')
      await expect(footnotes).toBeVisible()
      await footnotes.click()
      await page.keyboard.type(FRESH)
      await expect(footnotes).toBeVisible()
      await page.keyboard.press('ControlOrMeta+Enter')
      await expectWrittenInto(page, 'footnotes')
      expect(await editorText(page)).toContain(`::: {slot=footnotes}\n\n${FRESH}\n\n:::`)
    } finally { engine.stop() }
  })
}

test('the footnote placeholder stays out of slide thumbnails', async ({ page }) => {
  const c: Case = { layout: 'title-body', body: '# No notes\n\nMain text', target: 'Main text' }
  const engine = await open(page, c)
  try {
    await expect(page.locator(PREVIEW).locator('[data-studio-slot="footnotes"]')).toBeVisible()
    await expect(page.locator('[data-slide-row="0"]').locator('[data-studio-slot="footnotes"]')).toBeHidden()
  } finally { engine.stop() }
})

test('blank lines typed in the Markdown editor keep the canvas text editable', async ({ page }) => {
  const c: Case = { layout: 'title-body', body: '# Title\n\nPara text', target: 'Para text' }
  const engine = await open(page, c)
  try {
    const before = await target(page, c).getAttribute('data-peitho-src')
    await fillEditor(page, '# Title\n\n\n\nPara text')
    // Clicks before the draft renders are ignored on purpose (stale spans).
    await expect(target(page, c)).not.toHaveAttribute('data-peitho-src', before!)
    await target(page, c).click()
    await expect(page.locator(FIELD)).toHaveCount(1)
    await clearField(page)
    await page.keyboard.type(FRESH)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expectWrittenInto(page, 'body')
  } finally { engine.stop() }
})
