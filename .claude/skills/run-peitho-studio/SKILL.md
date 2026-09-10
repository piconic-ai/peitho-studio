---
name: run-peitho-studio
description: Launch the Peitho Studio Tauri desktop app and drive its native window with GUI automation (osascript/System Events/cliclick) to manually verify a change end-to-end. Use before claiming a frontend/Rust fix works, when browser-only e2e (e2e/*.e2e.ts) can't reach past the welcome screen.
---

# Running Peitho Studio on a real device to verify a change

`e2e/*.e2e.ts` is a smoke test against a plain browser with no Tauri IPC,
so it can't verify anything past the Welcome screen (opening/editing a
deck, etc.) — see the comment in `e2e/welcome.e2e.ts`. Verifying anything
past that point requires actually launching a real Tauri native window
and driving it via GUI. There's no real e2e via `tauri-driver` yet (see
"e2e is wanted too, but it's fine to get there incrementally" in
`CLAUDE.md`), so this procedure substitutes for now.

## 0. Preflight check — is the user already running it?

Always check before launching `tauri dev` yourself.

```bash
lsof -i :3003 -sTCP:LISTEN
ps aux | grep -iE "tauri dev|target/debug/app" | grep -v grep
```

- If it's already running (the user's own dev session), verify against
  that window. Launching a new one doesn't just fail with `EADDRINUSE`
  (port 3003 conflict) — it can also leave an orphaned Rust process
  behind with the frontend build in a failed state (killing `tauri dev`'s
  child process doesn't kill the native window binary itself,
  `target/debug/app`, which survives). If you notice a duplicate launch,
  identify and kill only the one you started by its launch time — don't
  take down the user's existing process.
- GUI automation (mouse movement/clicks) steals OS-wide focus. Keep in
  mind the user may be working concurrently in another window/session —
  if in doubt, check a screenshot of the current state before proceeding.
- **(Unresolved — watch out) In an environment with multiple desktops
  (Mission Control Spaces), `osascript`'s `set frontmost` or `cliclick`'s
  coordinate clicks can land somewhere other than the desktop just
  confirmed via screenshot.** An actual incident: after specifying a PID
  with `set frontmost` and confirming via screenshot that it had
  successfully switched to the desktop with Peitho Studio alone, the very
  next `cliclick` landed, for some reason, on a completely different app
  on a different desktop (the user's other session), opening its context
  menu there. The following `Escape` keystroke then moved focus to yet
  another window (the terminal this very agent was running in). If you
  hit this untrustworthy state — "what the last screenshot showed" no
  longer matching "where the next action actually lands" — don't keep
  pushing more coordinate-based actions; stop and hand it back to the
  user (switch to having the user verify by hand, or if trying again,
  avoid Cmd+Tab/Mission Control operations next time and keep focus
  pinned). The root cause hasn't been identified — some mismatch between
  `osascript`'s cross-Spaces `frontmost` setting and the actual pointer
  coordinate system is suspected but unverified.

## 1. Launch

```bash
cd /Users/kfly8/src/github.com/piconic-ai/peitho-studio
nohup bunx tauri dev > /tmp/tauri-dev.log 2>&1 &
```

Launch is done once `[build] ... Running target/debug/app` appears in the
log (a cargo build runs on the first launch or after a Rust-side change,
taking tens of seconds to a few minutes; a frontend-only change hits the
cache and takes a few seconds).

Identify the native window's PID (the process name is `app`, per
`[package] name = "app"` in Cargo.toml):

```bash
ps aux | grep -i "target/debug/app" | grep -v grep
```

## 2. Bring the window to the front and screenshot it

```bash
osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is <PID>) to true'
screencapture -x <path>.png
```

Check the state by viewing the screenshot with the Read tool.

## 3. Clicks have to be coordinate-based (the AX tree doesn't work)

Getting UI elements via the accessibility tree — something like `tell
application "System Events" to tell (first process whose unix id is
<PID>) to get name of every button of window 1` — doesn't work on this
WKWebView-based Tauri window: `count of windows` returns **0** (this
approach would normally work on a regular native app, so suspect this
first when stuck). Give up on clicking by button name and click by
coordinate with `cliclick` instead.

Coordinate conversion (`screencapture` uses physical pixels;
`cliclick`/`osascript` click coordinates use logical points):

```bash
system_profiler SPDisplaysDataType | grep -i resolution   # physical resolution (e.g. 5120x2880)
osascript -e 'tell application "Finder" to get bounds of window of desktop'  # logical resolution (e.g. 0,0,2560,1440)
```

Since the Read tool shows the screenshot scaled down, converting its
displayed coordinates `(dx, dy)` to the real click coordinates:

```
point_x = dx * (logical resolution width / displayed image width)
```

Example: physical 5120, displayed 2000, logical 2560 → the ratio is
`2560/2000 = 1.28`.

```bash
cliclick c:<point_x>,<point_y>
```

Always confirm the result with a screenshot after clicking before moving
on — an off-target coordinate is otherwise hard to notice as a failure.

## 4. Route text input through the clipboard — IME mangles it otherwise

With a Japanese IME enabled, using `System Events`'s `keystroke
"some/path"` gets treated as conversion candidates and garbled, even for
a string that's plain ASCII (this happened even with not a single
Japanese character in the path).

```bash
printf '%s' "$TEXT" | pbcopy
osascript -e 'tell application "System Events" to keystroke "v" using {command down}'
```

Confirm via screenshot that the field is actually focused (the cursor is
blinking) before pasting — if the click coordinate was off and focus
never landed there, pasting does nothing.

## 5. Enter a path directly in the native file picker dialog

The native dialog opened by `openDialog({ directory: true })` accepts a
direct path via `Cmd+Shift+G` (Go to Folder). Enter text through the
clipboard as above. It doesn't always take effect on the first try, so
after entering it, check via screenshot whether the dialog's title bar
(current folder name) updated and the "Open" button is enabled; if not,
redo it via `Cmd+Shift+G`.

## 6. When the app's own context menu/keyboard shortcuts don't respond to `cliclick`

Clicking an item in the app's own right-click menu (New Slide/Delete/
Change Layout, etc.) with `cliclick c:x,y` sometimes just closes the menu
without the action firing. Selecting via arrow keys + Enter, or sending
the `Delete`/`Fn+Delete` key directly, failed the same way (the
observed behavior was that the keystroke reached the document behind the
menu instead of the frontmost menu, only moving the slide selection).

Isolation/verification steps:

1. Temporarily flip `"devtools": false` to `true` in `tauri.conf.json`
   and restart `tauri dev` (turning CLAUDE.md's "in dev builds, devtools
   = true makes the native element-inspection menu take priority" to
   your advantage here).
2. Right-click blank space → choosing "Inspect Element" opens the Web
   Inspector. If the selected element is inside the slide preview
   `<iframe>`, though, you need to switch the context indicator at the
   bottom right of the Console panel (`about:srcdoc`) to `localhost`
   before you can reference the main document's globals
   (`document`/`window`).
3. Type JS directly into the Console and synthesize mousedown/mousemove
   via `dispatchEvent` to check whether the logic itself works (this
   separates an implementation bug from a limitation of the automation).
   Pasting multi-line code via `pbcopy` turns newlines into spaces and
   causes a syntax error, so join it into one `;`-separated line.
   Example:
   ```js
   (() => { const row = document.querySelectorAll('[data-slide-row]')[0]; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, button: 0 })); return document.body.style.cursor; })()
   ```
4. **Key finding**: when it works correctly via `dispatchEvent` but not
   with a physical `cliclick` click, the cause turned out not to be the
   logic but **the Web Inspector's "Inspect Element" selection mode being
   left active**. Closing the DevTools panel via the close button (×) at
   its top left and retrying the same `cliclick` action then worked
   correctly (the physical mouse event was apparently being captured by
   element-selection mode instead of reaching the app's own `mousedown`
   handler). Once done verifying with DevTools, always close the panel
   before the next `cliclick` action.
5. Once verification is done, flip `"devtools"` back to `false` in
   `tauri.conf.json` — the app's own right-click menu stops working while
   it's `true`, so don't commit it that way.

## 7. Cleanup

Once verification is done, explicitly `kill` the `tauri dev` you started
and its child processes (`concurrently`, `vite build --watch`, `unocss
--watch`, `tsx watch server.ts`, `target/debug/app`). Cross-check launch
times via `ps aux` so you don't accidentally kill a process the user
already had running. Also delete any deck folder created for testing.

```bash
lsof -i :3003 -sTCP:LISTEN   # final check that the port was freed
```
