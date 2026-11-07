import { test, expect } from '../fixtures'

test('Cmd zoom shortcuts resize the real WKWebView layout viewport', async ({ tauriPage }) => {
  const page = tauriPage
  const viewportWidth = () => page.evaluate<number>('window.innerWidth')
  const press = async (key: string, metaKey = true) => {
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, metaKey: ${metaKey}, bubbles: true
    }))`)
  }

  await press('0')
  const baseline = await viewportWidth()
  const nativeScale = await page.evaluate<number>('window.__TAURI_INTERNALS__.invoke("plugin:window|scale_factor", { label: "main" })')
  const pageScale = () => page.evaluate<number>('window.devicePixelRatio')
  expect(baseline).toBeGreaterThan(0)
  expect(await pageScale()).toBeCloseTo(nativeScale, 4)

  try {
    await press('+')
    await expect.poll(viewportWidth).toBeLessThan(baseline * 0.9)
    expect(await pageScale()).toBeCloseTo(nativeScale * 1.2, 4)
    const enlarged = await viewportWidth()

    await press('0')
    await expect.poll(viewportWidth).toBe(baseline)

    await press('-')
    await expect.poll(viewportWidth).toBeGreaterThan(baseline * 1.1)
    expect(await pageScale()).toBeCloseTo(nativeScale * 0.8, 4)

    await press('0')
    await expect.poll(viewportWidth).toBe(baseline)

    await press('=')
    await expect.poll(viewportWidth).toBe(enlarged)

    await press('0', false)
    await page.evaluate('new Promise(resolve => setTimeout(resolve, 200))')
    expect(await viewportWidth()).toBe(enlarged)

    await press('0')
    await expect.poll(viewportWidth).toBe(baseline)

    await press('+', false)
    await page.evaluate('new Promise(resolve => setTimeout(resolve, 200))')
    expect(await viewportWidth()).toBe(baseline)
    await press('-', false)
    await page.evaluate('new Promise(resolve => setTimeout(resolve, 200))')
    expect(await viewportWidth()).toBe(baseline)
    await press('0', false)
    await page.evaluate('new Promise(resolve => setTimeout(resolve, 200))')
    expect(await viewportWidth()).toBe(baseline)
  } finally {
    await press('0')
    await expect.poll(viewportWidth).toBe(baseline)
  }
})
