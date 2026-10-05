// The layout screen as files | editor | layout list
// (todo/layout-screen-explorer.md): a file tree of the deck's `layouts/`,
// `css/`, `img/` and `fonts/`; the files opened from it (or from the list)
// as editor tabs, `css/base.css` included; the list with the selected
// layout drawn large and every layout's English name; and comments written
// on lines in the editor, sent to the agent on those lines of that file.
//
// The file commands and crit are mocked (helpers/mockTauri.ts,
// ipc/fakeCritIpc.ts): what the files become, and crit taking a comment on
// lines of a layout file, are `engine::deck_files`' and `crit.rs`'s own
// Rust tests. Not covered here: a real WKWebView, a real agent.
import { test, expect, type Page } from '@playwright/test'
import { emitLayoutFilesChanged, mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, editorText, fillEditor } from './helpers/codeEditor'
import { createFakeCritIpc, type FakeCritIpc } from '../ipc/fakeCritIpc'
import type { NewLayoutComment } from '../domain/critReview'

const SOURCE = [
  '<!-- {"key":"cover","layout":"title-slide"} -->\n# Cover',
  '<!-- {"key":"intro","layout":"title-body"} -->\n# Intro\n\nText.',
].join('\n\n---\n\n') + '\n'

const BASE_CSS = 'body {\n  margin: 0;\n}\nh1 { color: red; }\n'

function deckOf(overrides: Partial<MockDeck> = {}): MockDeck {
  return {
    source: SOURCE,
    layouts: ['title-slide', 'title-body', 'quote'],
    layoutFiles: {
      'title-slide': { html: '<section class="peitho-slide layout-title-slide"><h1>title</h1></section>', css: '.layout-title-slide {}' },
      'title-body': { html: '<section class="peitho-slide layout-title-body"><h1>body</h1></section>', css: '.layout-title-body {}' },
      quote: { html: '<section class="peitho-slide layout-quote"><h1>quote</h1></section>', css: null },
    },
    otherFiles: { 'css/base.css': BASE_CSS, 'img/logo.png': 'png', 'img/photos/a.jpg': 'jpg' },
    layoutFilesStamp: 'v1',
    invokedCommands: [],
    ...overrides,
  }
}

async function openLayoutScreen(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await page.locator('[data-slide-row="0"]').click()
  await page.locator('[data-studio-mode-option="layouts"]').click()
  await expect(page.locator('[data-layout-screen]')).toBeVisible()
  await expect(page.locator('[data-layout-row="title-slide"]')).toHaveAttribute('aria-current', 'true')
}

const treeRow = (page: Page, path: string) => page.locator(`[data-tree-row="${path}"]`)
const tab = (page: Page, path: string) => page.locator(`[data-layout-tab="${path}"]`)
const tabPaths = (page: Page) => page.locator('[data-layout-tab]').evaluateAll(tabs => tabs.map(el => el.getAttribute('data-layout-tab')))

function count(deck: MockDeck, cmd: string): number {
  return (deck.invokedCommands ?? []).filter(invoked => invoked === cmd).length
}

test.describe('the arrangement', () => {
  test('Given the layout screen, then the file tree, the editor, the layout list and the comments column stand left to right', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    const xs = await Promise.all(['[data-file-tree]', '[data-layout-editor]', '[data-layout-list]', '[data-panel="review"]'].map(async selector => (await page.locator(selector).boundingBox())!.x))
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })

  test('Given the tree, when the divider right of it is dragged, then the tree grows and the editor shrinks', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    const tree = (await page.locator('[data-file-tree]').boundingBox())!
    const editor = (await page.locator('[data-layout-editor]').boundingBox())!
    await page.mouse.move(tree.x + tree.width + 2, tree.y + 200)
    await page.mouse.down()
    await page.mouse.move(tree.x + tree.width + 60, tree.y + 200, { steps: 4 })
    await page.mouse.up()
    await expect.poll(async () => (await page.locator('[data-file-tree]').boundingBox())!.width).toBeGreaterThan(tree.width + 40)
    expect((await page.locator('[data-layout-editor]').boundingBox())!.width).toBeLessThan(editor.width - 40)
  })
})

