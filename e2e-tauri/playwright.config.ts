import { defineConfig } from '@playwright/test'

// Spike config (see docs/tauri-playwright-spike.md) — assumes the app is
// already running with `cargo build --features e2e-testing` (or `bunx
// tauri dev --features e2e-testing`) against the dev server on :3003, so no
// `webServer` here (that's e2e/'s job for the existing IPC-mocked suite).
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    // tauri-playwright's `tauriPage` fixture unconditionally depends on
    // Playwright's own `page` fixture even in `tauri` mode (it destructures
    // `{ page, mode }` and only branches on `mode` inside the body) — so a
    // browser still gets launched even though this mode never uses it.
    // `channel: 'chrome'` reuses the same workaround the main e2e/ suite
    // already needs on this machine (the Playwright browser-binary CDN is
    // blocked by network policy).
    channel: 'chrome',
    // `mode` is a genuine Playwright "option fixture" (createTauriTest's
    // `mode: ['browser', { option: true }]`, confirmed by reading
    // dist/index.js — it's read from here at runtime), but the package
    // doesn't export a config type that knows about it, so plain
    // `@playwright/test`'s `UseOptions` rejects it at the type level. Cast
    // rather than widen the whole `use` block to `any`.
    ...({ mode: 'tauri' } as Record<string, unknown>),
  },
})
