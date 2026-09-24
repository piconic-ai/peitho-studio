// Edit > Undo / Redo walk one timeline of typing and slide operations,
// whatever has focus and whichever slide is open (`replayHistory` in
// `components/Studio.tsx`, see todo/undo-redo-text-grouping.md):
//
// 1. Typing, then a layout change, then Undo with the body focused undoes
//    the layout change first.
// 2. Typing in slide One, then opening slide Two, then Undo opens slide One
//    again and takes the typing back there.
// 3. Vim's `u` / `Ctrl-R` stay within their own editor's text, and Undo
//    never takes back a second time what `u` already took back.
// 4. Undoing a change to another slide (a layout change, a reorder) opens
//    that slide.
//
// Edit > Undo is sent as the `menu:undo` event the Rust side emits for the
// menu item and its Cmd+Z accelerator (`src-tauri/src/edit_menu.rs`); the
// native menu, and the same steps on a real WKWebView, are on-device checks.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, editorText, moveToEditorEnd, type EditorName } from './helpers/codeEditor'

const TWO_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'
const LAYOUTS = ['cover', 'statement']

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await expect.poll(() => editorText(page)).toBe('# Slide One')
}

async function emit(page: Page, event: string, payload: unknown): Promise<void> {
  await page.evaluate(({ event, payload }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, payload, 'main')
  }, { event, payload })
}

async function menu(page: Page, item: 'undo' | 'redo'): Promise<void> {
  await emit(page, `menu:${item}`, null)
}

/** Opens the slide on `row` and waits for the body to show `heading`. */
async function selectRow(page: Page, row: number, heading: string): Promise<void> {
  await page.locator(`[data-slide-row="${row}"]`).click()
  await expect.poll(() => editorText(page)).toBe(heading)
}

/** Types `text` at the end of an editor and waits for it to be saved. */
async function typeAndSave(page: Page, deck: MockDeck, text: string, which: EditorName = 'body'): Promise<void> {
  await moveToEditorEnd(page, which)
  await page.keyboard.type(text)
  await expect.poll(() => deck.source).toContain(text)
}

async function rightClickMenu(page: Page, row: number, item: string): Promise<void> {
  await page.locator(`[data-slide-row="${row}"]`).click({ button: 'right' })
  await page.getByText(item, { exact: true }).click()
}

async function changeLayout(page: Page, row: number, layout: string): Promise<void> {
  await page.locator(`[data-slide-row="${row}"]`).click({ button: 'right' })
  await page.getByRole('button', { name: /^Change Layout/ }).click()
  await page.locator(`button[data-key="${layout}"]`).click()
}

