// Vim mode in the slide body and speaker notes (`dom/codeEditor.ts`),
// turned on from the settings panel and saved as the `vimMode` setting.
// Covers the keys, the mode shown under the editor, the clipboard sharing
// (against the mock's stand-in clipboard, `plugin:clipboard-manager|*`),
// and the call that switches the OS input source to ASCII. What the input
// source switch and the real clipboard actually do on macOS, and how an
// IME's in-progress conversion reacts to `<Esc>`, are on-device checks.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, editorText } from './helpers/codeEditor'

const TWO_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\nfirst line\nsecond line\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
  await expect.poll(() => editorText(page)).toBe('# Slide One\n\nfirst line\nsecond line')
}

/** The vim status line under an editor (`--NORMAL--`, `--INSERT--`, ...). */
function vimStatus(page: Page, which: 'body' | 'note' = 'body') {
  return page.locator(`[data-editor="${which}"] .cm-vim-panel`)
}

/** Focuses the body editor with the cursor on its first line, in normal
 * mode: `gg` and `0` move there whatever the click hit. */
async function focusBodyTop(page: Page): Promise<void> {
  await editorContent(page).click()
  await page.keyboard.type('gg0')
}

async function emit(page: Page, event: string, payload: unknown, toWindow?: string): Promise<void> {
  await page.evaluate(({ event, payload, toWindow }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, payload, toWindow)
  }, { event, payload, toWindow })
}

/** The window taking focus back, as when the user returns from another app. */
async function refocusWindow(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

test.describe('functional', () => {
  test('Given vim mode is off (the default), when "dd" is typed into the body, then it is typed as text', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES })

    await editorContent(page).click()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.type('dd')

    await expect.poll(() => editorText(page)).toBe('dd# Slide One\n\nfirst line\nsecond line')
    await expect(vimStatus(page)).toHaveCount(0)
  })

  test('Given the settings panel, when Vim mode is checked, then the choice is saved and the body editor takes vim keys at once', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES }
    await openDeck(page, deck)

    await emit(page, 'menu:settings', null, 'main')
    const checkbox = page.getByRole('checkbox', { name: /Vim mode/ })
    await expect(checkbox).not.toBeChecked()
    await checkbox.check()
    await expect.poll(() => deck.settings).toEqual({ vimMode: true })
    await page.keyboard.press('Escape')

    await focusBodyTop(page)
    await page.keyboard.type('dd')
    await expect.poll(() => editorText(page)).toBe('\nfirst line\nsecond line')
    await expect.poll(() => deck.source).not.toContain('# Slide One')
  })

  test('Given vim mode was saved as on, when the window starts, then the settings panel shows it checked', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES, settings: { vimMode: true } })

    await emit(page, 'menu:settings', null, 'main')
    await expect(page.getByRole('checkbox', { name: /Vim mode/ })).toBeChecked()
  })

  test('Given vim mode is on, when "dd" then "u" are typed, then the line is deleted and the undo brings it back', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES, settings: { vimMode: true } })

    await focusBodyTop(page)
    await page.keyboard.type('jjdd')
    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nsecond line')

    await page.keyboard.type('u')
    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nfirst line\nsecond line')
  })

  test('Given vim mode is on and a line deleted with "dd", when Edit > Undo is chosen, then the same undo history brings it back', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES, settings: { vimMode: true } })

    await focusBodyTop(page)
    await page.keyboard.type('jjdd')
    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nsecond line')

    await emit(page, 'menu:undo', null, 'main')
    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nfirst line\nsecond line')
    // And vim's own redo steps forward on that same history.
    await page.keyboard.press('Control+r')
    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nsecond line')
  })

  test('Given vim mode is on, when entering and leaving insert mode, then the status line under the editor shows the mode', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES, settings: { vimMode: true } })

    await focusBodyTop(page)
    await expect(vimStatus(page)).toContainText('--NORMAL--')

    await page.keyboard.type('A')
    await expect(vimStatus(page)).toContainText('--INSERT--')
    await page.keyboard.type('!')

    await page.keyboard.press('Escape')
    await expect(vimStatus(page)).toContainText('--NORMAL--')
    await expect.poll(() => editorText(page)).toBe('# Slide One!\n\nfirst line\nsecond line')

    await page.keyboard.type('V')
    await expect(vimStatus(page)).toContainText('--VISUAL LINE--')
  })

  test('Given vim mode is on, when keys are typed in the speaker notes, then vim takes them there too', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, settings: { vimMode: true } }
    await openDeck(page, deck)

    await editorContent(page, 'note').click()
    await expect(vimStatus(page, 'note')).toContainText('--NORMAL--')
    await page.keyboard.type('iRemember the demo')
    await page.keyboard.press('Escape')
    await page.keyboard.type('0dw')

    await expect.poll(() => editorText(page, 'note')).toBe('the demo')
    await expect.poll(() => deck.source).toContain('the demo')
  })

  test('Given vim mode is on, when insert mode is left with Escape, then the OS input source is switched to ASCII', async ({ page }) => {
    const invokedCommands: string[] = []
    await openDeck(page, { source: TWO_SLIDES, settings: { vimMode: true }, invokedCommands })

    await focusBodyTop(page)
    await page.keyboard.type('i')
    const before = invokedCommands.filter(cmd => cmd === 'select_ascii_input_source').length

    await page.keyboard.press('Escape')
    await expect.poll(() => invokedCommands.filter(cmd => cmd === 'select_ascii_input_source').length).toBe(before + 1)
  })

  test('Given vim mode is on, when a line is yanked with "yy", then it is written to the OS clipboard', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, settings: { vimMode: true } }
    await openDeck(page, deck)

    await focusBodyTop(page)
    await page.keyboard.type('jjyy')

    await expect.poll(() => deck.clipboardText).toBe('first line\n')
  })

  test('Given text copied in another app, when the window takes focus back and "p" is typed, then that text is put', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, settings: { vimMode: true } }
    await openDeck(page, deck)
    await focusBodyTop(page)

    deck.clipboardText = 'from another app\n'
    await refocusWindow(page)
    // The read is asynchronous; give it a moment before `p` reads the register.
    await page.waitForTimeout(200)
    await page.keyboard.type('p')

    await expect.poll(() => editorText(page)).toBe('# Slide One\nfrom another app\n\nfirst line\nsecond line')
  })

  test('Given a yank in the body, when "p" is typed in the notes, then the yanked text is put there', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES, settings: { vimMode: true } })

    await focusBodyTop(page)
    await page.keyboard.type('jjyy')
    await editorContent(page, 'note').click()
    await page.waitForTimeout(200)
    await page.keyboard.type('P')

    await expect.poll(() => editorText(page, 'note')).toBe('first line\n')
  })

  test('Given vim mode is on, when it is turned off from another window, then keys are typed as text again', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES, settings: { vimMode: true } })
    await focusBodyTop(page)
    await expect(vimStatus(page)).toBeVisible()

    await emit(page, 'settings:changed', { vimMode: false })
    await expect(vimStatus(page)).toHaveCount(0)
    await editorContent(page).click()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.type('dd')

    await expect.poll(() => editorText(page)).toBe('dd# Slide One\n\nfirst line\nsecond line')
  })

  test('Given vim mode is on and the slide context menu is open, when Escape is pressed, then the menu closes as before', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES, settings: { vimMode: true } })
    await focusBodyTop(page)
    await page.keyboard.type('i')

    await page.locator('[data-slide-row="1"]').click({ button: 'right' })
    const menuDelete = page.getByText('Delete', { exact: true })
    await expect(menuDelete).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menuDelete).toBeHidden()
  })
})

