import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorText, fillEditor } from './helpers/codeEditor'

const PREVIEW = '[data-preview-host]'
const FIELD = `${PREVIEW} [data-studio-edit]`
const SOURCE = '<!-- {"key":"s","layout":"two-column"} -->\n# Title\n'
const TWO_COLUMN = '<section class="peitho-slide" style="width:1280px;height:720px;padding:64px;box-sizing:border-box;background:white"><h1><slot name="title" accepts="inline" arity="1"></slot></h1><div style="display:flex;gap:40px"><div style="width:50%"><slot name="left" accepts="blocks" arity="0..*"></slot></div><div style="width:50%"><slot name="right" accepts="blocks" arity="0..*"></slot></div></div></section>'

async function open(page: Page, source = SOURCE): Promise<MockDeck> {
  const deck: MockDeck = { source, deckPath: '/decks/talk/deck.md', editAnnotations: true, editableLayouts: true, layouts: ['two-column'], layoutFiles: { 'two-column': { html: TWO_COLUMN, css: null } }, css: '.peitho-slide h1 {font-size:56px}.peitho-slide p {font-size:32px}.peitho-slide img {width:100%;height:100%;object-fit:contain}' }
  deck.layouts!.push('title-only')
  deck.layoutFiles!['title-only'] = { html: '<section class="peitho-slide" data-template="title-only" style="width:1280px;height:720px;padding:64px;box-sizing:border-box;background:white"><h1><slot name="title" accepts="inline" arity="1"></slot></h1></section>', css: null }
  deck.layoutVerdicts = () => deck.layouts!.map(layout => ({ layout, fit: { kind: 'fits' } }))
  await mockTauri(page, deck); await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Title')
  return deck
}

test('text edits update Markdown as one undoable edit, and clicks no longer open comments', async ({ page }) => {
  const deck = await open(page)
  await page.locator(`${PREVIEW} h1`).click()
  await expect(page.locator(FIELD)).toHaveText('Title')
  await expect(page.locator('[data-comment-box]')).toBeHidden()
  await page.locator(FIELD).fill('成長率')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => editorText(page)).toBe('# 成長率')
  await expect.poll(() => deck.source).toContain('# 成長率')
  await page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
  await expect.poll(() => editorText(page)).toBe('# Title')
})

test('both empty columns accept text without requiring slot syntax', async ({ page }) => {
  const deck = await open(page)
  await expect(page.locator(`${PREVIEW} [data-studio-slot="left"]`)).toHaveAttribute('data-studio-empty', '')
  await page.locator(`${PREVIEW} [data-studio-slot="left"]`).click()
  await page.locator(FIELD).fill('Left column')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('::: {slot=left}\n\nLeft column')
  await expect(page.locator(`${PREVIEW} [data-studio-slot="left"]`)).toHaveText('Left column')
  await page.locator(`${PREVIEW} [data-studio-slot="right"]`).click()
  await page.locator(FIELD).fill('右の文章')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('::: {slot=right}\n\n右の文章')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
  await page.screenshot({ path: '/tmp/peitho-direct-edit.png' })
})

test('cancel leaves Markdown unchanged and commenting remains an explicit mode', async ({ page }) => {
  const deck = await open(page)
  await page.locator(`${PREVIEW} h1`).click()
  await page.locator(FIELD).fill('Discard')
  await page.locator(FIELD).press('Escape')
  await expect(page.locator(FIELD)).toHaveCount(0)
  expect(deck.source).toBe(SOURCE)
  await page.locator('[data-preview-comment-mode]').click()
  await page.locator(`${PREVIEW} h1`).click()
  await expect(page.locator('[data-comment-box]')).toBeVisible()
  await expect(page.locator(FIELD)).toHaveCount(0)
})

