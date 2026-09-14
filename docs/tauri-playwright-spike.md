# tauri-playwright spike

Investigates whether [`@srsholmes/tauri-playwright`](https://github.com/srsholmes/tauri-playwright) /
`tauri-plugin-playwright` can drive this app's real WKWebView window for e2e
coverage `e2e/*.e2e.ts` (IPC-mocked, plain browser tab — see its own header
comments) explicitly cannot reach: real peitho-core rendering, real
WKWebView CSS/reactivity quirks, native right-click menus, native drag,
native dialogs.

This followed real-device GUI automation (`osascript`/`cliclick`, per
`.claude/skills/run-peitho-studio/SKILL.md`) causing an actual incident: a
coordinate click landed on the operator's own Chrome window instead of
Peitho Studio's, during a screen-shared meeting. `tauri-driver` (Tauri's
own official WebDriver tooling) turned out to have no macOS support at all
— Apple doesn't ship a WKWebDriver, confirmed at
[tauri-apps/tauri#7068](https://github.com/tauri-apps/tauri/issues/7068).
`tauri-playwright` is a third-party plugin that avoids OS-level input
entirely: it embeds a control server in the app that Playwright talks to
over a Unix socket, which calls `WKWebView.evaluateJavaScript` directly —
no screen coordinates, no risk of hitting the wrong window.

## Status: integration works; one real environmental blocker found

What's actually been verified, each rebuilt and re-run to confirm (not
assumed from reading the README):

