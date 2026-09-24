// Edit > Undo / Redo undo and redo structural slide operations (New Slide,
// Delete, Skip, ...) when focus is outside the editor's text fields, and
// run the field's own text undo when one has focus (see `onMenuHistory` in
// `components/Studio.tsx`). Cmd+Z / Cmd+Shift+Z reach the same handler
// through the menu items' accelerators (`src-tauri/src/edit_menu.rs`), so
// these tests send the menu event the Rust side emits; the native menu
// itself, and which of the menu and the page's keydown sees Cmd+Z first on
// WKWebView, are covered only by on-device verification.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorContent, editorText, fillEditor, moveToEditorEnd } from './helpers/codeEditor'

const TWO_SLIDES = '<!-- {"key":"one"} -->\n# Slide One\n\n---\n\n<!-- {"key":"two"} -->\n# Slide Two\n'

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
}

async function rightClickMenu(page: Page, row: number, item: string): Promise<void> {
  await page.locator(`[data-slide-row="${row}"]`).click({ button: 'right' })
  await page.getByText(item, { exact: true }).click()
}

/** Sends Edit > Undo / Redo the way the Rust side does: `emit_to` the
 * focused window, which is this page's `main` unless `toWindow` says
 * otherwise. */
async function menu(page: Page, item: 'undo' | 'redo', toWindow = 'main'): Promise<void> {
  await page.evaluate(({ event, label }) => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent(event, null, label)
  }, { event: `menu:${item}`, label: toWindow })
}

/** Moves focus off any field. Pressing a slide-list row does the same
 * (`dom/fieldFocus.ts`); the drag test below covers that path itself. */
async function blurFields(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

test('Given a new slide, when Edit > Undo is chosen outside the editor, then the slide is removed, and Edit > Redo brings it back', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)

  await rightClickMenu(page, 1, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  await blurFields(page)

  await menu(page, 'undo')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
  expect(deck.source).not.toContain('# New Slide')

  await menu(page, 'redo')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  expect(deck.source).toContain('# New Slide')
})

test('Given a deleted slide, when Edit > Undo is chosen, then the slide comes back in its old position', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)

  await rightClickMenu(page, 0, 'Delete')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 5_000 })
  await blurFields(page)

  await menu(page, 'undo')

  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
  expect(deck.source.indexOf('# Slide One')).toBeLessThan(deck.source.indexOf('# Slide Two'))
})

test('Given two operations, when Edit > Undo is chosen twice, then they are undone newest first', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)

  await rightClickMenu(page, 1, 'Skip in Present')
  await expect.poll(() => deck.source).toContain('"skip":true')
  await rightClickMenu(page, 0, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  await blurFields(page)

  await menu(page, 'undo')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
  expect(deck.source).toContain('"skip":true')

  await menu(page, 'undo')
  await expect.poll(() => deck.source).not.toContain('"skip"')
  expect(deck.source).toBe(TWO_SLIDES)
})

test('Given focus in the slide body editor, when Edit > Undo is chosen, then no structural operation is undone', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)

  await rightClickMenu(page, 1, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })

  await editorContent(page).click()
  await menu(page, 'undo')

  // Give a wrongly routed undo time to land before asserting it didn't.
  await page.waitForTimeout(500)
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  expect(deck.source).toContain('# New Slide')
})

test('Given nothing has been done yet, when Edit > Undo is chosen, then the deck is left as it is', async ({ page }) => {
  const invoked: string[] = []
  const deck: MockDeck = { source: TWO_SLIDES, onInvoke: cmd => { invoked.push(cmd) } }
  await openDeck(page, deck)
  await blurFields(page)
  invoked.length = 0

  await menu(page, 'undo')
  await menu(page, 'redo')

  await page.waitForTimeout(500)
  expect(invoked).not.toContain('save_deck_source')
  expect(deck.source).toBe(TWO_SLIDES)
})

test('Given two operations, when Edit > Undo is chosen twice without waiting, then both are undone', async ({ page }) => {
  // Every render waits a little, so the second press lands while the first
  // undo is still saving — it must queue behind it, not be dropped or
  // computed from the slides the first undo is about to change.
  const deck: MockDeck = { source: TWO_SLIDES, renderDraftDelayMs: 300 }
  await openDeck(page, deck)

  await rightClickMenu(page, 1, 'Skip in Present')
  await expect.poll(() => deck.source).toContain('"skip":true')
  await rightClickMenu(page, 0, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  await blurFields(page)

  await menu(page, 'undo')
  await menu(page, 'undo')

  await expect.poll(() => deck.source, { timeout: 5_000 }).toBe(TWO_SLIDES)
  await expect(page.locator('[data-slide-row]')).toHaveCount(2)
})

test('Given typed text that splits a slide in two, when Edit > Undo is chosen, then an earlier operation is not undone against the shifted slides', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)

  await rightClickMenu(page, 1, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  // A `---` typed into the first slide turns it into two slides.
  await page.locator('[data-slide-row="0"]').click()
  await fillEditor(page, '# Slide One\n\n---\n\n# Split Off\n')
  await expect(page.locator('[data-slide-row]')).toHaveCount(4, { timeout: 5_000 })
  // The row count follows the in-memory preview render; wait for the
  // autosave that actually re-splits the deck on disk.
  await expect.poll(() => deck.source, { timeout: 5_000 }).toContain('# Split Off')
  await blurFields(page)

  await menu(page, 'undo')

  // Without clearing the history, this would delete whatever slide now sits
  // where the new slide used to be (`# Slide Two`).
  await page.waitForTimeout(500)
  await expect(page.locator('[data-slide-row]')).toHaveCount(4)
  expect(deck.source).toContain('# New Slide')
  expect(deck.source).toContain('# Slide Two')
})

