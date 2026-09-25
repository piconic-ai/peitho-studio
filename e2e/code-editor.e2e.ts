// The slide body and speaker notes are CodeMirror 6 editors
// (`dom/codeEditor.ts`). These cover what the user sees of them: typing is
// saved, switching slides swaps the text, each slide keeps its own undo
// history for when the user comes back to it (`dom/editorSlideStates.ts`),
// and Edit > Undo takes typing back in the slide it was typed into, in
// order with slide operations (more in `undo-timeline.e2e.ts`).
// Edit > Undo is sent as the `menu:undo` event the Rust side emits for the
// menu item and its Cmd+Z accelerator (`src-tauri/src/edit_menu.rs`); the
// native menu itself, and IME on a real WKWebView, are on-device checks.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, editorText, fillEditor, moveToEditorEnd, type EditorName } from './helpers/codeEditor'

const TWO_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'
const THREE_SLIDES = `${TWO_SLIDES}\n---\n\n<!-- {"key":"three"} -->\n# Slide Three\n`

async function openDeck(page: Page, deck: MockDeck, slides = 2): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(slides, { timeout: 10_000 })
  await expect.poll(() => editorText(page)).toBe('# Slide One')
}

async function emit(page: Page, event: string, payload: unknown, toWindow?: string): Promise<void> {
  await page.evaluate(({ event, payload, toWindow }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, payload, toWindow)
  }, { event, payload, toWindow })
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

function vimStatus(page: Page) {
  return page.locator('[data-editor="body"] .cm-vim-panel')
}

const JA_NOTES_PLACEHOLDER = '発表者用のメモ — 聴衆には表示されません。'

async function menu(page: Page, item: 'undo' | 'redo'): Promise<void> {
  await emit(page, `menu:${item}`, null, 'main')
}

test.describe('functional', () => {
  test('Given a slide open in the editor, when text is typed into the body, then it is saved into the deck', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)

    await moveToEditorEnd(page)
    await page.keyboard.type(' typed')

    await expect.poll(() => deck.source).toContain('# Slide One typed')
    expect(deck.source).toContain('# Slide Two')
  })

  test('Given a slide open in the editor, when the body is replaced with several lines, then every line is saved', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)

    await fillEditor(page, '# Rewritten\n\n- first\n- second')

    await expect.poll(() => editorText(page)).toBe('# Rewritten\n\n- first\n- second')
    await expect.poll(() => deck.source).toContain('# Rewritten\n\n- first\n- second')
  })

  test('Given a slide open in the editor, when a speaker note is typed, then it is saved with the slide', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)

    await editorContent(page, 'note').click()
    await page.keyboard.type('Remember the demo')

    await expect.poll(() => deck.source).toContain('Remember the demo')
    const [slideOne] = deck.source.split(/^---$/m)
    expect(slideOne).toContain('Remember the demo')
  })

  test('Given an empty speaker note, when the editor is shown, then it shows the placeholder but holds no text', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })

    await expect(page.locator('[data-editor="note"] .cm-placeholder')).toHaveText('Notes for the presenter — not shown to the audience.')
    expect(await editorText(page, 'note')).toBe('')
  })

  test('Given a character deleted in one slide, when another slide is selected and Edit > Undo is chosen there, then the first slide opens again with the character back, and the other slide is untouched', async ({ page }) => {
    // A deletion is what a history carried across the switch would replay
    // visibly: undoing it in the wrong editor re-inserts the character into
    // the other slide's text ("# Slide Twoe").
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await moveToEditorEnd(page)
    await page.keyboard.press('Backspace')
    await expect.poll(() => deck.source).toContain('# Slide On\n')

    await page.locator('[data-slide-row="1"]').click()
    await expect.poll(() => editorText(page)).toBe('# Slide Two')

    await editorContent(page).click()
    await menu(page, 'undo')

    await expect.poll(() => editorText(page)).toBe('# Slide One')
    await expect.poll(() => deck.source).toContain('# Slide One\n')
    expect(deck.source).toContain('# Slide Two\n')
  })

  test('Given text typed into the body, when Edit > Undo and Redo are chosen with the body focused, then the typing is undone, redone, and saved each time', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await moveToEditorEnd(page)
    await page.keyboard.type(' typed')
    await expect.poll(() => deck.source).toContain('# Slide One typed')

    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One')
    await expect.poll(() => deck.source).not.toContain('typed')

    await menu(page, 'redo')
    await expect.poll(() => editorText(page)).toBe('# Slide One typed')
    await expect.poll(() => deck.source).toContain('# Slide One typed')
  })

  test('Given text typed into the speaker note, when Edit > Undo is chosen with the note focused, then only the note typing is undone', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await moveToEditorEnd(page)
    await page.keyboard.type(' body')
    await editorContent(page, 'note').click()
    await page.keyboard.type('note text')
    await expect.poll(() => deck.source).toContain('note text')

    await menu(page, 'undo')

    await expect.poll(() => editorText(page, 'note')).toBe('')
    expect(await editorText(page)).toBe('# Slide One body')
  })

  test('Given the body focused, when an arrow key is pressed, then the cursor moves in the text and the slide selection stays', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await moveToEditorEnd(page)

    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('!')

    // Had ArrowDown selected the next slide, the editor would show it.
    await expect.poll(() => editorText(page)).toBe('# Slide One!')
    await page.waitForTimeout(300)
    expect(await editorText(page)).toBe('# Slide One!')
  })
})