test.describe('the file tree', () => {
  test('Given a deck with layouts, CSS and images, then the tree lists the folders, and a closed folder hides what is in it', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    for (const path of ['layouts', 'layouts/quote.html', 'css', 'css/base.css', 'img', 'img/logo.png', 'img/photos/a.jpg']) {
      await expect(treeRow(page, path)).toBeVisible()
    }
    await expect(treeRow(page, 'deck.md')).toHaveCount(0)

    await treeRow(page, 'img').click()
    await expect(treeRow(page, 'img')).toHaveAttribute('aria-expanded', 'false')
    await expect(treeRow(page, 'img/logo.png')).toHaveCount(0)
    await expect(treeRow(page, 'img/photos/a.jpg')).toHaveCount(0)
    await treeRow(page, 'img').click()
    await expect(treeRow(page, 'img/photos/a.jpg')).toBeVisible()
  })

  test('Given css/base.css in the tree, when it is clicked, then it opens in a tab of its own, the list keeps its selection, and the tree marks it', async ({ page }) => {
    await openLayoutScreen(page, deckOf())

    await treeRow(page, 'css/base.css').click()

    await expect(tab(page, 'css/base.css')).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => editorText(page, 'layout-css')).toBe(BASE_CSS.replace(/\n$/, '\n'))
    await expect(page.locator('[data-layout-row="title-slide"]')).toHaveAttribute('aria-current', 'true')
    await expect(treeRow(page, 'css/base.css')).toHaveAttribute('aria-current', 'true')
  })

  test('adversarial: Given an image in the tree, when it is clicked, then nothing opens', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    const before = await tabPaths(page)
    // Shown disabled: a forced click must still do nothing.
    await expect(treeRow(page, 'img/logo.png')).toHaveAttribute('aria-disabled', 'true')
    await treeRow(page, 'img/logo.png').click({ force: true })
    await page.waitForTimeout(200)
    expect(await tabPaths(page)).toEqual(before)
  })
})

test.describe('selection between the tree, the tabs and the list', () => {
  test('Given a layout picked in the list, then its HTML and CSS open as tabs, the HTML shown, and the tree marks it', async ({ page }) => {
    await openLayoutScreen(page, deckOf())

    await page.locator('[data-layout-row="title-body"]').click()

    await expect.poll(() => tabPaths(page)).toEqual(expect.arrayContaining(['layouts/title-body.html', 'css/title-body.css']))
    await expect(tab(page, 'layouts/title-body.html')).toHaveAttribute('aria-selected', 'true')
    await expect(treeRow(page, 'layouts/title-body.html')).toHaveAttribute('aria-current', 'true')
    await expect.poll(() => editorText(page, 'layout-html')).toBe('<section class="peitho-slide layout-title-body"><h1>body</h1></section>')
  })

  test('Given a layout\'s CSS picked in the tree, then that layout is selected in the list and drawn large, with its CSS shown', async ({ page }) => {
    await openLayoutScreen(page, deckOf())

    await treeRow(page, 'css/title-body.css').click()

    await expect(page.locator('[data-layout-row="title-body"]')).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('[data-layout-selected-preview]')).toHaveAttribute('data-layout-selected-preview', 'title-body')
    await expect(tab(page, 'css/title-body.css')).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => editorText(page, 'layout-css')).toBe('.layout-title-body {}')
  })

  test('Given base.css shown, when another layout is picked, then base.css stays open and the list follows the pick; showing base.css again keeps the last layout drawn large', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    await treeRow(page, 'css/base.css').click()
    await page.locator('[data-layout-row="quote"]').click()
    await expect(page.locator('[data-layout-row="quote"]')).toHaveAttribute('aria-current', 'true')

    await tab(page, 'css/base.css').locator('[data-layout-tab-show]').click()

    await expect(tab(page, 'css/base.css')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-layout-row="quote"]')).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('[data-layout-selected-preview]')).toHaveAttribute('data-layout-selected-preview', 'quote')
  })

  test('Given a tab of another layout, when it is shown, then the list selects that layout', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    await page.locator('[data-layout-row="quote"]').click()
    await expect(page.locator('[data-layout-row="quote"]')).toHaveAttribute('aria-current', 'true')

    await tab(page, 'layouts/title-slide.html').locator('[data-layout-tab-show]').click()

    await expect(page.locator('[data-layout-row="title-slide"]')).toHaveAttribute('aria-current', 'true')
  })
})

