import { test, expect } from '@playwright/test'
import { mockTauri } from './helpers/mockTauri'
import { editorText, fillEditor } from './helpers/codeEditor'

test('Given four panels, when each is folded and reopened, then contents and widths survive', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await mockTauri(page, { source: '<!-- {"key":"one"} -->\n# Slide One\n' })
  await page.goto('/')
  await expect(page.locator('[data-slide-row]')).toHaveCount(1)
  await expect.poll(() => editorText(page)).toBe('# Slide One')
  await fillEditor(page, '# Edited')
  const editor = page.locator('[data-editor="body"] .cm-editor')
  await editor.evaluate(el => { el.setAttribute('data-mount-probe', 'original') })

  // Closing controls overlay the original layout without adding a header.
  for (const panel of ['slides', 'editor', 'review']) {
    const container = page.locator(`[data-panel="${panel}"]`)
    const content = page.locator(`#panel-${panel}`)
    await expect(content).toHaveCSS('padding-top', '0px')
    expect((await content.boundingBox())!.y).toBe((await container.boundingBox())!.y)
  }
  const previewBox = await page.locator('[data-panel="preview"]').boundingBox()
  const switchBox = await page.locator('[data-panel="preview"] [role="switch"]').boundingBox()
  expect(switchBox!.x - previewBox!.x).toBeLessThan(24)
  expect(switchBox!.y - previewBox!.y).toBeLessThan(12)
  const width = await page.locator('#panel-editor').evaluate(el => el.getBoundingClientRect().width)
  for (const panel of ['slides', 'editor', 'preview', 'review']) {
    const button = page.locator(`[data-panel="${panel}"] [data-panel-toggle]`)
    await page.mouse.move(0, 0)
    await expect(button).toHaveCSS('opacity', '0')
    await button.hover()
    await expect(button).toHaveCSS('opacity', '1')
    await button.click()
    await expect(page.locator(`[data-panel="${panel}"]`)).toBeHidden()
    await expect(page.locator(`#panel-${panel}`)).toBeHidden()
    await expect(page.locator('[data-panel-rail]')).toHaveCSS('width', '36px')
    await expect(page.locator(`[data-panel-rail] [data-panel-toggle="${panel}"]`)).toBeVisible()
    if (panel === 'editor') {
      await expect(page.locator('[data-panel="preview"]')).toBeVisible()
      await expect(page.locator('[data-panel="review"]')).toBeVisible()
      const preview = await page.locator('[data-panel="preview"]').boundingBox()
      expect(preview!.x).toBe(36)
      await page.screenshot({ path: testInfo.outputPath('panels-partial.png') })
    }
  }
  // All folded icons share one column in the original panel order.
  const boxes = await page.locator('[data-panel-rail] button').evaluateAll(elements =>
    elements.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })))
  expect(new Set(boxes.map(box => box.x)).size).toBe(1)
  expect(boxes.every((box, index) => index === 0 || box.y > boxes[index - 1].y)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('panels-folded.png') })
  // All four can be closed; every restore icon remains reachable.
  for (const panel of ['review', 'preview', 'editor', 'slides']) {
    const button = page.locator(`[data-panel-rail] [data-panel-toggle="${panel}"]`)
    await button.focus()
    await button.press('Enter')
    await expect(button).toBeHidden()
    await expect(page.locator(`#panel-${panel}`)).toBeVisible()
  }
  await expect(page.locator('[data-panel-rail]')).toBeHidden()
  await expect(editor).toHaveAttribute('data-mount-probe', 'original')
  await expect.poll(() => editorText(page)).toBe('# Edited')
  expect(await page.locator('#panel-editor').evaluate(el => el.getBoundingClientRect().width)).toBe(width)
  await expect(page.locator('[data-preview-host]')).toHaveAttribute('data-slide-canvas-key', 'one')
  await page.screenshot({ path: testInfo.outputPath('panels-open.png') })
})
