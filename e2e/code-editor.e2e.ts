// The slide body and speaker notes are CodeMirror 6 editors
// (`dom/codeEditor.ts`). These cover what the user sees of them: typing is
// saved, switching slides swaps the text without Undo reaching back into
// the previous slide, and Edit > Undo undoes the focused editor's typing.
// Edit > Undo is sent as the `menu:undo` event the Rust side emits for the
// menu item and its Cmd+Z accelerator (`src-tauri/src/edit_menu.rs`); the
// native menu itself, and IME on a real WKWebView, are on-device checks.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, editorText, fillEditor, moveToEditorEnd } from './helpers/codeEditor'

const TWO_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await expect.poll(() => editorText(page)).toBe('# Slide One')
}

async function menu(page: Page, item: 'undo' | 'redo'): Promise<void> {
  await page.evaluate(event => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, null, 'main')
  }, `menu:${item}`)
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

  test('Given a character deleted in one slide, when another slide is selected, then the editor shows that slide, and Edit > Undo there does not bring back the deleted character', async ({ page }) => {
    // A deletion is what a history kept across the switch would replay
    // visibly: undoing it re-inserts the character into the other slide's
    // text ("# Slide Twoe").
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)
    await moveToEditorEnd(page)
    await page.keyboard.press('Backspace')
    await expect.poll(() => deck.source).toContain('# Slide On\n')

    await page.locator('[data-slide-row="1"]').click()
    await expect.poll(() => editorText(page)).toBe('# Slide Two')

    await editorContent(page).click()
    await menu(page, 'undo')

    // Give a wrongly kept history time to land before asserting it didn't.
    await page.waitForTimeout(800)
    expect(await editorText(page)).toBe('# Slide Two')
    expect(deck.source).toContain('# Slide On\n')
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

test.describe('robustness', () => {
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
