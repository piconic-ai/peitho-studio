// Functional requirement (todo/section-time-spinner.md): a section's
// planned time is edited with minutes/seconds spinners in the slide list's
// section header, and nothing typed or stepped there can save a time peitho
// can't read. Each test below is one Given-When-Then example, driven
// through the real frontend (SlideList.tsx -> Studio.tsx's
// onSectionTimeInput/commitSectionEdit -> save_deck_source) against the
// mocked IPC bridge. The native spin buttons WKWebView draws are not
// covered here: see domain/slides.examples.ts's manual example.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

/** Two sections, so the frontmatter total visibly depends on both. */
function deckWithIntroPlannedFor(introTime: string, total: string): MockDeck {
  return {
    source: [
      '---',
      `time: ${total}`,
      '---',
      `<!-- {"section":"Intro","time":"${introTime}"} -->`,
      '# Intro',
      '',
      '---',
      '',
      '<!-- {"section":"Body","time":"1m"} -->',
      '# Body',
      '',
    ].join('\n'),
  }
}

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })
}

function introSpinner(page: Page, part: 'minutes' | 'seconds') {
  return page.locator('[data-slide-row="0"]').getByLabel(part === 'minutes' ? 'Section minutes' : 'Section seconds')
}

/** Renames the Body section and waits until that save lands. A save the
 * step under test started by mistake was sent to the backend first, so it
 * has landed too by the time this returns, and the caller can check that
 * the Intro section is still what the deck started with. */
async function saveUnrelatedEdit(page: Page, deck: MockDeck): Promise<void> {
  const bodyName = page.locator('[data-slide-row="1"]').getByLabel('Section name')
  await bodyName.fill('Body renamed')
  await bodyName.press('Enter')
  await expect.poll(() => deck.source).toContain('"section":"Body renamed"')
}

test('Given a section loaded from a deck as "1m30s", when the deck opens, then its spinners show 1 minute and 30 seconds', async ({ page }) => {
  await openDeck(page, deckWithIntroPlannedFor('1m30s', '2m30s'))

  await expect(introSpinner(page, 'minutes')).toHaveValue('1')
  await expect(introSpinner(page, 'seconds')).toHaveValue('30')
})

test('Given a section planned for 59 seconds, when its seconds spinner is stepped up once and the header is left, then the seconds carry into the minutes and the deck saves 1m with a matching frontmatter total', async ({ page }) => {
  const deck = deckWithIntroPlannedFor('59s', '1m59s')
  await openDeck(page, deck)

  await introSpinner(page, 'seconds').focus()
  await page.keyboard.press('ArrowUp')

  await expect(introSpinner(page, 'minutes')).toHaveValue('1')
  await expect(introSpinner(page, 'seconds')).toHaveValue('0')

  await page.keyboard.press('Enter')

  await expect.poll(() => deck.source).toContain('<!-- {"section":"Intro","time":"1m"} -->')
  expect(deck.source).toContain('time: 2m\n')
})

test('Given a section planned for 1m30s, when 75 is typed into its seconds spinner and the header is left, then the deck saves 2m15s', async ({ page }) => {
  const deck = deckWithIntroPlannedFor('1m30s', '2m30s')
  await openDeck(page, deck)

  await introSpinner(page, 'seconds').fill('75')
  await page.keyboard.press('Enter')

  await expect(introSpinner(page, 'minutes')).toHaveValue('2')
  await expect(introSpinner(page, 'seconds')).toHaveValue('15')
  await expect.poll(() => deck.source).toContain('<!-- {"section":"Intro","time":"2m15s"} -->')
  expect(deck.source).toContain('time: 3m15s\n')
})

test('Given a section planned for 30 seconds, when "000" is typed into its minutes spinner and the header is left, then the spinner shows 0 again and the section is left unchanged', async ({ page }) => {
  const deck = deckWithIntroPlannedFor('30s', '1m30s')
  await openDeck(page, deck)

  await introSpinner(page, 'minutes').fill('000')
  await page.keyboard.press('Enter')

  await expect(introSpinner(page, 'minutes')).toHaveValue('0')
  await expect(introSpinner(page, 'seconds')).toHaveValue('30')
  await saveUnrelatedEdit(page, deck)
  expect(deck.source).toContain('<!-- {"section":"Intro","time":"30s"} -->')
  expect(deck.source).toContain('time: 1m30s\n')
})

