import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { splitSlides, extractNote, extractPageComment } from '../domain/slides'
import { editorText, fillEditor } from './helpers/codeEditor'

const PREVIEW = '[data-preview-host]'
const FIELD = `${PREVIEW} [data-studio-edit]`
const SOURCE = '<!-- {"key":"s","layout":"two-column"} -->\n# Title\n'
const TWO_COLUMN = '<section class="peitho-slide" style="width:1280px;height:720px;padding:64px;box-sizing:border-box;background:white"><h1><slot name="title" accepts="inline" arity="1"></slot></h1><div style="display:flex;gap:40px"><div style="width:50%"><slot name="left" accepts="blocks" arity="0..*"></slot></div><div style="width:50%"><slot name="right" accepts="blocks" arity="0..*"></slot></div></div></section>'

async function open(page: Page, source = SOURCE, leftArity = '0..*'): Promise<MockDeck> {
  const deck: MockDeck = { source, deckPath: '/decks/talk/deck.md', editAnnotations: true, editableLayouts: true, layouts: ['two-column'], layoutFiles: { 'two-column': { html: TWO_COLUMN.replace('name="left" accepts="blocks" arity="0..*"', `name="left" accepts="blocks" arity="${leftArity}"`), css: null } }, css: '.peitho-slide h1 {font-size:56px}.peitho-slide p {font-size:32px}.peitho-slide img {width:100%;height:100%;object-fit:contain}' }
  deck.layouts!.push('title-only')
  deck.layoutFiles!['title-only'] = { html: '<section class="peitho-slide" data-template="title-only" style="width:1280px;height:720px;padding:64px;box-sizing:border-box;background:white"><h1><slot name="title" accepts="inline" arity="1"></slot></h1></section>', css: null }
  deck.layoutVerdicts = () => deck.layouts!.map(layout => ({ layout, fit: { kind: 'fits' } }))
  await mockTauri(page, deck); await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(splitSlides(source).length)
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Title')
  return deck
}

test('text edits update Markdown as one undoable edit, and clicks no longer open comments', async ({ page }) => {
  const deck = await open(page)
  await page.locator(`${PREVIEW} h1`).dblclick()
  await expect(page.locator(FIELD)).toHaveText('Title')
  await expect(page.locator('[data-comment-box]')).toBeHidden()
  await page.locator(FIELD).fill('成長率')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => editorText(page)).toBe('# 成長率')
  await expect.poll(() => deck.source).toContain('# 成長率')
  await page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
  await expect.poll(() => editorText(page)).toBe('# Title')
})

test('an emptied title placeholder reuses its heading when text is entered again', async ({ page }) => {
  const deck = await open(page)
  await page.locator(`${PREVIEW} h1`).click()
  await page.locator(FIELD).fill('')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toMatch(/\n#[ \t\u00a0]*\n/)
  const title = page.locator(`${PREVIEW} [data-studio-slot="title"]`)
  // An empty rendered title can have no source annotation, so entry comes
  // through the slot placeholder rather than the previous text element.
  await title.evaluate(el => el.replaceChildren())
  await title.click()
  await page.keyboard.type('New title')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => editorText(page)).toBe('# New title')
  await expect.poll(() => deck.source).not.toContain('# \u00a0')
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('New title')
})

test('clicking text-slot whitespace edits the nearest text block in one click', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\nFirst paragraph\n\nSecond paragraph\n\n:::\n')
  const slot = page.locator(`${PREVIEW} [data-studio-slot="left"]`)
  const frame = slot.locator('..')
  await frame.evaluate(el => { (el as HTMLElement).style.padding = '20px' })
  await frame.click({ position: { x: 5, y: 5 } })
  await expect(page.locator(FIELD)).toHaveText('First paragraph')
  await page.locator(FIELD).fill('Edited from whitespace')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('Edited from whitespace\n\nSecond paragraph')
})

