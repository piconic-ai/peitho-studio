# Frontend architecture principles

An extension of `CLAUDE.md`'s "prefer pure functions" and "distinguish
state by directory/file structure" principles into a more concrete layer
structure, prompted by refactoring the large `components/Studio.tsx`
component. Execution steps and progress live under `todo/` (delete once
done, or move to `todo/archive/`) — this document holds **only permanent
principles and rules**.

## Five-layer structure

A binary of `.ts` = pure / `.tsx` = stateful can't express "a layer that
holds signals but never touches the DOM/IPC" or "a layer that touches the
DOM but holds no signals," and that ends up as pressure to cram
everything into `.tsx`. Split into five layers by directory.

| Directory | Allowed | Forbidden | Testing |
|---|---|---|---|
| `domain/` (`.ts`) | Pure functions, ADTs, transition functions, and example data with no dependencies | `@barefootjs/client`, `@tauri-apps/*`, `document`/`window` | `bun test` (spec / adversarial / property / pairwise) |
| `state/` (`.ts`) | `createSignal`/`createMemo`/`createEffect`/`batch`/`createSelector`, `domain/` | `@tauri-apps/*`, DOM API, JSX | `bun test` + `createRoot` (model-based tests) |
| `ipc/` (`.ts`) | Thin typed wrappers around `invoke`/`listen`/`openDialog`, plus boundary types | Signals, DOM, business logic | Types only. Provide a fake implementation with the same interface for e2e |
| `dom/` (`.ts`) | DOM measurement, style writes, event subscriptions (Shadow DOM canvas mount/scale sync, drag gestures, textarea sync) | Signals, IPC, JSX | Push any formula/calculation part out to `domain/` and test with `bun test`. The rest is covered by IR tests/e2e |
| `components/` (`.tsx`) | JSX + imports from the four layers above. A composition root does only "store creation, IPC/event wiring, and placing children" | Business logic, text manipulation, state-transition decisions | `@barefootjs/test` IR tests + Playwright (with IPC stubs) |

The dependency direction is one-way: `components → state → domain`,
`components → ipc`, `components → dom → domain`. Imports that cross
layers in a forbidden direction are mechanically detected by
`scripts/arch-check.test.ts` (fails if `domain/` has `@tauri-apps`, fails
if `components/` writes `invoke(` directly, etc.).

## What doesn't fit the five-layer model: "orchestration"

Even after extracting `Studio.tsx` down to the four `state/` stores
(`deckStore`/`renderStore`/`editorStore`/`uiStore`, Step 20), roughly 600
lines — things like `commitChange`/`selectSlide`/`handleSave`/
`refreshSource`/`addSlide`/`reorderSlides` — remained in `Studio.tsx`. By
the table's principle, a composition root should do only "store creation,
IPC/event wiring, and placing children," and these clearly look like
"business logic, text manipulation, state-transition decisions." They
didn't remain because there was nowhere to delegate them to — the actual
reason, discovered while implementing this, is that **they remained
because there is nowhere in these five layers they could go**:

- Can't go in `domain/` — it includes IPC calls, so it's impure.
- Can't go in `state/` — its allowed dependency direction is only
  `state → domain`, which doesn't permit a dependency on `ipc/`
  (`commitChange` calls `deckIpc.renderDraft`/`saveDeckSource`).
- Can't go in `ipc/` — it carries business logic beyond the scope of a
  typed wrapper (resolving a `SelectionPlan`, calling
  `reconcileAfterCommit`, etc.).
- Can't go in `dom/` — it entangles both DOM manipulation
  (`syncEditorFields`) and IPC calls, and `dom/` doesn't permit IPC.