test('Given a section planned for 1m30s, when its minutes spinner is cleared and the header is left, then the spinner shows 1 again and the section is left unchanged', async ({ page }) => {
  const deck = deckWithIntroPlannedFor('1m30s', '2m30s')
  await openDeck(page, deck)

  await introSpinner(page, 'minutes').fill('')
  // Still empty while the user is in the field, not rewritten to 0.
  await expect(introSpinner(page, 'minutes')).toHaveValue('')
  await page.keyboard.press('Enter')

  await expect(introSpinner(page, 'minutes')).toHaveValue('1')
  await expect(introSpinner(page, 'seconds')).toHaveValue('30')
  await saveUnrelatedEdit(page, deck)
  expect(deck.source).toContain('<!-- {"section":"Intro","time":"1m30s"} -->')
})

test('Given a section planned for 1m30s, when "-1" is typed key by key into its seconds spinner and the header is left, then a minute is borrowed and the deck saves 59s', async ({ page }) => {
  // The "-" alone is a half-typed entry the number input reports as NaN.
  // It must not be read as 0 and written back over the field, or the "1"
  // that follows would make "01" instead of "-1".
  const deck = deckWithIntroPlannedFor('1m30s', '2m30s')
  await openDeck(page, deck)

  await introSpinner(page, 'seconds').selectText()
  await page.keyboard.type('-1')
  await page.keyboard.press('Enter')

  await expect(introSpinner(page, 'minutes')).toHaveValue('0')
  await expect(introSpinner(page, 'seconds')).toHaveValue('59')
  await expect.poll(() => deck.source).toContain('<!-- {"section":"Intro","time":"59s"} -->')
  expect(deck.source).toContain('time: 1m59s\n')
})

test('Given a section planned for 1 minute, when its minutes spinner is set to 0 (making 0m0s) and the header is left, then the deck saves 1 second instead, since peitho rejects a zero-length section time', async ({ page }) => {
  const deck = deckWithIntroPlannedFor('1m', '2m')
  await openDeck(page, deck)

  await introSpinner(page, 'minutes').fill('0')
  await expect(introSpinner(page, 'seconds')).toHaveValue('0')
  await page.keyboard.press('Enter')

  await expect.poll(() => deck.source).toContain('<!-- {"section":"Intro","time":"1s"} -->')
  expect(deck.source).toContain('time: 1m1s\n')
  await expect(introSpinner(page, 'minutes')).toHaveValue('0')
  await expect(introSpinner(page, 'seconds')).toHaveValue('1')
})

test('Given a section already saved as 1 second, when its seconds spinner is brought to 0 and the header is left, then the spinner shows 1 again and the section is left unchanged', async ({ page }) => {
  const deck = deckWithIntroPlannedFor('1s', '1m1s')
  await openDeck(page, deck)

  await introSpinner(page, 'seconds').fill('0')
  await page.keyboard.press('Enter')

  await expect(introSpinner(page, 'seconds')).toHaveValue('1')
  await saveUnrelatedEdit(page, deck)
  expect(deck.source).toContain('<!-- {"section":"Intro","time":"1s"} -->')
  expect(deck.source).toContain('time: 1m1s\n')
})

test('Given saving takes a while, when the minutes spinner is stepped, then the seconds spinner is stepped and the user pauses before leaving the header, then both steps are kept and saved', async ({ page }) => {
  // Regression: each spinner used to save on its own blur. Tabbing from
  // minutes to seconds started a save, and when its re-render landed it
  // reset the section's draft to the just-saved 2m30s, discarding the
  // seconds step made while that save was in flight. Leaving the header
  // afterwards then had nothing left to save.
  const renderDraftDelayMs = 500
  const deck: MockDeck = { ...deckWithIntroPlannedFor('1m30s', '2m30s'), renderDraftDelayMs }
  await openDeck(page, deck)

  await introSpinner(page, 'minutes').focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Tab')
  await expect(introSpinner(page, 'seconds')).toBeFocused()
  await page.keyboard.press('ArrowUp')

  // The pause: long enough for a save started by the Tab to have landed.
  await page.waitForTimeout(renderDraftDelayMs * 2)
  expect(await introSpinner(page, 'seconds').inputValue()).toBe('31')

  await page.keyboard.press('Enter')

  await expect.poll(() => deck.source).toContain('<!-- {"section":"Intro","time":"2m31s"} -->')
  expect(deck.source).toContain('time: 3m31s\n')
  await expect(introSpinner(page, 'minutes')).toHaveValue('2')
  await expect(introSpinner(page, 'seconds')).toHaveValue('31')
})
