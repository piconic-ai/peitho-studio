# BarefootJS 0.40.2 browser reproductions

These standalone CSR reproductions need Bun and Google Chrome. They do not
need Peitho Studio, Tauri, or a rendering engine. All framework versions are
pinned in package.json and bun.lock.

```sh
bun install --frozen-lockfile
bun run verify
```

The verification builds the fixtures, starts a server on an available port,
launches Chrome through Playwright, and checks the actual rendered DOM.
It exits with code 1 for the two reproduced bugs. It writes results.json
and preserves readable generated JavaScript under dist/assets/.

Each case can also run alone:

```sh
bun run verify Fragment
bun run verify Element
bun run verify Hidden
bun run verify ObjectIdentity
bun run verify StableIdentity
```

The first and fourth commands fail; the other three pass on the pinned
packages. No page errors were emitted in any case.

| Case | Actual result | Expected result |
| --- | --- | --- |
| Fragment | State text changes to busy; disabled stays false, hidden stays absent | disabled=true, hidden present |
| Element | State and both attributes update | Same |
| Hidden | State and both attributes update | Same |
| ObjectIdentity | different | same |
| StableIdentity | same | same |

Fragment differs from Element only in its root wrapper. Hidden keeps the
Fragment root and replaces the conditional with the hidden attribute.
The fragment failure also occurred when the branch was initially absent
and then entered, and when the affected Fragment was a child with props.
Neither props nor delayed mounting is required by the final reproduction.

ObjectIdentity has no reactive state and uses an object literal directly.
The compiler emits a child prop getter that returns a fresh { n: 1 } on each
read. StableIdentity passes an accessor that returns the original object.

The other investigated concern, compound computed locals such as
`const disabled = !props.ready || props.busy`, is documented behavior.
`bf guide props-reactivity` says computed locals are evaluated once and
recommends createMemo or inline JSX. It is not reported as a framework bug.

Observed with @barefootjs/client, @barefootjs/jsx, and @barefootjs/vite 0.40.2,
Vite 6.4.3, TypeScript 5.9.3, Playwright 1.63.0, Bun 1.3.5, and Google Chrome
156.0.8078.80 on macOS arm64.
