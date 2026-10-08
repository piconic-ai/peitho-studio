// A deck peitho-core refuses to build (a slot violation, an unknown
// frontmatter key — written by an agent or another editor, or an old deck
// a newer peitho rejects) opens in the editor all the same, from its
// source alone: the error bar and the preview pane show peitho-core's
// error until a fixed source renders (todo/open-broken-deck.md). The mock
// stands in for peitho-core with `renderError`, the structured refusal
// `open_deck`/`render_draft` answer; the same flow against the real
// engine is `real-engine-open-broken-deck.e2e.ts`.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { editorText, fillEditor, moveToEditorEnd } from './helpers/codeEditor'
import type { RenderErrorPayload } from '../domain/render'

const ERROR_BAR = '.bg-destructive\\/10'
const PREVIEW_ERROR = '[data-preview-build-error]'
const THUMBNAIL_CANVAS = '[data-slide-row] [data-slide-canvas-key]'
const SELECTED_ROW = '[data-slide-row] .border-\\[\\#eab308\\]'

const SOURCE = '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n'

const SLIDE_TWO_ERROR: RenderErrorPayload = {
  kind: 'Arity',
  line: 8,
  originFile: null,
  message: "slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  help: 'use a layout with a body slot or remove one paragraph',
  headline: "slide 2 ('two'), line 8: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  slide: { number: 2, key: 'two' },
}

const FRONTMATTER_ERROR: RenderErrorPayload = {
  kind: 'Parse',
  line: 2,
  originFile: null,
  message: 'invalid deck frontmatter: unknown field `fontss`',
  help: 'use only the supported deck frontmatter keys',
  headline: 'line 2: invalid deck frontmatter: unknown field `fontss`',
  slide: null,
}

async function openBroken(page: Page, deck: MockDeck): Promise<MockDeck> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 10_000 })
  return deck
}

function brokenDeck(overrides: Partial<MockDeck> = {}): MockDeck {
  return {
    source: SOURCE,
    deckPath: '/decks/broken/deck.md',
    renderError: content => (content.includes('BROKEN') ? SLIDE_TWO_ERROR : null),
    ...overrides,
  }
}

test('Given a deck peitho-core refuses, when it is opened, then the editor opens on its source with the broken slide selected and the error shown', async ({ page }) => {
  await openBroken(page, brokenDeck())

  // The editor, not the welcome screen, with the deck's path in the header.
  await expect(page.getByText('Peitho Studio', { exact: true })).toHaveCount(0)
  await expect(page.getByText('/decks/broken/deck.md', { exact: true })).toBeVisible()

  // Every slide of the source is listed — as a placeholder, nothing having
  // rendered — and the slide the error names is the one open for editing.
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(0)
  await expect(page.locator('[data-slide-row="1"]').locator(SELECTED_ROW.replace('[data-slide-row] ', ''))).toBeVisible()
  await expect.poll(() => editorText(page)).toBe('# Two\n\nBROKEN')

  // peitho-core's error — its headline and help — in the error bar and,
  // with no slide to preview, in the preview pane.
  const errorBar = page.locator(ERROR_BAR)
  await expect(errorBar).toBeVisible()
  await expect(errorBar).toContainText(SLIDE_TWO_ERROR.headline)
  await expect(errorBar).toContainText(SLIDE_TWO_ERROR.help)
  const previewError = page.locator(PREVIEW_ERROR)
  await expect(previewError).toBeVisible()
  await expect(previewError).toContainText(SLIDE_TWO_ERROR.headline)
  await expect(previewError).toContainText(SLIDE_TWO_ERROR.help)
  await expect(previewError).toContainText("This deck doesn't build yet")
})

test('Given a broken deck is open, when nothing is done for longer than the error bar\'s usual timeout, then the error is still there', async ({ page }) => {
  await openBroken(page, brokenDeck())
  await expect(page.locator(ERROR_BAR)).toBeVisible()

  // The transient-error timer is 6 seconds; a deck that doesn't build has
  // nothing else to show, so its error stays.
  await page.waitForTimeout(6_500)
  await expect(page.locator(ERROR_BAR)).toBeVisible()
  await expect(page.locator(ERROR_BAR)).toContainText(SLIDE_TWO_ERROR.headline)
  await expect(page.locator(PREVIEW_ERROR)).toBeVisible()
})

