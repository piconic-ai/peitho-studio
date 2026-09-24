// Functional requirement (todo/slide-list-section-collapse.md): a section
// header in the slide list can fold away the thumbnails of every slide in
// its section, so a long deck can be scanned section by section. Each test
// below is one Given-When-Then example, driven through the real frontend
// (SlideList.tsx's toggle -> Studio.tsx -> state/uiStore.ts's
// collapsedSectionKeys -> domain/sectionCollapse.ts) against the mocked IPC
// bridge. Whether a re-shown thumbnail repaints at the right scale on a
// real WKWebView is left to on-device checking (see the todo's 完了条件).
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

/** Two sections of two slides each: rows 0-1 are Intro, rows 2-3 are Body. */
function twoSectionDeck(): MockDeck {
  return {
    source: [
      '---',
      'time: 2m',
      '---',
      '<!-- {"section":"Intro","time":"1m"} -->',
      '# Welcome',
      '',
      '---',
      '',
      '# Agenda',
      '',
      '---',
      '',
      '<!-- {"section":"Body","time":"1m"} -->',
      '# Details',
      '',
      '---',
      '',
      '# Wrap up',
      '',
    ].join('\n'),
  }
}

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(4, { timeout: 10_000 })
}

function row(page: Page, index: number) {
  return page.locator(`[data-slide-row="${String(index)}"]`)
}

/** A row's thumbnail button (the one that selects the slide). */
function thumbnail(page: Page, index: number) {
  return row(page, index).locator('button[title]')
}

function collapseToggle(page: Page, index: number) {
  return row(page, index).getByRole('button', { name: /^(Collapse|Expand) section$/ })
}

test('Given a deck with two sections, when it opens, then every section is expanded and every thumbnail shows', async ({ page }) => {
  await openDeck(page, twoSectionDeck())

  await expect(collapseToggle(page, 0)).toHaveAttribute('aria-expanded', 'true')
  await expect(collapseToggle(page, 2)).toHaveAttribute('aria-expanded', 'true')
  for (const index of [0, 1, 2, 3]) await expect(thumbnail(page, index)).toBeVisible()
})

test('Given the Intro section expanded, when its toggle is clicked, then its slides hide, its header stays, and Body is untouched', async ({ page }) => {
  await openDeck(page, twoSectionDeck())

  await collapseToggle(page, 0).click()

  await expect(collapseToggle(page, 0)).toHaveAttribute('aria-expanded', 'false')
  await expect(row(page, 0).getByLabel('Edit section name and time')).toBeVisible()
  await expect(thumbnail(page, 0)).toBeHidden()
  await expect(row(page, 1)).toBeHidden()
  await expect(thumbnail(page, 2)).toBeVisible()
  await expect(thumbnail(page, 3)).toBeVisible()
})

test('Given the Intro section collapsed, when its toggle is clicked again, then its slides show again', async ({ page }) => {
  await openDeck(page, twoSectionDeck())
  await collapseToggle(page, 0).click()

  await collapseToggle(page, 0).click()

  await expect(collapseToggle(page, 0)).toHaveAttribute('aria-expanded', 'true')
  await expect(thumbnail(page, 0)).toBeVisible()
  await expect(thumbnail(page, 1)).toBeVisible()
})

test('Given the Body section collapsed, when a slide is added above it, then Body (now on later rows) is still the collapsed one', async ({ page }) => {
  const deck = twoSectionDeck()
  await openDeck(page, deck)
  await collapseToggle(page, 2).click()

  await thumbnail(page, 0).click({ button: 'right' })
  await page.getByText('New Slide', { exact: true }).click()
  await expect(page.locator('[data-slide-row]')).toHaveCount(5, { timeout: 5_000 })

  await expect(collapseToggle(page, 0)).toHaveAttribute('aria-expanded', 'true')
  await expect(thumbnail(page, 1)).toBeVisible()
  await expect(collapseToggle(page, 3)).toHaveAttribute('aria-expanded', 'false')
  await expect(thumbnail(page, 3)).toBeHidden()
  await expect(row(page, 4)).toBeHidden()
})

test('Given the second Intro slide open, when Intro is collapsed, then Intro stays collapsed even though its open slide is hidden', async ({ page }) => {
  await openDeck(page, twoSectionDeck())
  await thumbnail(page, 1).click()

  await collapseToggle(page, 0).click()

  await expect(collapseToggle(page, 0)).toHaveAttribute('aria-expanded', 'false')
  await expect(row(page, 1)).toBeHidden()
})

test('Given Body collapsed, when New Slide is added from its header row, then Body expands and the new slide is in view', async ({ page }) => {
  const deck = twoSectionDeck()
  await openDeck(page, deck)
  await collapseToggle(page, 2).click()

  // Right-clicking a row selects its slide, so Body already expands here
  // (its first slide became the selection); the new slide lands in Body
  // right after it.
  await row(page, 2).getByLabel('Edit section name and time').click({ button: 'right' })
  await page.getByText('New Slide', { exact: true }).click()
  await expect(page.locator('[data-slide-row]')).toHaveCount(5, { timeout: 5_000 })

  await expect(collapseToggle(page, 2)).toHaveAttribute('aria-expanded', 'true')
  await expect(thumbnail(page, 3)).toBeVisible()
  await expect(thumbnail(page, 3)).toHaveAttribute('title', 'New Slide')
})

test('Given Body (the last section) collapsed, when a slide is dragged below every row, then the drop line shows under Body\'s header and the slide moves to the end', async ({ page }) => {
  const deck = twoSectionDeck()
  await openDeck(page, deck)
  await collapseToggle(page, 2).click()
  await expect(row(page, 3)).toBeHidden()

  const from = await thumbnail(page, 1).boundingBox()
  const header = await row(page, 2).boundingBox()
  if (!from || !header) throw new Error('rows have no layout')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, header.y + header.height + 5, { steps: 5 })

  await expect(row(page, 2)).toHaveClass(/border-b-primary/)

  await page.mouse.up()
  await expect.poll(() => deck.source.trimEnd().endsWith('# Agenda')).toBe(true)
})

test('Given the Intro section collapsed, when its summary is clicked, then its name/time editor still opens', async ({ page }) => {
  await openDeck(page, twoSectionDeck())
  await collapseToggle(page, 0).click()

  await row(page, 0).getByLabel('Edit section name and time').click()

  await expect(row(page, 0).getByLabel('Section name')).toBeVisible()
  await expect(collapseToggle(page, 0)).toHaveAttribute('aria-expanded', 'false')
})
