// Typed boundary around every Tauri command/event Studio.tsx talks to (see
// src-tauri/src/peitho.rs for the Rust side — 12 #[tauri::command]s + the
// `deck-file-changed`/`menu:new-deck`/`menu:undo`/`menu:redo`/`present-ready`
// events emitted from lib.rs/edit_menu.rs/peitho.rs). Per
// docs/architecture.md's layering: this is the sanctioned door for
// `@tauri-apps/api/core`(`invoke`)/`.../event`(`listen`) — enforced by
// `scripts/arch-check.test.ts`'s `components/` rule — so components/state
// call through the `DeckIpc` interface and can run against
// `fakeDeckIpc.ts` in tests/e2e instead. `@tauri-apps/plugin-dialog` and
// `@tauri-apps/api/window` are a separate, not-yet-covered concern —
// `components/Studio.tsx` still imports those directly for the
// welcome-screen/window flows this module doesn't touch yet.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { DeckVariant } from '../domain/deckVariants'
import type { RenderPayload } from '../domain/render'
import type { LayoutVerdict } from '../domain/layoutFit'

export type { DeckVariant } from '../domain/deckVariants'
export type { Manifest, ManifestSection, ManifestSlide, RenderPayload } from '../domain/render'
export type { LayoutVerdict } from '../domain/layoutFit'

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
  /** The open deck's same-base siblings (`deck.md`, `deck.ja.md`, ...),
   * itself included — see `list_deck_variants` in peitho.rs. */
  listDeckVariants(): Promise<DeckVariant[]>
  previewLayouts(): Promise<LayoutPreviewsPayload>
  /** Which of the deck's layouts the slide at `slideIndex` of `content`
   * fits — `null` when there is no such slide to judge (out of range, or a
   * draft). Rejects when `content` doesn't parse. See
   * `engine::layout_fit` in src-tauri. */
  checkSlideLayouts(content: string, slideIndex: number): Promise<LayoutVerdict[] | null>
  presentDeck(rehearsal: boolean): Promise<void>
  onDeckFileChanged(callback: () => void): Unsubscribe
  onMenuNewDeck(callback: () => void): Unsubscribe
  /** Edit > Undo (or its Cmd+Z accelerator), sent only to the focused
   * window — see `src-tauri/src/edit_menu.rs`. The menu item replaced the
   * native one, so the text fields' own undo also arrives here. */
  onMenuUndo(callback: () => void): Unsubscribe
  /** Edit > Redo (or Cmd+Shift+Z); see `onMenuUndo`. */
  onMenuRedo(callback: () => void): Unsubscribe
  /** Fires once the `peitho present` subprocess `presentDeck` launched has
   * actually rendered the deck and started serving it — see
   * `watch_present_readiness` in peitho.rs. Much closer to "the
   * presentation is really up" than `presentDeck`'s own resolution, which
   * only means the subprocess was spawned. */
  onPresentReady(callback: () => void): Unsubscribe
  /** Fires if the `peitho present` subprocess exits (or is otherwise heard
   * from) without ever signaling readiness — the message is its captured
   * stderr (e.g. `--rehearsal` rejected on a deck with no agenda
   * sections). See `watch_present_failure` in peitho.rs. */
  onPresentFailed(callback: (message: string) => void): Unsubscribe
}

function subscribe(event: string, callback: () => void): Unsubscribe {
  const unlisten = listen(event, () => { callback() })
  return () => { void unlisten.then(stop => { stop() }) }
}

/** Like `subscribe`, but only for events sent to this window. A plain
 * `listen()` also hears events `emit_to` sends to *another* window. */
function subscribeToThisWindow(event: string, callback: () => void): Unsubscribe {
  const unlisten = getCurrentWebviewWindow().listen(event, () => { callback() })
  return () => { void unlisten.then(stop => { stop() }) }
}

function subscribeWithPayload<T>(event: string, callback: (payload: T) => void): Unsubscribe {
  const unlisten = listen<T>(event, e => { callback(e.payload) })
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
    listDeckVariants: () => invoke('list_deck_variants'),
    previewLayouts: () => invoke('preview_layouts'),
    checkSlideLayouts: (content, slideIndex) => invoke('check_slide_layouts', { content, slideIndex }),
    presentDeck: rehearsal => invoke('present_deck', { rehearsal }),
    onDeckFileChanged: callback => subscribe('deck-file-changed', callback),
    onMenuNewDeck: callback => subscribe('menu:new-deck', callback),
    onMenuUndo: callback => subscribeToThisWindow('menu:undo', callback),
    onMenuRedo: callback => subscribeToThisWindow('menu:redo', callback),
    onPresentReady: callback => subscribe('present-ready', callback),
    onPresentFailed: callback => subscribeWithPayload('present-failed', callback),
  }
}