test.describe('robustness', () => {
  test('Given the clipboard holds no text, when the window takes focus back, then "p" still puts the last yank', async ({ page }) => {
    const deck: MockDeck = { source: TWO_SLIDES, settings: { vimMode: true } }
    await openDeck(page, deck)
    await focusBodyTop(page)
    await page.keyboard.type('jjyy')
    await expect.poll(() => deck.clipboardText).toBe('first line\n')

    deck.clipboardText = null
    await refocusWindow(page)
    await page.waitForTimeout(200)
    await page.keyboard.type('p')

    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nfirst line\nfirst line\nsecond line')
  })

  test('Given reading the clipboard fails, when the window takes focus back, then vim keeps working with its own register', async ({ page }) => {
    const deck: MockDeck = {
      source: TWO_SLIDES,
      settings: { vimMode: true },
      commandError: cmd => (cmd === 'plugin:clipboard-manager|read_text' ? 'simulated clipboard failure' : null),
    }
    await openDeck(page, deck)
    await focusBodyTop(page)
    await page.keyboard.type('jjyy')
    await refocusWindow(page)
    await page.waitForTimeout(200)
    await page.keyboard.type('p')

    await expect.poll(() => editorText(page)).toBe('# Slide One\n\nfirst line\nfirst line\nsecond line')
    await expect(page.locator('.bg-destructive\\/10')).toBeHidden()
  })

  test('Given the input source switch fails, when insert mode is left, then the editor is back in normal mode with no error shown', async ({ page }) => {
    await openDeck(page, {
      source: TWO_SLIDES,
      settings: { vimMode: true },
      commandError: cmd => (cmd === 'select_ascii_input_source' ? 'simulated TIS failure' : null),
    })
    await focusBodyTop(page)
    await page.keyboard.type('i')
    await page.keyboard.press('Escape')

    await expect(vimStatus(page)).toContainText('--NORMAL--')
    await page.keyboard.type('dd')
    await expect.poll(() => editorText(page)).toBe('\nfirst line\nsecond line')
    await expect(page.locator('.bg-destructive\\/10')).toBeHidden()
  })

  test('Given vim mode is on and the body in insert mode, when another slide is selected, then vim still works there, back in normal mode', async ({ page }) => {
    await openDeck(page, { source: TWO_SLIDES, settings: { vimMode: true } })
    await focusBodyTop(page)
    await page.keyboard.type('i')

    await page.locator('[data-slide-row="1"]').click()
    await expect.poll(() => editorText(page)).toBe('# Slide Two')
    await editorContent(page).click()
    await expect(vimStatus(page)).toContainText('--NORMAL--')
    await page.keyboard.type('gg0dw')

    await expect.poll(() => editorText(page)).toBe('Slide Two')
  })

  test('Given saving the setting fails, when Vim mode is checked, then an error is shown and the editor stays as it was', async ({ page }) => {
    await openDeck(page, {
      source: TWO_SLIDES,
      commandError: cmd => (cmd === 'update_settings' ? 'simulated disk full' : null),
    })
    await emit(page, 'menu:settings', null, 'main')
    await page.getByRole('checkbox', { name: /Vim mode/ }).check()

    await expect(page.getByText(/Could not save the vim mode setting/)).toBeVisible()
    await expect(vimStatus(page)).toHaveCount(0)
  })
})
