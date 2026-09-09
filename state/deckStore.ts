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

  return { deckLifecycle, setDeckLifecycle, deckPath, isBusy, newDeckModalOpen, newDeckParentDir, newDeckName }
}
