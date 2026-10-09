// Reading and typing into the slide body / speaker notes editors, which are
// CodeMirror 6 editors (`dom/codeEditor.ts`) rather than `<textarea>`s:
// `toHaveValue`/`fill` don't apply to their `contenteditable` content.
import type { Locator, Page } from '@playwright/test'

/** The slide body and notes, the whole-deck source (the repair editor
 * offered while the deck doesn't build), and the layout screen's HTML
 * and CSS. */
export type EditorName = 'body' | 'note' | 'source' | 'layout-html' | 'layout-css'

/** The editor's `contenteditable` element — what takes focus and typing. */
export function editorContent(page: Page, which: EditorName = 'body'): Locator {
  return page.locator(`[data-editor="${which}"] .cm-content`)
}

/** The editor's text, one line per `.cm-line`, as CodeMirror joins it. The
 * placeholder, shown only in an empty editor, is left out. */
export async function editorText(page: Page, which: EditorName = 'body'): Promise<string> {
  return editorContent(page, which).evaluate(content =>
    Array.from(content.querySelectorAll(':scope > .cm-line'))
      .map(line => (line.querySelector('.cm-placeholder') ? '' : line.textContent ?? ''))
      .join('\n'))
}

/** Replaces the editor's whole text with `text`, the way a user would:
 * focus it, select all, and type over the selection. */
export async function fillEditor(page: Page, text: string, which: EditorName = 'body'): Promise<void> {
  await editorContent(page, which).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
}

/** Moves the cursor to the end of the editor's text. */
export async function moveToEditorEnd(page: Page, which: EditorName = 'body'): Promise<void> {
  await editorContent(page, which).click()
  await page.keyboard.press('ControlOrMeta+End')
}