test('Given a broken deck is open, when the broken slide is fixed in the editor and saved, then the deck renders and the error goes away', async ({ page }) => {
  const deck = await openBroken(page, brokenDeck())
  await expect(page.locator(ERROR_BAR)).toBeVisible()

  await fillEditor(page, '# Two\n\nFixed')

  // The save went through (the render passed), every slide now has a
  // thumbnail, the open slide a preview, and no error is shown anywhere.
  await expect.poll(() => deck.source).toContain('# Two\n\nFixed')
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3)
  await expect(page.locator('[data-preview-host] h1')).toHaveText('Two')
  await expect(page.locator(ERROR_BAR)).toBeHidden()
  await expect(page.locator(PREVIEW_ERROR)).toBeHidden()
})

test('Given a broken deck is open, when a fix leaves another slide broken, then nothing is saved and the error bar shows the new error', async ({ page }) => {
  const slideThreeError: RenderErrorPayload = {
    ...SLIDE_TWO_ERROR,
    line: 13,
    headline: "slide 3, line 13: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
    slide: { number: 3, key: null },
  }
  const deck = await openBroken(page, brokenDeck({
    source: '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n\nSTILL\n',
    renderError: content => (content.includes('BROKEN') ? SLIDE_TWO_ERROR : content.includes('STILL') ? slideThreeError : null),
  }))
  await expect(page.locator(ERROR_BAR)).toContainText("slide 2 ('two')")

  await fillEditor(page, '# Two\n\nFixed')

  // The save is blocked (as any save of a draft that doesn't build is),
  // and the error bar names what is still wrong — slide 3 now.
  await expect(page.locator(ERROR_BAR)).toContainText('slide 3, line 13', { timeout: 5_000 })
  await expect(page.locator(ERROR_BAR)).not.toContainText("slide 2 ('two')")
  expect(deck.source).toContain('BROKEN')
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(0)
  // Not a transient error either: it stays past the timer.
  await page.waitForTimeout(6_500)
  await expect(page.locator(ERROR_BAR)).toContainText('slide 3, line 13')
})

test('Given a deck whose frontmatter peitho-core refuses (no slide to blame), when it is opened, then the first slide is open and the error shows', async ({ page }) => {
  await openBroken(page, brokenDeck({
    source: '---\nfontss: x\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n',
    renderError: content => (content.includes('fontss') ? FRONTMATTER_ERROR : null),
  }))

  await expect(page.locator('[data-slide-row="0"]').locator(SELECTED_ROW.replace('[data-slide-row] ', ''))).toBeVisible()
  await expect(page.locator(ERROR_BAR)).toContainText('line 2: invalid deck frontmatter')
  await expect(page.locator(PREVIEW_ERROR)).toContainText('unknown field `fontss`')
})

// --- The whole-deck source editor: errors in text no slide's body shows ---

const SOURCE_TOGGLE = '[data-source-toggle]'
const FRONTMATTER_SOURCE = '---\nfontss: x\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n'

test('Given a deck that builds, when it is open, then no source editor is offered', async ({ page }) => {
  await openBroken(page, brokenDeck({ source: '# One\n\n---\n\n# Two\n\n---\n\n# Three\n' }))
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3)
  await expect(page.locator(SOURCE_TOGGLE)).toBeHidden()
})

test('Given a frontmatter error, when the unknown key is removed in the deck source editor, then it saves, renders, and the slide editor is back', async ({ page }) => {
  const deck = await openBroken(page, brokenDeck({
    source: FRONTMATTER_SOURCE,
    renderError: content => (content.includes('fontss') ? FRONTMATTER_ERROR : null),
  }))
  // The slide editor can't reach the frontmatter: the first slide's body
  // shows none of it.
  await expect.poll(() => editorText(page)).toBe('# One')
  const toggle = page.locator(SOURCE_TOGGLE)
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveText('Edit deck source')

  await toggle.click()
  // The whole deck.md, frontmatter included, in place of the slide's body.
  await expect(page.locator('[data-editor="source"]')).toBeVisible()
  await expect(page.locator('[data-editor="body"]')).toBeHidden()
  await expect.poll(() => editorText(page, 'source')).toBe(FRONTMATTER_SOURCE)
  await expect(toggle).toHaveText('Back to slide')

  const fixed = FRONTMATTER_SOURCE.replace('fontss: x\n', '')
  await fillEditor(page, fixed, 'source')

  // A pause in typing saves it: the deck builds, the error is gone.
  await expect.poll(() => deck.source).toBe(fixed)
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3)
  await expect(page.locator(ERROR_BAR)).toBeHidden()
  await expect(page.locator(PREVIEW_ERROR)).toBeHidden()

  // Leaving it brings the slide editor back, and once left the toggle
  // goes away with the deck building again.
  await toggle.click()
  await expect(page.locator('[data-editor="body"]')).toBeVisible()
  await expect.poll(() => editorText(page)).toBe('# One')
  await expect(toggle).toBeHidden()
})