test('the original missing-body error can be recovered by clicking the desired column', async ({ page }) => {
  const deck = await open(page)
  deck.commandError = (command, args) => command === 'render_draft' && String(args.content).includes('- Item') && !String(args.content).includes('slot=left') ? "slide 1 ('s'), line 4: unassigned content remains for missing 'body' slot" : null
  await fillEditor(page, '# Title\n\n- Item')
  await expect(page.getByText(/unassigned content remains/)).toBeVisible()
  await page.locator(`${PREVIEW} [data-studio-slot="left"]`).click()
  await expect(page.locator(FIELD)).toHaveText('- Item')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('::: {slot=left}\n\n- Item')
  await expect(page.getByText(/unassigned content remains/)).toHaveCount(0)
})

test('adding and moving an image keeps the column layout and supports Undo', async ({ page }) => {
  const deck = await open(page)
  await page.locator('[data-preview-image-input]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
  await expect.poll(() => deck.source).toContain('::: {slot=studio-image-1}')
  const image = page.locator(`${PREVIEW} [data-studio-image="studio-image-1"]`)
  await expect(image).toBeVisible()
  await expect(page.locator(`${PREVIEW} [data-studio-slot="left"]`)).toBeVisible()
  const added = /"layout":"([^"]+)"/.exec(deck.source)![1]
  const bounds = (await image.boundingBox())!
  await page.mouse.move(bounds.x + 20, bounds.y + 20); await page.mouse.down()
  await page.mouse.move(bounds.x + 55, bounds.y + 40, { steps: 5 }); await page.mouse.up()
  await expect.poll(() => /"layout":"([^"]+)"/.exec(deck.source)?.[1]).not.toBe(added)
  await page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
  await expect.poll(() => /"layout":"([^"]+)"/.exec(deck.source)?.[1]).toBe(added)
  const restored = (await image.boundingBox())!
  await page.mouse.move(restored.x + restored.width - 2, restored.y + restored.height - 2); await page.mouse.down()
  await page.mouse.move(restored.x + restored.width + 20, restored.y + restored.height + 15, { steps: 5 }); await page.mouse.up()
  await expect.poll(() => /"layout":"([^"]+)"/.exec(deck.source)?.[1]).not.toBe(added)
  await image.click({ position: { x: 12, y: 12 } })
  await image.press('Delete')
  await expect.poll(() => deck.source).not.toContain('slot=studio-image-1')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
  await page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
  await expect.poll(() => deck.source).toContain('slot=studio-image-1')
  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByRole('button', { name: /^Change Layout/ }).click()
  await page.locator('button[data-key="title-only"]').click()
  await expect(page.locator(`${PREVIEW} .peitho-slide`)).toHaveAttribute('data-template', 'title-only')
  await expect(image).toBeVisible()
  expect(deck.source).toContain('slot=studio-image-1')
})

