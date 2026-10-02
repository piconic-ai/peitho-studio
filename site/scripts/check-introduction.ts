// Browser verification for the standalone introduction and responsive site embed.
import { chromium, expect } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chrome' })
const base = process.env.SITE_URL ?? 'http://127.0.0.1:3014'
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 900 }, reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}/demo.html`)
  const words = '# My own introduction\n\n- Plain text\n- <img src=x onerror=alert(1)>\n- My agent, my choice'
  await page.locator('#markdown').fill(words)
  await expect(page.locator('#slide-title')).toHaveText('My own introduction')
  await expect(page.locator('#slide-points .point-text')).toHaveText(['Plain text', '<img src=x onerror=alert(1)>', 'My agent, my choice'])
  await expect(page.locator('#slide-points img')).toHaveCount(0)
  await page.locator('#step-design').click()
  await page.locator('#send').click()
  await expect(page.locator('#presentation')).toHaveClass(/rich/)
  await expect(page.locator('#markdown')).toHaveValue(words)
  await page.locator('#before').click()
  await expect(page.locator('#presentation')).not.toHaveClass(/rich/)
  await page.locator('#after').click()
  await expect(page.locator('#presentation')).toHaveClass(/rich/)
  await page.locator('#step-write').click()
  await expect(page.locator('#markdown')).toHaveValue(words)
  // Stopping playback by typing must not let pending steps overwrite user input.
  await page.locator('#play').click()
  await page.locator('#markdown').fill('# Keep my edit\n\n- One\n- Two\n- Three')
  await page.waitForTimeout(1600)
  await expect(page.locator('#slide-title')).toHaveText('Keep my edit')
  await expect(page.locator('#write-panel')).toBeVisible()
  // The complete story works, and can be replayed.
  await page.locator('#play').click()
  await expect(page.locator('#presentation')).toHaveClass(/rich/, { timeout: 15_000 })
  await expect(page.locator('#slide-title')).toHaveText('Meet Peitho Studio')
  await expect(page.locator('#play-label')).toHaveText('Replay the story', { timeout: 10_000 })
  // Narrow → wide resizing shrinks the iframe again, without internal clipping.
  await page.goto(base)
  const frame = page.frameLocator('#studio-introduction')
  await expect(frame.locator('#markdown')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 900 })
  await frame.locator('#step-design').click()
  await frame.locator('#send').click()
  await expect(frame.locator('#presentation')).toHaveClass(/rich/)
  await expect.poll(() => page.locator('#studio-introduction').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(850)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 1000 })
  await expect.poll(() => page.locator('#studio-introduction').evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(850)
  expect(errors).toEqual([])
  console.log('Verified: live edits, safe text rendering, retained words, Before/After, playback cancellation, full story, responsive embedding.')
} finally { await browser.close() }