test('Given a duplicate slide key, when the key is changed in the deck source editor, then the deck renders with both slides', async ({ page }) => {
  const source = '<!-- {"key":"same"} -->\n# One\n\n---\n\n<!-- {"key":"same"} -->\n# Two\n\n---\n\n# Three\n'
  const duplicateKey: RenderErrorPayload = {
    kind: 'Parse', line: 6, originFile: null,
    message: "duplicate slide key 'same'",
    help: 'give each slide a unique key',
    headline: "slide 2 ('same'), line 6: duplicate slide key 'same'",
    slide: { number: 2, key: 'same' },
  }
  const deck = await openBroken(page, brokenDeck({
    source,
    renderError: content => (content.split('"key":"same"').length > 2 ? duplicateKey : null),
  }))
  // The blamed slide is open, but its body shows no key to change.
  await expect.poll(() => editorText(page)).toBe('# Two')

  await page.locator(SOURCE_TOGGLE).click()
  await expect.poll(() => editorText(page, 'source')).toContain('"key":"same"')
  const fixed = source.replace('<!-- {"key":"same"} -->\n# Two', '<!-- {"key":"two"} -->\n# Two')
  await fillEditor(page, fixed, 'source')

  await expect.poll(() => deck.source).toBe(fixed)
  await expect(page.locator(THUMBNAIL_CANVAS)).toHaveCount(3)
  await expect(page.locator(ERROR_BAR)).toBeHidden()
})

test('Given the deck source editor holds a draft that still does not build, when a slide is clicked, then nothing is saved, the editor stays, and the error names the problem', async ({ page }) => {
  const deck = await openBroken(page, brokenDeck({
    source: FRONTMATTER_SOURCE,
    renderError: content => (content.includes('fontss') ? FRONTMATTER_ERROR : null),
  }))
  await page.locator(SOURCE_TOGGLE).click()
  await expect(page.locator('[data-editor="source"]')).toBeVisible()
  // A change that keeps the bad key.
  const stillBroken = FRONTMATTER_SOURCE.replace('# Three', '# Three!')
  await fillEditor(page, stillBroken, 'source')
  await page.waitForTimeout(1_500)

  await page.locator('[data-slide-row="2"]').click()
  await expect(page.locator('[data-editor="source"]')).toBeVisible()
  expect(deck.source).toBe(FRONTMATTER_SOURCE)
  await expect(page.locator(ERROR_BAR)).toContainText('unknown field `fontss`')
  await expect.poll(() => editorText(page, 'source')).toBe(stillBroken)
})

test('Given typing continues while the deck source editor\'s save is in flight, when "Back to slide" was clicked meanwhile, then the editor closes only once that typing is saved too', async ({ page }) => {
  const deck = await openBroken(page, brokenDeck({
    source: FRONTMATTER_SOURCE,
    renderError: content => (content.includes('fontss') ? FRONTMATTER_ERROR : null),
    renderDraftDelayMs: 1_500,
  }))
  const toggle = page.locator(SOURCE_TOGGLE)
  await toggle.click()
  const fixed = FRONTMATTER_SOURCE.replace('fontss: x\n', '')
  await fillEditor(page, fixed, 'source')
  // The autosave starts after a 1s pause and its render takes 1.5s: click
  // "Back to slide" and keep typing while that save is in flight.
  await page.waitForTimeout(1_200)
  await toggle.click()
  // The click took focus to the button; the editor is still shown, and
  // typing goes on in it.
  await moveToEditorEnd(page, 'source')
  await page.keyboard.insertText('\nLater words\n')

  // The later typing reached disk and only then did the editor close.
  await expect.poll(() => deck.source, { timeout: 10_000 }).toContain('Later words')
  await expect(page.locator('[data-editor="source"]')).toBeHidden()
  await expect(page.locator('[data-editor="body"]')).toBeVisible()
  expect(deck.source).toContain('# Three\n')
  expect(deck.source).not.toContain('fontss')
})

