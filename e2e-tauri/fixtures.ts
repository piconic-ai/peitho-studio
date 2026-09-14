// Spike (see docs/tauri-playwright-spike.md): unlike e2e/helpers/mockTauri.ts
// (IPC-mocked, plain browser tab), this drives the *real* WKWebView window
// via tauri-plugin-playwright's Unix-socket bridge — no OS-level clicks, no
// screen coordinates. The Tauri app must already be running with the
// e2e-testing feature (its Cargo.toml only links the plugin then) — see
// e2e-tauri/README.md for how to launch it.
import { createTauriTest } from '@srsholmes/tauri-playwright'

export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:3003',
})