/** The deck's slide titles in file order. */
function titleOrder(deck: MockDeck): string[] {
  return [...deck.source.matchAll(/^# (.+)$/gm)].map(m => m[1] ?? '')
}

test.describe('functional: one timeline for typing and slide operations', () => {
  test('Given text typed into the body and then a layout change, when Edit > Undo is chosen with the body focused, then the layout change is undone first and the typing next, and Redo replays them in order', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, layouts: LAYOUTS }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' typed')
    await changeLayout(page, 0, 'cover')
    await expect.poll(() => deck.source).toContain('"layout":"cover"')

    await editorContent(page).click()
    await menu(page, 'undo')
    await expect.poll(() => deck.source).not.toContain('"layout"')
    expect(await editorText(page)).toBe('# Slide One typed')

    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One')
    await expect.poll(() => deck.source).not.toContain('typed')

    await menu(page, 'redo')
    await expect.poll(() => editorText(page)).toBe('# Slide One typed')
    await menu(page, 'redo')
    await expect.poll(() => deck.source).toContain('"layout":"cover"')
    expect(deck.source).toContain('# Slide One typed')
  })

  test('Given text typed into slide One, when slide Two is opened and Edit > Undo is chosen, then slide One opens again with the typing taken back and saved, and Redo puts it back', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' typed')
    await selectRow(page, 1, '# Slide Two')

    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One')
    await expect.poll(() => deck.source).not.toContain('typed')

    await selectRow(page, 1, '# Slide Two')
    await menu(page, 'redo')
    await expect.poll(() => editorText(page)).toBe('# Slide One typed')
    await expect.poll(() => deck.source).toContain('# Slide One typed')
  })

  test('Given typing in the note and then in the body, when Edit > Undo is chosen twice, then the body typing is taken back first and the note typing next', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, 'note text', 'note')
    await typeAndSave(page, deck, ' body')

    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One')
    expect(await editorText(page, 'note')).toBe('note text')

    await menu(page, 'undo')
    await expect.poll(() => editorText(page, 'note')).toBe('')
    await expect.poll(() => deck.source).not.toContain('note text')
    expect(deck.source).not.toContain(' body')
  })

  test('Given quick typing on both sides of a slide operation, when Edit > Undo is chosen three times, then the later typing, the operation and the earlier typing are taken back one at a time', async ({ page }) => {
    // Quick, and with the cursor never moved in between, so CodeMirror
    // would put both bursts of typing in one undo group, were it not closed
    // when the operation joins the timeline.
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await moveToEditorEnd(page)
    await page.keyboard.type(' a')
    await rightClickMenu(page, 0, 'Skip in Present')
    // Checked every few milliseconds, to keep the gap short.
    await expect.poll(() => deck.source, { intervals: [10] }).toContain('"skip":true')
    // Focus back without a click, which would move the cursor and so start
    // a new group by itself.
    await editorContent(page).evaluate(el => { (el as HTMLElement).focus() })
    await page.keyboard.type(' b')
    await expect.poll(() => deck.source).toContain('# Slide One a b')

    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One a')
    expect(deck.source).toContain('"skip":true')

    await menu(page, 'undo')
    await expect.poll(() => deck.source).not.toContain('"skip"')
    expect(await editorText(page)).toBe('# Slide One a')

    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One')
  })
})

test.describe('functional: undo opens the slide it changes', () => {
  test('Given a layout change on slide Two while slide One is open, when Edit > Undo is chosen, then slide Two opens and its layout change is undone', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, layouts: LAYOUTS }
    await openDeck(page, deck)
    await changeLayout(page, 1, 'statement')
    await expect.poll(() => deck.source).toContain('"layout":"statement"')
    await selectRow(page, 0, '# Slide One')

    await menu(page, 'undo')

    await expect.poll(() => deck.source).not.toContain('"layout"')
    await expect.poll(() => editorText(page)).toBe('# Slide Two')
  })

  test('Given slide One moved below slide Two and slide Two open, when Edit > Undo is chosen, then the order comes back and slide One, the one that moved, is open', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Meta+Shift+ArrowDown')
    await expect.poll(() => titleOrder(deck)).toEqual(['Slide Two', 'Slide One'])
    await selectRow(page, 0, '# Slide Two')

    await menu(page, 'undo')

    await expect.poll(() => titleOrder(deck)).toEqual(['Slide One', 'Slide Two'])
    await expect.poll(() => editorText(page)).toBe('# Slide One')
  })
})

