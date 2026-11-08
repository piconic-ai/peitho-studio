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

test('View menu actions share the keyboard zoom level in the focused WKWebView', async ({ tauriPage }) => {
  const page = tauriPage
  const invokeMenu = (id: string) => page.evaluate<boolean>(`window.__TAURI_INTERNALS__.invoke(
    'plugin:view-menu-test|activate', { id: ${JSON.stringify(id)} }
  )`)
  const pageScale = () => page.evaluate<number>('window.devicePixelRatio')
  const keyboard = (key: string) => page.evaluate<boolean>(`window.dispatchEvent(new KeyboardEvent('keydown', {
    key: ${JSON.stringify(key)}, metaKey: true, bubbles: true
  }))`)
  const items = await page.evaluate<Array<[string, string]>>(`window.__TAURI_INTERNALS__.invoke('plugin:view-menu-test|items')`)
  expect(items.map(([id]) => id)).toEqual(['view_zoom_in', 'view_zoom_out', 'view_actual_size'])
  expect(items.every(([, label]) => label.length > 0)).toBe(true)

  await keyboard('0')
  const baseline = await pageScale()
  try {
    expect(await invokeMenu('view_zoom_in')).toBe(true)
    await expect.poll(pageScale).toBeCloseTo(baseline * 1.2, 4)
    await keyboard('+')
    await expect.poll(pageScale).toBeCloseTo(baseline * 1.4, 4)
    await page.evaluate<boolean>(`window.dispatchEvent(new WheelEvent('mousewheel', { ctrlKey: true, deltaY: -1, cancelable: true }))`)
    await expect.poll(pageScale).toBeCloseTo(baseline * 1.6, 4)
    expect(await invokeMenu('view_zoom_out')).toBe(true)
    await expect.poll(pageScale).toBeCloseTo(baseline * 1.4, 4)
    expect(await invokeMenu('view_actual_size')).toBe(true)
    await expect.poll(pageScale).toBeCloseTo(baseline, 4)
    expect(await invokeMenu('view_zoom_out')).toBe(true)
    await expect.poll(pageScale).toBeCloseTo(baseline * 0.8, 4)
    expect(await invokeMenu('not_a_zoom_action')).toBe(false)
    expect(await pageScale()).toBeCloseTo(baseline * 0.8, 4)
  } finally {
    await invokeMenu('view_actual_size')
    await expect.poll(pageScale).toBeCloseTo(baseline, 4)
  }
})