test.describe('functional: each slide keeps its own undo history', () => {
  test('Given text typed into slide One, when slide Two is opened and then slide One again, then Edit > Undo in the body takes the typing back out, and Redo puts it back', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' typed')

    await selectRow(page, 1, '# Slide Two')
    await selectRow(page, 0, '# Slide One typed')
    await editorContent(page).click()
    await menu(page, 'undo')

    await expect.poll(() => editorText(page)).toBe('# Slide One')
    await expect.poll(() => deck.source).not.toContain('typed')
    await menu(page, 'redo')
    await expect.poll(() => editorText(page)).toBe('# Slide One typed')
  })

  test('Given text typed into slide One\'s speaker note, when slide Two is opened and then slide One again, then Edit > Undo in the note takes the typing back out', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, 'note text', 'note')

    await selectRow(page, 1, '# Slide Two')
    await selectRow(page, 0, '# Slide One')
    await editorContent(page, 'note').click()
    await menu(page, 'undo')

    await expect.poll(() => editorText(page, 'note')).toBe('')
    await expect.poll(() => deck.source).not.toContain('note text')
  })

  test('Given text typed into slide One and then into slide Two, when Edit > Undo is chosen twice from slide One, then slide Two\'s typing is taken back first, in slide Two, and slide One\'s next, in slide One', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' one')
    await selectRow(page, 1, '# Slide Two')
    await typeAndSave(page, deck, ' two')

    await selectRow(page, 0, '# Slide One one')
    await editorContent(page).click()
    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide Two')
    await expect.poll(() => deck.source).not.toContain(' two')
    expect(deck.source).toContain('# Slide One one')

    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One')
    await expect.poll(() => deck.source).not.toMatch(/ one| two/)
  })

  test('Given text typed into slide One and then slide Two moved above it, when slide One is reopened in second place, then its typing is still there to undo: Edit > Undo takes back the move first and the typing next', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' typed')
    await selectRow(page, 1, '# Slide Two')

    // Cmd+Shift+ArrowUp outside the text fields moves the open slide up.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Meta+Shift+ArrowUp')
    await expect.poll(() => deck.source.indexOf('# Slide Two')).toBeLessThan(deck.source.indexOf('# Slide One'))

    await selectRow(page, 1, '# Slide One typed')
    await editorContent(page).click()
    await menu(page, 'undo')
    await expect.poll(() => deck.source.indexOf('# Slide One') < deck.source.indexOf('# Slide Two')).toBe(true)
    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One')
    await expect.poll(() => deck.source).not.toContain('typed')
    expect(deck.source).toContain('# Slide Two\n')
  })

  test('Given text typed into slide Three and slide One open, when slide Two is deleted, then the editor opens slide Three with its typing still there to undo: Edit > Undo brings slide Two back first and takes the typing back next', async ({ page }) => {
    const deck: MockDeck = { source: THREE_SLIDES }
    await openDeck(page, deck, 3)
    await selectRow(page, 2, '# Slide Three')
    await typeAndSave(page, deck, ' typed')
    await selectRow(page, 0, '# Slide One')

    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    await page.getByText('Delete', { exact: true }).click()
    await expect(page.locator('[data-slide-row]')).toHaveCount(2)

    await expect.poll(() => editorText(page)).toBe('# Slide Three typed')
    await editorContent(page).click()
    await menu(page, 'undo')
    await expect(page.locator('[data-slide-row]')).toHaveCount(3)
    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide Three')
    await expect.poll(() => deck.source).not.toContain('typed')
  })

  test('Given text typed into slide One, when a save in slide Two splits it into two slides and slide One is reopened, then Edit > Undo there changes nothing', async ({ page }) => {
    // Positions shifted in a way no slide command describes, so the kept
    // history is dropped rather than risk it landing on the wrong slide.
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' typed')
    await selectRow(page, 1, '# Slide Two')

    await moveToEditorEnd(page)
    await page.keyboard.insertText('\n\n---\n\n# Slide Split')
    await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })

    await selectRow(page, 0, '# Slide One typed')
    await editorContent(page).click()
    await menu(page, 'undo')
    // Give a wrongly kept history time to land before asserting it didn't.
    await page.waitForTimeout(800)
    expect(await editorText(page)).toBe('# Slide One typed')
    expect(deck.source).toContain('# Slide One typed')
  })

  test('Given text typed into slide One with vim mode off, when vim mode is turned on while in slide Two and slide One is reopened, then slide One takes vim keys and vim\'s u takes back the typing', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' typed')
    await selectRow(page, 1, '# Slide Two')

    await emit(page, 'settings:changed', { vimMode: true })
    await expect(vimStatus(page)).toBeVisible()
    await selectRow(page, 0, '# Slide One typed')

    await editorContent(page).click()
    await expect(vimStatus(page)).toBeVisible()
    await page.keyboard.type('u')
    await expect.poll(() => editorText(page)).toBe('# Slide One')
    await expect.poll(() => deck.source).not.toContain('typed')
  })

  test('Given text typed into slide One with vim mode on, when vim mode is turned off while in slide Two and slide One is reopened, then keys there are typed as text again and Edit > Undo still reaches the earlier typing', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, settings: { vimMode: true } }
    await openDeck(page, deck)
    await editorContent(page).click()
    await page.keyboard.type('A typed')
    await page.keyboard.press('Escape')
    await expect.poll(() => deck.source).toContain('# Slide One typed')
    await selectRow(page, 1, '# Slide Two')

    await emit(page, 'settings:changed', { vimMode: false })
    await expect(vimStatus(page)).toHaveCount(0)
    await selectRow(page, 0, '# Slide One typed')

    await expect(vimStatus(page)).toHaveCount(0)
    await moveToEditorEnd(page)
    await page.keyboard.type('u')
    await expect.poll(() => editorText(page)).toBe('# Slide One typedu')
    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One typed')
    await menu(page, 'undo')
    await expect.poll(() => editorText(page)).toBe('# Slide One')
  })

  test('Given typing deleted again from slide One\'s speaker note, when the UI language is changed while in slide Two and slide One is reopened, then its empty note shows the placeholder in the new language and Edit > Undo still reaches the typing', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, 'x', 'note')
    await page.keyboard.press('Backspace')
    await expect.poll(() => editorText(page, 'note')).toBe('')
    await expect.poll(() => deck.source).not.toContain('<!--\nx\n-->')
    await selectRow(page, 1, '# Slide Two')

    await emit(page, 'settings:changed', { uiLanguage: 'ja' })
    await expect(page.locator('[data-editor="note"] .cm-placeholder')).toHaveText(JA_NOTES_PLACEHOLDER)
    await selectRow(page, 0, '# Slide One')

    await expect(page.locator('[data-editor="note"] .cm-placeholder')).toHaveText(JA_NOTES_PLACEHOLDER)
    await editorContent(page, 'note').click()
    await menu(page, 'undo')
    await expect.poll(() => editorText(page, 'note')).toBe('x')
  })
})