test('a failed image move restores the displayed position and keeps the saved source', async ({ page }) => {
  const deck = await open(page)
  await page.locator('[data-preview-image-input]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
  await expect.poll(() => deck.source).toContain('slot=studio-image-1')
  deck.commandError = cmd => cmd === 'create_image_canvas' ? 'Could not save image position' : null
  const before = deck.source
  const image = page.locator(`${PREVIEW} [data-studio-image="studio-image-1"]`)
  const rect = (await image.boundingBox())!
  await page.mouse.move(rect.x + 15, rect.y + 15); await page.mouse.down()
  await page.mouse.move(rect.x + 45, rect.y + 30, { steps: 4 }); await page.mouse.up()
  await expect(page.getByText('Could not save image position')).toBeVisible()
  await expect.poll(async () => Math.round((await image.boundingBox())!.x)).toBe(Math.round(rect.x))
  expect(deck.source).toBe(before)
})


test('editing stays in the slide with its typography and commits on outside click', async ({ page }) => {
  const deck = await open(page)
  const heading = page.locator(`${PREVIEW} h1`)
  const size = await heading.evaluate(el => getComputedStyle(el).fontSize)
  await heading.click()
  await expect(page.locator(`${PREVIEW} textarea`)).toHaveCount(0)
  await expect(page.locator(`${PREVIEW} [data-studio-edit] button`)).toHaveCount(0)
  expect(await page.locator(FIELD).evaluate(el => getComputedStyle(el).fontSize)).toBe(size)
  await page.locator(FIELD).fill('Inline title')
  await page.locator('[data-preview-comment-mode]').click()
  await expect.poll(() => deck.source).toContain('# Inline title')
  await expect(page.locator(FIELD)).toHaveCount(0)
})

test('Enter finishes a title and multiline column text remains in that column', async ({ page }) => {
  const deck = await open(page)
  await page.locator(`${PREVIEW} h1`).click()
  await page.locator(FIELD).fill('New title')
  await page.locator(FIELD).press('Enter')
  await expect.poll(() => deck.source).toContain('# New title')
  await page.locator(`${PREVIEW} [data-studio-slot="left"]`).click()
  await page.locator(FIELD).fill('First line')
  await page.locator(FIELD).press('End')
  await page.locator(FIELD).press('Enter')
  await page.locator(FIELD).pressSequentially('Second line')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('First line  \nSecond line')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
})

test('with the editor closed, blank lines in a cover text box do not create extra body items', async ({ page }) => {
  const source = '<!-- {"key":"cover","layout":"title-slide"} -->\n# Title\n\nOriginal\n'
  const deck: MockDeck = { source, deckPath: '/decks/talk/deck.md', editAnnotations: true, editableLayouts: true, layouts: ['title-slide'], layoutFiles: { 'title-slide': { html: TWO_COLUMN.replace(/<div style="display:flex;gap:40px">[\s\S]*<\/div><\/section>/, '<div><slot name="body" accepts="blocks" arity="0..1"></slot></div></section>'), css: null } } }
  deck.commandError = (cmd, args) => ['render_draft', 'save_slide'].includes(cmd) && /First\n\nSecond/.test(String(args.content)) ? "slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1" : null
  await mockTauri(page, deck); await page.goto('/')
  await page.locator('[data-slide-row="0"]').click()
  await page.getByRole('button', { name: 'Editor: Close', exact: true }).click()
  await expect(page.locator('[data-editor="body"]')).toBeHidden()
  await page.locator(`${PREVIEW} p`).click()
  await page.locator(FIELD).fill('First')
  await page.locator(FIELD).press('End')
  await page.locator(FIELD).press('Enter')
  await page.locator(FIELD).press('Enter')
  await page.locator(FIELD).pressSequentially('Second')
  await expect.poll(() => editorText(page)).toContain('First  \n\u00a0  \nSecond')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('First  \n\u00a0  \nSecond')
  await expect(page.getByText(/got 2 item/)).toHaveCount(0)
})


test('Markdown updates while typing without replacing the focused slide element', async ({ page }) => {
  await open(page)
  await page.locator(`${PREVIEW} h1`).click()
  await page.locator(FIELD).fill('Live title')
  await expect.poll(() => editorText(page)).toBe('# Live title')
  await page.waitForTimeout(900)
  await expect(page.locator(FIELD)).toBeFocused()
  await page.locator(FIELD).press('End')
  await page.locator(FIELD).pressSequentially(' continued')
  await expect.poll(() => editorText(page)).toBe('# Live title continued')
  await page.locator(FIELD).press('Escape')
  await expect.poll(() => editorText(page)).toBe('# Title')
})

test('editing the first of two slides keeps the next settings behind a real slide separator', async ({ page }) => {
  const source = '<!-- {"key":"cover","layout":"title-body"} -->\n# Title\n\nOriginal body\n\n---\n\n<!-- {"key":"next","layout":"title-body"} -->\n# Next\n\nNext body\n'
  const deck: MockDeck = { source, deckPath: '/decks/talk/deck.md', editAnnotations: true, editableLayouts: true, layouts: ['title-body'], layoutFiles: { 'title-body': { html: '<section class="peitho-slide" style="width:1280px;height:720px;padding:64px"><h1><slot name="title" accepts="inline" arity="1"></slot></h1><slot name="body" accepts="blocks" arity="0..*"></slot></section>', css: null } } }
  deck.commandError = (cmd, args) => ['render_draft', 'save_slide'].includes(cmd) && /[^\n]\n---\n/.test(String(args.content)) ? "page settings comment must appear before slide content" : null
  await mockTauri(page, deck); await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
  await page.locator('[data-slide-row="0"]').click()
  await page.locator(`${PREVIEW} p`).click()
  await page.locator(FIELD).fill('Edited body')
  await expect.poll(() => editorText(page)).toContain('Edited body')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('Edited body\n\n---\n\n<!-- {"key":"next"')
  await expect(page.getByText(/page settings comment must appear/)).toHaveCount(0)
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
  expect(deck.source).toContain('# Next\n\nNext body')
})


test('IME conversion updates Markdown only after composition ends', async ({ page }) => {
  await open(page)
  await page.locator(`${PREVIEW} h1`).click()
  await page.locator(FIELD).evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    el.textContent = '変換中'
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
  })
  expect(await editorText(page)).toBe('# Title')
  await page.locator(FIELD).evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '変換中' })))
  await expect.poll(() => editorText(page)).toBe('# 変換中')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => editorText(page)).toBe('# 変換中')
})


