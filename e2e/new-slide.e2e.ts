// Regression test for a real bug: a brand-new `.map()` row's `ref` runs
// while the row is still part of a detached "template contents" document
// (not yet the real page document) — see dom/slideCanvas.ts's
// mountSlideCanvas doc comment. Adopting a CSSStyleSheet created against
// the real document into that row's shadow root threw
// `NotAllowedError: Sharing constructed stylesheets in multiple documents
// is not allowed`, silently aborting the whole "New Slide" commit before
// it reached saveDeckSource — the thumbnail list just never grew. (A
// second, unrelated cause of "New Slide silently does nothing" — a real
// peitho-core build error invisible because of StatusBar's own rendering
// bug — is covered separately in error-banner-visibility.e2e.ts and
// domain/slides.test.ts's newSlideConfig tests.)
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

test('New Slide adds a thumbnail and persists the new slide text', async ({ page }) => {
  const deck: MockDeck = { source: '# Slide One\n' }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByText('New Slide', { exact: true }).click()

  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
  expect(deck.source).toContain('# New Slide')
})

// The exact real-world scenario a user hit: a single slide with an
// explicit layout, plus a second layout in the deck's `layouts/`
// directory — see domain/slides.ts's newSlideConfig for why a bare,
// layout-less "New Slide" becomes ambiguous once that second layout
// exists, and pipeline.rs's render_source_adversarial_a_title_only_slide_
// with_no_explicit_layout_is_ambiguous for peitho-core's own side of it.
test('New Slide inherits the previous slide\'s explicit layout, avoiding a multi-layout ambiguity', async ({ page }) => {
  const deck: MockDeck = {
    source: '<!-- {"key":"cover","layout":"cover"} -->\n# Cover\n',
    // A layout-less new slide would be ambiguous once a deck has more than
    // one layout — simulates peitho-core's real "slide matches multiple
    // layouts" build error for exactly that shape.
    commandError: (cmd, args) => {
      if (cmd !== 'render_draft') return null
      const secondSlide = (args.content as string).split(/^---$/m)[1] ?? ''
      const hasExplicitLayout = /"layout"\s*:/.test(secondSlide)
      return secondSlide.includes('# New Slide') && !hasExplicitLayout
        ? "slide 2 ('new-slide'): slide matches multiple layouts: cover, title-body-code"
        : null
    },
  }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1, { timeout: 10_000 })

  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByText('New Slide', { exact: true }).click()

  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
  const secondSlide = deck.source.split(/^---$/m)[1] ?? ''
  expect(secondSlide).toContain('# New Slide')
  expect(secondSlide).toContain('"layout":"cover"')
  await expect(page.locator('.bg-destructive\\/10')).toBeHidden()
})
