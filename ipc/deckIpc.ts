// Typed boundary around every Tauri command/event Studio.tsx talks to (see
// src-tauri/src/peitho.rs for the Rust side — its #[tauri::command]s + the
// `deck-file-changed`/`menu:new-deck`/`menu:undo`/`menu:redo`/
// `menu:deck-setting`/`present-ready`
// events emitted from lib.rs/edit_menu.rs/deck_menu.rs/peitho.rs). Per
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
import type { DeckFileEntry } from '../domain/deckFiles'
import type { DeckSettingsState } from '../domain/deckSettings'
import type { DeckVariant } from '../domain/deckVariants'
import type { NewDeckSettings } from '../domain/newDeckSettings'
import type { RenderOutcome, RenderPayload } from '../domain/render'
import type { LayoutVerdict } from '../domain/layoutFit'
import { unwrapRenderOutcome } from './renderOutcome'

export type { DeckVariant } from '../domain/deckVariants'
export type { Manifest, ManifestSection, ManifestSlide, RenderErrorPayload, RenderOutcome, RenderPayload } from '../domain/render'
export type { LayoutVerdict } from '../domain/layoutFit'

export interface DeckSessionInfo {
  deckPath: string
  deckDir: string
  /** Whether the deck's folder is trusted to run its scripts — see
   * `trust_open_deck` in peitho.rs. */
  trusted: boolean
  /** The deck as rendered on open — or, `failed`, peitho-core's refusal
   * with the deck open all the same, so its source can be fixed in the
   * editor (see `open_deck` in peitho.rs). */
  render: RenderOutcome
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
  /** Creates `<parentDir>/<name>` with `settings` in its frontmatter (only
   * the ones that aren't the default) and returns its `deck.md`'s path. */
  createDeck(parentDir: string, name: string, settings: NewDeckSettings): Promise<string>
  openDeckVariant(path: string): Promise<void>
  takePendingDeck(): Promise<string | null>
  getRecentDecks(): Promise<string[]>
  openDeck(path: string): Promise<DeckSessionInfo>
  /** Renders `content` in memory. Rejects with a `RenderFailure` (its
   * `error` peitho-core's structured refusal, its message the text the
   * error bar shows) when the draft doesn't build — see
   * `ipc/renderOutcome.ts`. */
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
  /** Adds the built-in `title-body-image` layout (and its CSS) to the
   * deck's folder so the slide at `slideIndex` of `content` builds —
   * `content` already re-pins that slide when it was pinned to another
   * layout. Resolves with the deck-relative paths written; rejects, having
   * written nothing, when one of them exists or another slide would stop
   * building. See `engine::image_layout` in src-tauri. */
  addImageLayout(content: string, slideIndex: number): Promise<string[]>
  /** The layout screen's file operations on the deck's own `layouts/` and
   * `css/` — see `engine::layout_files` in src-tauri. Each refuses, having
   * written nothing, when the change would move a slide of `content` (the
   * deck source as the frontend has it) off the layout it builds on.
   *
   * Creates layout `name` from `template` (`null`: blank, otherwise a
   * standard layout's name) and resolves with the name saved. */
  createLayout(content: string, name: string, template: string | null): Promise<string>
  /** Copies layout `name` and resolves with the copy's name. */
  duplicateLayout(content: string, name: string): Promise<string>
  /** Resolves when layout `name` can be deleted once its slides are moved
   * as in `repinned` (`original` with them re-pinned); writes nothing. */
  checkLayoutRemoval(original: string, repinned: string, name: string): Promise<void>
  /** Deletes layout `name`'s files, its slides already moved off it in
   * `content`. */
  deleteLayout(content: string, name: string): Promise<void>
  /** The layout screen's file tree: the deck's `layouts/`, `css/`, `img/`
   * and `fonts/` (`engine::deck_files::list_deck_files`). */
  listDeckFiles(): Promise<DeckFileEntry[]>
  /** The text of `path` — a layout's HTML or a CSS file of the deck — for
   * an editor tab. A layout's own CSS file not there yet reads blank. */
  readDeckFile(path: string): Promise<string>
  /** Layout `name`'s placeholder preview rendered from unsaved `html` and
   * `css` — a side `null` as on disk (its tab isn't open) — writing
   * nothing: the layout editor's live preview. */
  previewLayoutDraft(name: string, html: string | null, css: string | null): Promise<{ fragment: string; css: string }>
  /** Overwrites `path` (a layout's HTML or a CSS file) with `text`; refuses
   * a layout that doesn't parse, and an edit that would stop `content` (the
   * deck source now) from building as it does. Resolves with the layout
   * files' fingerprint once written (`layoutFilesStamp`), so the watcher's
   * report of this write can be told from someone else's. With `base`
   * (what the editor last read or wrote), refuses with
   * `FILE_CHANGED_ON_DISK` (`domain/fileEditor.ts`) when the file no
   * longer holds it. */
  saveDeckFile(content: string, path: string, text: string, base?: string): Promise<string>
  /** A fingerprint of the deck's layout files (`layouts/*.html`,
   * `css/*.css`): it changes when one is added, removed or written — by
   * the Coding Agent, say. */
  layoutFilesStamp(): Promise<string>
  /** Tells this window's close whether the layout editor holds a draft not
   * saved yet: closing then asks for it to be saved first
   * (`onLayoutFlushBeforeClose`). See `report_layout_draft` in peitho.rs. */
  reportLayoutDraft(pending: boolean): Promise<void>
  presentDeck(rehearsal: boolean): Promise<void>
  /** Tells the Edit menu's deck settings what this window's deck holds
   * (checks and current-value labels), shown while this window is in
   * front. See `report_deck_settings` in peitho.rs. */
  reportDeckSettings(settings: DeckSettingsState): Promise<void>
  /** Trusts this window's open deck folder to run scripts, from now on
   * and after a restart. Takes no path: it can only trust the deck
   * already open here. */
  trustOpenDeck(): Promise<void>
  onDeckFileChanged(callback: () => void): Unsubscribe
  /** The deck's layout files (`layouts/*.html`, `css/*.css`) changed on
   * disk — once per burst, this window's deck only, Studio's own writes
   * included. See `watch_layout_dirs` in peitho.rs. */
  onLayoutFilesChanged(callback: () => void): Unsubscribe
  /** This window was asked to close while the layout editor held an
   * unsaved draft (`reportLayoutDraft`): save it, then close again. */
  onLayoutFlushBeforeClose(callback: () => void): Unsubscribe
  onMenuNewDeck(callback: () => void): Unsubscribe
  /** Edit > Undo (or its Cmd+Z accelerator), sent only to the focused
   * window — see `src-tauri/src/edit_menu.rs`. The menu item replaced the
   * native one, so the text fields' own undo also arrives here. */
  onMenuUndo(callback: () => void): Unsubscribe
  /** Edit > Redo (or Cmd+Shift+Z); see `onMenuUndo`. */
  onMenuRedo(callback: () => void): Unsubscribe
  /** A deck-setting item of the Edit menu, sent only to the focused window
   * — see `src-tauri/src/deck_menu.rs`. The payload is unchecked here;
   * read it with `resolveDeckSettingPick`. */
  onMenuDeckSetting(callback: (payload: unknown) => void): Unsubscribe
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

export function subscribe(event: string, callback: () => void): Unsubscribe {
  const unlisten = listen(event, () => { callback() })
  return () => { void unlisten.then(stop => { stop() }) }
}

/** Like `subscribe`, but only for events sent to this window. A plain
 * `listen()` also hears events `emit_to` sends to *another* window. */
export function subscribeToThisWindow(event: string, callback: () => void): Unsubscribe {
  return subscribeToThisWindowWithPayload(event, () => { callback() })
}

/** `subscribeToThisWindow` with the event's payload. */
export function subscribeToThisWindowWithPayload<T>(event: string, callback: (payload: T) => void): Unsubscribe {
  const unlisten = getCurrentWebviewWindow().listen<T>(event, e => { callback(e.payload) })
  return () => { void unlisten.then(stop => { stop() }) }
}

export function subscribeWithPayload<T>(event: string, callback: (payload: T) => void): Unsubscribe {
  const unlisten = listen<T>(event, e => { callback(e.payload) })
  return () => { void unlisten.then(stop => { stop() }) }
}

export function createTauriDeckIpc(): DeckIpc {
  return {
    devDefaultDeck: () => invoke('dev_default_deck'),
    createDeck: (parentDir, name, settings) =>
      invoke('create_deck', { parentDir, name, aspectRatio: settings.aspect_ratio, lang: settings.lang }),
    openDeckVariant: path => invoke('open_deck_variant', { path }),
    takePendingDeck: () => invoke('take_pending_deck'),
    getRecentDecks: () => invoke('get_recent_decks'),
    openDeck: path => invoke('open_deck', { path }),
    renderDraft: async content => unwrapRenderOutcome(await invoke<RenderOutcome>('render_draft', { content })),
    readDeckSource: () => invoke('read_deck_source'),
    saveDeckSource: content => invoke('save_deck_source', { content }),
    listDeckVariants: () => invoke('list_deck_variants'),
    previewLayouts: () => invoke('preview_layouts'),
    checkSlideLayouts: (content, slideIndex) => invoke('check_slide_layouts', { content, slideIndex }),
    addImageLayout: (content, slideIndex) => invoke('add_image_layout', { content, slideIndex }),
    createLayout: (content, name, template) => invoke('create_layout', { content, name, template }),
    duplicateLayout: (content, name) => invoke('duplicate_layout', { content, name }),
    checkLayoutRemoval: (original, repinned, name) => invoke('check_layout_removal', { original, repinned, name }),
    deleteLayout: (content, name) => invoke('delete_layout', { content, name }),
    listDeckFiles: () => invoke('list_deck_files'),
    readDeckFile: path => invoke('read_deck_file', { path }),
    layoutFilesStamp: () => invoke('layout_files_stamp'),
    reportLayoutDraft: pending => invoke('report_layout_draft', { pending }),
    previewLayoutDraft: (name, html, css) => invoke('preview_layout_draft', { name, html, css }),
    saveDeckFile: (content, path, text, base) => invoke('save_deck_file', { content, path, text, base: base ?? null }),
    presentDeck: rehearsal => invoke('present_deck', { rehearsal }),
    reportDeckSettings: settings => invoke('report_deck_settings', { settings }),
    trustOpenDeck: () => invoke('trust_open_deck'),
    onDeckFileChanged: callback => subscribe('deck-file-changed', callback),
    onLayoutFilesChanged: callback => subscribeToThisWindow('layout-files-changed', callback),
    onLayoutFlushBeforeClose: callback => subscribeToThisWindow('layout:flush-before-close', callback),
    onMenuNewDeck: callback => subscribe('menu:new-deck', callback),
    onMenuUndo: callback => subscribeToThisWindow('menu:undo', callback),
    onMenuRedo: callback => subscribeToThisWindow('menu:redo', callback),
    onMenuDeckSetting: callback => subscribeToThisWindowWithPayload('menu:deck-setting', callback),
    onPresentReady: callback => subscribe('present-ready', callback),
    onPresentFailed: callback => subscribeWithPayload('present-failed', callback),
  }
}