- **The default (non-e2e) build is unaffected.** `cargo build` /
  `cargo build --features e2e-testing` both succeed; `cargo test --lib`
  passes in both configurations (32 tests). The tricky part was that
  `tauri-playwright:default` (a capability permission from a plugin that's
  only linked in behind the `e2e-testing` feature) makes a **plain**
  `cargo build` fail capability validation ("Permission playwright:default
  not found") if it's listed in `capabilities/default.json` unconditionally
  — confirmed by trying it. Fixed by moving it into its own
  `capabilities/e2e/playwright.json` and switching `build.rs`'s
  `capabilities_path_pattern` based on `CARGO_FEATURE_E2E_TESTING` (present
  only in an `--features e2e-testing` build) — `./capabilities/*.json`
  (skips the `e2e/` subdirectory) normally, `./capabilities/**/*` when the
  feature is on. The upstream example app (`examples/hello-world`) doesn't
  handle this at all — its single `capabilities/default.json` always lists
  `playwright:default`, which would fail the same way; its CI only ever
  builds with `--features e2e-testing` on, so it never hits this.
- **Plugin registration must happen before Tauri creates its windows, not
  inside `.setup()`.** `tauri-plugin-playwright` injects
  `window.__PW_ACTIVE__ = true` via `.js_init_script(...)`, which only
  reaches a webview's *first* page load. This app's other conditionally-
  registered plugin (`tauri_plugin_log`, debug-only) is registered inside
  `.setup()`, which runs *after* `tauri.conf.json`'s declared windows
  already exist — copying that pattern for `tauri-plugin-playwright`
  compiled fine but silently never actually worked: `window.__PW_ACTIVE__`
  never appeared, and every test hung on Playwright's own readiness wait
  until timeout. Fixed by registering it directly on the `Builder` chain
  instead (`src-tauri/src/lib.rs`), matching the plugin's own Quick Start
  example rather than this codebase's `setup()` convention.
- **The Unix socket comes up correctly** (`/tmp/tauri-playwright.sock`,
  confirmed via the plugin's own `tauri-plugin-playwright: listening on
  unix:...` log line) once the app launches with the display actually
  awake.
- **The npm package's own type declarations don't match its documented
  config surface.** `mode` (`'browser' | 'tauri' | 'cdp'`) is a genuine
  Playwright "option fixture" — confirmed by reading the compiled
  `dist/index.js` (`mode: ["browser", { option: true }]`), so it *is*
  read from `defineConfig`'s `use` block at runtime exactly as the README
  shows — but `@playwright/test`'s own `UseOptions` type doesn't know
  about it, so `use: { mode: 'tauri' }` fails `tsc`. Worked around with a
  narrow cast in `e2e-tauri/playwright.config.ts` rather than widening the
  whole `use` block.
- **`tauriPage` still launches a browser even in `tauri` mode.** Its
  fixture function unconditionally destructures `{ page, mode }` as its
  own dependencies (confirmed in `dist/index.js`), so Playwright
  provisions the `page` fixture (launching a real browser) regardless of
  which mode branch actually runs — wasteful, but harmless once
  `channel: 'chrome'` is set (this project already needs that everywhere
  else too, since the Playwright browser-binary CDN is blocked here).

**Blocker hit, not yet resolved**: with the display asleep/locked (screen
was black; confirmed via a read-only screenshot, no GUI interaction
attempted), a freshly-launched `--features e2e-testing` build never
produced the "listening on unix:..." log line at all — not a timeout, no
log output whatsoever — even though `ps`/`lsof` showed the process
genuinely running and loading WebKit resources. The very first launch
earlier in this spike, while the display was awake, worked in ~2 seconds.
This is consistent with (though not proven to be exactly)
[[tauri-macos-window-automation]]'s note (from the kfly8/notes repo,
sourced from a `tophatch/swift-pwa` issue) that a hidden/occluded WKWebView
throttles rendering to 0fps — here it looks like *process startup itself*
stalls with the display off, not just steady-state rendering. Not
re-investigated further in this session; the process was killed rather
than forcing a display wake, since deliberately waking someone else's
locked screen mid-session wasn't judged worth the interruption for a spike.

## What's committed here vs. still open

Committed on this branch (`feat/tauri-playwright-e2e`, based on `main`,
**not** part of PR #55's `feat/present-click-feedback`):

- `src-tauri/Cargo.toml`: `e2e-testing` feature, `tauri-plugin-playwright`
  as an optional dependency.
- `src-tauri/src/lib.rs`: conditional plugin registration (early, not in
  `.setup()`).
- `src-tauri/capabilities/e2e/playwright.json` (new) +
  `src-tauri/build.rs` (feature-conditional capability glob).
- `e2e-tauri/`: a from-scratch Playwright config + fixtures + one smoke
  test (welcome screen visibility) using `mode: 'tauri'`, kept separate
  from `e2e/` (different config, different purpose — real window vs.
  IPC-mocked browser tab) so neither's `webServer`/`testMatch` picks up
  the other's files.
- `package.json`: `@srsholmes/tauri-playwright` dev dependency.

**Not yet done** — this was a feasibility spike, not the full rollout:

- Never actually got a green test run against the real window (blocked by
  the display-sleep issue above, discovered late in the session).
- No CI wiring, no `PEITHO_STUDIO_DEV_DECK`-based seam for tests that need
  to skip the native folder-picker dialog (`plugin:dialog|open` isn't
  mockable in `tauri` mode the way it is in `browser` mode/`e2e/`'s
  `mockTauri.ts` — it would hit the real native dialog). Fine for a smoke
  test landing on the welcome screen; a real regression suite exercising
  drag/right-click/rendering would need this.
- No decision yet on how a `tauri`-mode run should fit into this
  project's actual dev loop (a manually-launched long-lived app process
  the test suite connects to, vs. something `bun run test:e2e:tauri`
  launches and tears down itself, matching the upstream CI's pattern of
  starting the binary in the background and polling for the socket).

## How to try it

```bash
# Terminal 1 — dev server the app's devUrl points at
bun run build && bun run start

# Terminal 2 — the real app, with the e2e plugin linked in
cd src-tauri && cargo build --features e2e-testing
./target/debug/app  # do this from a terminal with the display actually awake

# Once "tauri-plugin-playwright: listening on unix:/tmp/tauri-playwright.sock" appears:
npx playwright test --config e2e-tauri/playwright.config.ts
```