test.describe('the editor\'s tabs', () => {
  test('Given typing in one tab, when another is shown and back, then the typing is still there, and a closed tab leaves', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ saveLayoutDelayMs: 60_000 }))
    await treeRow(page, 'css/base.css').click()
    await fillEditor(page, 'h1 { color: blue; }', 'layout-css')
    await expect(tab(page, 'css/base.css').locator('[data-layout-tab-dirty]')).toBeVisible()

    await tab(page, 'layouts/title-slide.html').locator('[data-layout-tab-show]').click()
    await expect.poll(() => editorText(page, 'layout-html')).toContain('layout-title-slide')
    await tab(page, 'css/base.css').locator('[data-layout-tab-show]').click()
    await expect.poll(() => editorText(page, 'layout-css')).toBe('h1 { color: blue; }')

    await tab(page, 'layouts/title-slide.html').locator('[data-layout-tab-close]').click()
    await expect(tab(page, 'layouts/title-slide.html')).toHaveCount(0)
    await expect(tab(page, 'css/base.css')).toHaveAttribute('aria-selected', 'true')
  })

  test('Given every tab closed, then the editor says to open a file', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    for (const path of await tabPaths(page)) await tab(page, path!).locator('[data-layout-tab-close]').click()
    await expect(page.locator('[data-layout-tab]')).toHaveCount(0)
    await expect(page.locator('[data-layout-no-file]')).toBeVisible()
    await expect(page.locator('[data-editor-comment]')).toBeDisabled()
  })

  test('Given base.css edited, when typing pauses, then it is saved on its own and every thumbnail is drawn again', async ({ page }) => {
    const deck = deckOf()
    await openLayoutScreen(page, deck)
    await treeRow(page, 'css/base.css').click()
    await expect.poll(() => editorText(page, 'layout-css')).toContain('margin: 0;')
    const previewsBefore = count(deck, 'preview_layouts')

    await fillEditor(page, 'h1 { color: teal; }', 'layout-css')

    await expect.poll(() => deck.otherFiles?.['css/base.css']).toBe('h1 { color: teal; }')
    await expect.poll(() => count(deck, 'preview_layouts')).toBeGreaterThan(previewsBefore)
    await expect(tab(page, 'css/base.css').locator('[data-layout-tab-dirty]')).toBeHidden()
    await expect(page.locator('footer')).toContainText('Saved css/base.css')
  })

  test('Given base.css open with nothing unsaved, when it is deleted on disk, then its tab closes', async ({ page }) => {
    const deck = deckOf()
    await openLayoutScreen(page, deck)
    await treeRow(page, 'css/base.css').click()
    await expect(tab(page, 'css/base.css')).toBeVisible()

    delete deck.otherFiles!['css/base.css']
    deck.layoutFilesStamp = 'agent-1'
    await emitLayoutFilesChanged(page)

    await expect(tab(page, 'css/base.css')).toHaveCount(0)
    await expect(treeRow(page, 'css/base.css')).toHaveCount(0)
  })

  test('Given unsaved typing in base.css, when it is deleted on disk, then the tab stays with the typing and says it can\'t be saved', async ({ page }) => {
    const deck = deckOf({ saveLayoutDelayMs: 60_000 })
    await openLayoutScreen(page, deck)
    await treeRow(page, 'css/base.css').click()
    await fillEditor(page, 'h1 { color: blue; }', 'layout-css')

    delete deck.otherFiles!['css/base.css']
    deck.layoutFilesStamp = 'agent-1'
    await emitLayoutFilesChanged(page)

    await expect(page.locator('[data-layout-editor-message]')).toContainText('no longer on disk')
    expect(await editorText(page, 'layout-css')).toBe('h1 { color: blue; }')

    // Leaving is held back until the draft is discarded by closing its tab.
    await page.locator('[data-studio-mode-option="slides"]').click()
    await expect(page.locator('[data-layout-notice]')).toContainText('could not be saved')
    await tab(page, 'css/base.css').locator('[data-layout-tab-close]').click()
    await expect(tab(page, 'css/base.css')).toHaveCount(0)
    await page.locator('[data-studio-mode-option="slides"]').click()
    await expect(page.locator('[data-layout-screen]')).toBeHidden()
  })

  test('Given a layout\'s draft that could not be saved, when another layout is picked and then it again, then the large preview draws the draft again', async ({ page }) => {
    // The draft renders in the preview, but its save is refused.
    await openLayoutScreen(page, deckOf({ commandError: cmd => (cmd === 'save_deck_file' ? 'held back' : null) }))
    await page.locator('[data-layout-row="quote"]').click()
    await expect.poll(() => editorText(page, 'layout-html')).toContain('layout-quote')
    await fillEditor(page, '<section class="peitho-slide layout-quote"><h1>draft</h1></section>', 'layout-html')
    const large = page.locator('[data-layout-selected-preview] [data-layout-selected-canvas] h1')
    await expect(large).toHaveText('draft')

    await page.locator('[data-layout-row="title-body"]').click()
    await expect(large).toHaveText('body')
    await page.locator('[data-layout-row="quote"]').click()

    await expect.poll(() => editorText(page, 'layout-html')).toBe('<section class="peitho-slide layout-quote"><h1>draft</h1></section>')
    await expect(large).toHaveText('draft')
  })
})

