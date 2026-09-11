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
refactoring). In-flight migration plans and progress live under `todo/`
(delete once done, or move to `todo/archive/` if it has reference value,
e.g. a record of how a correction was arrived at).

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
  half of `bun run dev`), no Tauri window involved. `welcome.e2e.ts` is a
  bare smoke test with no IPC bridge at all. `e2e/helpers/mockTauri.ts`
  stubs `window.__TAURI_INTERNALS__.invoke` (via `page.exposeFunction`) so
  a test can get past the welcome screen and drive the real frontend
  logic — `domain/slides.ts` run in Node stands in for peitho-core, close
  enough to exercise the app's own reactive/DOM code (this caught and
  fixed a real bug, see `new-slide.e2e.ts`). What it *can't* catch:
  anything that depends on peitho-core's actual output or a real WKWebView
  (rendering fidelity, `adoptedStyleSheets`/`@font-face` support, native
  right-click, drag). Real e2e that drives an actual Tauri window (via
  `tauri-driver`) is still queued in `tmp/todo.md` as a Scope1+ concern;
  until then, the steps for verifying WKWebView-specific behavior on a
  real device are collected in
  `.claude/skills/run-peitho-studio/SKILL.md`.

## Commit granularity

Commit by semantic unit. "Wrote the design rules," "extracted this logic
into a pure function," "added tests" should each be their own commit —
don't bundle everything into one giant commit.

## Pitfalls hit with Tauri (v2 / WKWebView)

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
- State that should differ per window (the open deck, its file watcher,
  its subprocess) must be kept in a map keyed by `window.label()` rather
  than a single global — otherwise a second window silently overwrites
  the first window's state.
- To hand a freshly created window "which resource to open," registering
  it in a `Mutex<HashMap<label, T>>` "pending" registry **before** the
  window is created — which the window then pulls out exactly once at
  startup — is simpler and more robust than embedding it in the URL query
  string (see `PendingDecks`/`take_pending_deck`).

## Pitfalls hit with BarefootJS