test.describe('functional: vim\'s u and Ctrl-R', () => {
  const VIM_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\nfirst line\nsecond line\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'
  const FULL = '# Slide One\n\nfirst line\nsecond line'
  const DELETED = '# Slide One\n\nsecond line'

  async function openVimDeck(page: Page, deck: MockDeck): Promise<void> {
    await mockTauri(page, deck)
    await page.goto('/')
    await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
    await expect.poll(() => editorText(page)).toBe(FULL)
  }

  /** Deletes the "first line" with vim's `dd`, from the top in normal mode. */
  async function deleteFirstLine(page: Page): Promise<void> {
    await editorContent(page).click()
    await page.keyboard.type('gg0jjdd')
    await expect.poll(() => editorText(page)).toBe(DELETED)
  }

  test('Given a slide operation and then a line deleted with "dd", when "u" is typed twice, then only the line comes back and the slide operation stays', async ({ page }) => {
    const deck: MockDeck = { source: VIM_SLIDES, settings: { vimMode: true } }
    await openVimDeck(page, deck)
    await rightClickMenu(page, 0, 'Skip in Present')
    await expect.poll(() => deck.source).toContain('"skip":true')
    await deleteFirstLine(page)

    await page.keyboard.type('uu')

    await expect.poll(() => editorText(page)).toBe(FULL)
    await page.waitForTimeout(300)
    expect(deck.source).toContain('"skip":true')
  })

  test('Given a slide operation and then a line deleted with "dd" and brought back with "u", when Edit > Undo is chosen, then the slide operation is undone and the line is not touched again', async ({ page }) => {
    const deck: MockDeck = { source: VIM_SLIDES, settings: { vimMode: true } }
    await openVimDeck(page, deck)
    await rightClickMenu(page, 0, 'Skip in Present')
    await expect.poll(() => deck.source).toContain('"skip":true')
    await deleteFirstLine(page)
    await page.keyboard.type('u')
    await expect.poll(() => editorText(page)).toBe(FULL)

    await menu(page, 'undo')

    await expect.poll(() => deck.source).not.toContain('"skip"')
    expect(await editorText(page)).toBe(FULL)
  })

  test('Given a line deleted with "dd", taken back with "u" and put back with "Ctrl-R", when Edit > Undo is chosen twice, then the line comes back once and the second Undo changes nothing', async ({ page }) => {
    const deck: MockDeck = { source: VIM_SLIDES, settings: { vimMode: true } }
    await openVimDeck(page, deck)
    await deleteFirstLine(page)
    await page.keyboard.type('u')
    await expect.poll(() => editorText(page)).toBe(FULL)
    await page.keyboard.press('Control+r')
    await expect.poll(() => editorText(page)).toBe(DELETED)

    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe(FULL)

    await menu(page, 'undo')
    await page.waitForTimeout(500)
    expect(await editorText(page)).toBe(FULL)
    await expect.poll(() => deck.source).toBe(VIM_SLIDES)
  })
})

test.describe('robustness', () => {
  test('Given typing in two slides and a slow save, when Edit > Undo is pressed twice without waiting, the first on another slide, then both slides\' typing is taken back and saved', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, renderDraftDelayMs: 300 }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' one')
    await selectRow(page, 1, '# Slide Two')
    await typeAndSave(page, deck, ' two')
    await selectRow(page, 0, '# Slide One one')

    await menu(page, 'undo')
    await menu(page, 'undo')

    await expect.poll(() => deck.source, { timeout: 10_000 }).not.toMatch(/ one| two/)
    expect(await editorText(page)).toBe('# Slide One')
    await selectRow(page, 1, '# Slide Two')
  })

  test('Given typing in slide Two and then slide Two deleted, when Edit > Undo is chosen twice, then slide Two comes back with its typing, which the second Undo leaves alone', async ({ page }) => {
    // The deleted slide's editor history went with it; its marker can only
    // be skipped.
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await selectRow(page, 1, '# Slide Two')
    await typeAndSave(page, deck, ' typed')
    await rightClickMenu(page, 1, 'Delete')
    await expect(page.locator('[data-slide-row]')).toHaveCount(1)

    await menu(page, 'undo')
    await expect(page.locator('[data-slide-row]')).toHaveCount(2)
    await expect.poll(() => editorText(page)).toBe('# Slide Two typed')

    await menu(page, 'undo')
    await page.waitForTimeout(500)
    expect(await editorText(page)).toBe('# Slide Two typed')
    expect(deck.source).toContain('# Slide Two typed')
  })

  test('Given typing in slide One, when a "---" typed in slide Two splits it, then Edit > Undo takes nothing back', async ({ page }) => {
    // The split shifts every later slide; the timeline is dropped rather
    // than risk undoing typing on the wrong slide.
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' typed')
    await selectRow(page, 1, '# Slide Two')
    await moveToEditorEnd(page)
    await page.keyboard.insertText('\n\n---\n\n# Slide Split')
    await expect.poll(() => deck.source).toContain('# Slide Split')
    await expect(page.locator('[data-slide-row]')).toHaveCount(3)

    await menu(page, 'undo')

    await page.waitForTimeout(800)
    expect(deck.source).toContain('# Slide One typed')
    expect(deck.source).toContain('# Slide Split')
  })
})