test('the first mouse press selects text and accepts typing without another click or focus command', async ({ page }) => {
  const deck = await open(page)
  const heading = page.locator(`${PREVIEW} h1`)
  await heading.evaluate(el => {
    el.getRootNode().addEventListener('mousedown', event => {
      document.documentElement.dataset.mouseDownPrevented = String(event.defaultPrevented)
    }, { once: true })
  })
  const bounds = (await heading.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await expect(page.locator('html')).toHaveAttribute('data-mouse-down-prevented', 'false')
  await expect(page.locator(FIELD)).toHaveAttribute('contenteditable', 'true')
  await expect(page.locator(FIELD)).toHaveAttribute('data-studio-selected', '')
  await page.mouse.up()
  await page.keyboard.type('X')
  await expect(page.locator(FIELD)).toContainText('X')
  await expect.poll(() => deck.source).toContain('X')
})

test('clicking an in-slide control finishes text editing and releases preview updates', async ({ page }) => {
  await open(page)
  await page.locator(`${PREVIEW} .peitho-slide`).evaluate(slide => {
    const button = document.createElement('button'); button.textContent = 'Slide action'; slide.append(button)
  })
  await page.locator(`${PREVIEW} h1`).click()
  await expect(page.locator(FIELD)).toHaveCount(1)
  await page.locator(`${PREVIEW} button`).click()
  await expect(page.locator(FIELD)).toHaveCount(0)
  await fillEditor(page, '# Updated from Markdown')
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Updated from Markdown')
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
  await page.locator(`${PREVIEW} h1`).dblclick()
  await page.locator(FIELD).fill('Discard')
  await page.locator(FIELD).press('Escape')
  await expect(page.locator(FIELD)).toHaveCount(0)
  expect(deck.source).toBe(SOURCE)
  await page.locator(`${PREVIEW} h1`).click({ button: 'right' })
  await page.locator('[data-slide-menu-item="comment"]').click()
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

for (const keys of ['same', 'different', 'absent'] as const) {
  test(`image markers preserve handle sentinels and reconcile a detached slide with ${keys} keys`, async ({ page }) => {
    await open(page)
    await page.locator('[data-preview-image-input]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
    const image = page.locator(`${PREVIEW} [data-studio-image]`)
    const handles = image.locator('[data-studio-handle]')
    await expect(handles).toHaveCount(8)
    expect(await handles.evaluateAll(nodes => nodes.map(node => node instanceof HTMLElement ? [node.dataset.studioHandle, node.style.left, node.style.top, node.style.cursor] : []))).toEqual([
      ['nw', '0%', '0%', 'nw-resize'], ['n', '50%', '0%', 'n-resize'], ['ne', '100%', '0%', 'ne-resize'],
      ['w', '0%', '50%', 'w-resize'], ['e', '100%', '50%', 'e-resize'], ['sw', '0%', '100%', 'sw-resize'],
      ['s', '50%', '100%', 's-resize'], ['se', '100%', '100%', 'se-resize'],
    ])
    await image.evaluate(element => {
      for (const handle of Array.from(element.querySelectorAll('[data-studio-handle]')).slice(1)) handle.remove()
      const root = element.getRootNode()
      if (root instanceof ShadowRoot) root.host.dispatchEvent(new Event('studio-edit-mode'))
    })
    await expect(handles).toHaveCount(1)
    await expect(handles).toHaveAttribute('data-studio-handle', 'nw')
    await image.click({ position: { x: 20, y: 20 } })
    await expect(image).toHaveAttribute('data-studio-selected', '')
    await image.evaluate((element, keys) => {
      const slide = element.closest('.peitho-slide')!
      if (keys === 'absent') slide.removeAttribute('data-slide-key')
      const replacement = slide.cloneNode(true)
      if (!(replacement instanceof HTMLElement)) throw new Error('Expected slide element')
      if (keys === 'different') replacement.dataset.slideKey = 'another-slide'
      if (keys !== 'different') for (const selected of replacement.querySelectorAll('[data-studio-selected]')) selected.removeAttribute('data-studio-selected')
      const root = element.getRootNode()
      slide.replaceWith(replacement)
      if (root instanceof ShadowRoot) root.host.dispatchEvent(new Event('studio-edit-mode'))
    }, keys)
    if (keys === 'different') await expect(image).not.toHaveAttribute('data-studio-selected')
    else await expect(image).toHaveAttribute('data-studio-selected', '')
    expect(await image.evaluate(element => { const root = element.getRootNode(); return root instanceof ShadowRoot && root.activeElement === element })).toBe(false)
    await expect(handles).toHaveCount(1)
  })
}

test('a detached selected text node loses its selection marker on the replacement slide', async ({ page }) => {
  await open(page)
  await page.locator(`${PREVIEW} h1`).click()
  await page.keyboard.press('Escape')
  const selected = page.locator(`${PREVIEW} [data-studio-selected]`)
  await expect(selected).toHaveCount(1)
  await selected.evaluate(element => {
    const slide = element.closest('.peitho-slide')!
    slide.replaceWith(slide.cloneNode(true))
  })
  await expect(selected).toHaveCount(0)
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
  await heading.dblclick()
  await expect(page.locator(`${PREVIEW} textarea`)).toHaveCount(0)
  await expect(page.locator(`${PREVIEW} [data-studio-edit] button`)).toHaveCount(0)
  expect(await page.locator(FIELD).evaluate(el => getComputedStyle(el).fontSize)).toBe(size)
  await page.locator(FIELD).fill('Inline title')
  await page.locator('[data-slide-row="0"]').click()
  await expect.poll(() => deck.source).toContain('# Inline title')
  await expect(page.locator(FIELD)).toHaveCount(0)
})

test('list editing preserves rendered line spacing and formatting whitespace', async ({ page }) => {
  await open(page, SOURCE + '\n::: {slot=left}\n\n- First\n- Second\n- Third\n\n:::\n')
  const list = page.locator(`${PREVIEW} [data-studio-slot="left"] ul`)
  await list.evaluate(el => {
    el.style.fontSize = '32px'; el.style.lineHeight = '1.35'
    el.innerHTML = '\n' + Array.from(el.children).map(li => li.outerHTML).join('\n') + '\n'
  })
  const geometry = () => list.evaluate(el => ({
    height: el.getBoundingClientRect().height,
    lines: Array.from(el.querySelectorAll('li')).map(li => ({ y: li.getBoundingClientRect().y, height: li.getBoundingClientRect().height, lineHeight: getComputedStyle(li).lineHeight })),
  }))
  const before = await geometry()
  await list.locator('li').first().click()
  expect(await geometry()).toEqual(before)
  await page.keyboard.press('Escape')
  expect(await geometry()).toEqual(before)
})

test('paragraph editing preserves soft breaks and rendered hard-break line spacing', async ({ page }) => {
  await open(page, SOURCE + '\n::: {slot=left}\n\nFirst  \nSecond\n\n:::\n')
  const paragraph = page.locator(`${PREVIEW} [data-studio-slot="left"] p`).first()
  await paragraph.evaluate(el => {
    el.innerHTML = 'First<br>\nSecond with\na soft break'
    el.style.lineHeight = '1.35'
  })
  const geometry = () => paragraph.evaluate(el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el)
    return { y: rect.y, height: rect.height, lineHeight: style.lineHeight, whiteSpace: style.whiteSpace }
  })
  const before = await geometry()
  await paragraph.click({ position: { x: 5, y: 5 } })
  expect(await geometry()).toEqual(before)
  await page.keyboard.press('Escape')
  expect(await geometry()).toEqual(before)
})

test('Enter finishes a title and multiline column text remains in that column', async ({ page }) => {
  const deck = await open(page)
  await page.locator(`${PREVIEW} h1`).dblclick()
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
  await page.locator(`${PREVIEW} p`).dblclick()
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
  await page.locator(`${PREVIEW} h1`).dblclick()
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
  await page.locator(`${PREVIEW} p`).dblclick()
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
  await page.locator(`${PREVIEW} h1`).dblclick()
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
  await paragraph.dblclick({ position: { x: 5, y: 5 } })
  await page.locator(FIELD).press('Meta+Enter')
  expect(deck.source).toBe(source)
  await paragraph.dblclick({ position: { x: 5, y: 5 } })
  await page.locator(FIELD).press('End')
  await page.locator(FIELD).pressSequentially('!')
  await expect.poll(() => editorText(page)).toContain('Use \`code\` and **bold**.!')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('Use \`code\` and **bold**.!')
})

test('typing Markdown punctuation on the canvas writes literal text safely', async ({ page }) => {
  await open(page)
  await page.locator(`${PREVIEW} h1`).dblclick()
  await page.locator(FIELD).fill('Use *literal* <tag>')
  await expect.poll(() => editorText(page)).toBe('# Use \\*literal\\* \\<tag\\>')
  await page.locator(FIELD).press('Meta+Enter')
})


test('a complete canvas session undoes and redoes as one unit across typing, pauses, and caret moves', async ({ page }) => {
  await open(page)
  await fillEditor(page, '# Before session')
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Before session')
  await page.locator(`${PREVIEW} h1`).dblclick()
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
  await page.locator(`${PREVIEW} h1`).dblclick()
  await page.locator(FIELD).fill('Next session')
  await page.locator(FIELD).press('Meta+Enter')
  await history('undo')
  await expect.poll(() => editorText(page)).toBe('# Moved First second')
  await history('undo')
  await expect.poll(() => editorText(page)).toBe('# Before session')
  await history('undo')
  await expect.poll(() => editorText(page)).toBe('# Title')
})


test('image context menu supports all four actions, boundaries, Undo and failed saves', async ({ page }) => {
  const deck = await open(page)
  const photo = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
  await page.locator('[data-preview-image-input]').setInputFiles([photo('one.png'), photo('two.png'), photo('three.png')])
  const images = page.locator(`${PREVIEW} [data-studio-image]`)
  await expect(images).toHaveCount(3)
  const order = () => images.evaluateAll(nodes => [...nodes.map((node, index) => ({ slot: node.getAttribute('data-studio-image'), layer: Number((node as HTMLElement).style.zIndex) || index + 1 })), { slot: 'studio-content', layer: 0 }].sort((a, b) => a.layer - b.layer).map(node => node.slot))
  const third = page.locator(`${PREVIEW} [data-studio-image="studio-image-3"]`)
  const toolbar = page.locator('[data-slide-menu]')
  let selected = false
  const showMenu = async () => {
    await (selected ? page.locator(`${PREVIEW} .peitho-slide`) : third).click({ button: 'right', position: { x: 5, y: 5 } })
    selected = true
    await expect(toolbar).toBeVisible()
  }
  await showMenu()
  await expect(toolbar.locator('button:visible')).toHaveCount(10)
  await expect(toolbar.locator('button:visible').first()).toHaveAttribute('data-slide-menu-item', 'comment')
  await expect(toolbar.getByRole('button', { name: /^New Slide/ })).toBeHidden()
  await expect(page.locator(`${PREVIEW} [data-studio-image-order]`)).toHaveCount(0)
  await expect(toolbar.getByRole('button', { name: 'Bring to front', exact: true })).toBeDisabled()
  await toolbar.getByRole('button', { name: 'Send to back', exact: true }).click()
  await expect.poll(order).toEqual(['studio-image-3', 'studio-content', 'studio-image-1', 'studio-image-2'])
  await showMenu()
  await expect(toolbar.getByRole('button', { name: 'Send backward', exact: true })).toBeDisabled()
  await toolbar.getByRole('button', { name: 'Bring forward', exact: true }).click()
  await expect.poll(order).toEqual(['studio-content', 'studio-image-3', 'studio-image-1', 'studio-image-2'])
  await showMenu()
  await toolbar.getByRole('button', { name: 'Bring to front', exact: true }).click()
  await expect.poll(order).toEqual(['studio-content', 'studio-image-1', 'studio-image-2', 'studio-image-3'])
  await showMenu()
  await toolbar.getByRole('button', { name: 'Send backward', exact: true }).click()
  await expect.poll(order).toEqual(['studio-content', 'studio-image-1', 'studio-image-3', 'studio-image-2'])
  await page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
  await expect.poll(order).toEqual(['studio-content', 'studio-image-1', 'studio-image-2', 'studio-image-3'])
  await showMenu()
  const saved = deck.source
  deck.commandError = command => command === 'create_image_canvas' ? 'order save failed' : null
  await toolbar.getByRole('button', { name: 'Send to back', exact: true }).click()
  await expect(page.getByText('order save failed')).toBeVisible()
  expect(deck.source).toBe(saved)
  expect(await order()).toEqual(['studio-content', 'studio-image-1', 'studio-image-2', 'studio-image-3'])
  await showMenu()
  await expect(toolbar.getByRole('button', { name: 'Send to back', exact: true })).toBeEnabled()
})


test('one image moves behind actual slide text and returns to the foreground', async ({ page }) => {
  const deck = await open(page)
  deck.layoutFiles!['two-column'].html = TWO_COLUMN.replace('<h1>', '<h1 style="position:absolute;left:15%;top:25%;width:55%;height:55%;margin:0;background:red">')
  await page.locator('[data-preview-image-input]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
  const image = page.locator(`${PREVIEW} [data-studio-image]`)
  const foreground = () => image.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const root = element.getRootNode()
    if (!(root instanceof ShadowRoot) || !element.isConnected) return null
    return root.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[data-studio-image]') !== null
  })
  await expect.poll(foreground).toBe(true)
  await image.click({ button: 'right', position: { x: 30, y: 30 } })
  const menu = page.locator('[data-slide-menu]')
  await expect(menu.getByRole('button', { name: 'Send to back', exact: true })).toBeEnabled()
  await menu.getByRole('button', { name: 'Send to back', exact: true }).click()
  await expect.poll(foreground).toBe(false)
  // Keep the selected image as the menu target when right-clicking its overlying text.
  await page.locator(`${PREVIEW} h1`).click({ button: 'right', position: { x: 30, y: 30 } })
  await menu.getByRole('button', { name: 'Bring to front', exact: true }).click()
  await expect.poll(foreground).toBe(true)
})


test('preview menus contain element actions and paste while thumbnail menus own slide actions', async ({ page }) => {
  await open(page)
  const menu = page.locator('[data-slide-menu]')
  await page.locator(`${PREVIEW} h1`).click({ button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu.locator('button:visible')).toHaveCount(6)
  await expect(menu.locator('button:visible').first()).toHaveAttribute('data-slide-menu-item', 'comment')
  await expect(menu.getByRole('button', { name: /^New Slide/ })).toBeHidden()
  await page.mouse.click(1, 600)
  await page.locator(`${PREVIEW} .peitho-slide`).click({ button: 'right', position: { x: 5, y: 5 } })
  await expect(menu.getByRole('button', { name: /^New Slide/ })).toBeHidden()
  await expect(menu.getByRole('button', { name: /^Paste/ })).toBeVisible()
  await expect(menu.locator('button:visible').first()).toHaveAttribute('data-slide-menu-item', 'comment')
})


test('element copy, cut and delete act on text and images and Undo restores them', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\nKeep **formatting**\n\n:::\n')
  const menu = page.locator('[data-slide-menu]')
  const undo = () => page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
  await page.locator(`${PREVIEW} p`).click({ button: 'right' })
  await menu.getByRole('button', { name: /^Copy/ }).click()
  expect(deck.clipboardText).toBe('Keep **formatting**')
  await page.locator(`${PREVIEW} p`).click({ button: 'right' })
  await menu.getByRole('button', { name: /^Cut/ }).click()
  await expect.poll(() => deck.source).not.toContain('Keep **formatting**')
  await expect.poll(() => deck.source).not.toContain('slot=left')
  await undo()
  await expect.poll(() => deck.source).toContain('Keep **formatting**')
  await page.locator(`${PREVIEW} h1`).click({ button: 'right' })
  await menu.getByRole('button', { name: /^Delete/ }).click()
  await expect.poll(() => editorText(page)).toContain('# \u00a0')
  await undo()
  await expect.poll(() => editorText(page)).toContain('# Title')
  await page.locator('[data-preview-image-input]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
  const image = page.locator(`${PREVIEW} [data-studio-image]`)
  await image.click({ button: 'right' })
  await menu.getByRole('button', { name: /^Copy/ }).click()
  expect(deck.clipboardText).toMatch(/^!\[\]\(img\//)
  await image.click()
  await image.press('Meta+x')
  await expect(image).toHaveCount(0)
  await undo()
  await expect(image).toHaveCount(1)
  await image.click({ button: 'right' })
  await menu.getByRole('button', { name: /^Delete/ }).click()
  await expect(image).toHaveCount(0)
  await undo()
  await expect(image).toHaveCount(1)
  deck.commandError = command => command === 'plugin:clipboard-manager|write_text' ? 'clipboard failed' : null
  await image.click({ button: 'right' })
  await menu.getByRole('button', { name: /^Cut/ }).click()
  await expect(page.getByText('clipboard failed')).toBeVisible()
  await expect(image).toHaveCount(1)
})


test('copied and cut elements paste as separate canvas objects via menu and keyboard', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\nKeep **formatting**\n\n:::\n')
  const menu = page.locator('[data-slide-menu]')
  const background = page.locator(`${PREVIEW} .peitho-slide`)
  const undo = () => page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
  await page.locator(`${PREVIEW} p`).click({ button: 'right' })
  await menu.getByRole('button', { name: /^Copy/ }).click()
  await background.click({ button: 'right', position: { x: 5, y: 5 } })
  await menu.getByRole('button', { name: /^Paste/ }).click()
  await expect(page.locator(`${PREVIEW} [data-studio-text]`)).toHaveCount(1)
  await expect.poll(() => deck.source).toContain('::: {slot=studio-text-1}\n\nKeep **formatting**')
  await undo()
  await expect(page.locator(`${PREVIEW} [data-studio-text]`)).toHaveCount(0)
  await page.locator(`${PREVIEW} h1`).click({ button: 'right' })
  await menu.getByRole('button', { name: /^Copy/ }).click()
  await background.click({ button: 'right', position: { x: 5, y: 5 } })
  await menu.getByRole('button', { name: /^Paste/ }).click()
  await expect(page.locator(`${PREVIEW} [data-studio-text] h1`)).toHaveText('Title')
  await page.locator('[data-preview-image-input]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
  const images = page.locator(`${PREVIEW} [data-studio-image]`)
  const originalImageRect = await images.boundingBox()
  await images.click({ button: 'right' })
  await menu.getByRole('button', { name: /^Cut/ }).click()
  await expect(images).toHaveCount(0)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(text => navigator.clipboard.writeText(text!), deck.clipboardText)
  await background.click({ position: { x: 5, y: 5 } })
  await page.locator(PREVIEW).press('ControlOrMeta+v')
  await expect(images).toHaveCount(1)
  const firstPasteRect = await images.boundingBox()
  expect(firstPasteRect!.x).toBeGreaterThan(originalImageRect!.x)
  expect(firstPasteRect!.y).toBeGreaterThan(originalImageRect!.y)
  await images.click()
  await images.press('ControlOrMeta+v')
  await expect(images).toHaveCount(2)
  const secondPasteRect = await images.nth(1).boundingBox()
  expect(secondPasteRect!.x).toBeGreaterThan(firstPasteRect!.x)
  expect(secondPasteRect!.y).toBeGreaterThan(firstPasteRect!.y)
})


test('one click edits text, Escape selects the object, and empty canvas never deletes a slide', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\nText object\n\n:::\n')
  await page.locator(`${PREVIEW} p`).click()
  await expect(page.locator(FIELD)).toHaveText('Text object')
  await page.locator(FIELD).click()
  await expect(page.locator(FIELD)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator(FIELD)).toHaveCount(0)
  await page.keyboard.press('Meta+c')
  await expect.poll(() => deck.clipboardText).toBe('Text object')
  await page.keyboard.press('Delete')
  await expect.poll(() => deck.source).not.toContain('Text object')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
  await page.locator(`${PREVIEW} h1`).click()
  await expect(page.locator(FIELD)).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('a')
  await expect(page.locator(FIELD)).toHaveText('a')
  await page.keyboard.press('Meta+Enter')
  await expect.poll(() => editorText(page)).toBe('# a')
  await page.locator(`${PREVIEW} .peitho-slide`).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Delete')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
  await expect(page.locator('[data-preview-comment-mode], [data-preview-add-image]')).toHaveCount(0)
  await page.locator(`${PREVIEW} .peitho-slide`).click({ button: 'right', position: { x: 5, y: 5 } })
  await expect(page.locator('[data-preview-add-image-menu]')).toBeVisible()
})

test('an emptied free-text object stays hidden while a hidden footnotes wrapper is revealed', async ({ page }) => {
  const html = '<section class="peitho-slide" data-empty-slots="footnotes studio-text-1" style="width:1280px;height:720px;padding:64px;box-sizing:border-box;background:white"><h1><slot name="title" accepts="inline" arity="1"></slot></h1><div data-studio-text="studio-text-1" style="position:absolute;left:20%;top:30%;width:55%"><slot name="studio-text-1" accepts="blocks" arity="0..*"></slot></div><footer class="footnotes" style="display:none"><div><slot name="footnotes" accepts="blocks" arity="0..*"></slot></div></footer></section>'
  const deck: MockDeck = { source: '<!-- {"key":"s","layout":"canvas"} -->\n# Title\n', deckPath: '/decks/talk/deck.md', editAnnotations: true, editableLayouts: true, layouts: ['canvas'], layoutFiles: { canvas: { html, css: null } } }
  await mockTauri(page, deck); await page.goto('/')
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} [data-studio-slot="footnotes"]`)).toBeVisible()
  await expect(page.locator(`${PREVIEW} [data-studio-text="studio-text-1"]`)).toBeHidden()
})

const reproDirectory = process.env.PEITHO_REPRO_DECK_DIR

test('real deck text removed from Markdown disappears and cannot keep an unsynchronized editing field', async ({ page }) => {
  test.skip(!reproDirectory, 'Set PEITHO_REPRO_DECK_DIR to the read-only reproduction snapshot')
  const source = readFileSync(join(reproDirectory!, 'deck.md'), 'utf8')
  const layoutFiles = Object.fromEntries(readdirSync(join(reproDirectory!, 'layouts')).filter(file => file.endsWith('.html')).map(file => [file.slice(0, -5), { html: readFileSync(join(reproDirectory!, 'layouts', file), 'utf8'), css: null }]))
  const css = readdirSync(join(reproDirectory!, 'css')).filter(file => file.endsWith('.css')).map(file => readFileSync(join(reproDirectory!, 'css', file), 'utf8')).join('\n')
  const deck: MockDeck = { source, deckPath: '/Users/kfly8/Desktop/test/deck.md', editAnnotations: true, editableLayouts: true, layouts: Object.keys(layoutFiles), layoutFiles, css }
  await mockTauri(page, deck); await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  await page.locator('[data-slide-row="0"]').click()
  const text = page.locator(`${PREVIEW} [data-studio-text="studio-text-1"]`)
  await expect(text).toContainText('あああああ')
  const original = extractPageComment(extractNote(splitSlides(source)[0].text).rest).rest
  await text.locator('p').dispatchEvent('click', { detail: 2 })
  await page.locator(FIELD).fill('')
  await fillEditor(page, original.replace(/::: \{slot=studio-text-1\}[\s\S]*?\n:::/, ''))
  await expect(text).toBeHidden()
  await expect(page.locator(FIELD)).toHaveCount(0)
  await expect.poll(() => editorText(page)).not.toContain('studio-text-1')
  await page.locator('[data-editor="body"] .cm-content').press('ControlOrMeta+a')
  await page.keyboard.insertText(original)
  await expect.poll(() => deck.source).toContain('あああああ')
  await expect(text).toContainText('あああああ')
  await text.locator('p').dispatchEvent('click', { detail: 2 })
  await page.locator(FIELD).fill('Markdownと同期')
  await expect.poll(() => deck.source).toContain('Markdownと同期')
  await page.locator(FIELD).press('Meta+Enter')
  await text.locator('p').dispatchEvent('click', { detail: 1 })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Delete')
  await expect(text).toHaveCount(0)
  await expect.poll(() => editorText(page)).not.toContain('studio-text-1')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
})


test('re-editing a rendered hard break does not add a blank line', async ({ page }) => {
  await open(page, SOURCE + '\n::: {slot=left}\n\nFirst  \nSecond\n\n:::\n')
  const paragraph = page.locator(`${PREVIEW} [data-studio-slot="left"] p`).first()
  await paragraph.evaluate(el => {
    const start = Number(el.getAttribute('data-peitho-src')!.split('-')[0])
    el.setAttribute('data-peitho-src', `${start}-${start + 'First  \nSecond'.length}`)
    el.setAttribute('data-peitho-md', 'First  \nSecond')
    el.innerHTML = 'First<br />\nSecond'
    el.nextElementSibling?.remove()
  })
  await paragraph.dblclick({ position: { x: 5, y: 5 } })
  await page.locator(FIELD).evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
  })
  await page.locator(FIELD).pressSequentially('!')
  await expect.poll(() => editorText(page)).toContain('First  \nSecond!')
  expect(await editorText(page)).not.toContain('\u00a0')
})

test('pasted text uses the selected identical paragraph and grows without clipping its margins', async ({ page }) => {
  await open(page, SOURCE + '\n::: {slot=left}\n\nsame\n\n:::\n\n::: {slot=right}\n\nsame\n\n:::\n')
  const selected = page.locator(`${PREVIEW} [data-studio-slot="right"] p`)
  await selected.evaluate(el => { el.style.fontSize = '64px' })
  const slide = page.locator(`${PREVIEW} .peitho-slide`)
  const slideBox = (await slide.boundingBox())!
  const original = (await selected.boundingBox())!
  await selected.click({ button: 'right' })
  const menu = page.locator('[data-slide-menu]')
  await menu.getByRole('button', { name: /^Copy/ }).click()
  await slide.click({ button: 'right', position: { x: 5, y: 5 } })
  await menu.getByRole('button', { name: /^Paste/ }).click()
  const pasted = page.locator(`${PREVIEW} [data-studio-text]`)
  await expect(pasted).toContainText('same')
  const bounds = (await pasted.boundingBox())!
  expect(bounds.x).toBeCloseTo(original.x + slideBox.width * .02, 0)
  await expect(pasted).toHaveCSS('height', /px$/)
  expect(await pasted.evaluate(el => (el as HTMLElement).style.height)).toBe('auto')
  expect(await pasted.evaluate(el => getComputedStyle(el).overflow)).toBe('visible')
  const visible = async () => pasted.evaluate(el => {
    const wrapper = el.getBoundingClientRect(), child = el.querySelector('p')!.getBoundingClientRect()
    return child.top >= wrapper.top - 1 && child.bottom <= wrapper.bottom + 1
  })
  expect(await visible()).toBe(true)
  // The 64px inline style above is a selection probe, not persisted layout
  // typography. Measure growth against the rendered single-line text.
  await pasted.locator('p').dblclick()
  await page.locator(FIELD).fill('first')
  await page.locator(FIELD).press('Meta+Enter')
  await expect(pasted).toContainText('first')
  await expect(page.locator(FIELD)).toHaveCount(0)
  const height = async () => (await pasted.boundingBox())?.height ?? 0
  await expect.poll(height).toBeGreaterThan(0)
  const singleLine = await height()
  await pasted.locator('p').click()
  await page.locator(FIELD).fill('first')
  await page.locator(FIELD).press('End')
  for (const line of ['second', 'third', 'fourth']) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(line)
  }
  await page.locator(FIELD).press('Meta+Enter')
  // A re-render briefly detaches the box (no bounding box): keep polling.
  await expect.poll(height).toBeGreaterThan(singleLine)
  expect(await visible()).toBe(true)
})

test('canvas paste shortcuts work without a native paste event and coalesce a delayed native event', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\nClipboard text\n\n:::\n')
  const paragraph = page.locator(`${PREVIEW} [data-studio-slot="left"] p`)
  await paragraph.click()
  await paragraph.press('Escape')
  await paragraph.press('Meta+c')
  await expect.poll(() => deck.clipboardText).toBe('Clipboard text')
  await paragraph.dispatchEvent('keydown', { key: 'v', metaKey: true, bubbles: true, composed: true })
  await expect(page.locator(`${PREVIEW} [data-studio-text]`)).toHaveCount(1)
  await paragraph.evaluate(el => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'Clipboard text')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, composed: true, cancelable: true }))
  })
  await page.waitForTimeout(200)
  await expect(page.locator(`${PREVIEW} [data-studio-text]`)).toHaveCount(1)
  // A subsequent native menu paste is a separate action, even within the
  // shortcut's timeout window.
  await paragraph.evaluate(el => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'Clipboard text')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, composed: true, cancelable: true }))
  })
  await expect(page.locator(`${PREVIEW} [data-studio-text]`)).toHaveCount(2)
})

async function listCaret(page: Page, itemIndex: number, end = false) {
  await page.locator(FIELD).evaluate((field, args) => {
    const item = field.querySelectorAll('li')[args.itemIndex]
    const range = document.createRange(); range.selectNodeContents(item); range.collapse(!args.end)
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
  }, { itemIndex, end })
}

test('list key composition and modifier guards preserve the active edit and stop propagation', async ({ page }) => {
  const source = SOURCE + '\n::: {slot=left}\n\n- One\n\n:::\n'
  const deck = await open(page, source)
  await page.locator(`${PREVIEW} li`).click()
  await listCaret(page, 0)
  const guarded = await page.locator(FIELD).evaluate(field => {
    const root = field.getRootNode()
    let propagated = 0
    const observe = () => { propagated++ }
    root.addEventListener('keydown', observe)
    const control = document.createElement('span'); field.parentElement!.append(control)
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true, cancelable: true, composed: true }))
    control.remove()
    const baseline = propagated
    const prevented: boolean[] = []
    for (const mode of ['event', 'session']) {
      if (mode === 'session') field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      for (const key of ['Escape', 'Enter', 'Backspace']) {
        const event = new KeyboardEvent('keydown', { key, isComposing: mode === 'event', bubbles: true, cancelable: true, composed: true })
        field.dispatchEvent(event); prevented.push(event.defaultPrevented)
      }
      if (mode === 'session') field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    }
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
      const event = new KeyboardEvent('keydown', { key: 'Backspace', [modifier]: true, bubbles: true, cancelable: true, composed: true })
      field.dispatchEvent(event); prevented.push(event.defaultPrevented)
    }
    for (const modifier of ['altKey', 'shiftKey']) {
      const event = new KeyboardEvent('keydown', { key: 'Enter', [modifier]: true, bubbles: true, cancelable: true, composed: true })
      field.dispatchEvent(event); prevented.push(event.defaultPrevented)
    }
    root.removeEventListener('keydown', observe)
    return { baseline, propagated, prevented }
  })
  expect(guarded).toEqual({ baseline: 1, propagated: 1, prevented: Array(12).fill(false) })
  await expect(page.locator(FIELD)).toHaveCount(1)
  await expect(page.locator(`${FIELD} li`)).not.toHaveAttribute('data-studio-unlisted')
  expect(deck.source).toBe(source)
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const prevented = await page.locator(FIELD).evaluate((field, modifier) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', [modifier]: true, bubbles: true, cancelable: true, composed: true })
      field.dispatchEvent(event)
      return event.defaultPrevented
    }, modifier)
    expect(prevented).toBe(true)
    await expect(page.locator(FIELD)).toHaveCount(0)
    if (modifier === 'ctrlKey') await page.locator(`${PREVIEW} li`).click()
  }
})

test('list actions distinguish selected text, empty selection, repeated unlisting and a rejected commit', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\n- One\n- Two\n\n:::\n')
  await page.locator(`${PREVIEW} li`).first().click()
  const selected = await page.locator(FIELD).evaluate(field => {
    const item = field.querySelector('li')!
    const selection = window.getSelection()!
    const range = document.createRange(); range.selectNodeContents(item)
    selection.removeAllRanges(); selection.addRange(range)
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, composed: true })
    field.dispatchEvent(event)
    return { prevented: event.defaultPrevented, text: item.textContent, unlisted: item.hasAttribute('data-studio-unlisted') }
  })
  expect(selected).toEqual({ prevented: false, text: 'One', unlisted: false })
  const emptied = await page.locator(FIELD).evaluate(field => {
    const item = field.querySelector('li')!; item.textContent = '  '
    const selection = window.getSelection()!
    const range = document.createRange(); range.selectNodeContents(item)
    selection.removeAllRanges(); selection.addRange(range)
    const collapsed = selection.isCollapsed
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true })
    field.dispatchEvent(event)
    return { collapsed, prevented: event.defaultPrevented, unlisted: item.hasAttribute('data-studio-unlisted'), style: item.style.listStyleType }
  })
  expect(emptied).toEqual({ collapsed: false, prevented: true, unlisted: true, style: 'none' })
  await expect.poll(() => deck.source).toContain('&#160;\n\n- Two')
  const saved = deck.source
  const repeated = await page.locator(FIELD).evaluate(field => {
    const item = field.querySelector('li')!; item.textContent = 'Not committed again'
    const range = document.createRange(); range.selectNodeContents(item); range.collapse(true)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    return ['Backspace', 'Enter'].map(key => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true })
      field.dispatchEvent(event)
      return { prevented: event.defaultPrevented, error: field.hasAttribute('data-studio-edit-error') }
    })
  })
  expect(repeated).toEqual([{ prevented: false, error: false }, { prevented: false, error: false }])
  expect(await editorText(page)).not.toContain('Not committed again')
  await page.locator(`${FIELD} li`).last().evaluate(item => { item.textContent = '---' })
  await listCaret(page, 1)
  const rejected = await page.locator(FIELD).evaluate(field => {
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, composed: true })
    field.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(rejected).toBe(true)
  await expect(page.locator(FIELD)).toHaveAttribute('data-studio-edit-error', '')
  await expect(page.locator(`${FIELD} li`).last()).toHaveAttribute('data-studio-unlisted', '')
  expect(deck.source).toBe(saved)
})

test('list boundary normalization publishes only native Enter and uses immediate list items', async ({ page }) => {
  await open(page, SOURCE + '\n::: {slot=left}\n\n- One\n- Two\n\n:::\n')
  await page.locator(`${PREVIEW} li`).first().click()
  const cases = await page.locator(FIELD).evaluate(field => {
    Object.defineProperty(field.getRootNode(), 'getSelection', { value: undefined })
    const selection = window.getSelection()!
    const list = field.querySelector('ul')!, original = list.innerHTML
    const remove = selection.removeAllRanges.bind(selection), add = selection.addRange.bind(selection)
    let removed = 0, added = 0
    selection.removeAllRanges = () => { removed++; remove() }
    selection.addRange = range => { added++; add(range) }
    const results = []
    try {
      for (const kind of ['start-backspace', 'end-backspace', 'trailing-enter', 'adjacent-enter', 'nested-enter', 'unlisted-enter', 'outside-enter']) {
        list.innerHTML = original; field.replaceChildren(list)
        const last = list.lastElementChild!
        const target = kind === 'adjacent-enter' ? list.firstElementChild! : last
        if (kind === 'adjacent-enter') field.append(target)
        if (kind === 'nested-enter') last.insertAdjacentHTML('beforeend', '<ul><li>Nested</li></ul>')
        if (kind === 'unlisted-enter') last.setAttribute('data-studio-unlisted', '')
        field.append(document.createTextNode('\n'))
        const range = document.createRange(); range.selectNodeContents(field); range.collapse(kind === 'start-backspace')
        const outside = document.createElement('li'); outside.textContent = 'Outside'
        if (kind === 'outside-enter') {
          field.parentElement!.append(outside); range.selectNodeContents(outside); range.collapse(false)
        }
        remove(); add(range); removed = 0; added = 0
        const event = new KeyboardEvent('keydown', { key: kind.endsWith('backspace') ? 'Backspace' : 'Enter', bubbles: true, cancelable: true, composed: true })
        field.dispatchEvent(event)
        const composed = selection.getComposedRanges({ shadowRoots: [field.getRootNode() as ShadowRoot] })[0]
        results.push({ kind, prevented: event.defaultPrevented, removed, added,
          unlisted: Array.from(field.querySelectorAll('li')).map(item => item.hasAttribute('data-studio-unlisted')),
          atTargetEnd: composed?.startContainer === target && composed.startOffset === target.childNodes.length })
        outside.remove()
      }
    } finally { selection.removeAllRanges = remove; selection.addRange = add }
    return results
  })
  expect(cases).toEqual([
    { kind: 'start-backspace', prevented: true, removed: 0, added: 0, unlisted: [false, true], atTargetEnd: false },
    { kind: 'end-backspace', prevented: false, removed: 0, added: 0, unlisted: [false, false], atTargetEnd: true },
    { kind: 'trailing-enter', prevented: false, removed: 1, added: 1, unlisted: [false, false], atTargetEnd: true },
    { kind: 'adjacent-enter', prevented: false, removed: 1, added: 1, unlisted: [false, false], atTargetEnd: true },
    { kind: 'nested-enter', prevented: false, removed: 1, added: 1, unlisted: [false, false, false], atTargetEnd: true },
    { kind: 'unlisted-enter', prevented: false, removed: 0, added: 0, unlisted: [false, true], atTargetEnd: true },
    { kind: 'outside-enter', prevented: false, removed: 0, added: 0, unlisted: [false, false], atTargetEnd: false },
  ])
  await expect(page.locator(FIELD)).toHaveCount(1)
})

test('Enter creates new list items, empty Enter and line-start Backspace remove bullets, and Undo restores the list', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\n- One\n- Two\n\n:::\n')
  await page.locator(`${PREVIEW} li`).first().click()
  await listCaret(page, 0, true)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Added')
  await expect.poll(() => deck.source).toContain('- One\n- Added\n- Two')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Plain')
  await expect.poll(() => deck.source).toContain('- Added\n\nPlain\n\n- Two')
  await listCaret(page, 3)
  await page.keyboard.press('Backspace')
  await expect.poll(() => deck.source).not.toContain('- Two')
  await page.keyboard.type('New ')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('New Two')
  await expect(page.locator(`${PREVIEW} li`)).toHaveCount(2)
  await expect(page.locator(`${PREVIEW} p`)).toHaveText(['Plain', 'New Two'])
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
  await page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
  await expect.poll(() => deck.source).toContain('- One\n- Two')
})

test('unlisting in a single-block slot uses a private layout and keeps the original template unchanged', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\n- One\n- Two\n\n:::\n', '0..1')
  const originalSource = deck.source
  const original = deck.layoutFiles!['two-column'].html
  deck.commandError = (command, args) => command === 'render_draft' && String(args.content).includes('"layout":"two-column"') && String(args.content).includes('\n\nTwo') ? 'slot capacity exceeded' : null
  await page.locator(`${PREVIEW} li`).last().click()
  await listCaret(page, 1)
  await page.keyboard.press('Backspace')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('- One\n\nTwo')
  await expect.poll(() => deck.source).toContain('"layout":"studio-canvas-')
  expect(deck.layoutFiles!['two-column'].html).toBe(original)
  await expect(page.locator(`${PREVIEW} p`)).toHaveText('Two')
  await expect(page.getByText('slot capacity exceeded')).toHaveCount(0)
  const changedSource = deck.source
  await page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:undo', null, 'main'))
  await expect.poll(() => deck.source).toBe(originalSource)
  await page.evaluate(() => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent('menu:redo', null, 'main'))
  await expect.poll(() => deck.source).toBe(changedSource)
})

test('cancelling a list edit before layout preparation finishes discards pending text', async ({ page }) => {
  const source = SOURCE + '\n::: {slot=left}\n\n- One\n- Two\n\n:::\n'
  const deck = await open(page, source, '0..1')
  await page.evaluate(() => {
    const w = window as unknown as { __mockInvoke: (cmd: string, args: unknown) => Promise<unknown>; __releaseList?: () => void }
    const invoke = w.__mockInvoke
    w.__mockInvoke = async (cmd, args) => {
      if (cmd === 'create_image_canvas') await new Promise<void>(resolve => { w.__releaseList = resolve })
      return invoke(cmd, args)
    }
  })
  await page.locator(`${PREVIEW} li`).first().click()
  await listCaret(page, 0, true)
  await page.keyboard.type('Discard')
  await page.waitForFunction(() => Boolean((window as unknown as { __releaseList?: () => void }).__releaseList))
  await page.locator(FIELD).press('Escape')
  await page.evaluate(() => (window as unknown as { __releaseList: () => void }).__releaseList())
  await expect.poll(() => Object.keys(deck.layoutFiles!).length).toBe(3)
  expect(deck.source).toBe(source)
  await expect(page.locator(`${PREVIEW} li`).first()).toHaveText('One')
})

test('an empty final list item remains a bullet in Markdown and Escape keeps object shortcuts available', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\n- One\n\n:::\n')
  await page.locator(`${PREVIEW} li`).click()
  await listCaret(page, 0, true)
  await page.keyboard.press('Enter')
  await expect.poll(() => deck.source).toContain('- One\n- &#160;')
  await page.keyboard.type('Two')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('- One\n- Two')
  await page.locator(`${PREVIEW} li`).last().click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+c')
  await expect.poll(() => deck.clipboardText).toBe('Two')
  await page.keyboard.press('Delete')
  await expect.poll(() => deck.source).not.toContain('Two')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
})

test('Enter at the list container boundary adds a final bullet instead of a plain browser line', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\n- One\n\n:::\n')
  await page.locator(`${PREVIEW} li`).click()
  await page.locator(FIELD).evaluate(field => {
    const root = field.getRootNode() as ShadowRoot
    Object.defineProperty(root, 'getSelection', { value: undefined })
    const selectionAPI = window.getSelection() as unknown as { getComposedRanges: (options: { shadowRoots: ShadowRoot[] } | ShadowRoot) => StaticRange[] }
    const composed = selectionAPI.getComposedRanges.bind(selectionAPI)
    // Safari's older signature accepts a ShadowRoot directly.
    selectionAPI.getComposedRanges = options => {
      if (!(options instanceof ShadowRoot)) throw new TypeError('ShadowRoot required')
      return composed({ shadowRoots: [options] })
    }
    field.append(document.createTextNode('\n'))
    const range = document.createRange(); range.selectNodeContents(field); range.collapse(false)
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
  })
  await page.keyboard.press('Enter')
  await page.keyboard.type('Two')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('- One\n- Two')
  await expect(page.locator(`${PREVIEW} li`)).toHaveCount(2)
})

test('switching slides waits for pending list preparation and saves the latest input', async ({ page }) => {
  const source = SOURCE + '\n::: {slot=left}\n\n- One\n\n:::\n\n---\n<!-- {"key":"second","layout":"two-column"} -->\n# Second\n'
  const deck = await open(page, source, '0..1')
  await page.evaluate(() => {
    const w = window as unknown as { __mockInvoke: (cmd: string, args: unknown) => Promise<unknown>; __releaseList?: () => void }
    const invoke = w.__mockInvoke
    w.__mockInvoke = async (cmd, args) => {
      if (cmd === 'create_image_canvas') await new Promise<void>(resolve => { w.__releaseList = resolve })
      return invoke(cmd, args)
    }
  })
  await page.locator(`${PREVIEW} li`).click()
  await listCaret(page, 0, true)
  await page.keyboard.type('Keep')
  await page.waitForFunction(() => Boolean((window as unknown as { __releaseList?: () => void }).__releaseList))
  await page.locator('[data-slide-row="1"]').click()
  await expect.poll(() => editorText(page)).toContain('# Title')
  await page.evaluate(() => (window as unknown as { __releaseList: () => void }).__releaseList())
  await expect.poll(() => editorText(page)).toBe('# Second')
  await expect.poll(() => deck.source).toContain('- OneKeep')
  await page.locator('[data-slide-row="0"]').click()
  await expect(page.locator(`${PREVIEW} li`)).toHaveText('OneKeep')
})

test('a failed list layout preparation still preserves subsequent typing in Markdown', async ({ page }) => {
  const deck = await open(page, SOURCE + '\n::: {slot=left}\n\n- One\n\n:::\n', '0..1')
  deck.commandError = command => command === 'create_image_canvas' ? 'Cannot write layout' : null
  await page.locator(`${PREVIEW} li`).click()
  await listCaret(page, 0, true)
  await page.keyboard.type('Keep')
  await expect.poll(() => editorText(page)).toContain('- OneKeep')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toContain('- OneKeep')
})

test('editing a loose list preserves separate paragraphs within an item', async ({ page }) => {
  const source = SOURCE + '\n::: {slot=left}\n\n- One\n\n  More\n\n- Two\n\n:::\n'
  const deck = await open(page, source)
  // Match the engine's actual loose-list structure, with annotations on
  // each paragraph rather than the mock's default one-line LI elements.
  await page.locator(`${PREVIEW} [data-studio-slot="left"]`).evaluate((slot, source) => {
    const paragraph = (word: string) => {
      const at = source.indexOf(word)
      const from = new TextEncoder().encode(source.slice(0, at)).length
      return `<p data-peitho-src="${from}-${from + word.length}" data-peitho-md="${word}">${word}</p>`
    }
    slot.innerHTML = `<ul><li>${paragraph('One')}${paragraph('More')}</li><li>${paragraph('Two')}</li></ul>`
  }, source)
  await page.locator(`${PREVIEW} li p`).first().click()
  await page.locator(FIELD).locator('p').first().evaluate(p => {
    const range = document.createRange(); range.selectNodeContents(p); range.collapse(false)
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
  })
  await page.keyboard.type('X')
  await page.locator(FIELD).press('Meta+Enter')
  await expect.poll(() => deck.source).toMatch(/- OneX\n[ \t]*\n  More\n- Two/)
})

test('cancelling a prepared list edit prevents Redo from reviving its private layout', async ({ page }) => {
  const source = SOURCE + '\n::: {slot=left}\n\n- One\n- Two\n\n:::\n'
  const deck = await open(page, source, '0..1')
  await page.locator(`${PREVIEW} li`).last().click()
  await listCaret(page, 1)
  await page.keyboard.press('Backspace')
  await expect.poll(() => deck.source).toContain('"layout":"studio-canvas-')
  await page.locator(FIELD).press('Escape')
  await expect.poll(() => deck.source).toBe(source)
  for (const event of ['menu:undo', 'menu:redo']) {
    await page.evaluate(event => (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, label: string) => void }).__mockEmitTauriEvent(event, null, 'main'), event)
    await expect.poll(() => editorText(page)).toContain('- One\n- Two')
  }
  expect(deck.source).toBe(source)
})


for (const scenario of [
  {
    name: 'zero ordered start', list: true,
    html: '<ol start="0"><li>Zero</li><li>Next</li></ol>',
    expected: "# Title\n\n::: {slot=left}\n\n0. Zero\n1. Next\n\n:::"
  },
  {
    name: 'empty text BR sibling and unlisted block runs', list: true,
    html: '<ul><li>a<br data-empty-sibling></li><li data-studio-unlisted>Free<p>Block</p>end</li><li>\n <b>x</b> \t&nbsp;</li><li> \t<b>y</b></li></ul>',
    expected: "# Title\n\n::: {slot=left}\n\n- a  \n  \n\nFree\n\nBlock\n\nend\n\n- **x** \t\u00a0\n-  \t**y**\n\n:::"
  },
  {
    name: 'mixed nested lists and block runs', list: true,
    html: '<ul>\n<li>Lead<p>Paragraph <b>bold</b></p>between<div>Block</div><ol start="3"><li>Ordered<ul><li>Deep</li></ul></li></ol>tail</li>\n<li></li></ul>',
    expected: "# Title\n\n::: {slot=left}\n\n- Lead\n  \n  Paragraph **bold**\n  \n  between\n  \n  Block\n  \n  3. Ordered\n     \n     - Deep\n  \n  tail\n- &#160;\n\n:::"
  },
  {
    name: 'list formatting whitespace and BR siblings', list: true,
    html: '<ul> \t&nbsp;\n<li> A \t&nbsp;\n<br>\nB<br>\n\nC<br><!--comment--></li><li>x<br></li><li data-studio-unlisted><br></li><li> \t&nbsp;</li><li>a\n \t<b>b</b>\n<span>c</span> \t&nbsp;</li></ul>',
    expected: "# Title\n\n::: {slot=left}\n\n-  A \t\u00a0\n    \n  B  \n  \n  C  \n  \n- x\n\n&#160;\n\n- &#160;\n- a\n   \t**b**c \t\u00a0\n\n:::"
  },
  {
    name: 'zero ordered starts and non-item children', list: true,
    html: '<ol start="0"><span>prefix</span><li>Zero</li><li>Next</li></ol>',
    expected: "# Title\n\n::: {slot=left}\n\nprefix\n1. Zero\n2. Next\n\n:::"
  },
  {
    name: 'negative ordered starts', list: true,
    html: '<ol start="-2"><li>Negative</li><li>Next</li></ol>',
    expected: "# Title\n\n::: {slot=left}\n\n-2. Negative\n-1. Next\n\n:::"
  },
  {
    name: 'invalid ordered starts', list: true,
    html: '<ol start="invalid"><li>Invalid</li><li>Next</li></ol>',
    expected: "# Title\n\n::: {slot=left}\n\nNaN. Invalid\nNaN. Next\n\n:::"
  },
  {
    name: 'inline aliases raw code links and live checkbox state', list: false,
    html: '<strong>S</strong><b>B</b><em>E</em><i>I</i><s>S</s><del>D</del><code>a`<b>*raw*</b></code><a href="https://example.test/a">link</a><a>missing</a><unknown-tag>unknown</unknown-tag><svg><text>svg</text></svg><!--omit--><input type="checkbox" checked><input type="checkbox"><input type="CHECKBOX" checked><input type="text">',
    expected: "# Title\n\n::: {slot=left}\n\n**S****B***E**I*~~S~~~~D~~``a`*raw*``[link](https://example.test/a)[missing]()unknownsvg[ ] [x] \n\n:::"
  },
  {
    name: 'non-list placeholder and post-BR line feeds', list: false,
    html: 'A<br>\nB<br>\n\nC<div><br></div><p><br></p><div>D</div><p>E</p>',
    expected: "# Title\n\n::: {slot=left}\n\nA  \nB  \n\u00a0  \nC  \n\u00a0  \n\u00a0  \nD  \nE\n\n:::"
  },
]) {
  test(`serializer characterization: ${scenario.name}`, async ({ page }) => {
    await open(page, SOURCE + '\n::: {slot=left}\n\n' + (scenario.list ? '- Seed' : 'Seed') + '\n\n:::\n')
    await page.locator(`${PREVIEW} [data-studio-slot="left"] ${scenario.list ? 'li' : 'p'}`).first().click()
    await page.locator(FIELD).evaluate((field, html) => {
      field.innerHTML = html
      field.querySelector('[data-empty-sibling]')?.after(document.createTextNode(''))
      const inputs = field.querySelectorAll('input')
      if (inputs[0]) inputs[0].checked = false
      if (inputs[1]) inputs[1].checked = true
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }, scenario.html)
    await expect.poll(() => editorText(page)).toBe(scenario.expected)
  })
}

for (const invalid of ['span', 'quote', 'code', 'pre'] as const) {
  test(`invalid direct source (${invalid}) clears selection without empty-slot fallback`, async ({ page }) => {
    await open(page)
    await page.locator(`${PREVIEW} h1`).click()
    await page.locator(FIELD).press('Escape')
    await page.locator(`${PREVIEW} [data-studio-selected]`).evaluate((selected, invalid) => {
      if (!(selected instanceof HTMLElement)) throw new Error('Missing selected text')
      const slot = selected.closest('[data-studio-slot]')
      if (!slot) throw new Error('Missing title slot')
      selected.textContent = ''
      if (invalid === 'span') selected.setAttribute('data-peitho-src', 'broken')
      if (invalid === 'quote') selected.removeAttribute('data-peitho-md')
      if (invalid === 'code' || invalid === 'pre') {
        const code = document.createElement(invalid); selected.before(code); code.append(selected)
      }
      slot.setAttribute('data-studio-empty', '')
      selected.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    }, invalid)
    await expect(page.locator(FIELD)).toHaveCount(0)
    await expect(page.locator(`${PREVIEW} [data-studio-selected]`)).toHaveCount(0)
  })
}

for (const clickTarget of ['source', 'heading'] as const) {
  test(`a ${clickTarget} click keeps direct-source versus heading-descendant precedence`, async ({ page }) => {
    await open(page)
    await page.locator(`${PREVIEW} h1`).evaluate((heading, clickTarget) => {
      const original = heading.matches('[data-peitho-src]') ? heading : heading.querySelector('[data-peitho-src]')
      if (!original) throw new Error('Missing title source')
      const first = document.createElement('span')
      const second = document.createElement('span')
      for (const [index, element] of [first, second].entries()) {
        element.setAttribute('data-peitho-src', original.getAttribute('data-peitho-src') ?? '')
        element.setAttribute('data-peitho-md', original.getAttribute('data-peitho-md') ?? '')
        element.dataset.entryCandidate = String(index); element.textContent = 'Title'
      }
      heading.removeAttribute('data-peitho-src'); heading.removeAttribute('data-peitho-md')
      heading.replaceChildren(first, second)
      const target = clickTarget === 'source' ? second : heading
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    }, clickTarget)
    await expect(page.locator(FIELD)).toHaveAttribute('data-entry-candidate', clickTarget === 'source' ? '1' : '0')
  })
}

for (const container of ['slide', 'single-slot-wrapper'] as const) {
  test(`whitespace on ${container} preserves the single contained-slot rule`, async ({ page }) => {
    await open(page)
    await page.locator(`${PREVIEW} .peitho-slide`).evaluate((slide, container) => {
      const title = slide.querySelector('h1')
      if (!title) throw new Error('Missing title')
      const wrapper = document.createElement('div'); wrapper.append(title)
      slide.replaceChildren(wrapper)
      const target = container === 'slide' ? slide : wrapper
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    }, container)
    await expect(page.locator(FIELD)).toHaveCount(container === 'slide' ? 0 : 1)
  })
}

for (const direct of [false, true]) {
  test(`IMG source filtering distinguishes ${direct ? 'direct' : 'whitespace'} resolution`, async ({ page }) => {
    await open(page)
    await page.locator(`${PREVIEW} h1`).evaluate((heading, direct) => {
      const source = heading.matches('[data-peitho-src]') ? heading : heading.querySelector('[data-peitho-src]')
      const slot = source?.closest('[data-studio-slot]')
      if (!source || !slot) throw new Error('Missing title source slot')
      const image = document.createElement('img')
      image.setAttribute('data-peitho-src', source.getAttribute('data-peitho-src') ?? '')
      image.setAttribute('data-peitho-md', source.getAttribute('data-peitho-md') ?? '')
      const text = source.cloneNode(true)
      if (!(text instanceof HTMLElement)) throw new Error('Missing text source')
      image.dataset.entryCandidate = 'image'; text.dataset.entryCandidate = 'text'
      const wrapper = document.createElement('div')
      const replacementSlot = document.createElement('div')
      replacementSlot.setAttribute('data-studio-slot', slot.getAttribute('data-studio-slot') ?? '')
      for (const tag of ['pre', 'code', 'div']) {
        const excluded = document.createElement(tag)
        if (tag === 'div') excluded.dataset.studioImage = 'excluded'
        const excludedSource = text.cloneNode(true)
        if (!(excludedSource instanceof Element)) throw new Error('Missing excluded source')
        excludedSource.setAttribute('data-entry-candidate', `excluded-${tag}`)
        excluded.append(excludedSource); replacementSlot.append(excluded)
      }
      replacementSlot.append(image, text); wrapper.append(replacementSlot)
      heading.replaceWith(wrapper)
      const target = direct ? image : replacementSlot
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    }, direct)
    await expect(page.locator(FIELD)).toHaveAttribute('data-entry-candidate', direct ? 'image' : 'text')
  })
}

for (const tie of [false, true]) {
  test(`whitespace distance preserves ${tie ? 'DOM-order ties' : 'nearest rectangle'}`, async ({ page }) => {
    await open(page)
    await page.locator(`${PREVIEW} h1`).evaluate((heading, tie) => {
      const original = heading.matches('[data-peitho-src]') ? heading : heading.querySelector('[data-peitho-src]')
      if (!original) throw new Error('Missing title source')
      const slot = document.createElement('div'); slot.dataset.studioSlot = 'title'
      for (const index of [0, 1]) {
        const source = original.cloneNode(true)
        if (!(source instanceof HTMLElement)) throw new Error('Missing source clone')
        source.dataset.entryCandidate = String(index)
        source.getBoundingClientRect = () => new DOMRect(tie ? 100 : index * 100, 0, 10, 10)
        slot.append(source)
      }
      heading.replaceWith(slot)
      slot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, clientX: 105, clientY: 5 }))
    }, tie)
    await expect(page.locator(FIELD)).toHaveAttribute('data-entry-candidate', tie ? '0' : '1')
  })
}

