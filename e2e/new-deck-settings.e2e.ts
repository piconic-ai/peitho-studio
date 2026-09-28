// The New Deck dialog's aspect ratio and language pickers, from File > New
// Deck… (the welcome screen's button runs the same `handleNewDeck`) to
// `create_deck`. What `create_deck` writes is Rust's job (tested in
// peitho.rs, rendered through peitho-core there); here the mock stands in
// for it by writing the same starter deck, so the opened deck's canvas
// follows the picked ratio as it would on a real device.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

const STARTER_BODY = '<!-- {"key":"cover","section":"Intro","time":"1m"} -->\n# New Presentation\n\nStart writing your slides here.\n'

/** The deck.md `create_deck` writes for these arguments: only the settings
 * that aren't the default get a line (`starter_deck` in peitho.rs). */
function starterDeck(args: Record<string, unknown>): string {
  const lines = ['time: 1m']
  if (args.aspectRatio !== '16:9') lines.push(`aspect_ratio: ${String(args.aspectRatio)}`)
  if (args.lang !== 'en') lines.push(`lang: ${String(args.lang)}`)
  return `---\n${lines.join('\n')}\n---\n${STARTER_BODY}`
}

/** Opens the welcome screen with a folder picker that answers
 * `/fake/parent`, collecting every `create_deck` call's arguments. */
async function openWelcome(page: Page, extra: Partial<MockDeck> = {}): Promise<{ deck: MockDeck; creates: Record<string, unknown>[] }> {
  const creates: Record<string, unknown>[] = []
  const deck: MockDeck = {
    source: '# unused\n',
    devDefaultDeck: null,
    dialogPath: '/fake/parent',
    onInvoke: (cmd, args) => {
      if (cmd !== 'create_deck') return
      creates.push(args)
      deck.source = starterDeck(args)
    },
    ...extra,
  }
  await mockTauri(page, deck)
  await page.goto('/')
  return { deck, creates }
}

async function openDialog(page: Page, name = 'my-talk'): Promise<void> {
  await page.getByText('New Deck…', { exact: true }).click()
  await page.getByPlaceholder('Deck name').fill(name)
}

const aspectRatio = (page: Page) => page.getByRole('radiogroup', { name: 'Aspect Ratio' })
const language = (page: Page) => page.getByRole('radiogroup', { name: 'Language' })

/** The preview's canvas width, which follows the deck's aspect ratio. */
function previewCanvasWidth(page: Page): Promise<number> {
  return page.locator('[data-preview-host]').evaluate(el => parseFloat((el as HTMLElement).style.getPropertyValue('--peitho-canvas-width')))
}

/** The first thumbnail's box, width over height. */
async function thumbnailRatio(page: Page): Promise<number> {
  const box = await page.locator('[data-slide-row] [style*="aspect-ratio"]').first().boundingBox()
  if (box === null) throw new Error('no thumbnail box')
  return box.width / box.height
}

test('Given the New Deck dialog opens, then 16:9 and English are picked, and Create sends them to create_deck', async ({ page }) => {
  const { creates } = await openWelcome(page)
  await openDialog(page)

  await expect(aspectRatio(page).getByRole('radio', { name: '16:9' })).toHaveAttribute('aria-checked', 'true')
  await expect(aspectRatio(page).getByRole('radio', { name: '4:3' })).toHaveAttribute('aria-checked', 'false')
  await expect(language(page).getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
  await expect(language(page).getByRole('radio', { name: '日本語' })).toHaveAttribute('aria-checked', 'false')

  await page.getByText('Create', { exact: true }).click()

  await expect.poll(() => creates).toEqual([{ parentDir: '/fake/parent', name: 'my-talk', aspectRatio: '16:9', lang: 'en' }])
  await expect.poll(() => previewCanvasWidth(page), { timeout: 10_000 }).toBe(1280)
})

test('Given 4:3 and 日本語 are picked, when Create is clicked, then create_deck gets both and the new deck opens at 4:3', async ({ page }) => {
  const { deck, creates } = await openWelcome(page)
  await openDialog(page)

  await aspectRatio(page).getByRole('radio', { name: '4:3' }).click()
  await language(page).getByRole('radio', { name: '日本語' }).click()
  await expect(aspectRatio(page).getByRole('radio', { name: '4:3' })).toHaveAttribute('aria-checked', 'true')
  await expect(aspectRatio(page).getByRole('radio', { name: '16:9' })).toHaveAttribute('aria-checked', 'false')
  await expect(language(page).getByRole('radio', { name: '日本語' })).toHaveAttribute('aria-checked', 'true')

  await page.getByText('Create', { exact: true }).click()

  await expect.poll(() => creates).toEqual([{ parentDir: '/fake/parent', name: 'my-talk', aspectRatio: '4:3', lang: 'ja' }])
  expect(deck.source.startsWith('---\ntime: 1m\naspect_ratio: 4:3\nlang: ja\n---\n')).toBe(true)
  await expect.poll(() => previewCanvasWidth(page), { timeout: 10_000 }).toBe(960)
  await expect.poll(() => thumbnailRatio(page)).toBeCloseTo(4 / 3, 1)
})

test('Given 4:3 was picked and create_deck fails, then the dialog stays open with 4:3 still picked for the retry', async ({ page }) => {
  let fail = true
  const { creates } = await openWelcome(page, {
    commandError: cmd => (cmd === 'create_deck' && fail ? 'my-talk already exists' : null),
  })
  await openDialog(page)
  await aspectRatio(page).getByRole('radio', { name: '4:3' }).click()
  await page.getByText('Create', { exact: true }).click()

  await expect(page.locator('div.text-destructive').filter({ hasText: 'my-talk already exists' }).last()).toBeVisible()
  await expect(aspectRatio(page).getByRole('radio', { name: '4:3' })).toHaveAttribute('aria-checked', 'true')

  fail = false
  await page.getByText('Create', { exact: true }).click()
  await expect.poll(() => creates.map(args => args.aspectRatio)).toEqual(['4:3', '4:3'])
})

test('Given 4:3 and 日本語 were picked, when the dialog is cancelled and opened again, then it is back at 16:9 and English', async ({ page }) => {
  await openWelcome(page)
  await openDialog(page)
  await aspectRatio(page).getByRole('radio', { name: '4:3' }).click()
  await language(page).getByRole('radio', { name: '日本語' }).click()
  await page.getByText('Cancel', { exact: true }).click()

  await openDialog(page)
  await expect(aspectRatio(page).getByRole('radio', { name: '16:9' })).toHaveAttribute('aria-checked', 'true')
  await expect(language(page).getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
})

test('Given the UI is in Japanese, then the pickers are named as the Edit menu names them, and the choices read the same', async ({ page }) => {
  await openWelcome(page, { settings: { uiLanguage: 'ja' } })
  await page.getByText('新規デッキ…', { exact: true }).click()

  await expect(page.getByRole('radiogroup', { name: '縦横比' }).getByRole('radio', { name: '16:9' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radiogroup', { name: '言語' }).getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
})
