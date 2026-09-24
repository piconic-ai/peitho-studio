import { defineConfig } from '@playwright/test'

// Runs against the plain dev server (no Tauri) — see e2e/welcome.e2e.ts
// for what this can and can't cover. Uses the system-installed Google Chrome
// (`channel: 'chrome'`) rather than Playwright's own bundled Chromium:
// this dev machine's network policy blocks the browser-binary CDN
// (`cdn.playwright.dev`), so `playwright install` can't download one, but
// a real Chrome is already installed for everyday use.
// Its own port, apart from `bun run dev`'s 3003 (Tauri's `devUrl`), so a
// running `tauri dev` never collides with it. Worktrees running e2e at the
// same time each need their own: `E2E_PORT=3014 bun run test:e2e`.
const E2E_PORT = Number(process.env.E2E_PORT ?? 3013)

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
    baseURL: `http://localhost:${E2E_PORT}`,
    channel: 'chrome',
    // The UI picks its language from the OS until the mock answers (see
    // `createSettingsStore`'s first guess in Studio.tsx), so pin the
    // browser's own to keep a Japanese dev machine from changing the
    // outcome of tests that expect English.
    locale: 'en-US',
  },
  webServer: {
    // `start` alone only serves whatever's already in dist/ — build first
    // so the e2e run reflects the current source, not a stale bundle.
    command: `bun run build && PORT=${E2E_PORT} bun run start`,
    url: `http://localhost:${E2E_PORT}`,
    // Never reuse a server already on the port: it may be serving another
    // worktree's build (a leftover run, or a concurrent one), which made
    // tests pass or fail against code that wasn't under test. A busy port
    // fails the run instead; pick another with `E2E_PORT`.
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
