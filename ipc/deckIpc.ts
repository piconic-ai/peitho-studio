// Typed boundary around every Tauri command/event Studio.tsx talks to (see
// src-tauri/src/peitho.rs for the Rust side — 11 #[tauri::command]s + the
// `deck-file-changed`/`menu:new-deck` events emitted from lib.rs). Per
// docs/architecture.md's layering: this is the ONLY module allowed to
// import `@tauri-apps/*`; components/state call through the `DeckIpc`
// interface so they can run against `fakeDeckIpc.ts` in tests/e2e instead.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface ManifestSlide {
  index: number
  key: string
  src: string
  hasNotes: boolean
  skip: boolean
  revealSteps: number
  text: { title: string; body: string; code: string }
}

export interface ManifestSection {
  name: string
  startIndex: number
  endIndex: number
  plannedDurationMs: number
}

export interface Manifest {
  title: string
  slideCount: number
  canvasWidth: number
  canvasHeight: number
  sections: ManifestSection[]
  slides: ManifestSlide[]
}

export interface RenderPayload {
  manifest: Manifest
  fragments: Record<string, string>
  assetBaseUrl: string
}

export interface DeckSessionInfo {
  deckPath: string
  deckDir: string
  render: RenderPayload
}

export interface LayoutPreview {
  name: string
  fragment: string
}

export interface LayoutPreviewsPayload {
  previews: LayoutPreview[]
  css: string
}

/** A subscription's teardown, made synchronous — `listen()` itself
 * resolves asynchronously to an unlisten function, but every caller here
 * wants to register it once (in `onMount`) and tear it down once (in
 * `onCleanup`) without juggling that promise itself. */
export type Unsubscribe = () => void

export interface DeckIpc {
  devDefaultDeck(): Promise<string | null>
  createDeck(parentDir: string, name: string): Promise<string>
  openDeckWindow(path: string): Promise<void>
  takePendingDeck(): Promise<string | null>
  getRecentDecks(): Promise<string[]>
  openDeck(path: string): Promise<DeckSessionInfo>
  renderDraft(content: string): Promise<RenderPayload>
  readDeckSource(): Promise<string>
  saveDeckSource(content: string): Promise<void>
  previewLayouts(): Promise<LayoutPreviewsPayload>
  presentDeck(rehearsal: boolean): Promise<void>
  onDeckFileChanged(callback: () => void): Unsubscribe
  onMenuNewDeck(callback: () => void): Unsubscribe
}

function subscribe(event: string, callback: () => void): Unsubscribe {
  const unlisten = listen(event, () => { callback() })
  return () => { void unlisten.then(stop => { stop() }) }
}

export function createTauriDeckIpc(): DeckIpc {
  return {
    devDefaultDeck: () => invoke('dev_default_deck'),
    createDeck: (parentDir, name) => invoke('create_deck', { parentDir, name }),
    openDeckWindow: path => invoke('open_deck_window', { path }),
    takePendingDeck: () => invoke('take_pending_deck'),
    getRecentDecks: () => invoke('get_recent_decks'),
    openDeck: path => invoke('open_deck', { path }),
    renderDraft: content => invoke('render_draft', { content }),
    readDeckSource: () => invoke('read_deck_source'),
    saveDeckSource: content => invoke('save_deck_source', { content }),
    previewLayouts: () => invoke('preview_layouts'),
    presentDeck: rehearsal => invoke('present_deck', { rehearsal }),
    onDeckFileChanged: callback => subscribe('deck-file-changed', callback),
    onMenuNewDeck: callback => subscribe('menu:new-deck', callback),
  }
}