test('direct edits preserve inline code and emphasis and leave untouched Markdown unchanged', async ({ page }) => {
  const source = `${SOURCE}\n::: {slot=left}\n\nUse \`code\` and **bold**.\n\n:::\n`
  const deck = await open(page, source)
  const paragraph = page.locator(`${PREVIEW} [data-studio-slot="left"] p`)
  // Match the real engine's inline HTML; the fixture mock intentionally renders plain text.
  await paragraph.evaluate(el => { el.innerHTML = 'Use <code>code</code> and <strong>bold</strong>.' })
  await paragraph.click({ position: { x: 5, y: 5 } })
  await page.locator(FIELD).press('Meta+Enter')
  expect(deck.source).toBe(source)
  await paragraph.click({ position: { x: 5, y: 5 } })
  await page.locator(FIELD).press('End')
  await page.locator(FIELD).pressSequentially('!')
  await expect.poll(() => editorText(page)).toContain('Use \`code\` and **bold**.!')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('Use \`code\` and **bold**.!')
})

test('typing Markdown punctuation on the canvas writes literal text safely', async ({ page }) => {
  await open(page)
  await page.locator(`${PREVIEW} h1`).click()
  await page.locator(FIELD).fill('Use *literal* <tag>')
  await expect.poll(() => editorText(page)).toBe('# Use \\*literal\\* \\<tag\\>')
  await page.locator(FIELD).press('Meta+Enter')
})


test('a complete canvas session undoes and redoes as one unit across typing, pauses, and caret moves', async ({ page }) => {
  await open(page)
  await fillEditor(page, '# Before session')
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Before session')
  await page.locator(`${PREVIEW} h1`).click()
  await page.locator(FIELD).fill('')
  await page.locator(FIELD).pressSequentially('First')
  await page.waitForTimeout(700)
  await page.locator(FIELD).pressSequentially(' second')
  await page.locator(FIELD).press('Home')
  await page.locator(FIELD).pressSequentially('Moved ')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => editorText(page)).toBe('# Moved First second')
  const history = async (direction: 'undo' | 'redo') => {
    await page.evaluate(direction => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent(`menu:${direction}`, null, 'main'), direction)
  }
  await history('undo')
  await expect.poll(() => editorText(page)).toBe('# Before session')
  await history('redo')
  await expect.poll(() => editorText(page)).toBe('# Moved First second')
  // A later canvas edit must start its own group.
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Moved First second')
  await page.locator(`${PREVIEW} h1`).click()
  await page.locator(FIELD).fill('Next session')
  await page.locator(FIELD).press('Meta+Enter')
  await history('undo')
  await expect.poll(() => editorText(page)).toBe('# Moved First second')
  await history('undo')
  await expect.poll(() => editorText(page)).toBe('# Before session')
  await history('undo')
  await expect.poll(() => editorText(page)).toBe('# Title')
})
