import { defineConfig } from '@playwright/test'

// Runs against the plain dev server (no Tauri) — see e2e/welcome.e2e.ts
// for what this can and can't cover. Uses the system-installed Google Chrome
// (`channel: 'chrome'`) rather than Playwright's own bundled Chromium:
// this dev machine's network policy blocks the browser-binary CDN
// (`cdn.playwright.dev`), so `playwright install` can't download one, but
// a real Chrome is already installed for everyday use.
export default defineConfig({
  testDir: './e2e',
  // `*.e2e.ts` rather than Playwright's default `*.spec.ts` — bun's own
  // test runner (`bun test`, used for components/*.test.ts) also matches
  // `*.spec.ts` by default and would otherwise try to execute these too.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3003',
    channel: 'chrome',
  },
  webServer: {
    // `start` alone only serves whatever's already in dist/ — build first
    // so the e2e run reflects the current source, not a stale bundle.
    command: 'bun run build && bun run start',
    url: 'http://localhost:3003',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
