// The root-cause fix for bug bfa5577: "New Deck" created the folder but
// never navigated to the editor. The old code tracked `deckPath`/
// `isBusy`/`newDeckModalOpen`/`newDeckParentDir`/`newDeckName` as five
// independent signals, and `submitNewDeck` held `isBusy(true)` across a
// call into `loadDeck` (which has its own `isBusy` guard) — so the
// second, nested "am I busy" check silently no-opped the load. This ADT
// makes "created but never actually opened" unrepresentable: `decide`
// only ever transitions `creating` -> `opening` (never straight to
// `open` or back to `welcome`) on a `created` event, so nothing short
// of an explicit `opened`/`failed` event can leave `creating`.

export type DeckLifecycle =
  | { kind: 'welcome' }
  | { kind: 'naming-new-deck'; parentDir: string; name: string }
  | { kind: 'creating'; parentDir: string; name: string }
  | { kind: 'opening'; path: string }
  | { kind: 'open'; deckPath: string }

export type DeckEvent =
  | { type: 'open-requested'; path: string }
  | { type: 'new-deck-requested'; parentDir: string }
  | { type: 'name-changed'; name: string }
  | { type: 'create-confirmed' }
  | { type: 'create-cancelled' }
  | { type: 'created'; path: string }
  | { type: 'opened'; deckPath: string }
  | { type: 'failed'; message: string }

export type Decision =
  | { kind: 'transition'; next: DeckLifecycle; effect?: 'invoke-open' | 'invoke-create' | 'spawn-window' }
  | { kind: 'rejected'; reason: 'busy' | 'already-open' | 'invalid-name' | 'not-applicable' }

/** `true` for the two states an in-flight IPC call owns — the states
 * `isBusy` used to be a sixth, independently-settable signal for.
 * Deriving it from `lifecycle` instead means nothing can leave it stuck
 * `true` (or `false` mid-flight) by forgetting to clear a flag. */
export function isBusy(lifecycle: DeckLifecycle): boolean {
  return lifecycle.kind === 'creating' || lifecycle.kind === 'opening'
}

/** The single state-transition table for the whole deck-opening/
 * creating flow. Every caller (UI event handlers, the async IPC
 * continuations) goes through this — none of them decide `next` for
 * themselves. `open`'s `open-requested` (spawn a second window rather
 * than replacing this one) is modeled for completeness per the ADT, but
 * as of this writing every call site that fires `open-requested` only
 * does so while still `welcome` (the "Open Deck…" button and Recent
 * entries only render there) — native "Open Recent" opens a new window
 * entirely Rust-side and never reaches this at all. */
export function decide(state: DeckLifecycle, event: DeckEvent): Decision {
  switch (state.kind) {
    case 'welcome':
      switch (event.type) {
        case 'open-requested':
          return { kind: 'transition', next: { kind: 'opening', path: event.path }, effect: 'invoke-open' }
        case 'new-deck-requested':
          return { kind: 'transition', next: { kind: 'naming-new-deck', parentDir: event.parentDir, name: '' } }
        default:
          return { kind: 'rejected', reason: 'not-applicable' }
      }
    case 'naming-new-deck':
      switch (event.type) {
        case 'name-changed':
          return { kind: 'transition', next: { ...state, name: event.name } }
        case 'create-confirmed':
          if (state.name.trim() === '') return { kind: 'rejected', reason: 'invalid-name' }
          return {
            kind: 'transition',
            next: { kind: 'creating', parentDir: state.parentDir, name: state.name },
            effect: 'invoke-create',
          }
        case 'create-cancelled':
          return { kind: 'transition', next: { kind: 'welcome' } }
        default:
          return { kind: 'rejected', reason: 'busy' }
      }
    case 'creating':
      switch (event.type) {
        // The bfa5577 fix, encoded as a type: `created` can only ever
        // lead to `opening`, never directly to `open` — there is no
        // `Decision` that skips the open step, so a future edit can't
        // silently reintroduce "created but not opened" by routing
        // around it.
        case 'created':
          return { kind: 'transition', next: { kind: 'opening', path: event.path }, effect: 'invoke-open' }
        case 'failed':
          // Back to naming (not `welcome`) — the modal stays open with
          // the same parentDir/name so the user can see the error and
          // retry without re-picking the folder or retyping the name.
          return { kind: 'transition', next: { kind: 'naming-new-deck', parentDir: state.parentDir, name: state.name } }
        default:
          return { kind: 'rejected', reason: 'busy' }
      }
    case 'opening':
      switch (event.type) {
        case 'opened':
          return { kind: 'transition', next: { kind: 'open', deckPath: event.deckPath } }
        case 'failed':
          return { kind: 'transition', next: { kind: 'welcome' } }
        default:
          return { kind: 'rejected', reason: 'busy' }
      }
    case 'open':
      switch (event.type) {
        case 'open-requested':
          return { kind: 'transition', next: state, effect: 'spawn-window' }
        default:
          return { kind: 'rejected', reason: 'already-open' }
      }
    default: {
      const _exhaustive: never = state
      throw new Error(`Unhandled DeckLifecycle: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
