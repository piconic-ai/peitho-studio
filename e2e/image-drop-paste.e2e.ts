// Images brought into the slide body by pasting (a screenshot on the
// clipboard) or by dropping files from Finder: each is saved into the
// deck's `img/` (`import_deck_image_bytes`/`_file`, stubbed here — what they
// write is covered by `engine::images`'s Rust tests) and its Markdown goes
// in as its own paragraph.
//
// A paste is a real `paste` event carrying a `File` on its clipboard data.
// A drop is the `tauri://drag-drop` event Tauri sends in place of an HTML5
// drop (the window takes file drops itself), with its position in physical
// pixels. What these can't show: whether a real WKWebView hands a
// screenshot over as PNG or TIFF, what Finder's copied files look like on
// the clipboard, and whether a real drop's position lines up — on-device
// checks (todo/image-drop-paste.md).
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, editorText, moveToEditorEnd } from './helpers/codeEditor'

const TWO_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\nSome text\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]

interface Invocation { cmd: string; args: Record<string, unknown> }

async function openDeck(page: Page, deck: MockDeck): Promise<Invocation[]> {
  const invocations: Invocation[] = []
  deck.onInvoke = (cmd, args) => { invocations.push({ cmd, args }) }
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await expect.poll(() => editorText(page)).toBe('# Slide One\n\nSome text')
  return invocations
}

const imports = (invocations: Invocation[]) => invocations.filter(call => call.cmd.startsWith('import_deck_image_'))

/** Pastes into the focused body what a clipboard holding `files` (and
 * optionally `text`) would. */
async function paste(page: Page, files: { name: string; type: string; bytes: number[] }[], text?: string): Promise<void> {
  await editorContent(page).evaluate((content, { files, text }) => {
    const data = new DataTransfer()
    for (const file of files) data.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }))
    if (text !== undefined) data.setData('text/plain', text)
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, { files, text })
}

/** Drops `paths` onto the window at `point` (CSS pixels), as Tauri reports
 * it: unscaled on macOS, in physical pixels elsewhere (`dropPointToCss`). */
async function drop(page: Page, paths: string[], point: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ paths, point }) => {
    const scale = /Mac/.test(navigator.userAgent) ? 1 : window.devicePixelRatio
    ;(window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown) => void })
      .__mockEmitTauriEvent('tauri://drag-drop', { paths, position: { x: point.x * scale, y: point.y * scale } })
  }, { paths, point })
}

/** The CSS-pixel point at the end of the body's `line`-th line (1-based). */
async function endOfLine(page: Page, line: number): Promise<{ x: number; y: number }> {
  const box = await editorContent(page).locator(':scope > .cm-line').nth(line - 1).boundingBox()
  if (box === null) throw new Error('line not visible')
  return { x: box.x + box.width - 2, y: box.y + box.height / 2 }
}

async function menuUndo(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent('menu:undo', null, 'main')
  })
}