/** The deck's slide titles in file order. */
function titleOrder(deck: MockDeck): string[] {
  return [...deck.source.matchAll(/^# (.+)$/gm)].map(m => m[1] ?? '')
}

/** Drags row `from` by its thumbnail and drops it above row `onto`. */
async function dragRowAbove(page: Page, from: number, onto: number): Promise<void> {
  const source = await page.locator(`[data-slide-row="${from}"]`).boundingBox()
  const target = await page.locator(`[data-slide-row="${onto}"]`).boundingBox()
  if (!source || !target) throw new Error('rows have no layout')
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + 5, { steps: 5 })
  await page.mouse.up()
}

test('Given slides reordered with Cmd+Shift+ArrowDown, when Edit > Undo is chosen, then the old order comes back, and Edit > Redo reorders them again', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)
  await page.locator('[data-slide-row="0"] button[title]').first().click()
  await blurFields(page)

  await page.keyboard.press('Meta+Shift+ArrowDown')
  await expect.poll(() => titleOrder(deck)).toEqual(['Slide Two', 'Slide One'])

  await menu(page, 'undo')
  await expect.poll(() => titleOrder(deck)).toEqual(['Slide One', 'Slide Two'])

  await menu(page, 'redo')
  await expect.poll(() => titleOrder(deck)).toEqual(['Slide Two', 'Slide One'])
})

test('Given focus in the slide body editor, when a slide is dragged to a new position and Edit > Undo is chosen, then the old order comes back', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)
  // Typing in the body is the usual state right before a drag. The row's
  // mousedown `preventDefault()`s (for the hand-rolled drag), which also
  // cancels the focus change a press would otherwise make.
  await editorContent(page).click()

  await dragRowAbove(page, 1, 0)
  await expect.poll(() => titleOrder(deck)).toEqual(['Slide Two', 'Slide One'])

  await menu(page, 'undo')
  await expect.poll(() => titleOrder(deck)).toEqual(['Slide One', 'Slide Two'])
})

test('Given text typed into the slide body, when Edit > Undo and Redo are chosen with the body focused, then the typing is undone and redone and the slides stay as they are', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)
  await rightClickMenu(page, 1, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  await moveToEditorEnd(page)
  await page.keyboard.type(' typed')
  await expect.poll(() => editorText(page)).toMatch(/ typed$/)

  await menu(page, 'undo')
  await expect.poll(() => editorText(page)).not.toMatch(/typed/)

  await menu(page, 'redo')
  await expect.poll(() => editorText(page)).toMatch(/ typed$/)
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
})

test('Given a new slide, when a Cmd+Z keydown reaches the page but not the menu, then nothing is undone', async ({ page }) => {
  // Cmd+Z is left to the Edit menu's accelerator; handling the keydown too
  // would undo twice for one press.
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)
  await rightClickMenu(page, 1, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  await blurFields(page)

  await page.keyboard.press('Meta+z')

  await page.waitForTimeout(500)
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  expect(deck.source).toContain('# New Slide')
})

test('Given a new slide, when Edit > Undo is sent to another window, then this window undoes nothing', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)
  await rightClickMenu(page, 1, 'New Slide')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })
  await blurFields(page)

  await menu(page, 'undo', 'deck-2')

  await page.waitForTimeout(500)
  await expect(page.locator('[data-slide-row]')).toHaveCount(3)
  expect(deck.source).toContain('# New Slide')
})

test('Given text typed into the slide body and the phone shape menu open, when Edit > Undo is chosen with the body still focused, then the typing is undone', async ({ page }) => {
  const deck: MockDeck = { source: TWO_SLIDES }
  await openDeck(page, deck)
  await moveToEditorEnd(page)
  await page.keyboard.type(' typed')
  await expect.poll(() => editorText(page)).toMatch(/ typed$/)

  await page.locator('[data-viewport-toggle]').click()
  await page.locator('[data-phone-shape-menu-button]').click()
  await expect(page.locator('[data-phone-shape-menu]')).toBeVisible()
  // WebKit never moves focus onto a clicked <button>, so on the real app the
  // body keeps focus through those clicks; Chromium moves it, so put it back.
  await editorContent(page).evaluate(el => { (el as HTMLElement).focus() })

  await menu(page, 'undo')
  await expect.poll(() => editorText(page)).not.toMatch(/typed/)
})