test('Given a save is in flight when the text is typed back to what disk holds, when "Back to slide" is clicked, then disk ends up with the typed-back text, not the in-flight one', async ({ page }) => {
  const deck = await openBroken(page, brokenDeck({
    source: FRONTMATTER_SOURCE,
    renderError: content => (content.includes('fontss') ? FRONTMATTER_ERROR : null),
    renderDraftDelayMs: 1_500,
  }))
  const toggle = page.locator(SOURCE_TOGGLE)
  await toggle.click()
  const fixed = FRONTMATTER_SOURCE.replace('fontss: x\n', '')
  await fillEditor(page, fixed, 'source')
  // The fix's save is in flight (1s pause, then a 1.5s render) when the
  // text goes back to exactly what was on disk — a clean-looking draft.
  await page.waitForTimeout(1_200)
  await fillEditor(page, FRONTMATTER_SOURCE, 'source')
  await toggle.click()

  // The in-flight save lands first (the fix, which builds); the typed-back
  // text is then saved over it — and refused, since it doesn't build — so
  // the editor stays open on it, with the error back, rather than closing
  // on the text the user had left behind.
  await expect.poll(() => deck.source, { timeout: 10_000 }).toBe(fixed)
  await expect(page.locator(ERROR_BAR)).toContainText('unknown field `fontss`', { timeout: 10_000 })
  await expect(page.locator('[data-editor="source"]')).toBeVisible()
  await expect.poll(() => editorText(page, 'source')).toBe(FRONTMATTER_SOURCE)
})

test('Given the deck source editor holds typing that does not build, then the window is told a draft is pending, as for a layout file', async ({ page }) => {
  const reports: unknown[] = []
  await openBroken(page, brokenDeck({
    source: FRONTMATTER_SOURCE,
    renderError: content => (content.includes('fontss') ? FRONTMATTER_ERROR : null),
    onInvoke: (cmd, args) => { if (cmd === 'report_layout_draft') reports.push(args.pending) },
  }))
  await page.locator(SOURCE_TOGGLE).click()
  await fillEditor(page, FRONTMATTER_SOURCE.replace('# Three', '# Three!'), 'source')
  await expect.poll(() => reports.at(-1)).toBe(true)
  // Saved (buildable) typing clears it again.
  await fillEditor(page, FRONTMATTER_SOURCE.replace('fontss: x\n', ''), 'source')
  await expect.poll(() => reports.at(-1), { timeout: 10_000 }).toBe(false)
})

test('Given a save is in flight when the text is typed back to what disk holds, then the window is still told a draft is pending until it lands', async ({ page }) => {
  const reports: boolean[] = []
  await openBroken(page, brokenDeck({
    source: FRONTMATTER_SOURCE,
    renderError: content => (content.includes('fontss') ? FRONTMATTER_ERROR : null),
    renderDraftDelayMs: 1_500,
    onInvoke: (cmd, args) => { if (cmd === 'report_layout_draft') reports.push(args.pending as boolean) },
  }))
  await page.locator(SOURCE_TOGGLE).click()
  await fillEditor(page, FRONTMATTER_SOURCE.replace('fontss: x\n', ''), 'source')
  await expect.poll(() => reports.at(-1)).toBe(true)
  // The save is in flight; the draft goes back to the text disk holds.
  await page.waitForTimeout(1_200)
  const reportsBeforeRevert = reports.length
  await fillEditor(page, FRONTMATTER_SOURCE, 'source')
  await page.waitForTimeout(500)
  // A clean-looking draft, but a write still pending: never reported as
  // nothing to save.
  expect(reports.slice(reportsBeforeRevert)).not.toContain(false)
  expect(reports.at(-1)).toBe(true)
})

test('Given a broken deck is open, when the Recent Decks list is read, then the deck was remembered like any other', async ({ page }) => {
  const invoked: string[] = []
  await openBroken(page, brokenDeck({ invokedCommands: invoked }))
  // `remember_recent_deck` runs Rust-side inside `open_deck`; what the
  // frontend can show is that `open_deck` itself completed (the editor is
  // up) rather than rejecting — the mock answers it the way peitho.rs
  // does for a deck that doesn't build.
  expect(invoked).toContain('open_deck')
  expect(invoked).toContain('read_deck_source')
})