for (const destination of ['image', 'none', 'rejected'] as const) {
  test(`a ${destination} destination preserves its selection behavior`, async ({ page }) => {
    const deck = await open(page)
    await page.locator(`${PREVIEW} h1`).click()
    await page.locator(FIELD).press('Escape')
    const chooser = destination === 'image' ? page.waitForEvent('filechooser') : null
    await page.locator(`${PREVIEW} .peitho-slide`).evaluate((slide, destination) => {
      const selected = slide.querySelector('[data-studio-selected]')
      if (!selected) throw new Error('Missing preceding selection')
      selected.setAttribute('data-entry-candidate', 'previous')
      const target = document.createElement('div')
      target.dataset.entryCandidate = 'destination'
      if (destination === 'image') {
        target.dataset.studioSlot = 'image'; target.dataset.studioAccepts = 'image'
      }
      if (destination === 'rejected') {
        target.dataset.peithoSrc = selected.getAttribute('data-peitho-src') ?? ''
        target.dataset.peithoMd = 'not the rendered source'; target.textContent = 'Unresolvable text'
      }
      slide.append(target)
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    }, destination)
    if (chooser) await chooser
    await expect(page.locator(FIELD)).toHaveCount(0)
    const selected = page.locator(`${PREVIEW} [data-studio-selected]`)
    if (destination === 'none') await expect(selected).toHaveCount(0)
    else {
      await expect(selected).toHaveAttribute('data-entry-candidate', destination === 'image' ? 'previous' : 'destination')
      await expect(selected).toHaveAttribute('tabindex', '0')
    }
    expect(deck.source).toBe(SOURCE)
  })
}

