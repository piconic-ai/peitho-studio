// A deck nobody has trusted yet is shown with nothing of its own running —
// no layout <script>, no `on*` handler, no `<iframe srcdoc>` — on every
// surface a slide is drawn on, and a banner offers to trust it. See
// todo/deck-script-trust.md.
//
// Every vector below records itself in `window.__ran` when it runs, so
// "nothing ran" is checked against the same markup that, once the deck is
// trusted, visibly does run — proving the markers themselves work.
import { test, expect, type Page } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'
import { fillEditor } from './helpers/codeEditor'

const RECORD = (label: string): string => `(window.__ran = window.__ran || []).push('${label}')`

function scriptedFragment(title: string): string {
  return `<section class="peitho-slide"><h1>${title}</h1>`
    + `<script>${RECORD('script')}</script>`
    + `<img src="missing-image.png" onerror="${RECORD('img-onerror')}">`
    + `<iframe srcdoc="<script>(parent.__ran = parent.__ran || []).push('iframe-srcdoc')</script>"></iframe>`
    + '</section>'
}

const PLAIN_FRAGMENT = (title: string): string => `<section class="peitho-slide"><h1>${title}</h1></section>`

const BANNER = '[data-script-trust-banner]'
const TRUST_BUTTON = `${BANNER} button`

async function ran(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as unknown as { __ran?: string[] }).__ran ?? [])].sort())
}

/** Long enough for a handler that was going to fire (an image's load
 * error, an iframe's document) to have fired. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(500)
}

async function openDeck(page: Page, deck: MockDeck): Promise<void> {
  await mockTauri(page, deck)
  await page.goto('/')
  await expect(page.locator('[data-slide-row]').first()).toBeVisible({ timeout: 10_000 })
}

test.describe('an untrusted deck with scripts', () => {
  test('Given an untrusted deck whose slides carry a script, an onerror handler and an iframe srcdoc, when its thumbnails mount, then none of them runs and the banner is shown', async ({ page }) => {
    await openDeck(page, { source: '# Scripted\n', fragmentFor: scriptedFragment })

    await expect(page.locator(BANNER)).toBeVisible()
    await settle(page)
    expect(await ran(page)).toEqual([])
  })

  test('Given an untrusted scripted deck, when the slide is previewed, edited, and the layout picker is opened, then still nothing runs', async ({ page }) => {
    await openDeck(page, {
      source: '# Scripted\n', fragmentFor: scriptedFragment, layouts: ['cover'], layoutFragment: scriptedFragment('Layout'),
    })

    await page.locator('[data-slide-row="0"]').click()
    await expect(page.locator('[data-preview-host]')).toHaveAttribute('data-slide-canvas-key', /.+/)
    await fillEditor(page, '# Scripted and Edited\n')
    await expect.poll(() => page.locator('[data-slide-row="0"] [data-slide-canvas-key]').evaluate(host => host.shadowRoot?.querySelector('h1')?.textContent))
      .toBe('Scripted and Edited')
    await page.locator('[data-slide-row="0"]').click({ button: 'right' })
    await page.getByRole('button', { name: /^Change Layout/ }).click()
    await expect(page.locator('button[data-key="cover"]')).toBeVisible()

    await settle(page)
    expect(await ran(page)).toEqual([])
  })

  test('Given an untrusted scripted deck, when the user presses "Trust and Run", then the folder is trusted, the scripts run, and the banner goes away', async ({ page }) => {
    const deck: MockDeck = { source: '# Scripted\n', fragmentFor: scriptedFragment, invokedCommands: [] }
    await openDeck(page, deck)
    await expect(page.locator(BANNER)).toBeVisible()

    await page.locator(TRUST_BUTTON).click()

    await expect(page.locator(BANNER)).toBeHidden()
    expect(deck.invokedCommands).toContain('trust_open_deck')
    expect(deck.trusted).toBe(true)
    await expect.poll(() => ran(page)).toEqual(expect.arrayContaining(['iframe-srcdoc', 'img-onerror', 'script']))
  })

  test('Given a deck trusted from the banner, when the app is reloaded (as after a restart), then it opens trusted with no banner', async ({ page }) => {
    const deck: MockDeck = { source: '# Scripted\n', fragmentFor: scriptedFragment }
    await openDeck(page, deck)
    await page.locator(TRUST_BUTTON).click()
    await expect(page.locator(BANNER)).toBeHidden()

    await page.reload()
    await expect(page.locator('[data-slide-row]').first()).toBeVisible({ timeout: 10_000 })

    await expect.poll(() => ran(page)).toEqual(expect.arrayContaining(['script']))
    await expect(page.locator(BANNER)).toBeHidden()
  })

  test('Given the trust cannot be saved, when the user presses "Trust and Run", then the error is shown, nothing runs, and the banner stays to try again', async ({ page }) => {
    await openDeck(page, {
      source: '# Scripted\n', fragmentFor: scriptedFragment,
      commandError: cmd => (cmd === 'trust_open_deck' ? 'failed to write trusted_deck_dirs.json' : null),
    })

    await page.locator(TRUST_BUTTON).click()

    await expect(page.getByText('failed to write trusted_deck_dirs.json')).toBeVisible()
    await expect(page.locator(TRUST_BUTTON)).toBeEnabled()
    await settle(page)
    expect(await ran(page)).toEqual([])
  })
})

test('Given an untrusted deck with no scripts, when it opens, then no banner is shown', async ({ page }) => {
  await openDeck(page, { source: '# Plain\n', fragmentFor: PLAIN_FRAGMENT })
  await settle(page)
  await expect(page.locator(BANNER)).toBeHidden()
})

test('Given a trusted deck with scripts, when it opens, then its scripts run as before and no banner is shown', async ({ page }) => {
  await openDeck(page, { source: '# Scripted\n', fragmentFor: scriptedFragment, trusted: true })

  await expect.poll(() => ran(page)).toEqual(expect.arrayContaining(['iframe-srcdoc', 'img-onerror', 'script']))
  await expect(page.locator(BANNER)).toBeHidden()
})

test('Given an untrusted deck styled with <style>, class, style and data-* attributes and SVG, when it is sanitized, then all of it survives and still applies', async ({ page }) => {
  const styled = (title: string): string => '<section class="peitho-slide">'
    + '<style>.accent { color: rgb(1, 2, 3); }</style>'
    + `<h1 class="accent" style="margin-left: 7px" data-note="kept">${title}</h1>`
    + '<svg width="10" height="10"><circle cx="5" cy="5" r="3"></circle></svg>'
    + '</section>'
  await openDeck(page, { source: '# Styled\n', fragmentFor: styled })

  const rendered = await page.locator('[data-slide-row="0"] [data-slide-canvas-key]').evaluate(host => {
    const h1 = host.shadowRoot?.querySelector('h1')
    return {
      color: h1 ? getComputedStyle(h1).color : null,
      marginLeft: h1 ? getComputedStyle(h1).marginLeft : null,
      note: h1?.dataset.note ?? null,
      circle: host.shadowRoot?.querySelector('svg circle') !== null,
    }
  })
  expect(rendered).toEqual({ color: 'rgb(1, 2, 3)', marginLeft: '7px', note: 'kept', circle: true })
  await expect(page.locator(BANNER)).toBeHidden()
})