test.describe('the layout list', () => {
  test('Given standard layouts, then each row shows its display name and, under it, its English name; a deck\'s own layout shows its name once', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    const row = (name: string) => page.locator(`[data-layout-row="${name}"]`)
    await expect(row('title-body')).toContainText('Title and body')
    await expect(row('title-body').locator('[data-layout-english-name]')).toHaveText('title-body')
    await expect(row('quote').locator('[data-layout-english-name]')).toBeHidden()
    await expect(page.locator('[data-layout-selected-label]')).toHaveText('Title slide')
    await expect(page.locator('[data-layout-selected-english]')).toHaveText('title-slide')
  })

  test('Given Japanese, then the English name still shows under the Japanese one', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ settings: { uiLanguage: 'ja' } }))
    const row = page.locator('[data-layout-row="title-body"]')
    await expect(row).toContainText('タイトルと本文')
    await expect(row.locator('[data-layout-english-name]')).toHaveText('title-body')
  })

  test('Given the list, then the selected layout is drawn large above two columns of small thumbnails', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ layoutFragment: '<h1>saved</h1>' }))
    const large = (await page.locator('[data-layout-selected-preview] [data-layout-thumbnail]').boundingBox())!
    const small = await Promise.all(['title-slide', 'title-body', 'quote'].map(async name => (await page.locator(`[data-layout-row="${name}"] [data-layout-row-thumbnail]`).boundingBox())!))
    expect(small[0].y).toBeGreaterThan(large.y + large.height)
    expect(small[0].width).toBeLessThan(large.width * 0.6)
    // Two to a row: the second sits beside the first, the third under them.
    expect(Math.abs(small[1].y - small[0].y)).toBeLessThan(2)
    expect(small[1].x).toBeGreaterThan(small[0].x)
    expect(small[2].y).toBeGreaterThan(small[0].y + small[0].height)
  })
})

test.describe('the large preview looks like the slide preview', () => {
  test('Given the selected layout drawn large, then nothing frames it and the pointer over it is the slide preview\'s', async ({ page }) => {
    await openLayoutScreen(page, deckOf({ layoutFragment: '<h1>saved</h1>' }))
    const box = page.locator('[data-layout-selected-preview]')
    const drawing = box.locator('[data-layout-thumbnail]')
    for (const element of [box, drawing]) await expect(element).toHaveCSS('border-top-width', '0px')
    const slidePreviewCursor = await page.locator('[data-preview-host]').evaluate(el => getComputedStyle(el).cursor)
    await expect(drawing).toHaveCSS('cursor', slidePreviewCursor)
    await expect(drawing).not.toHaveCSS('cursor', 'crosshair')
  })
})

test.describe('the grid thumbnails\' frame', () => {
  /** The frame's look: width, style and color of its top border. */
  const frameOf = (el: Element) => { const style = getComputedStyle(el); return `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}` }
  const slideThumbnail = (page: Page, index: number) => page.locator(`[data-slide-row="${String(index)}"] span.rounded-md.overflow-hidden`).first()

  test('Given the slides screen\'s selected and hovered thumbnails, then the layout grid\'s selected and hovered thumbnails are framed the same', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    await page.locator('[data-studio-mode-option="slides"]').click()
    const slideSelected = await slideThumbnail(page, 0).evaluate(frameOf)
    await slideThumbnail(page, 1).hover()
    const slideHovered = await slideThumbnail(page, 1).evaluate(frameOf)
    await page.mouse.move(0, 0)
    const slideRest = await slideThumbnail(page, 1).evaluate(frameOf)
    expect(slideSelected).not.toBe(slideRest)

    await page.locator('[data-studio-mode-option="layouts"]').click()
    const grid = (name: string) => page.locator(`[data-layout-row="${name}"] [data-layout-row-thumbnail]`)
    expect(await grid('title-slide').evaluate(frameOf)).toBe(slideSelected)
    await page.mouse.move(0, 0)
    expect(await grid('quote').evaluate(frameOf)).toBe(slideRest)
    await grid('quote').hover()
    expect(await grid('quote').evaluate(frameOf)).toBe(slideHovered)
    // Nothing else frames a row any more.
    await expect(page.locator('[data-layout-row="title-slide"]')).toHaveCSS('border-top-width', '0px')
  })
})