for (const freeText of [false, true]) {
  test(`list edit resolves the ${freeText ? 'free-text ancestor before' : 'ordinary'} slot`, async ({ page }) => {
    const deck = await open(page, SOURCE + '\n::: {slot=left}\n\n- First\n- Second\n\n:::\n')
    const preparedSlots: unknown[] = []
    deck.commandError = (command, args) => {
      if (command === 'create_image_canvas') preparedSlots.push(args.textSlot)
      return null
    }
    if (freeText) await page.locator(`${PREVIEW} [data-studio-slot="left"]`).evaluate(slot => {
      const wrapper = document.createElement('div'); wrapper.dataset.studioText = 'preferred'
      slot.before(wrapper); wrapper.append(slot)
    })
    await page.locator(`${PREVIEW} [data-studio-slot="left"] li`).first().click()
    await page.locator(FIELD).fill('Changed list')
    await expect.poll(() => preparedSlots).toEqual([freeText ? 'preferred' : 'left'])
  })
}

test('field mechanics promote the outermost list, filter annotations, and restore the original source', async ({ page }) => {
  const source = SOURCE + '\n::: {slot=left}\n\n- First\n- Second\n\n:::\n'
  const deck = await open(page, source)
  await page.locator(`${PREVIEW} [data-studio-slot="left"] ul`).evaluate(list => {
    const [first, second] = list.querySelectorAll('li')
    const nested = document.createElement('ol'); nested.append(second); first.append(nested)
    list.setAttribute('data-outer-list', '')
    list.style.whiteSpace = 'pre-wrap'
    for (const invalid of ['span', 'quote']) {
      const extra = document.createElement('span'); extra.dataset.peithoSrc = invalid === 'span' ? 'broken' : second.getAttribute('data-peitho-src') ?? ''
      if (invalid === 'span') extra.dataset.peithoMd = 'bad span'
      list.append(extra)
    }
    second.setAttribute('data-original-source', '')
    second.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }))
  })
  await expect(page.locator(`${FIELD} > [data-outer-list]`)).toHaveCount(1)
  await expect(page.locator(FIELD)).toHaveCSS('white-space', 'pre-wrap')
  await page.locator(FIELD).press('Escape')
  await expect(page.locator(FIELD)).toHaveCount(0)
  await expect(page.locator(`${PREVIEW} [data-studio-selected]`)).toHaveAttribute('data-original-source', '')
  await expect(page.locator(`${PREVIEW} [data-outer-list]`)).not.toHaveAttribute('contenteditable')
  expect(deck.source).toBe(source)
  await page.locator(`${PREVIEW} [data-original-source]`).dispatchEvent('click')
  await page.locator(FIELD).fill('Replacement')
  await expect.poll(() => editorText(page)).toContain('Replacement')
  await expect.poll(() => editorText(page)).not.toContain('First')
  expect(await editorText(page)).not.toContain('Second')
})