test.describe('functional', () => {
  test('Given a screenshot on the clipboard, when it is pasted into the body, then it is saved into img/ and its Markdown is inserted as its own paragraph', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    const invocations = await openDeck(page, deck)

    await moveToEditorEnd(page)
    await paste(page, [{ name: 'image.png', type: 'image/png', bytes: PNG_BYTES }])

    await expect.poll(() => imports(invocations).length).toBe(1)
    const call = imports(invocations)[0]
    expect(call.cmd).toBe('import_deck_image_bytes')
    expect(call.args.bytes).toEqual(PNG_BYTES)
    const name = (call.args.headers as Record<string, string>)['x-image-name']
    expect(name).toMatch(/^screenshot-\d{8}-\d{6}\.png$/)
    await expect.poll(() => editorText(page)).toBe(`# Slide One\n\nSome text\n\n![](img/${name})`)
    // The status bar says "Image added to img/" until the save that
    // follows replaces it with "Saved".
    await expect.poll(() => deck.source).toContain(`Some text\n\n![](img/${name})`)
  })

  test('Given only text on the clipboard, when it is pasted, then it is pasted as text as before and nothing is imported', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    const invocations = await openDeck(page, deck)

    await moveToEditorEnd(page)
    await paste(page, [], ' and more')

    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nSome text and more')
    await expect.poll(() => deck.source).toContain('Some text and more')
    expect(imports(invocations)).toEqual([])
  })

  test('Given text copied with a rendered image beside it (as Excel or Keynote copy), when it is pasted, then the text is pasted and nothing is imported', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    const invocations = await openDeck(page, deck)

    await moveToEditorEnd(page)
    await paste(page, [{ name: 'image.png', type: 'image/png', bytes: PNG_BYTES }], ' and more')

    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nSome text and more')
    await expect.poll(() => deck.source).toContain('Some text and more')
    expect(imports(invocations)).toEqual([])
  })

  test('Given an image file dragged from Finder, when it is dropped at the end of a line in the body, then it is copied into img/ and inserted there as its own paragraph', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    const invocations = await openDeck(page, deck)

    await drop(page, ['/Users/me/Desktop/photo.png'], await endOfLine(page, 1))

    await expect.poll(() => editorText(page)).toBe('# Slide One\n\n![](img/photo.png)\n\nSome text')
    expect(imports(invocations).map(call => call.args)).toEqual([{ path: '/Users/me/Desktop/photo.png' }])
    await expect.poll(() => deck.source).toContain('# Slide One\n\n![](img/photo.png)\n\nSome text')
  })

  test('Given several image files, when they are dropped together, then each becomes its own paragraph in the order dropped', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)

    await drop(page, ['/d/b.jpg', '/d/a.png'], await endOfLine(page, 3))

    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nSome text\n\n![](img/b.jpg)\n\n![](img/a.png)')
  })

  test('Given an SVG or a text file among the dropped files, when dropped on the body, then the error bar names them and nothing is imported or inserted', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    const invocations = await openDeck(page, deck)

    await drop(page, ['/d/photo.png', '/d/diagram.svg', '/d/notes.txt'], await endOfLine(page, 1))

    await expect(page.getByText('only PNG, JPEG, GIF and WebP images can be used: diagram.svg, notes.txt')).toBeVisible()
    expect(imports(invocations)).toEqual([])
    expect(await editorText(page)).toBe('# Slide One\n\nSome text')
  })

  test('Given a file dropped outside the body editor, when dropped on the slide list, then nothing happens', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    const invocations = await openDeck(page, deck)

    const row = await page.locator('[data-slide-row="1"]').boundingBox()
    if (row === null) throw new Error('row not visible')
    await drop(page, ['/d/photo.png'], { x: row.x + 5, y: row.y + 5 })

    await page.waitForTimeout(200)
    expect(imports(invocations)).toEqual([])
    expect(await editorText(page)).toBe('# Slide One\n\nSome text')
  })

  test('Given an image just pasted, when Edit > Undo is chosen, then the whole image paragraph is taken back in one step', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)

    await moveToEditorEnd(page)
    await page.keyboard.type(' typed')
    await paste(page, [{ name: 'image.png', type: 'image/png', bytes: PNG_BYTES }])
    await expect.poll(() => editorText(page)).toContain('![](img/screenshot-')

    await menuUndo(page)
    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nSome text typed')
  })

  test('Given a deck whose layouts have no image slot, when an image is dropped, then the build error is shown and the Markdown stays for the user to fix', async ({ page }) => {
    const noSlot = "no slot accepts image in layout 'title-body-code'"
    const deck: MockDeck = {
      source: TWO_SLIDES,
      commandError: (cmd, args) => (cmd === 'render_draft' && String(args.content).includes('![](') ? noSlot : null),
    }
    await openDeck(page, deck)

    await drop(page, ['/d/photo.png'], await endOfLine(page, 3))

    await expect(page.getByText(noSlot)).toBeVisible()
    expect(await editorText(page)).toBe('# Slide One\n\nSome text\n\n![](img/photo.png)')
  })
})

test.describe('functional: on a Retina display', () => {
  test.use({ deviceScaleFactor: 2 })

  test('Given a display scaled 2x, when images are dropped on two different lines one after another, then each lands on the line it was dropped on', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    const invocations = await openDeck(page, deck)

    await drop(page, ['/d/first.png'], await endOfLine(page, 3))
    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nSome text\n\n![](img/first.png)')
    await drop(page, ['/d/second.png'], await endOfLine(page, 1))

    await expect.poll(() => editorText(page)).toBe('# Slide One\n\n![](img/second.png)\n\nSome text\n\n![](img/first.png)')
    expect(imports(invocations).map(call => call.args)).toEqual([{ path: '/d/first.png' }, { path: '/d/second.png' }])
  })
})

test.describe('non-functional: errors and timing', () => {
  test('Given saving the image fails, when an image is pasted, then the error is shown and the text is left as it was', async ({ page }) => {
    const deck: MockDeck = {
      source: TWO_SLIDES,
      commandError: cmd => (cmd === 'import_deck_image_bytes' ? 'failed to write img/x.png: permission denied' : null),
    }
    await openDeck(page, deck)

    await moveToEditorEnd(page)
    await paste(page, [{ name: 'image.png', type: 'image/png', bytes: PNG_BYTES }])

    await expect(page.getByText('Could not add the image: ')).toBeVisible()
    await expect(page.getByText('permission denied')).toBeVisible()
    expect(await editorText(page)).toBe('# Slide One\n\nSome text')
  })

  test('Given the user moves to another slide while a dropped image is still being saved, when saving ends, then nothing is inserted into the other slide', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, importImageDelayMs: 400 }
    await openDeck(page, deck)

    await drop(page, ['/d/photo.png'], await endOfLine(page, 1))
    await expect(page.locator('footer')).toContainText('Importing image…')
    await page.locator('[data-slide-row="1"]').click()
    await expect.poll(() => editorText(page)).toBe('# Slide Two')

    await expect(page.locator('footer')).toContainText('Image added to img/')
    expect(await editorText(page)).toBe('# Slide Two')
    expect(deck.source).not.toContain('![](')
  })

  test('Given the user keeps typing while a pasted image is being saved, when saving ends, then the image goes in at the cursor and the typing is kept', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, importImageDelayMs: 300 }
    await openDeck(page, deck)

    await moveToEditorEnd(page)
    await paste(page, [{ name: 'image.png', type: 'image/png', bytes: PNG_BYTES }])
    await page.keyboard.type(' more')

    await expect.poll(() => editorText(page)).toMatch(/^# Slide One\n\nSome text more\n\n!\[\]\(img\/screenshot-\d{8}-\d{6}\.png\)$/)
  })
})
