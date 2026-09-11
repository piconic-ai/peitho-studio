// Regression test for a real bug: right-clicking a thumbnail left Cut/
// Copy/Delete permanently disabled, no matter which slide was clicked.
// `SlideList.tsx`'s slide-list container has its own `onContextMenu` (so
// right-clicking empty space still opens a menu, with no slide selected);
// a `.map()` row's own `onContextMenu` compiles to a delegated listener on
// that very container, so the container's directly-authored handler ends
// up as a second, separate listener on the same DOM node, and the row
// handler's `event.stopPropagation()` can't stop a sibling listener
// already registered on that same node (piconic-ai/barefootjs#2930) — a
// right-click on a row fired both handlers, and the container's
// `null`-index call always ran second, silently overwriting the row's own
// correct index. See `Studio.tsx`'s `openContextMenu` and `SlideList.tsx`'s
// container `onContextMenu` for the fix.
import { test, expect } from '@playwright/test'
import { mockTauri, type MockDeck } from './helpers/mockTauri'

test('right-clicking a thumbnail enables Cut/Copy/Delete, and each one works', async ({ page }) => {
  const deck: MockDeck = { source: '# Slide One\n\n---\n\n# Slide Two\n' }
  await mockTauri(page, deck)

  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 10_000 })

  await page.locator('[data-slide-row="1"]').click({ button: 'right' })
  const copyBtn = page.getByRole('button', { name: /^Copy/ })
  const cutBtn = page.getByRole('button', { name: /^Cut/ })
  const deleteBtn = page.getByRole('button', { name: /^Delete/ })
  await expect(copyBtn).toBeEnabled()
  await expect(cutBtn).toBeEnabled()
  await expect(deleteBtn).toBeEnabled()

  // Copy the second slide, then paste it after the first — should grow
  // the deck back out to 3 slides with the copy inserted in the middle.
  await copyBtn.click()
  await page.locator('[data-slide-row="0"]').click({ button: 'right' })
  await page.getByRole('button', { name: /^Paste/ }).click()
  await expect(page.locator('[data-slide-row]')).toHaveCount(3, { timeout: 5_000 })

  // Delete actually removes the right-clicked slide, not some other one.
  await page.locator('[data-slide-row="1"]').click({ button: 'right' })
  await page.getByRole('button', { name: /^Delete/ }).click()
  await expect(page.locator('[data-slide-row]')).toHaveCount(2, { timeout: 5_000 })
})