test('field mechanics keep list ancestry without promotion for an empty slot', async ({ page }) => {
  const deck = await open(page)
  await page.locator(`${PREVIEW} [data-studio-slot="left"]`).evaluate(slot => {
    const list = document.createElement('ul'), item = document.createElement('li')
    list.style.whiteSpace = 'pre-line'
    slot.before(list); list.append(item); item.append(slot)
    slot.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }))
  })
  await expect(page.locator(`${PREVIEW} li > [data-studio-edit]`)).toHaveCount(1)
  await expect(page.locator(`${FIELD} ul`)).toHaveCount(0)
  await expect(page.locator(FIELD)).toHaveCSS('white-space', 'pre-line')
  await page.locator(FIELD).press('Escape')
  await expect(page.locator(`${PREVIEW} li > [data-studio-slot="left"]`)).toHaveCount(1)
  await expect(page.locator(FIELD)).toHaveCount(0)
  expect(deck.source).toBe(SOURCE)
})

test('field mechanics consume active-field clicks through composition and rejected commits', async ({ page }) => {
  const source = SOURCE + '\n::: {slot=left}\n\nBody\n\n:::\n'
  const deck = await open(page, source)
  const outsideClick = () => page.locator(`${PREVIEW} h1`).evaluate(heading => {
    const source = heading.querySelector('[data-peitho-src]') ?? heading
    source.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
  })
  await page.locator(`${PREVIEW} [data-studio-slot="left"] p`).click()
  await page.locator(FIELD).evaluate(field => {
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    field.textContent = 'Pending composition'
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
    field.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
  })
  await outsideClick()
  await expect(page.locator(FIELD)).toHaveText('Pending composition')
  expect(deck.source).toBe(source)
  await page.locator(FIELD).evaluate(field => field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await expect.poll(() => deck.source).toContain('Pending composition')
  await expect(page.locator(FIELD)).toHaveText('Pending composition')
  const saved = deck.source
  await page.locator(FIELD).evaluate(field => { field.textContent = '---' })
  await outsideClick()
  await expect(page.locator(FIELD)).toHaveAttribute('data-studio-edit-error', '')
  await expect(page.locator(FIELD)).toHaveText('---')
  expect(deck.source).toBe(saved)
  await page.locator(FIELD).evaluate(field => { field.textContent = 'Accepted' })
  await outsideClick()
  await expect(page.locator(FIELD)).toHaveCount(0)
  await expect.poll(() => deck.source).toContain('Accepted')
})

for (const caret of ['standard', 'vendor', 'null', 'outside'] as const) {
  test(`field mechanics place the caret with ${caret} browser API results`, async ({ page }) => {
    await open(page)
    const actual = await page.locator(`${PREVIEW} h1`).evaluate((heading, caret) => {
      const root = heading.getRootNode()
      if (!(root instanceof ShadowRoot)) throw new Error('Missing shadow root')
      const source = heading.matches('[data-peitho-src]') ? heading : heading.querySelector('[data-peitho-src]')
      if (!source?.firstChild) throw new Error('Missing text source')
      const text = source.firstChild, selection = window.getSelection()!
      const saved = [Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint'), Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint'), Object.getOwnPropertyDescriptor(root, 'getSelection')]
      const calls: string[] = []
      let observed = { atText: false, atEnd: false, offset: -1, collapsed: false }
      const add = selection.addRange
      const position = (x: number, y: number, options: { shadowRoots: ShadowRoot[] }) => {
        calls.push(`standard:${x},${y}:${options.shadowRoots[0] === root}`)
        return caret === 'vendor' || caret === 'null' ? null : { offsetNode: caret === 'outside' ? document.body : text, offset: 1 }
      }
      const vendor = () => {
        calls.push('vendor')
        if (caret === 'null') return null
        const range = document.createRange(); range.setStart(text, 2); range.collapse(true); return range
      }
      try {
        Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: position })
        Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: vendor })
        Object.defineProperty(root, 'getSelection', { configurable: true, value: () => { calls.push('selection'); return selection } })
        selection.addRange = range => {
          observed = { atText: range.startContainer === text, atEnd: range.startContainer === source && range.startOffset === source.childNodes.length, offset: range.startOffset, collapsed: range.collapsed }
          add.call(selection, range)
        }
        const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: 17, clientY: 23 })
        source.dispatchEvent(event)
        return { calls, observed, prevented: event.defaultPrevented, editable: source.getAttribute('contenteditable') }
      } finally {
        selection.addRange = add
        for (const [index, [object, key]] of ([[document, 'caretPositionFromPoint'], [document, 'caretRangeFromPoint'], [root, 'getSelection']] as const).entries()) {
          const descriptor = saved[index]
          if (descriptor) Object.defineProperty(object, key, descriptor)
          else Reflect.deleteProperty(object, key)
        }
      }
    }, caret)
    expect(actual.calls).toEqual(caret === 'vendor' || caret === 'null' ? ['standard:17,23:true', 'vendor', 'selection'] : ['standard:17,23:true', 'selection'])
    expect(actual.observed).toEqual({ atText: caret === 'standard' || caret === 'vendor', atEnd: caret === 'null' || caret === 'outside', offset: caret === 'vendor' ? 2 : 1, collapsed: true })
    expect(actual.prevented).toBe(true)
    expect(actual.editable).toBe('true')
  })
}
