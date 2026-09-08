// Given-When-Then example specs — see docs/architecture.md's "Examples by
// Specification" section for the rationale. An Example is DATA, not a test:
// it lives in `<module>.examples.ts` next to the module it documents, and
// is the single source of truth a human reads to understand the module's
// behavior. `<module>.test.ts` runs it (`test.each(examples.automated)`);
// see slides.test.ts's `test('spec: ...')`/`test('adversarial: ...')`
// naming for the sibling conventions an `example: ...`-prefixed test sits
// alongside.
//
// Every example is either automated or carries a `manual` reason — there
// is no third, silently-unverified state. `requireExhaustive` below is
// what a module's test file asserts to enforce that.

export interface Example<S, E, R = S> {
  /** Stable id — survives reordering, used to point at a specific example
   * from a bug-regression commit message or a quarantine note. */
  id: string
  given: string
  when: string
  then: string
  state: S
  event: E
  expect: R
  /** Present only when this example cannot be asserted by `bun test` —
   * e.g. it depends on a real Tauri window/WKWebView. The reason is what
   * turns "manual" into an intentional, reviewable decision rather than a
   * gap nobody noticed. */
  manual?: { reason: string }
  tags?: readonly ('bug-regression' | 'boundary' | 'pairwise')[]
}

export interface ExampleSet<S, E, R = S> {
  subject: string
  all: readonly Example<S, E, R>[]
  automated: readonly Example<S, E, R>[]
  manual: readonly Example<S, E, R>[]
}

export function defineExamples<S, E, R = S>(
  subject: string,
  cases: readonly Example<S, E, R>[],
): ExampleSet<S, E, R> {
  return {
    subject,
    all: cases,
    automated: cases.filter(c => !c.manual),
    manual: cases.filter(c => c.manual !== undefined),
  }
}

/** Every example in the set is accounted for as either automated or
 * explicitly manual — asserted by each module's own test file so a new
 * example can't quietly skip both. */
export function isExhaustivelyAccountedFor<S, E, R>(set: ExampleSet<S, E, R>): boolean {
  return set.all.length === set.automated.length + set.manual.length
}
