import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build, preview } from 'vite'
import { barefoot } from '@barefootjs/vite'
import { CSRAdapter } from '@barefootjs/client/csr-adapter'
import { chromium, type Page } from '@playwright/test'

const fixture = resolve(import.meta.dirname, 'fixtures/barefoot')
const config = {
  configFile: false as const,
  root: fixture,
  plugins: [barefoot({ adapter: new CSRAdapter(), components: [fixture] })],
  build: {
    outDir: resolve(import.meta.dirname, '../tmp/barefoot-regressions'),
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: { input: { index: resolve(fixture, 'index.html') } },
  },
  logLevel: 'error' as const,
}
await build(config)
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } })
const address = server.httpServer.address()
assert(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch({ channel: 'chrome' })
const tests: [string, (page: Page) => Promise<void>][] = [
  ['NestedMaps', async page => {
    await page.locator('[data-choice="square"]').click()
    assert.equal(await page.locator('[data-choice="square"]').getAttribute('aria-checked'), 'true')
    assert.equal(await page.locator('[data-choice="square"]').textContent(), 'yes')
    assert.equal(await page.locator('[data-choice="wide"]').getAttribute('aria-checked'), 'false')
  }],
  ['Propagation', async page => {
    await page.getByRole('button', { name: 'child', exact: true }).click()
    assert.equal(await page.locator('output').textContent(), '0,1')
  }],
  ['KeyedRef', async page => {
    assert.equal(await page.locator('input').getAttribute('data-mounted'), 'yes')
    await page.getByRole('button').click()
    await page.getByRole('button').click()
    assert.equal(await page.locator('input').getAttribute('data-mounted'), 'yes')
  }],
  ['LateRef', async page => {
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button').click()
      assert.equal(await page.locator('input').evaluate(el => el === document.activeElement), true)
      await page.getByRole('button').click()
    }
  }],
  ['BranchEffect', async page => {
    const toggle = page.getByRole('button', { name: 'toggle' })
    await toggle.click()
    await toggle.click()
    await toggle.click()
    const before = await page.locator('body').getAttribute('data-runs')
    await page.getByRole('button', { name: 'tick', exact: true }).click()
    assert.equal(await page.locator('body').getAttribute('data-runs'), before, 'unmounted branch effects still run')
    await toggle.click()
    const mounted = Number(await page.locator('body').getAttribute('data-runs'))
    await page.getByRole('button', { name: 'tick', exact: true }).click()
    assert.equal(Number(await page.locator('body').getAttribute('data-runs')), mounted + 1)
  }],
  ['DelayedBranch', async page => {
    await page.getByRole('button').click()
    await page.getByText('failure', { exact: true }).waitFor()
  }],
  ['NestedBranch', async page => {
    await page.getByRole('button').click()
    await page.getByText('ready', { exact: true }).waitFor()
  }],
  ['BranchChildText', async page => {
    await page.getByRole('button', { name: 'open', exact: true }).click()
    assert.equal(await page.locator('p').textContent(), 'send')
    await page.getByRole('button', { name: 'toggle', exact: true }).click()
    assert.equal(await page.locator('p').textContent(), 'sending')
    assert.equal(await page.locator('span').textContent(), 'entered')
  }],
  ['DestructuredStore', async page => {
    await page.getByRole('button').click()
    assert.equal(await page.getByRole('button').textContent(), '1')
  }],
  ['KeyedIndex', async page => {
    await page.getByRole('button').click()
    assert.deepEqual(await page.locator('p').allTextContents(), ['b:0', 'a:1'])
  }],
  ['BlockMap', async page => {
    assert.deepEqual(await page.locator('p').allTextContents(), ['A', 'B'])
  }],
  ['StableObjectIdentity', async page => {
    assert.equal(await page.locator('output').textContent(), 'same')
  }],
  ['GetterProp', async page => {
    await page.getByRole('button').click()
    assert.equal(await page.locator('output').textContent(), '1')
  }],
  ['NativeConst', async page => {
    const action = page.getByRole('button', { name: 'action', exact: true })
    assert.equal(await action.isDisabled(), false)
    await page.getByRole('button', { name: 'toggle', exact: true }).click()
    assert.equal(await action.isDisabled(), true)
    await page.getByRole('button', { name: 'toggle', exact: true }).click()
    assert.equal(await action.isDisabled(), false)
  }],
]
if (process.argv.includes('--audit')) {
  tests.push(['ComposedConst', async page => {
    const action = page.getByRole('button', { name: 'action', exact: true })
    assert.equal(await action.isDisabled(), false)
    await page.getByRole('button', { name: 'toggle', exact: true }).click()
    assert.equal(await action.isDisabled(), true)
    await page.getByRole('button', { name: 'toggle', exact: true }).click()
    assert.equal(await action.isDisabled(), false)
  }])
  tests.push(['ObjectIdentity', async page => {
    assert.equal(await page.locator('output').textContent(), 'same')
  }])
}
let failures = 0
try {
  for (const [name, verify] of tests) {
    const page = await browser.newPage()
    page.setDefaultTimeout(2000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      const response = await page.goto(`${baseUrl}index.html?probe=${name}`)
      assert.equal(response?.status(), 200, 'fixture page must load')
      await verify(page)
      assert.deepEqual(errors, [])
      console.log(`PASS ${name}`)
    } catch (error) {
      failures++
      console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
      if (errors.length) console.log(errors.join('\n'))
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
  await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()))
}
if (failures) process.exitCode = 1
