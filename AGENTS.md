# peitho-studio design rules

An editor for Peitho decks (Peitho is a Markdown-driven presentation engine),
currently shipped as a Tauri desktop app. Tauri v2 (Rust) + BarefootJS CSR +
UnoCSS. `peitho-core` is embedded in-process under `src-tauri/src/engine/`
rather than run as a subprocess.

## Design principles

The frontend's layer structure (domain/state/ipc/dom/components), the
principle of eliminating unrepresentable states via ADTs, writing specs as
Given-When-Then, and the approach to finding bugs are detailed in
`docs/architecture.md` (established during the `components/Studio.tsx`
refactoring). Track improvement plans and progress in
[GitHub Issues](https://github.com/piconic-ai/peitho-studio/issues).
Search existing open and closed issues before creating a plan, and update
an existing issue when it covers the same outcome. Write plans in Japanese
with the goal, scope and exclusions, investigation findings, approach,
layer ownership, tests, and acceptance criteria. Keep automated checks and
items requiring human judgment separate. For an unrefined idea, record only
what is known and identify the open questions.

When implementing an issue, read its full body and comments, follow its
scope, and link the implementation PR to the issue. Keep the issue open
while acceptance criteria or human checks remain. Close it only when all
criteria are met, or record why the work was rejected before closing it.
Do not recreate the retired `todo/` ledger. Historical references to its
files in this document refer to Git history, not active planning inputs.

- **Prefer pure functions.** Default to functions whose output is
  determined by their input, and confine dependence on side effects/state
  to only where it's truly necessary.
- **When state is used, make it distinguishable by directory/file
  structure.** Aim for "is this code stateful, or pure logic?" to be
  answerable just by looking at which file it's in. Current concrete
  assignment:
  - Frontend: `components/*.ts` (not `.tsx`) is exclusively for pure logic
    that never touches signals, the DOM, or IPC (e.g. `domain/slides.ts`,
    `domain/slideCss.ts`). `components/*.tsx` is the stateful layer that
    holds BarefootJS signals, effects, and IPC calls. Before embedding new
    pure logic inside a `.tsx`, first consider whether it can be extracted
    into a `.ts` file.
  - Rust: `src-tauri/src/engine/` is the rendering pipeline that calls
    peitho-core — a set of deterministic functions shaped
    `(Path, &str) -> Result<T, String>` that never reference Tauri's
    `State`. `src-tauri/src/peitho.rs` is the Tauri command + state-
    management layer — state held in `Mutex`es such as `PeithoSession`/
    `PendingDecks` must always be concentrated here, never leaked into
    other modules. `src-tauri/src/lib.rs` stays a thin wiring layer for
    the app (menu construction, event routing) only, with no business
    logic.
- **Keep pure functions narrow in scope.** One function, one
  responsibility. Before packing multiple transformations into a single
  function, first consider whether it can be split into a composition of
  smaller pure functions.
- **Spec tests and adversarial tests are essentially mandatory.** Whenever
  a new pure function is added or changed, write both a spec test for
  typical inputs and an adversarial test for boundary values, invalid
  input, empty strings, etc. Don't stop at "it should work."
  - Frontend: `bun test` (`*.test.ts`). Targets pure logic only — the
    BarefootJS components themselves (`.tsx`) aren't unit-tested for now
    — reach for `@barefootjs/test` (browserless IR-based testing) once
    verifying component structure becomes necessary.
  - Rust: `#[cfg(test)] mod tests` inside each module. Tauri commands
    that depend on `AppHandle`/`State` aren't unit-tested directly for
    now (that needs Tauri's test harness) — extract the state-independent
    logic out of the command as a function and test that instead.
- **e2e is wanted too, but it's fine to get there incrementally.** The
  Playwright suite under `e2e/` runs against the dev server (the frontend
  half of `bun run dev`), no Tauri window involved. It builds and serves
  its own copy on port 3013 (never reusing a server already there), so
  worktrees running e2e at the same time each need their own
  `E2E_PORT` (`E2E_PORT=3014 bun run test:e2e`). `welcome.e2e.ts` is a
  bare smoke test with no IPC bridge at all. `e2e/helpers/mockTauri.ts`
  stubs `window.__TAURI_INTERNALS__.invoke` (via `page.exposeFunction`) so
  a test can get past the welcome screen and drive the real frontend
  logic — `domain/slides.ts` run in Node stands in for peitho-core, close
  enough to exercise the app's own reactive/DOM code (this caught and
  fixed a real bug, see `new-slide.e2e.ts`). Passing `realEngine` from
  `e2e/helpers/realEngine.ts` instead answers `render_draft`/
  `create_image_canvas`/`check_slide_layouts` with peitho-core's actual
  output (needs
  `cargo build --example e2e_engine` in `src-tauri/`; specs named
  `real-engine-*.e2e.ts` skip without it and run in CI's macOS
  `e2e-real-engine` job) — use it whenever a canvas edit's resulting
  Markdown must satisfy real slot contracts (arity, routing). What neither
  can catch: a real WKWebView (rendering fidelity,
  `adoptedStyleSheets`/`@font-face` support, native right-click, drag). Real e2e that drives an actual Tauri window is still
  queued in `tmp/todo.md` as a Scope1+ concern — **not** via `tauri-driver`
  as originally assumed: it has no macOS support at all (Apple doesn't ship
  a WKWebDriver; confirmed at
  [tauri-apps/tauri#7068](https://github.com/tauri-apps/tauri/issues/7068)).
  A spike into the actual macOS-viable alternative
  (`tauri-plugin-playwright`, which drives the webview over a Unix socket
  instead of OS-level input) is in progress — see
  `docs/tauri-playwright-spike.md`. A `run-peitho-studio` skill used to
  automate this verification with `osascript`/`cliclick`, but it caused a
  second misdirected-click incident (see `docs/tauri-playwright-spike.md`)
  and was deleted — on-device WKWebView verification is done by the user
  manually until `tauri-plugin-playwright` (or another non-coordinate
  approach) replaces it.

## Debugging a layout's own JavaScript

A layout's `<script>` actually executes now in all three viewers (see
`todo/archive/layout-js-console-log.md`), so its `console.log` shows up in
ordinary DevTools — there's no dedicated log panel.

- **Studio**: same WKWebView Inspect Element flow as the `devtools`
  pitfall below.
- **`peitho present`**: opens the system's actual default browser as an
  independent OS process, not a Tauri window — its usual DevTools
  (F12 / Cmd+Option+I) works with no Tauri-side setting to flip.
- **`peitho build`'s distribution viewer**: a plain static page; open it
  in any browser like `peitho present`.

## Fixing a reported bug

Studio is a GUI, so an error should almost never reach the user. When a
bug report names one failing operation, don't stop at fixing that case:
run the `bug-sweep` workflow (`.claude/workflows/bug-sweep.js`, args
`{ report, deck?, pr? }`). It reproduces the report against the real
engine, sweeps the same kind of operation across every standard layout,
element and input variant, triages each failure (app bug / test artifact
/ design question / pre-existing flake), and fixes the confirmed ones with
regressions. Design questions it raises go back to the user, not into code.

## Commit granularity

Commit by semantic unit. "Wrote the design rules," "extracted this logic
into a pure function," "added tests" should each be their own commit —
don't bundle everything into one giant commit.

## Pitfalls hit with Tauri (v2 / WKWebView)

- A non-`async` `#[tauri::command]` runs on the UI thread, and while it
  runs the window can't repaint: the frontend's DOM still updates, but
  nothing reaches the screen until the command returns. A slow command
  (`open_deck`'s first render after launch once took ~5s) therefore looks
  like a frozen app, and DOM-based tests — mocked `e2e/` and
  `e2e-tauri/` alike — still pass. Mark slow commands
  `#[tauri::command(async)]`, unless concurrent runs would break shared
  state (`render_draft` updates the `AssetServer`). To check what was
  actually painted, record native frames with tauri-playwright's
  `startRecording`, and keep the window visible — an occluded WKWebView
  may not paint.
- `window.confirm()` / `window.prompt()` aren't reliable on Tauri's
  WKWebView (they can silently behave as if cancelled). Build any
  operation that needs confirmation with the app's own in-app UI rather
  than relying on native dialogs.
- Native HTML5 drag-and-drop (`draggable`, `dragstart`, etc.) is unstable
  on WKWebView. Build reordering UI by hand with
  `mousedown`/`mousemove`/`mouseup` instead (the same pattern as the
  column-resize divider).
- The factory passed to `Builder::menu(factory)` is called **before**
  Tauri's own internally managed state (e.g. `PathResolver`) is
  `manage()`d. Calling an API that depends on managed state here (e.g.
  `app.path()`) panics. Build a placeholder menu with empty data, then
  swap in the real menu via `app.set_menu()` after `setup()` completes
  (see `build_menu`/`build_menu_with_recents` in `src-tauri/src/lib.rs`).
- In dev builds, WKWebView's `isInspectable` defaults to `true`, so the
  native "Inspect Element" menu takes priority regardless of the page's
  own `contextmenu` handling. To make a custom right-click menu work, set
  `"devtools": false` in the window config in `tauri.conf.json`.
- An `<iframe>` grabs right-clicks into its own native context menu
  ("Open Frame in New Window", etc.) even with `pointer-events: none` set
  on it (ordinary clicks/drags pass through correctly) — needs an opaque
  overlay `<div>` (that doesn't kill pointer-events) on top of it so it can
  never become the event target. Likewise, the cursor passing over an
  `<iframe>` during a manual drag stops `mousemove` reaching the parent
  document (a separate browsing context) unless every `<iframe>` gets
  `pointer-events: none` for the drag's duration. Both hit (and were
  worked around) for the per-slide thumbnail/preview-pane/layout-picker
  `<iframe>`s this app used to render slides into — removed in favor of
  Shadow DOM (`dom/slideCanvas.ts`), which doesn't have either problem
  (same document, not a separate browsing context). Relevant again only if
  an `<iframe>` gets reintroduced somewhere.
- Trading that `<iframe>` for Shadow DOM traded away one isolation
  guarantee along with the two problems above: an `<iframe>`'s content is a
  separate document, so nothing about its embedding page's cascade ever
  reached it, but a shadow tree inherits ordinary inherited CSS properties
  (e.g. `text-align`, `color`, `font-family`) straight from its host
  element's computed style, same as any other descendant would. Hit on a
  real device: `SlideList.tsx` mounts a canvas inside a `<button>`, whose
  UA-stylesheet default is `text-align: center`; a deck's `<h1>`/`<ul>`
  inherited it and centered, and since `list-style-position: outside`
  bullet markers aren't subject to `text-align`, each `<li>`'s bullet
  stayed pinned at the far left while its own now-centered text visibly
  detached from it. Fixed by declaring `text-align: left` on `dom/
  slideCanvas.ts`'s shared `:host` rule — reproduced first in an isolated
  page by wrapping a synthetic host in the same `<button><span><span>`
  chain `SlideList.tsx` actually uses, confirming the bug required that
  exact ancestor and vanished once `:host` set its own value (this
  reproduces in any Chromium-family engine, including Playwright's — it
  simply hadn't been exercised with real `<ul>` content before). Any other
  inherited property `.peitho-slide`'s CSS doesn't already pin should be
  treated with the same suspicion.
- macOS 26 (Tahoe) draws a classic `.icns` app icon in a smaller
  "legacy" slot with a glass treatment on top — the icon looks a size
  smaller than its Dock neighbours and flat artwork comes out embossed.
  Only Icon Composer's layered `.icon` format (compiled to `Assets.car`,
  wired via `CFBundleIconName`) is drawn at full size, as authored. Tauri
  CLI 2.11+ accepts an `Assets.car` (or `.icon`) in `bundle.icon`, but
  under the Node CLI its own `actool` run crashes
  ([tauri-apps/tauri#15315](https://github.com/tauri-apps/tauri/issues/15315)),
  so `bun run icons` precompiles `src-tauri/icons/Assets.car` and
  `src-tauri/tauri.macos.conf.json` lists it (a platform config replaces
  the whole `bundle.icon` array, so it repeats the base list). Rendering
  `NSWorkspace.shared.icon(forFile:)` to a PNG shows the glass treatment
  (or its absence) without launching anything, but not the Dock's
  legacy-slot shrink — it drew the old and new bundles the same size —
  so the size has to be checked in the real Dock/Finder.
- On macOS, `onDragDropEvent`'s `position` is labelled `PhysicalPosition`
  but is actually in unzoomed AppKit points. Convert to CSS pixels by
  multiplying by the current window's native `scaleFactor()` and dividing
  by the page's `devicePixelRatio`, which includes webview zoom. Query the
  native factor for each drop so moving between monitors stays correct
  (see `dropPointToCss` in `domain/geometry.ts`).
- State that should differ per window (the open deck, its file watcher,
  its subprocess) must be kept in a map keyed by `window.label()` rather
  than a single global — otherwise a second window silently overwrites
  the first window's state.
- `emit_to` a window label doesn't make an event private to that window: a
  plain `listen()` from `@tauri-apps/api/event` (target `Any`) in *every*
  window still hears it. For an event meant for one window (e.g. the Edit
  menu's `menu:undo`), listen with `getCurrentWebviewWindow().listen()`
  (see `subscribeToThisWindow` in `ipc/deckIpc.ts`).
- To hand a freshly created window "which resource to open," registering
  it in a `Mutex<HashMap<label, T>>` "pending" registry **before** the
  window is created — which the window then pulls out exactly once at
  startup — is simpler and more robust than embedding it in the URL query
  string (see `PendingDecks`/`take_pending_deck`).
- `PredefinedMenuItem::quit` never raises `RunEvent::ExitRequested` on
  macOS: muda implements it as `terminate:` sent straight to NSApp, and tao
  has no `applicationShouldTerminate:`, so the process ends with
  `RunEvent::Exit` only and `api.prevent_exit()` never gets a chance (the
  prepared update was skipped on every Cmd+Q). `ExitRequested` fires only
  for `app.exit()`/`request_exit` and for the last window closing. Quit is
  therefore a plain `MenuItem` (`QUIT_MENU_ID`, `CmdOrCtrl+Q`) whose
  handler calls `app_handle.exit(0)`. Dock "Quit", logout and shutdown
  still go through `terminate:` and can't be held.

## BarefootJS

Use the installed `bf guide` documentation for compiler rules. Before adding
workarounds for a framework bug, reproduce it in a browser. `bf debug graph`
is static analysis; missing tracked dependencies alone do not prove a runtime
failure.

- Keep independent signals per slide key when unrelated rows should not
  update together. A single `Map` or `Record` signal subscribes every reader
  to the whole collection.
- Preserve the identity of shared objects passed to children. A local
  `const` passed as a prop can have its initializer inlined at each read.
  Use a stable accessor for objects such as the shared `CSSStyleSheet`.
- Use `createMemo` or inline JSX expressions for compound values derived
  from props. `const disabled = !props.ready || props.busy` stays frozen
  when used in a native element's attribute on 0.40.2.
- When normalizing an input back to an unchanged signal value, also write
  the canonical value to the input. Equality-based signal updates alone do
  not replace user text such as `000` with `0`.
- Keep StatusBar's error controls mounted and toggle the bar with `hidden`.
  On 0.40.2, mounting that subtree conditionally freezes subsequent
  disabled/hidden updates. The image-layout fix and send-error E2Es cover it.
- Keep CodeMirror hosts mounted when their editor instances must survive
  selection and pane changes. Framework effect cleanup does not manage
  externally created editor instances automatically.

The 0.40.2 audit, the distinction between old warnings and confirmed fixes,
and the browser regression command are in `docs/barefootjs-upgrade.md`.

## Pitfalls hit with UnoCSS (Wind4 preset)

- Bracketed arbitrary-value syntax like `border-[Npx]` gets
  misinterpreted by the UnoCSS Wind4 preset as a border-**color**
  utility, producing invalid CSS
  (`color-mix(in oklab, 6px ..., transparent)`). Use the numeric-scale
  utilities for border width (`border-2`/`border-4`/`border-8`).
- A semi-transparent border color (e.g. `border-foreground/40`) blends
  against the element's own local background if it has an opaque one
  (e.g. `bg-black`) — not against the page's overall background. When the
  color doesn't come out as intended, use an opaque token (e.g.
  `border-muted-foreground`) instead of an alpha-carrying one.
- `inset-0` compiles in UnoCSS to the CSS `inset` shorthand property
  (`inset: calc(var(--spacing) * 0)`), but on the WKWebView this app runs
  in (confirmed via an on-device Cmd+Shift+D debug snapshot), the `inset`
  shorthand itself has no effect: `position: absolute`/`fixed` applies,
  but `top`/`right`/`bottom`/`left` don't apply at all — the absolutely
  positioned element falls back to "unconstrained" (static position,
  intrinsic size; an `<iframe>`'s default 300×150px). Don't use `inset-0`
  — spell out `top-0 right-0 bottom-0 left-0` explicitly (the individual
  physical properties, which have existed since CSS2).
