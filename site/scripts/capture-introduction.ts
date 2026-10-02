// Regenerate the README's poster from the standalone HTML introduction.
import { chromium, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  await page.goto(`${process.env.SITE_URL ?? 'http://127.0.0.1:3014'}/demo.html`)
  await page.locator('#step-design').click()
  await page.locator('#send').click()
  await expect(page.locator('#presentation')).toHaveClass(/rich/)
  await page.evaluate(() => document.fonts.ready)
  const png = await page.locator('.tour').screenshot()
  // Encode outside the site document: its CSP deliberately disallows data: images.
  const encoder = await browser.newPage()
  const webp = await encoder.evaluate(async data => {
    const img = new Image()
    img.src = data
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width / 2
    canvas.height = img.height / 2
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', .9).split(',')[1]
  }, `data:image/png;base64,${png.toString('base64')}`)
  writeFileSync(resolve(import.meta.dir, '../public/studio.webp'), Buffer.from(webp, 'base64'))
} finally { await browser.close() }