test.describe('robustness', () => {
  test('Given text typed into slide One, when deck.md is changed from outside while in slide Two and slide One is reopened, then Edit > Undo there changes nothing', async ({ page }) => {
    // A deck read fresh from disk may not line up with any kept position,
    // even when slide One's own text is untouched by the change.
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await typeAndSave(page, deck, ' typed')
    await selectRow(page, 1, '# Slide Two')

    deck.source = deck.source.replace('# Slide Two', '# Slide Two external')
    await emit(page, 'deck-file-changed', null)
    await expect.poll(() => editorText(page)).toBe('# Slide Two external')

    await selectRow(page, 0, '# Slide One typed')
    await editorContent(page).click()
    await menu(page, 'undo')
    await page.waitForTimeout(800)
    expect(await editorText(page)).toBe('# Slide One typed')
    expect(deck.source).toContain('# Slide One typed')
  })

  test('Given an IME conversion in progress past the autosave delay, when it is committed, then the editor and the deck hold exactly the committed text', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await moveToEditorEnd(page)
    const cdp = await page.context().newCDPSession(page)

    await page.keyboard.type(' ')
    await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 })
    // Longer than the 600ms autosave delay, so a save can land mid-conversion.
    await page.waitForTimeout(1_200)
    await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 })
    await page.waitForTimeout(1_200)
    await cdp.send('Input.insertText', { text: '日本' })
    await page.keyboard.type('語')

    await expect.poll(() => editorText(page)).toBe('# Slide One 日本語')
    await expect.poll(() => deck.source).toContain('# Slide One 日本語\n')
  })

  test('Given a slow save, when typing continues while it is in flight, then no keystroke is lost or reordered', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, renderDraftDelayMs: 700 }
    await openDeck(page, deck)
    await moveToEditorEnd(page)

    await page.keyboard.type(' abc')
    await page.waitForTimeout(800)
    await page.keyboard.type('def', { delay: 120 })
    await page.waitForTimeout(700)
    await page.keyboard.type('ghi', { delay: 120 })

    await expect.poll(() => editorText(page)).toBe('# Slide One abcdefghi')
    await expect.poll(() => deck.source, { timeout: 10_000 }).toContain('# Slide One abcdefghi\n')
  })
})