- **Keyed `.map()` reuse bug** (reported as
  [piconic-ai/barefootjs#2859](https://github.com/piconic-ai/barefootjs/issues/2859)):
  when rows sharing the same key get reordered, that key's DOM node is
  reused, but a non-signal value captured in the closure at the original
  `.map()` call (e.g. a raw `i` index) does not get updated inside the
  render body. Event handlers are unaffected (since PR #2191 they
  re-derive the index from `data-key` on click), but values used in the
  render body are affected. When you need "this item's current position"
  inside a keyed `.map()`, don't write the raw loop index directly into
  JSX — hold it in a per-key signal instead (see below).
- **Don't hold an entire `Map`/`Record` in a single signal/memo.** A
  design like `createMemo<Map<key, X>>` — holding "the whole collection"
  as one value — subscribes every row that reads it to "the whole
  collection," so every row re-renders whenever any single item changes
  (a source of flicker). Instead, lazily create a `Map<key, [getter,
  setter]>` per key, and in `createEffect` only call the setter for the
  key whose value actually changed (the `fragmentSignal`/`indexSignal`
  pattern — see `state/renderStore.ts`).
- **Make the `.map()` callback an expression body.** Use the
  `(item, i) => (<jsx/>)` form and avoid a block body like
  `{ const x = ...; return <jsx/> }` — a block body is a compile error
  (`BF021`). If you need to derive something from the index, precompute
  it outside the `.map()` with `createMemo`.
- **(Unresolved — watch out)** When JSX uses a chain of ternaries and a
  later branch only becomes visible after a signal transitions from
  `null` to having data post-mount, that branch's contents sometimes
  failed to render (even though the data itself was read correctly).
  Restructuring so the same JSX is mounted from the start fixed it. When
  a specific branch fails to render only after a post-mount state
  transition, suspect this (a chain of ternaries vs. branching at mount
  time) first.
- **(Corrected — see below) Don't jump to "this breaks at runtime" from
  `bf debug graph`'s `(no tracked deps)` alone.** This section used to
  claim two "constraints": that signals/memos break when passed from a
  factory function (the `state/xxxStore.ts` pattern of returning
  `{ x, ... }`), and that they break when read through a helper function.
  Both turned out to be wrong. Reproducing all three patterns exactly as
  used in `domain/drag.ts` (calling a factory's return value from JSX via
  `store.x()`, using multiple memo calls inside a complex expression
  inside `.map()`, and a helper function that reads a memo internally and
  is called from JSX like `helper('cut')`) and actually checking browser
  behavior showed **all three update dynamically, correctly**. `bf debug
  graph` is a compile-time static-analysis result, and BarefootJS has a
  separate dynamic reactivity-tracking mechanism (wrap-by-default), so "a
  dependency the static analysis can't find" doesn't imply "it won't
  update at runtime." What looked broken at the time (the Step 7 drag
  visual effect) was most likely an artifact of a different, later-
  discovered cause (during on-device verification, DevTools' Inspect
  Element mode was still active and clicks weren't reaching the app).
  **Lesson**: `bf debug graph`'s `no tracked deps` is "a lead worth
  digging into," not "proof it's broken." Whether something is actually
  broken should be judged only after checking with `@barefootjs/test` IR
  tests or real-browser verification when in doubt. The only constraint
  actually confirmed to be real is this single one:
  **destructuring a signal's getter out with `const { x } = store` fails
  at runtime with `ReferenceError: Can't find variable: x`** (because the
  compiler's identifier extraction doesn't see through destructuring).
  Receiving it as `const store = createFooStore()` and calling it via the
  property (`store.x()`) is fine.
- **Pass props the called value, not the `Memo<T>` getter itself**
  (`isBusy={isBusy()}`, not `isBusy={isBusy}`). Passing the latter is a
  compiler build error, `BF044` (`Signal/Memo getter passed without
  calling it`) — hit when extracting `components/WelcomeScreen.tsx` by
  typing a prop as `isBusy: Memo<boolean>`. BarefootJS's props
  reactivity follows the same model as SolidJS: `value={count()}` is
  lowered by the compiler into a getter property,
  `{ get value() { return count() } }`. The child reads it directly as
  `props.xxx` (destructuring triggers the `BF043` warning — reactivity is
  lost; if the intent really is to use it once as an initial value, mute
  it explicitly with `@bf-ignore props-destructuring`). This `props.xxx`-
  style read also often doesn't show up in `bf debug graph`'s static
  graph (`no tracked deps`), but per the lesson above, dynamic tracking
  actually updates it correctly — confirmed with Playwright.
- **A `const` local passed as a prop is lowered by *inlining its
  initializer*, not by referencing the binding.** `const x = f(sig());
  <Child p={x}/>` compiles to `get p() { return f(sig()) }` — which is
  exactly right for a derived value (it's how the prop stays reactive),
  and wrong for anything whose initializer *constructs* something: every
  read of `props.p` builds a brand-new instance. Hit when passing a
  shared `CSSStyleSheet` (`createSlideStylesheet(...)`) down to
  `SlideList`: each thumbnail row's `ref` got its own separately-parsed
  sheet, and the `replaceSync` effect updated an object no shadow root
  had adopted, so a theme change would never have reached the mounted
  thumbnails. Verified by reading `dist/assets/components/*.js`. Keep
  such a value behind an accessor (`function getX() { return x }`) and
  pass *that* — a function identifier is passed by reference
  (`get p() { return getX }`), same as any callback prop.
- **A `createEffect` called inside a conditional branch's `ref` leaks one
  effect per re-entry into that branch, forever** (reported as
  [piconic-ai/barefootjs#2927](https://github.com/piconic-ai/barefootjs/issues/2927),
  with a minimal repro and root-cause trace). A branch's compiled
  `bindEvents()` re-runs in full every time the branch is re-entered
  (confirmed in `dist/assets/components/*.js` and
  `@barefootjs/client`'s `runtime/index.js`), but the branch's own cleanup
  is never invoked on re-entry, and `createEffect`'s cleanup doesn't
  re-run on re-execution either — so a `ref={el => createEffect(() =>
  ...)}` inside `cond ? <div ref={...}/> : <other/>` leaves the *previous*
  entry's effect still running against its now-detached `el` every time
  `cond` flips back to true, one more instance per flip, forever (each one
  keeps doing real work — e.g. re-mounting a Shadow DOM canvas — against
  an element nothing references anymore). Confirmed via `SlidePreview.tsx`
  toggling on `selectedSlideKey`. Fix: keep both branches permanently
  mounted and toggle visibility (a `hidden` class) instead of branching —
  same pattern `SlideContextMenu.tsx` already used for an unrelated
  reason. `ref`-scoped effects are otherwise fine (see `SlideList.tsx`'s
  thumbnail row, which mounts unconditionally within its `.map()`); the
  leak is specifically about a `ref` whose *entire host element* is inside
  a branch that unmounts and remounts.

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