In other words, "a procedure that crosses multiple state stores, calls
IPC, and sometimes touches the DOM too" demands **one more, unnamed place
to live** in this four-layers-plus-composition-root design. For now the
decision was to leave this as-is inside `components/Studio.tsx`
(introducing a new layer would be a design change beyond this
refactoring's scope) — but it's worth recording as fact that the table's
principle of "a composition root does only store creation, wiring, and
placement" was not, in fact, achieved as stated. If this line count is
trimmed further in the future, there are two options:

1. Add one explicit "orchestrator" layer, extending the dependency
   direction to `components → orchestrator → {state, ipc, dom}`.
2. Inject into each store a dependency on the IPC operations it should
   call itself (like `createDeckStore(deckIpc)`) — though this would be
   a decision to change the current principle itself that "state doesn't
   depend on ipc."

Neither was chosen this time; the status quo stands, with `Studio.tsx`
serving both roles — "composition root" and "orchestration" — at once.

## Invariants BarefootJS's constraints impose on the layer structure

(See `CLAUDE.md`'s "Pitfalls hit with BarefootJS" for details on each
individual pitfall. This section only covers how they influenced this
layer structure's **design decisions**.)

- **The Context API can't cross files** (`createContext()` produces a
  different Symbol per bundle), so it isn't used. Parent → child is
  **props**; child → parent is **callback props**.
- **A child never receives a setter.** It only receives a callback
  describing "what happened" (`onSelect(i)`, not `setSelectedIndex`).
  This confines which function writes which signal to a single place —
  the store — preventing an implicit contract from scattering across
  multiple locations.
- **Pass a read-only prop the called value, not the `Memo<T>` getter
  itself** (`isBusy={isBusy()}`, not `isBusy={isBusy}`) — the latter is a
  compiler build error, `BF044` (`Signal/Memo getter passed without
  calling it`). BarefootJS's props reactivity follows the same model as
  SolidJS: `value={count()}` is lowered into a getter property,
  `{ get value() { return count() } }`. The child reads it directly as
  `props.xxx` (destructuring triggers the `BF043` warning — mute it
  explicitly with `@bf-ignore props-destructuring` if the intent really
  is to use it once as an initial value). `bf debug graph` often doesn't
  put a `props.xxx`-style read's dependency on the static graph (`no
  tracked deps`), but as with other `no tracked deps` cases, dynamic
  tracking (wrap-by-default) actually updates it correctly — confirmed
  on a real device (Playwright) when extracting
  `components/WelcomeScreen.tsx`.
- **`Map`/`Set`/`Function` types can't be passed as props** (BF049).
  Instead of passing a collection, pass an accessor function like
  `(key) => Getter`.
- **JSX can't be written inside a local function** (BF045). You can't
  split things out in the shape of "a render helper function containing
  JSX." Splitting must always be done with a real subcomponent.
- **Don't rely on a single module-scope signal.** Each `.tsx` is an
  independent build chunk, so state sharing calls a factory at the
  composition root, and tests also explicitly own/dispose it via
  `createRoot`.
- **Don't destructure a signal's getter out with `const { x } =
  store`** (BarefootJS's compiler identifier extraction doesn't see
  through destructuring, so `x` is treated as an "undeclared variable"
  and throws a runtime `ReferenceError` — the factory shape in
  `state/xxxStore.ts` returning `{ draggedIndex, ... }` is itself fine.
  Confirmed, by reproducing it exactly as implemented in `domain/drag.ts`,
  that receiving it as `const store = createXxxStore()` and calling it
  via the property on the JSX side, `store.draggedIndex()`, works
  correctly — note that this section once mistakenly stated the opposite
  lesson here, that "going through a factory breaks it." In reality,
  dynamic reactivity tracking (wrap-by-default) covers a wider range than
  `bf debug graph`'s static analysis (which can report `no tracked
  deps`) — don't jump straight to "this breaks on a real device" from
  `bf debug graph`'s output alone; when in doubt, actually run it in a
  browser and check).
- **When splitting a keyed `.map()`'s row out into a child component,
  verify the freshness of the `index` prop with a spike before settling
  on the split** (because of past closure-staleness bugs, #2859/#2861).
- **Don't write view switching as nested ternaries** (a breeding ground
  for the unresolved rendering bug above). Write it as sibling standalone
  conditions (lining up `{kind() === 'x' ? <X/> : null}`) or as permanent
  mounting + a `hidden` class toggle.

## State flow: ADT → store → memo projection → props

The tension between "wanting to represent state as a single ADT in one
place" and "holding a collection/composite value in one signal causes
every row that reads it to re-render" is resolved by splitting the
roles: **the ADT is the source of truth on the logic side, subscription
happens on the projection side**.

```
domain/drag.ts        DragState (ADT, single value)  ← pure transitions: arm/move/dropTarget/cancel
        ↓
state/uiStore.ts      const [drag, setDrag] = createSignal<DragState>({kind:'idle'})
                       const draggedIndex = createMemo(() => drag().kind === 'dragging' ? drag().index : null)
                       const isDragged    = createSelector(draggedIndex)
        ↓
components/SlideList   Rows subscribe only to isDragged(i) → unrelated changes (e.g. dragDeltaY) don't trigger re-evaluation
```

`createMemo` compares its output with `Object.is` before notifying, so
even when only part of the ADT changes, the notification doesn't
propagate to unrelated projection memos.

## Eliminating unrepresentable states with ADTs

"Impossible combinations" that the types can still express (e.g.
`selectedIndex === null` while `bodyDraft !== ''`, or `layoutPickerOpen`
able to open even on a right-click over blank space) always arise when
state is held as the cartesian product of several independent
signals/fields. Enumerate only the "states that can actually occur" with
a discriminated union (an ADT), and enforce transition exhaustiveness at
compile time with a `switch`'s `_exhaustive: never`.

```ts
// Bad: the cartesian product of 5 independent fields (2^5 — only a
// small fraction can actually occur)
interface State { open: boolean; loading: boolean; index: number | null; ... }

// Good: enumerate only the states that can occur
type EditorSession =
  | { kind: 'none' }
  | { kind: 'editing'; index: number; saved: SlideFields; draft: SlideFields }
```

Adding a new state/operation is closed to three steps: "add one ADT
variant" → "the exhaustiveness check flags the unhandled spot as a
compile error" → "add one example test." This is the practical form of
the open-closed principle.

## Examples by Specification / Given-When-Then

- Examples live as **data** in `domain/<module>.examples.ts` (not a test
  file). This is the single source of truth for functional
  requirements.
- `<module>.test.ts` runs those examples through `test.each` (the
  runner). Keep the existing `test('spec: ...')` /
  `test('adversarial: ...')` naming as-is, and prefix example-derived
  tests with `example: ...`.
- Any example that can't be automated must carry `manual: { reason }`. A
  test checks that no example exists that is neither "automated" nor
  "manual with a reason."
- `*.spec.ts` isn't used (`bun test` would pick it up, creating a
  duplicate convention alongside `*.test.ts`). Keeping example data
  separated into a non-test file also lets it be reused as input for
  documentation generation.

The DSL and concrete examples are introduced in the execution plan under
`todo/`, or as `domain/spec.ts` at implementation time.

## Approach to bug discovery

Invest maximally in automated tests (minimize manual verification since
it undermines an AI agent's autonomy).

- **Adversarial tests**: build a catalog of nasty values per type (empty
  strings, HTML/XSS-like strings, emoji/surrogate pairs, boundary-value
  indices, etc.) and verify, via OFAT (swapping one value at a time),
  that it "doesn't crash" and "satisfies its invariants."
- **Pairwise tests**: apply to decision functions involving three or
  more independent axes (e.g. selection follow-up after a commit,
  context-menu enabled/disabled determination).
- **Property-based tests** (`fast-check`, runs as-is under `bun test`):
  used for things better stated as a "property" than as individual
  examples — e.g. round-trip identity for parse/serialize functions, or
  transformation invariants (count preservation, multiset preservation).
- **Model-based tests** (`fast-check`'s `commands`): the `state/` layer's
  state transitions are closed over reading/writing signals and have no
  external dependency on the DOM/IPC (they can be reproduced
  deterministically with `createRoot`), so they can be model-tested the
  same way as a pure reducer. Both of the two most recent bugs were
  caused by "a combination of operation-sequence order and in-flight
  state," so this pays off well.
- **Exhaustive/coverage tests**: when a transition function's (e.g.
  `decide`) state × event cartesian product fits within a realistic
  number (on the order of dozens), enumerate every combination and check
  that it "always returns a valid result" (never throws or returns
  `undefined`).
- **IR tests** (`@barefootjs/test`): compile every `.tsx` and pin down
  zero diagnostics, the signal list, and event wiring as code. Catches
  regressions against BarefootJS's compiler constraints (BF021/BF045/
  BF049, etc.) in CI.
- **Architecture tests**: mechanically forbid imports that cross the
  layers described above.

Lower-priority techniques that have been adopted (e.g. mutation testing)
and the contents of individual adversarial-value catalogs live in the
relevant `domain/*.ts`/`*.test.ts` file itself at implementation time
(not duplicated in this document).

## What has to be verified manually

Textarea sync during IME composition, WKWebView's handling of a slide
canvas's shadow root (`@font-face` registration, `adoptedStyleSheets`,
`border-radius` clipping a scaled child), native dialogs, dragging while
focus is lost, a pending deck across multiple windows, launching `peitho
present` — these can only be confirmed with a real Tauri window. Log
them as examples carrying `manual: { reason }`, and see
`.claude/skills/run-peitho-studio/SKILL.md` for the verification steps.