test.describe('a comment from the editor', () => {
  async function openWithCrit(page: Page, crit: FakeCritIpc): Promise<MockDeck> {
    const deck = deckOf({ crit, deckPath: '/decks/talk/deck.md' })
    await openLayoutScreen(page, deck)
    return deck
  }

  function sentLayoutComments(crit: FakeCritIpc): NewLayoutComment[] {
    return crit.calls.filter(call => call.method === 'addLayoutComments').flatMap(call => call.args[0] as NewLayoutComment[])
  }

  test('Given lines selected in base.css, when Comment is pressed, then the box names the file, the lines and their start, and the agent gets the comment on those lines', async ({ page }) => {
    const crit = createFakeCritIpc()
    await openWithCrit(page, crit)
    await treeRow(page, 'css/base.css').click()
    await expect.poll(() => editorText(page, 'layout-css')).toContain('margin: 0;')

    // Lines 2-3 picked with the keyboard.
    await editorContent(page, 'layout-css').click()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+End')
    await page.locator('[data-editor-comment]').click()

    await expect(page.locator('[data-comment-box]')).toBeVisible()
    await expect(page.locator('[data-comment-target]')).toHaveText('css/base.css L2-L3 "margin: 0; }"')
    await page.locator('[data-comment-box] textarea').fill('Less margin')
    await page.locator('[data-comment-add]').click()
    await page.locator('[data-review-send]').click()

    await expect.poll(() => sentLayoutComments(crit)).toEqual([{
      layout: null,
      lines: { path: 'css/base.css', startLine: 2, endLine: 3, quote: '  margin: 0;\n}' },
      body: '[css/base.css L2-L3 "margin: 0; }"] Less margin',
      author: 'Peitho Studio',
    }])
    await expect(page.locator('[data-review-row="comment"] [data-review-target]')).toHaveText('css/base.css L2-L3 "margin: 0; }"')
  })

  test('Given only a cursor in a layout\'s HTML, when Comment is pressed, then the comment is on the cursor\'s line', async ({ page }) => {
    const crit = createFakeCritIpc()
    await openWithCrit(page, crit)
    await expect.poll(() => editorText(page, 'layout-html')).toContain('layout-title-slide')
    await editorContent(page, 'layout-html').click()
    await page.keyboard.press('ControlOrMeta+End')

    await page.locator('[data-editor-comment]').click()

    await expect(page.locator('[data-comment-target]')).toHaveText('layouts/title-slide.html L1 "<section class="peitho-slide …"')
    await page.locator('[data-comment-box] textarea').fill('Add a subtitle')
    await page.locator('[data-comment-add]').click()
    await page.locator('[data-review-send]').click()
    await expect.poll(() => sentLayoutComments(crit).map(comment => comment.lines)).toEqual([
      { path: 'layouts/title-slide.html', startLine: 1, endLine: 1, quote: '<section class="peitho-slide layout-title-slide"><h1>title</h1></section>' },
    ])
  })

  test('Given a sent comment on lines of base.css, when its thread is clicked from the slides screen, then the layout screen opens base.css', async ({ page }) => {
    const crit = createFakeCritIpc()
    await openWithCrit(page, crit)
    await treeRow(page, 'css/base.css').click()
    await editorContent(page, 'layout-css').click()
    await page.locator('[data-editor-comment]').click()
    await page.locator('[data-comment-box] textarea').fill('Calmer')
    await page.locator('[data-comment-add]').click()
    await page.locator('[data-review-send]').click()
    await expect(page.locator('[data-review-row="comment"]')).toHaveCount(1)
    await tab(page, 'css/base.css').locator('[data-layout-tab-close]').click()
    await expect(tab(page, 'css/base.css')).toHaveCount(0)

    await page.locator('[data-studio-mode-option="slides"]').click()
    await page.locator('[data-review-row="comment"]').click()

    await expect(page.locator('[data-layout-screen]')).toBeVisible()
    await expect(tab(page, 'css/base.css')).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('saving and reading back around the agent\'s writes', () => {
  const TITLE_SLIDE_HTML = '<section class="peitho-slide layout-title-slide"><h1>title</h1></section>'

  test('Given an autosave refused because only the layout\'s other file changed on disk, then the edit is saved on the next try rather than left unsaved', async ({ page }) => {
    let refusals = 0
    const deck: MockDeck = deckOf({
      // The agent rewrites the layout's CSS during the HTML's save: the save
      // is refused, though the HTML itself is as the editor read it.
      commandError: (cmd, args) => {
        if (cmd !== 'save_deck_file' || args.path !== 'layouts/title-slide.html' || refusals > 0) return null
        refusals++
        deck.layoutFiles!['title-slide'] = { html: TITLE_SLIDE_HTML, css: '.layout-title-slide { color: red; }' }
        deck.layoutFilesStamp = 'agent-1'
        return 'the layout\'s files changed on disk since they were read'
      },
    })
    await openLayoutScreen(page, deck)
    await expect.poll(() => editorText(page, 'layout-html')).toBe(TITLE_SLIDE_HTML)

    const mine = '<section class="peitho-slide layout-title-slide"><h1>mine</h1></section>'
    await fillEditor(page, mine, 'layout-html')

    await expect.poll(() => deck.layoutFiles!['title-slide'].html, { timeout: 8000 }).toBe(mine)
    expect(refusals).toBe(1)
    expect(deck.layoutFiles!['title-slide'].css).toBe('.layout-title-slide { color: red; }')
    await expect(tab(page, 'layouts/title-slide.html').locator('[data-layout-tab-dirty]')).toBeHidden()
  })

  test('Given the open files being read back after the agent\'s write, when an IME composition starts during the read, then the editor takes the agent\'s text once it ends, and typing then is not saved over it', async ({ page }) => {
    const deck = deckOf()
    await openLayoutScreen(page, deck)
    await expect.poll(() => editorText(page, 'layout-html')).toBe(TITLE_SLIDE_HTML)
    // The last `>` selected: a composition over it that converts to `>`
    // again leaves the text as it was, so nothing is unsaved while it runs.
    await editorContent(page, 'layout-html').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('Shift+ArrowLeft')

    const agent = '<section class="peitho-slide layout-title-slide"><h1>agent</h1></section>'
    deck.layoutFiles!['title-slide'] = { html: agent, css: '.layout-title-slide {}' }
    deck.layoutFilesStamp = 'agent-1'
    deck.readDeckFileDelayMs = 1000
    const readsBefore = count(deck, 'read_deck_file')
    await emitLayoutFilesChanged(page)
    // The composition starts once the read back is under way.
    await expect.poll(() => count(deck, 'read_deck_file'), { intervals: [20] }).toBeGreaterThan(readsBefore)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '>', selectionStart: 1, selectionEnd: 1 })
    await page.waitForTimeout(1500)
    deck.readDeckFileDelayMs = 0
    await cdp.send('Input.insertText', { text: '>' })

    await expect.poll(() => editorText(page, 'layout-html')).toBe(agent)
    await page.keyboard.press('End')
    await page.keyboard.type('x')
    await expect.poll(() => deck.layoutFiles!['title-slide'].html).toBe(`${agent}x`)
  })

  test('Given both tabs of the selected layout closed, when its row is clicked again, then its files open again', async ({ page }) => {
    await openLayoutScreen(page, deckOf())
    for (const path of await tabPaths(page)) await tab(page, path!).locator('[data-layout-tab-close]').click()
    await expect(page.locator('[data-layout-tab]')).toHaveCount(0)

    await page.locator('[data-layout-row="title-slide"]').click()

    await expect.poll(() => tabPaths(page)).toEqual(['layouts/title-slide.html', 'css/title-slide.css'])
    await expect(tab(page, 'layouts/title-slide.html')).toHaveAttribute('aria-selected', 'true')
  })
})
