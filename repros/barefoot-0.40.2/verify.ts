import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { build, preview } from 'vite'
import { barefoot } from '@barefootjs/vite'
import { CSRAdapter } from '@barefootjs/client/csr-adapter'
import { chromium } from '@playwright/test'

const root = import.meta.dirname
const config = {
  configFile: false as const,
  root,
  plugins: [barefoot({ adapter: new CSRAdapter(), components: [root] })],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
    minify: false,
    rollupOptions: { input: { index: resolve(root, 'index.html') } },
  },
  logLevel: 'error' as const,
}
await build(config)
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } })
const address = server.httpServer.address()
assert(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}/index.html`
const browser = await chromium.launch({ channel: 'chrome' })
const names = ['Fragment', 'Element', 'Hidden', 'ObjectIdentity', 'StableIdentity']
const selected = process.argv[2]
if (selected && !names.includes(selected)) throw new Error(`Unknown case: ${selected}`)
const results = []
try {
  for (const name of selected ? [selected] : names) {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const response = await page.goto(`${baseUrl}?case=${name}`)
    assert.equal(response?.status(), 200)
    let actual
    let expected
    if (['Fragment', 'Element', 'Hidden'].includes(name)) {
      const toggle = page.locator('[data-toggle]')
      const action = page.locator('[data-action]')
      await toggle.waitFor()
      assert.equal(await toggle.textContent(), 'idle')
      assert.equal(await action.isDisabled(), false)
      assert.equal(await action.isVisible(), true)
      await toggle.click()
      actual = { state: await toggle.textContent(), disabled: await action.isDisabled(), hidden: await action.getAttribute('hidden') }
      expected = { state: 'busy', disabled: true, hidden: '' }
    } else {
      await page.locator('output').waitFor()
      actual = { text: await page.locator('output').textContent() }
      expected = { text: 'same' }
    }
    const passed = JSON.stringify(actual) === JSON.stringify(expected) && errors.length === 0
    results.push({ name, passed, actual, expected, errors })
    console.log(JSON.stringify(results.at(-1)))
    await page.close()
  }
  await writeFile(resolve(root, 'results.json'), JSON.stringify({ browser: browser.version(), results }, null, 2) + '\n')
} finally {
  await browser.close()
  await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()))
}
if (results.some(result => !result.passed)) process.exitCode = 1
