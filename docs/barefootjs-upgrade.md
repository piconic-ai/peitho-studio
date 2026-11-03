# BarefootJS 0.40.2 audit

The six BarefootJS dependencies were updated together from 0.39.1 to 0.40.2.
The browser probes use the published packages, the Vite plugin and CSRAdapter,
and a real Chrome process. They exercise the problematic patterns directly,
without the application's existing workarounds.

## Reproduce the checks

Run `bun run test:barefoot`. It builds a separate fixture under `tmp/`, starts
a server on an available port, and checks the rendered DOM after interaction.
It requires Google Chrome, as the application's Playwright suite does. The
fixtures are separate from the application build and do not ship in the app.

Run `bun run test:barefoot --audit` to include the unguarded object-identity
and composed-const probes. On 0.40.2 it intentionally exits unsuccessfully:
two reads of an object-valued prop produce different objects, and a native
attribute computed from `const disabled = !props.ready || props.busy` stays
frozen. The normal command verifies a stable accessor and createMemo instead.

The final probe fixtures and assertions were run on both versions in separate
installations. The earlier simple alias probe passed on both, but a stronger
composed expression exposed the remaining const-reactivity limitation.
A passing small probe establishes the behavior of that pattern, rather than
every possible combination of components and asynchronous operations.

| Behavior checked without its workaround | 0.39.1 | 0.40.2 |
| --- | --- | --- |
| Nested map attributes and text inside a conditional branch | Fails to update | Pass |
| Row handler stops propagation to its parent | Pass | Pass |
| Keyed row ref runs after leaving and re-entering its branch | Pass | Pass |
| Ref focuses an input on first entry and re-entry | Pass | Pass |
| Branch effects stop after unmount; one effect runs after remount | Pass | Pass |
| Initially absent error renders after a delayed state change | Pass | Pass |
| Nested branch changes from loading to ready | Pass | Pass |
| Conditional text in a child mounted inside a branch | Pass | Pass |
| Destructured store getter updates the DOM | Pass | Pass |
| Keyed row index follows a reorder | Pass | Pass |
| Native attribute derived from a compound local const | Fails | Fails |
| Memo derived from the same compound expression updates a native attribute | Pass | Pass |
| Block-bodied map callback with a local variable | Pass | Pass |
| Getter passed to a child as a callable prop | Pass | Pass |
| Stable accessor preserves an object's identity | Pass | Pass |
| Object-valued const prop preserves identity without an accessor | Fails | Fails |

Only the nested-map comparison demonstrates a fix between these two versions.
The other old warnings were already unsupported by these minimal reproductions
on 0.39.1. They are no longer blanket restrictions in AGENTS.md. Application
regressions remain covered by the existing Playwright tests.

The [0.39.2 compiler release](https://github.com/piconic-ai/barefootjs/releases/tag/%40barefootjs%2Fjsx%400.39.2)
records the nested-map fix, corresponding to
[issue #3274](https://github.com/piconic-ai/barefootjs/issues/3274).
The target release is
[0.40.2](https://github.com/piconic-ai/barefootjs/releases/tag/%40barefootjs%2Fjsx%400.40.2).

## Application changes and retained choices

NewDeckModal now renders both setting groups through a nested map. Its existing
E2E checks cover selected state, creation arguments, failure/retry, cancellation
and reopening, and translated labels. WelcomeScreen and NewDeckModal render
errors conditionally; the existing error-visibility tests still check
that failed operations show their messages. SlideList relies on the row's
stopPropagation instead of filtering the same event in the parent.

The broader application run exposed a remaining branch issue that the small
probes do not reproduce. Conditionally mounting StatusBar makes its descendant
controls stop updating their disabled/hidden attributes after initial display.
Four existing E2Es failed: the pending image-layout button remained enabled,
the refused image-layout action stayed visible, and two send-error scenarios
never switched to the AI-fixing state. StatusBar retains its always-mounted
subtree, with visibility controlled by hidden. Keep the image-slot-layout-fix
and send-build-error-from-error-bar E2Es when changing this subtree.

Shared CSSStyleSheet instances still use a stable accessor. Compound derived
props still use inline expressions or createMemo when passed to native elements.
Per-slide signals still prevent updates from notifying unrelated rows. Input canonicalization
still writes the DOM value when normalization leaves the signal unchanged.
CodeMirror hosts still remain mounted to preserve externally owned editor
instances. None of these choices is removed merely because branch handling
passes the browser probes.

This audit does not verify native WKWebView behavior. The Tauri/WKWebView and
UnoCSS cautions in AGENTS.md remain in place.

## Validation

- Type checking and the production build passed.
- All 2,212 unit tests passed.
- The normal browser probe command passed all 14 cases. The audit command
  failed only the two documented raw patterns on 0.40.2. On 0.39.1 it also
  failed the nested-map case.
- The final application E2E run passed 637 cases and timed out in eight.
  A fresh run of those eight passed all of them. Another 136 real-engine
  cases were skipped because this worktree had no engine binary.
- After restoring StatusBar's mounted subtree, all 15 image-layout-fix and
  send-build-error E2Es passed, including the four failed cleanup attempts.
- The cognitive complexity gate passed.
