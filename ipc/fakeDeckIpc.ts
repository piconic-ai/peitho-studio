// In-memory DeckIpc for state-layer tests (see docs/architecture.md's
// "model-based testing" note) — a test supplies just the responses it
// cares about via `overrides`; every call still lands in `calls` so a
// test can assert on what was invoked and with what arguments, without a
// real Tauri window. `emitDeckFileChanged`/`emitMenuNewDeck` let a test
// simulate the Rust side pushing an event.
import type { DeckIpc, DeckSessionInfo, LayoutPreviewsPayload, RenderPayload } from './deckIpc'

export interface RecordedCall {
  method: keyof DeckIpc
  args: readonly unknown[]
}

export interface FakeDeckIpc extends DeckIpc {
  calls: RecordedCall[]
  emitDeckFileChanged(): void
  emitMenuNewDeck(): void
}

const emptyRenderPayload: RenderPayload = {
  manifest: { title: '', slideCount: 0, canvasWidth: 1280, canvasHeight: 720, sections: [], slides: [] },
  fragments: {},
  assetBaseUrl: '',
}

export function createFakeDeckIpc(overrides: Partial<DeckIpc> = {}): FakeDeckIpc {
  const calls: RecordedCall[] = []
  const deckFileChangedListeners = new Set<() => void>()
  const menuNewDeckListeners = new Set<() => void>()

  function record(method: keyof DeckIpc, args: readonly unknown[]): void {
    calls.push({ method, args })
  }

  const base: DeckIpc = {
    devDefaultDeck: async () => { record('devDefaultDeck', []); return null },
    createDeck: async (parentDir, name) => { record('createDeck', [parentDir, name]); return `${parentDir}/${name}/deck.md` },
    openDeckWindow: async path => { record('openDeckWindow', [path]) },
    takePendingDeck: async () => { record('takePendingDeck', []); return null },
    getRecentDecks: async () => { record('getRecentDecks', []); return [] },
    openDeck: async path => {
      record('openDeck', [path])
      const info: DeckSessionInfo = { deckPath: path, deckDir: path, render: emptyRenderPayload }
      return info
    },
    renderDraft: async content => { record('renderDraft', [content]); return emptyRenderPayload },
    readDeckSource: async () => { record('readDeckSource', []); return '' },
    saveDeckSource: async content => { record('saveDeckSource', [content]) },
    previewLayouts: async () => {
      record('previewLayouts', [])
      const payload: LayoutPreviewsPayload = { previews: [], css: '' }
      return payload
    },
    presentDeck: async rehearsal => { record('presentDeck', [rehearsal]) },
    onDeckFileChanged: callback => {
      deckFileChangedListeners.add(callback)
      return () => { deckFileChangedListeners.delete(callback) }
    },
    onMenuNewDeck: callback => {
      menuNewDeckListeners.add(callback)
      return () => { menuNewDeckListeners.delete(callback) }
    },
  }

  return {
    ...base,
    ...overrides,
    calls,
    emitDeckFileChanged: () => { for (const cb of deckFileChangedListeners) cb() },
    emitMenuNewDeck: () => { for (const cb of menuNewDeckListeners) cb() },
  }
}
