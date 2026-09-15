import { createSignal, createMemo } from '@barefootjs/client'
import { type DeckLifecycle, isBusy as computeIsBusy } from '../domain/deckLifecycle'

/** The whole welcome/new-deck/open flow as one `domain/deckLifecycle.ts` ADT
 * signal, replacing five independently-settable signals (`deckPath`/
 * `isBusy`/`newDeckModalOpen`/`newDeckParentDir`/`newDeckName`) that let bug
 * bfa5577 happen: `submitNewDeck` held `isBusy(true)` across a call into
 * `loadDeck`, whose own separate `isBusy` guard silently no-opped the load,
 * leaving the folder created but the editor never shown. `decide`'s
 * `creating` state can only transition to `opening` (never straight back to
 * `welcome`) on its `created` event, so that failure mode is
 * unrepresentable now.
 *
 * `dispatch`/`runOpen`/`runCreate`/`openDeckInNewWindow` — the functions
 * that actually run `decide` and its IPC effects — stay in `Studio.tsx`
 * rather than living here: they call into `state/renderStore.ts`
 * (`applyRenderPayload`), `refreshSource`, and the notification signals,
 * spanning far more than this store's own state. */
export function createDeckStore() {
  const [deckLifecycle, setDeckLifecycle] = createSignal<DeckLifecycle>({ kind: 'welcome' })
  const deckPath = createMemo(() => {
    const l = deckLifecycle()
    return l.kind === 'open' ? l.deckPath : null
  })
  // Drives which top-level screen Studio.tsx renders — true for `opening`
  // as well as `open`, not just `open`. `dispatch` sets `deckLifecycle` to
  // `opening` synchronously, before ever awaiting `deckIpc.openDeck()`, so
  // switching to the editor shell on this (rather than waiting for
  // `deckPath()`, which only becomes non-null once the deck has actually
  // loaded) makes the screen change happen the instant a click is handled
  // — no perceptible delay for it to cover, so no busy-indicator design is
  // needed on WelcomeScreen for this flow at all. The editor shell itself
  // shows a loading placeholder while `deckPath()` is still null (see
  // Studio.tsx) — this real-device request came directly from a user
  // report that WelcomeScreen's busy feedback wasn't reassuring even once
  // reliably painted (see todo/archive/welcome-open-feels-frozen.md).
  const showEditor = createMemo(() => {
    const k = deckLifecycle().kind
    return k === 'opening' || k === 'open'
  })
  const isBusy = createMemo(() => computeIsBusy(deckLifecycle()))
  const newDeckModalOpen = createMemo(() => {
    const k = deckLifecycle().kind
    return k === 'naming-new-deck' || k === 'creating'
  })
  const newDeckParentDir = createMemo(() => {
    const l = deckLifecycle()
    return l.kind === 'naming-new-deck' || l.kind === 'creating' ? l.parentDir : null
  })
  const newDeckName = createMemo(() => {
    const l = deckLifecycle()
    return l.kind === 'naming-new-deck' || l.kind === 'creating' ? l.name : ''
  })

  return { deckLifecycle, setDeckLifecycle, deckPath, showEditor, isBusy, newDeckModalOpen, newDeckParentDir, newDeckName }
}
