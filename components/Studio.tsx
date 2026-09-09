'use client'

import { createSignal, createMemo, createEffect, untrack, batch, onMount, onCleanup } from '@barefootjs/client'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createTauriDeckIpc, type RenderPayload } from '../ipc/deckIpc'
import { type Manifest, type ManifestSection, type ManifestSlide, type SectionDraft, sectionStartByIndex as computeSectionStartByIndex } from '../domain/render'
import { clampMenuPosition } from '../domain/geometry'
import { type PageConfig } from '../domain/pageConfig'
import { type SelectionPlan, type EditorSession, type SlideFields, isDirty as computeIsDirty, reconcileAfterCommit, withRefreshedSaved, withDraftBody, withDraftNote } from '../domain/editorSession'
import { type SlideCommand, applyCommand, needsTimeResync, selectionPlanFor, validate } from '../domain/slideCommands'
import { type DragState, arm, move, dropTarget, cancel } from '../domain/drag'
import { type ContextMenu, indexOf as contextMenuIndexOf, positionOf as contextMenuPositionOf, isLayoutPickerOpen, menuItems as computeMenuItems, appendIndex as computeAppendIndex } from '../domain/contextMenu'
import { type DeckLifecycle, type DeckEvent, decide, isBusy as computeIsBusy } from '../domain/deckLifecycle'
import { gapUnderCursor, attachDragListeners, setDragAffordance } from '../dom/dragGesture'
import {
  splitSlides,
  extractNote,
  extractPageComment,
  buildSlideText,
  updatePageComment,
  slugifyTitle,
  uniqueSlideKey,
  clampFocusIndex,
  extractHeadingText,
  parseDurationToMs,
  updateFrontmatterTime,
  formatDurationMs,
  joinSlideTexts,
  sumSectionTimesMs,
  stabilizeByKey,
  type SlideRange,
} from '../domain/slides'
import { buildSlidePreviewDoc } from '../domain/previewDoc'
import { WelcomeScreen } from './WelcomeScreen'
import { NewDeckModal } from './NewDeckModal'
import { DeckHeader } from './DeckHeader'
import { StatusBar } from './StatusBar'
import { SlidePreview } from './SlidePreview'
import { SlideEditor } from './SlideEditor'
import { SlideContextMenu } from './SlideContextMenu'
import { SlideList } from './SlideList'

const MIN_COLUMN_WIDTH = 180
const MAX_COLUMN_WIDTH = 640
const SLIDE_LIST_WIDTH = 176
// Just the heading — `addSlide` attaches an explicit, collision-free
// PageComment `key` around this (see its own comment for why).
const NEW_SLIDE_MARKDOWN = '# New Slide\n'

export function Studio() {
  const deckIpc = createTauriDeckIpc()
  // The whole welcome/new-deck/open flow as one `domain/deckLifecycle.ts`
  // ADT signal, replacing five independently-settable signals
  // (`deckPath`/`isBusy`/`newDeckModalOpen`/`newDeckParentDir`/
  // `newDeckName`) that let bug bfa5577 happen: `submitNewDeck` held
  // `isBusy(true)` across a call into `loadDeck`, whose own separate
  // `isBusy` guard silently no-opped the load, leaving the folder
  // created but the editor never shown. `decide`'s `creating` state can
  // only transition to `opening` (never straight back to `welcome`) on
  // its `created` event, so that failure mode is unrepresentable now.
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
  // Applies `event` to the current lifecycle via `decide`, commits the
  // resulting state, and runs whichever IPC call the transition implies
  // — awaited, so a caller that needs to know the outcome (`onMount`'s
  // pending-deck load) can inspect `deckLifecycle()` right after this
  // resolves. `rejected` decisions are silently dropped: every caller
  // already only fires events its own UI state makes reachable (e.g. the
  // Create button is `disabled` while `isBusy()`), so a rejection here
  // would mean a caller raced its own guard, not something worth
  // surfacing to the user.
  async function dispatch(event: DeckEvent): Promise<void> {
    const decision = decide(deckLifecycle(), event)
    if (decision.kind === 'rejected') return
    const next = decision.next
    setDeckLifecycle(next)
    if (decision.effect === 'invoke-open' && next.kind === 'opening') {
      await runOpen(next.path)
    } else if (decision.effect === 'invoke-create' && next.kind === 'creating') {
      await runCreate(next.parentDir, next.name)
    } else if (decision.effect === 'spawn-window' && event.type === 'open-requested') {
      await openDeckInNewWindow(event.path)
    }
  }
  // The `invoke-open` effect: opens `path` in *this* window. Feeds its
  // outcome back through `dispatch` (`opened`/`failed`) rather than
  // setting `deckLifecycle` directly, so `creating` -> `opening` ->
  // `open` always goes through the same one state-transition table
  // regardless of which event started the chain.
  async function runOpen(path: string): Promise<void> {
    setErrorMessage(null)
    try {
      const info = await deckIpc.openDeck(path)
      applyRenderPayload(info.render)
      await refreshSource(false)
      setStatusMessage(`Opened ${info.deckPath}`)
      await dispatch({ type: 'opened', deckPath: info.deckPath })
    } catch (err) {
      setErrorMessage(String(err))
      // A failure here often means the path was a Recent entry pointing
      // at a folder that's since moved or been deleted — re-fetch so a
      // now-stale entry (Rust prunes it against disk on every read)
      // isn't still sitting there to fail the exact same way if clicked
      // again.
      void refreshRecentDecks()
      await dispatch({ type: 'failed', message: String(err) })
    }
  }
  // The `invoke-create` effect.
  async function runCreate(parentDir: string, name: string): Promise<void> {
    setErrorMessage(null)
    try {
      const path = await deckIpc.createDeck(parentDir, name)
      await dispatch({ type: 'created', path })
    } catch (err) {
      setErrorMessage(String(err))
      await dispatch({ type: 'failed', message: String(err) })
    }
  }
  // The `spawn-window` effect — modeled in `domain/deckLifecycle.ts` for
  // completeness (an `open` window that somehow receives another
  // `open-requested` shouldn't lose its own deck), but as of this
  // writing nothing in this file can actually fire `open-requested`
  // while `open`: the buttons/Recent entries that dispatch it only
  // render on the welcome screen, and native "Open Recent" opens a new
  // window entirely Rust-side without going through this component.
  async function openDeckInNewWindow(path: string): Promise<void> {
    try {
      await deckIpc.openDeckWindow(path)
    } catch (err) {
      setErrorMessage(String(err))
    }
  }
  const [assetBaseUrl, setAssetBaseUrl] = createSignal<string | null>(null)
  // The deck's native slide canvas size — split out of `manifest` into its
  // own equality-guarded signals (set in `applyRenderPayload`) even though
  // it logically lives there. `manifest()` gets a brand-new object on every
  // single-slide edit, but every thumbnail's `.map()` row reads canvas size
  // (for its `<iframe>` doc and its aspect-ratio style) — reading it via
  // `manifest()` directly made *every* row's reactive bindings depend on
  // *every* edit, forcing a real `.srcdoc` reassignment (a visible reload)
  // on rows whose own content never changed. See [[barefootjs-per-key-signal-pattern]].
  const [canvasWidth, setCanvasWidth] = createSignal(1280)
  const [canvasHeight, setCanvasHeight] = createSignal(720)
  const [manifest, setManifest] = createSignal<Manifest | null>(null)
  const [fullSource, setFullSource] = createSignal('')
  const [slideRanges, setSlideRanges] = createSignal<SlideRange[]>([])
  // The editor pane's entire state — which slide (if any) is open, its
  // last-saved fields, and the live draft — as one `domain/editorSession.ts`
  // ADT signal, with memos below projecting the pieces the rest of this
  // file reads individually (`selectedIndex`/`bodyDraft`/`noteDraft`/
  // `pageConfig`). Previously five independent signals
  // (`selectedIndex`/`bodyDraft`/`noteDraft`/`originalBody`/`originalNote`)
  // plus a separate `pageConfig`, which is exactly the kind of "ADT
  // scattered across independent fields" this refactor's `docs/
  // architecture.md` warns against — nothing stopped e.g. `bodyDraft`
  // pointing at one slide's text while `selectedIndex` had already moved
  // to another. `pageConfig` is held in `draft.config`/`saved.config`
  // rather than in `bodyDraft` itself — the whole point of this app is
  // that hand-writing/eyeballing that JSON comment (and telling it apart
  // from the note comment, same HTML-comment syntax) is the wrong way to
  // edit it. Applied through `buildSlideText` whenever the raw slide text
  // is reconstructed for saving; edited only via the thumbnail context
  // menu / section-header inputs, never by hand in the body textarea.
  const [editorSession, setEditorSession] = createSignal<EditorSession>({ kind: 'none' })
  const selectedIndex = createMemo(() => {
    const s = editorSession()
    return s.kind === 'editing' ? s.index : null
  })
  const bodyDraft = createMemo(() => {
    const s = editorSession()
    return s.kind === 'editing' ? s.draft.body : ''
  })
  const noteDraft = createMemo(() => {
    const s = editorSession()
    return s.kind === 'editing' ? s.draft.note : ''
  })
  const pageConfig = createMemo<PageConfig>(() => {
    const s = editorSession()
    return s.kind === 'editing' ? s.draft.config : {}
  })
  // One independent signal per slide key, rather than a single
  // `Record<string, string>` signal — reading `slideFragments()` as a whole
  // record would subscribe every thumbnail's `srcdoc` effect to the *entire*
  // record, so editing one slide reassigned every other thumbnail's
  // `<iframe srcdoc>` too (same value, but `.srcdoc` always forces a
  // navigate/reload on assignment regardless of whether the string actually
  // changed) — the visible flicker across the whole slide list on every
  // keystroke. Keying a separate signal per slide means only the row whose
  // fragment actually changed re-touches its iframe.
  const fragmentSignals = new Map<string, [() => string, (value: string) => void]>()
  function fragmentSignal(key: string): [() => string, (value: string) => void] {
    let entry = fragmentSignals.get(key)
    if (!entry) {
      entry = createSignal('')
      fragmentSignals.set(key, entry)
    }
    return entry
  }
  // A read-only accessor for `SlideList`'s thumbnail `ref` callback — it
  // only ever needs the current fragment HTML at mount time (never the
  // setter), so this keeps that setter from crossing the component
  // boundary at all, per docs/architecture.md's "children never receive a
  // setter" rule.
  function fragmentOf(key: string): string {
    return fragmentSignal(key)[0]()
  }
  const [sectionDrafts, setSectionDrafts] = createSignal<Record<number, SectionDraft>>({})
  // A single `domain/drag.ts` DragState signal, with three independent
  // memos over it for `draggedIndex`/`dragOverGap`/`dragDeltaY` — reading
  // the raw DragState directly from every slide row would subscribe all
  // of them to the whole state and re-render every row on each
  // `dragOverGap` change during a drag, not just the two rows whose own
  // border actually flips.
  //
  // The signal/memos live here, not in a `state/uiStore.ts` factory
  // function, despite that being this refactor's usual pattern for
  // extracting state out of Studio.tsx (see domain/editorSession.ts,
  // domain/slideCommands.ts for the logic side of the same split): a
  // `createDragStore()` returning `{ draggedIndex, ... }` compiled into
  // JSX bindings with zero tracked deps for every reference to it
  // (confirmed with `bf debug graph` — `dragStore.draggedIndex()` in JSX
  // showed `deps: []`), so the row's `class`/`style` never updated during
  // a drag. Even binding the factory's return values to plain top-level
  // `const`s in the component (`const draggedIndex = dragStore.draggedIndex`)
  // didn't help — same empty deps. BarefootJS's compiler resolves a
  // render's reactive dependencies by static analysis of createSignal/
  // createMemo calls literally written in the component's own source,
  // not by tracing values back to a signal through a function call
  // boundary — so a signal a component uses must be declared with
  // `createSignal`/`createMemo` directly in that component's file.
  // `domain/drag.ts`'s pure arm/move/dropTarget/cancel state machine is
  // still the source of truth for every transition; only the signal
  // itself had to move back here.
  const [dragState, setDragState] = createSignal<DragState>({ kind: 'idle' })
  const draggedIndex = createMemo(() => {
    const s = dragState()
    return s.kind === 'dragging' ? s.index : null
  })
  const dragOverGap = createMemo(() => {
    const s = dragState()
    return s.kind === 'dragging' ? s.gap : null
  })
  const dragDeltaY = createMemo(() => {
    const s = dragState()
    return s.kind === 'dragging' ? s.deltaY : 0
  })
  // Distinct from `isBusy` above (the deck-lifecycle one): this guards
  // `commitChange`'s own in-flight save, which used to share the same
  // `isBusy` signal with the welcome-screen open/create flow. The two
  // never actually overlapped in practice (the welcome screen only
  // shows while `deckPath() === null`, and `commitChange` only runs
  // once a deck is open), but sharing one flag for two unrelated
  // "something is in flight" meanings was exactly the kind of implicit
  // coupling this refactor is trying to remove.
  const [isSavingSlide, setIsSavingSlide] = createSignal(false)
  const [statusMessage, setStatusMessage] = createSignal('')
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [errorMessageCopied, setErrorMessageCopied] = createSignal(false)
  const [slideListWidth, setSlideListWidth] = createSignal(SLIDE_LIST_WIDTH)
  // `ContextMenu`'s `closed`/`on-empty-space`/`on-slide` distinguish a
  // right-click on a specific thumbnail from one on empty space in the
  // slide list — every per-slide action (Cut/Delete/Change Layout/...)
  // disables itself outside `on-slide` (see `domain/contextMenu.ts`'s
  // `menuItems`), while actions that don't need an existing slide
  // (New Slide, Paste) still work. `layoutPickerOpen` only exists on
  // `on-slide` for the same reason a layout picker can't open with no
  // slide to change the layout of.
  const [contextMenu, setContextMenu] = createSignal<ContextMenu>({ kind: 'closed' })
  // "Change Layout" expands this inline within the thumbnail context menu.
  // A grid of real rendered previews (Google Slides-style) was attempted
  // first, backed by `preview_layouts`'s per-layout fragment/CSS render,
  // but got shelved: a conditional
  // (`layoutPreviews() === null ? Loading : ... : ...`) sitting in the
  // context menu's part of the tree never showed its post-mount branches
  // (confirmed with plain `<div>` content too, so not about the
  // grid/`.map()`/iframe specifically), while the identical pattern
  // elsewhere in this file that isn't inside the context menu (e.g.
  // `manifest() === null ? ... : ...` for the slide list) worked fine.
  // Fixed since by permanently mounting the whole context-menu subtree
  // (see the comment above it further down) instead of gating it on
  // `contextMenu()` — that was the actual remount-on-every-open trigger,
  // not this conditional's own shape. `layoutPreviewCss` (below) carries
  // `preview_layouts`'s shared CSS alongside the per-layout fragments —
  // see `buildLayoutPreviewDoc` for why it's inlined per-iframe rather
  // than served, unlike a real slide's own `peitho.css`.
  const [layoutPreviews, setLayoutPreviews] = createSignal<{ name: string; fragment: string }[] | null>(null)
  const [layoutPreviewCss, setLayoutPreviewCss] = createSignal('')
  // The thumbnail context menu's Cut/Copy/Paste clipboard. Deliberately not
  // backed by `navigator.clipboard` — OS clipboard access needs its own
  // Tauri capability/plugin wiring, and the ask here is standard in-app
  // cut/copy/paste, not cross-app interop.
  const [clipboardSlideText, setClipboardSlideText] = createSignal<string | null>(null)
  // Shown centered in place of the whole 3-pane layout until a deck is
  // open. `recentDecks` (full deck.md paths) is persisted Rust-side (see
  // `get_recent_decks`/`remember_recent_deck` in peitho.rs) rather than in
  // `localStorage`, since the native File > Open Recent submenu needs the
  // same list and has no access to this webview's storage.
  const [recentDecks, setRecentDecks] = createSignal<string[]>([])

  // Plain (non-reactive) DOM handles for the two editor textareas — see the
  // note above `syncEditorFields` for why these are *not* driven by a
  // reactive `value={...}` binding.
  let bodyTextareaEl: HTMLTextAreaElement | undefined
  let noteTextareaEl: HTMLTextAreaElement | undefined
  // The context menu is permanently mounted (only its `hidden` class
  // toggles — see the comment above its JSX for why), so its `ref` fires
  // exactly once and this stays valid for the component's whole lifetime.
  let contextMenuEl: HTMLElement | undefined
  // Tracks an in-progress IME composition (kana->kanji conversion, etc.) on
  // each textarea, via `compositionstart`/`compositionend`. `syncEditorFields`
  // must never touch `.value` while one is active: WebKit owns the
  // in-progress composition buffer separately from the element's `.value`
  // during that window, and an external `.value` write — even to a byte-
  // identical string — can desync the two, surfacing as dropped characters
  // or a backspace that appears to delete the wrong thing.
  let bodyComposing = false
  let noteComposing = false

  // Pushes the current bodyDraft/noteDraft signal values into the actual
  // textarea DOM nodes. Call this after any *non-typing* change to those
  // signals (switching slides, a save response, an external-file merge) —
  // never react to the signals directly with a `value={...}` JSX binding.
  // A reactive binding re-assigns `.value` on every keystroke too, since
  // our own onInput handler is what changes the signal in the first place;
  // WebKit's textarea can drop or misplace a keystroke (a space swallowed,
  // the cursor jumping a line) when `.value` is reassigned while the user
  // is actively typing/composing. Uncontrolled + explicit imperative sync
  // avoids that class of bug entirely.
  function syncEditorFields(): void {
    if (bodyTextareaEl && !bodyComposing && bodyTextareaEl.value !== bodyDraft()) bodyTextareaEl.value = bodyDraft()
    if (noteTextareaEl && !noteComposing && noteTextareaEl.value !== noteDraft()) noteTextareaEl.value = noteDraft()
  }

  function onBodyTextareaRef(el: HTMLTextAreaElement): void {
    bodyTextareaEl = el
    el.value = bodyDraft()
    el.addEventListener('compositionstart', () => { bodyComposing = true })
    el.addEventListener('compositionend', () => { bodyComposing = false })
  }

  function onNoteTextareaRef(el: HTMLTextAreaElement): void {
    noteTextareaEl = el
    el.value = noteDraft()
    el.addEventListener('compositionstart', () => { noteComposing = true })
    el.addEventListener('compositionend', () => { noteComposing = false })
  }

  const [editorWidth, setEditorWidth] = createSignal(420)
  const [presentMenuOpen, setPresentMenuOpen] = createSignal(false)

  const sectionStartByIndex = createMemo<Record<number, ManifestSection>>(() => computeSectionStartByIndex(manifest()?.sections ?? []))
  const layoutPickerView = createMemo<'loading' | 'empty' | 'ready'>(() => {
    const previews = layoutPreviews()
    if (previews === null) return 'loading'
    if (previews.length === 0) return 'empty'
    return 'ready'
  })
  const currentMenuItems = createMemo(() => computeMenuItems(contextMenu(), {
    slideCount: manifest()?.slideCount ?? 0,
    hasClipboard: clipboardSlideText() !== null,
    configOf: slideConfigOf,
  }))
  const selectedRange = createMemo<SlideRange | null>(() => {
    const i = selectedIndex()
    if (i === null) return null
    return slideRanges()[i] ?? null
  })
  const isDirty = createMemo(() => computeIsDirty(editorSession()))
  const selectedSlide = createMemo<ManifestSlide | null>(() => {
    const i = selectedIndex()
    if (i === null) return null
    return manifest()?.slides[i] ?? null
  })
  // `selectedSlide()` itself is a *new object* on every keystroke (even to
  // some other slide — see `stabilizeByKey` in slides.ts), but a memo's
  // own output is compared by value before it notifies anyone, and two
  // strings that read the same are `Object.is`-equal regardless of which
  // slide object produced them. Deriving just the key through a memo is
  // what lets the preview iframe (below) depend on "which slide is
  // selected" without also depending on "has its content changed".
  const selectedSlideKey = createMemo<string | null>(() => selectedSlide()?.key ?? null)

  createEffect(() => {
    if (errorMessage() === null) return
    const timer = window.setTimeout(() => setErrorMessage(null), 6000)
    return () => window.clearTimeout(timer)
  })

  async function copyErrorMessage(): Promise<void> {
    const message = errorMessage()
    if (message === null) return
    await navigator.clipboard.writeText(message)
    setErrorMessageCopied(true)
    window.setTimeout(() => setErrorMessageCopied(false), 1500)
  }

  // Applies a render result (from `open_deck` or `render_draft`) to state.
  // Each fragment is written to its own key's signal, and only when the
  // value actually changed — see `fragmentSignal` above for why this must
  // stay per-key rather than one shared record. `manifest.slides` itself
  // gets the same treatment at the object level via `stabilizeByKey`: every
  // slide (edited or not) arrives as a freshly-deserialized object on every
  // keystroke, and reusing the *previous* slide's own reference for one
  // that's unchanged is what lets the keyed `.map()` over `manifest().slides`
  // skip re-running that row's bindings at all — see `stabilizeByKey`'s own
  // comment for why this is load-bearing, not just tidiness.
  function applyRenderPayload(payload: RenderPayload): void {
    // Everything `buildSlideDoc`/the untracked initial `srcdoc` read for a
    // slide's iframe depends on — its fragment, the canvas size, the asset
    // base URL — must already be current *before* `setManifest` below,
    // not after. A brand-new row (this deck's first render, or a slide
    // that didn't exist a moment ago) reads its `srcdoc` synchronously as
    // part of reacting to the manifest update that creates it; since that
    // read is frozen forever (see the comment on `buildSlideDoc`'s
    // `untrack` usage), setting it up in the other order let a fresh row
    // capture an empty fragment permanently, before this function ever
    // reached the loop that would have given it real content.
    //
    // Wrapped in `batch()` so `patchSlidePreviewIframes`'s effect (which
    // depends on both `manifest()` and every slide's own `fragmentSignal`)
    // flushes once per call to this function instead of once per signal
    // write inside it — a multi-slide deck's first render used to fire
    // that effect once per fragment plus once more for `setManifest`,
    // each pass a no-op past the first (its own `outerHTML` equality
    // check bails immediately), but still a `querySelectorAll` sweep over
    // every mounted iframe repeated for nothing.
    batch(() => {
      for (const [key, html] of Object.entries(payload.fragments)) {
        const [get, set] = fragmentSignal(key)
        if (get() !== html) set(html)
      }
      setAssetBaseUrl(payload.assetBaseUrl)
      if (canvasWidth() !== payload.manifest.canvasWidth) setCanvasWidth(payload.manifest.canvasWidth)
      if (canvasHeight() !== payload.manifest.canvasHeight) setCanvasHeight(payload.manifest.canvasHeight)
      const previousSlides = manifest()?.slides ?? []
      setManifest({ ...payload.manifest, slides: stabilizeByKey(previousSlides, payload.manifest.slides) })
      const drafts: Record<number, SectionDraft> = {}
      for (const section of payload.manifest.sections) {
        drafts[section.startIndex] = { name: section.name, time: formatDurationMs(section.plannedDurationMs) }
      }
      setSectionDrafts(drafts)
    })
  }

  // Renders `content` in-process (no disk write — see `engine::pipeline` on
  // the Rust side) and applies the result. `generation` guards against an
  // older, slower-to-resolve render landing after a newer one — with
  // peitho-core embedded directly this is on the order of tens of ms, but
  // IPC calls can still resolve out of order under load.
  let previewGeneration = 0
  async function renderPreview(content: string): Promise<void> {
    const generation = ++previewGeneration
    try {
      const payload = await deckIpc.renderDraft(content)
      if (generation !== previewGeneration) return
      applyRenderPayload(payload)
      setErrorMessage(null)
    } catch (err) {
      if (generation !== previewGeneration) return
      // Keep whatever last rendered successfully on screen; just surface
      // the build error (e.g. a mid-edit unclosed code fence) — a draft
      // that doesn't build yet shouldn't blank the preview.
      setErrorMessage(String(err))
    }
  }

  function currentDraftSource(): string | null {
    const range = selectedRange()
    const index = selectedIndex()
    if (!range || index === null) return null
    const newSlideText = buildSlideText(pageConfig(), bodyDraft(), noteDraft())
    const source = fullSource()
    return source.slice(0, range.start) + newSlideText + source.slice(range.end)
  }

  // Fast lane: re-renders (in-memory only) a beat after typing stops, so
  // Preview reflects Editor/notes edits without waiting on a disk save.
  // Re-fires on every bodyDraft/noteDraft change, so each keystroke resets
  // the timer via the cleanup below.
  createEffect(() => {
    bodyDraft()
    noteDraft()
    if (!isDirty()) return
    const timer = window.setTimeout(() => {
      const draft = currentDraftSource()
      if (draft !== null) void renderPreview(draft)
    }, 80)
    return () => window.clearTimeout(timer)
  })

  // Slow lane: persists to disk well after the fast lane already has
  // Preview showing the latest content, so saving never competes with
  // typing for responsiveness.
  createEffect(() => {
    bodyDraft()
    noteDraft()
    if (!isDirty()) return
    let live = true
    let timerId: number
    const attempt = () => {
      if (!live) return
      if (isSavingSlide()) {
        timerId = window.setTimeout(attempt, 150)
        return
      }
      void handleSave()
    }
    timerId = window.setTimeout(attempt, 600)
    return () => {
      live = false
      window.clearTimeout(timerId)
    }
  })

  function buildSlideDoc(fragmentHtml: string): string {
    return buildSlidePreviewDoc(fragmentHtml, assetBaseUrl() ?? '', canvasWidth(), canvasHeight())
  }

  // `srcdoc={...}` always reloads the iframe (a visible flash) when
  // reassigned, even to a value that's byte-identical to what's already
  // there (confirmed empirically — reassigning the exact same string three
  // times in a row fires three `load` events) — so the only real fix is to
  // never reassign it after the first load. All *later* content updates
  // flow through `patchSlidePreviewIframes` (a plain effect below) instead,
  // which mutates the already-loaded iframe's document in place — no
  // `.srcdoc` write, no reload.
  //
  // For the "selected slide" preview pane (a single iframe reused across
  // whichever slide is selected) `key` must be read by the *caller*, in
  // normal (tracked) context, so switching slides still reloads this pane;
  // only the fragment lookup itself is untracked (see the thumbnail row's
  // `ref` below for why a thumbnail needs a stronger fix than `untrack`).
  function buildSelectedSlideDoc(key: string | null): string {
    if (key === null) return ''
    return buildSlideDoc(untrack(() => fragmentSignal(key)[0]()))
  }

  // Swaps in fresh fragment HTML for every iframe currently showing `key`
  // (its thumbnail row and/or the "selected slide" preview pane both carry
  // `data-slide-preview-key`), without touching `.srcdoc`. Only ever
  // *replaces* an existing `.peitho-slide` — never inserts one — so a
  // patch that lands before an iframe's own initial `srcdoc` load has
  // finished (a real possibility: that load is async, this effect isn't)
  // is a safe no-op instead of risking a duplicated slide; the in-flight
  // `srcdoc` navigation already carries the correct content for that case,
  // and the next keystroke's patch (a beat later) catches up.
  function patchSlidePreviewIframes(key: string, fragmentHtml: string): void {
    const selector = `[data-slide-preview-key="${CSS.escape(key)}"]`
    for (const iframe of document.querySelectorAll<HTMLIFrameElement>(selector)) {
      const doc = iframe.contentDocument
      const current = doc?.querySelector('.peitho-slide')
      if (!current || current.outerHTML === fragmentHtml) continue
      const wrapper = doc!.createElement('div')
      wrapper.innerHTML = fragmentHtml
      const next = wrapper.firstElementChild
      if (!next) continue
      current.replaceWith(next)
      // The fit() script embedded in buildSlidePreviewDoc only re-scales on
      // its own `resize` listener — nothing else re-invokes it after a
      // direct content swap like this.
      doc!.defaultView?.dispatchEvent(new Event('resize'))
    }
  }

  createEffect(() => {
    for (const slide of manifest()?.slides ?? []) {
      patchSlidePreviewIframes(slide.key, fragmentSignal(slide.key)[0]())
    }
  })

  async function refreshSource(preserveSelection: boolean): Promise<void> {
    const source = await deckIpc.readDeckSource()
    setFullSource(source)
    const ranges = splitSlides(source)
    setSlideRanges(ranges)
    const nextIndex = clampFocusIndex(preserveSelection ? selectedIndex() : null, ranges.length)
    if (nextIndex === null) {
      setEditorSession({ kind: 'none' })
    } else {
      const { rest: withoutNote, note } = extractNote(ranges[nextIndex].text)
      const { rest, config } = extractPageComment(withoutNote)
      const fields: SlideFields = { body: rest, note, config }
      setEditorSession({ kind: 'editing', index: nextIndex, saved: fields, draft: fields })
    }
    syncEditorFields()
  }

  async function refreshRecentDecks(): Promise<void> {
    try {
      setRecentDecks(await deckIpc.getRecentDecks())
    } catch {
      // Best-effort — an empty Recent list just means nothing to suggest.
    }
  }

  async function handleOpenFolder(): Promise<void> {
    const picked = await openDialog({ directory: true, title: 'Open a Peitho deck folder' })
    if (!picked || typeof picked !== 'string') return
    await dispatch({ type: 'open-requested', path: picked })
  }

  async function handleNewDeck(): Promise<void> {
    const parent = await openDialog({ directory: true, title: 'Choose a location for the new deck' })
    if (!parent || typeof parent !== 'string') return
    await dispatch({ type: 'new-deck-requested', parentDir: parent })
  }

  // Writes a full deck.md replacement to disk, then re-derives every piece
  // of state that depends on file content (ranges, manifest, thumbnails,
  // the editor's drafts) from what actually gets persisted — the single
  // path `handleSave`, section-header edits, and drag-reorder all funnel
  // through, so none of them can drift from what `save_deck_source` wrote.
  // Renders first (in-memory) so Preview/thumbnails reflect the change
  // immediately, then persists to disk.
  //
  // Even though a render is fast now, the user hasn't stopped
  // typing/navigating just because this is in flight. Snapshotting
  // selection + drafts *before* awaiting and only applying them after *if*
  // nothing has changed in the meantime is what stops a slow, stale
  // response from yanking the cursor or reverting text out from under
  // someone who kept typing — without this guard the editor could still
  // visibly "fight" the user on a slower render (a large deck, a cold
  // custom-syntax load, ...).
  // `expectedDraft`: when the caller already knows exactly what it injected
  // for the focus slide (`handleSave` does — it built `nextSource` from
  // `bodyDraft()`/`noteDraft()` itself), pass those back here so they can be
  // reused verbatim instead of round-tripping through `extractNote`.
  // `extractNote` trims/collapses blank lines — appropriate for a *fresh*
  // read from disk, but lossy when looped back into the live draft: it
  // would silently swallow trailing whitespace the user just typed (e.g.
  // typing "the " mid-word) a few hundred ms later when this resync lands,
  // which then makes the *next* backspace remove a different character than
  // the one the user was looking at — exactly the "backspace deletes more
  // than I pressed" symptom. Callers that don't know the exact value up
  // front (section-header edits, drag-reorder) omit it and accept that
  // small risk, since those are discrete one-off actions, not continuous
  // typing.
  async function commitChange(
    nextSource: string,
    plan: SelectionPlan,
    expectedDraft?: { body: string; note: string },
  ): Promise<void> {
    const before = editorSession()
    setIsSavingSlide(true)
    setErrorMessage(null)
    try {
      const payload = await deckIpc.renderDraft(nextSource)
      applyRenderPayload(payload)
      await deckIpc.saveDeckSource(nextSource)
      setFullSource(nextSource)
      const ranges = splitSlides(nextSource)
      setSlideRanges(ranges)
      // `reconcileAfterCommit` only moves the selection/refreshes `saved`
      // if the user hasn't already navigated elsewhere themselves while
      // this was in flight — every caller passes a `SelectionPlan` naming
      // its own intent (`keep` for `handleSave`/`commitSectionEdit`/
      // `updateSlideConfig`, which never move anything; `follow-move` for
      // `reorderSlides`, which keeps the open slide's own position even
      // when the slide it moved isn't the one that's open;
      // `select`/`clamp-after-delete` for insert/paste/delete) — never the
      // position of whatever the change actually touched, or this would
      // drag the selection there regardless of what the user had open.
      const now = editorSession()
      const next = reconcileAfterCommit(before, now, ranges, plan, expectedDraft)
      setEditorSession(next)
      // `next === now` means the user moved on (a different selection, or
      // no change resolved) and this deliberately left it alone — nothing
      // to push into the textareas. Otherwise `saved` refreshed and/or
      // `draft` synced to it, so re-sync (a no-op if `draft` itself didn't
      // actually change, e.g. the user kept typing through the gap).
      if (next !== now) syncEditorFields()
      setStatusMessage('Saved')
    } catch (err) {
      setErrorMessage(String(err))
    } finally {
      setIsSavingSlide(false)
    }
  }

  // The saved text for a slide, unless it's the one currently open with
  // unsaved edits — then the live draft, so an operation on a *different*
  // slide (reordering, editing another section's time) never clobbers
  // in-progress work in the editor.
  function currentSlideText(index: number): string {
    if (index === selectedIndex() && isDirty()) return buildSlideText(pageConfig(), bodyDraft(), noteDraft())
    return slideRanges()[index]?.text ?? ''
  }

  // `window.confirm` used to gate this on discarding unsaved edits, but
  // Tauri's webview doesn't reliably surface it (it can resolve as
  // cancelled with no dialog shown at all), which silently blocked every
  // slide switch attempted while the fast/slow save lanes hadn't caught up
  // yet. There's no need to ask at all: flush the pending edit through the
  // same save path the auto-save effects use, then switch — never losing
  // work, never blocking on a dialog the webview won't show.
  async function selectSlide(index: number): Promise<void> {
    if (index === selectedIndex()) return
    if (isDirty()) await handleSave()
    const { rest: withoutNote, note } = extractNote(slideRanges()[index]?.text ?? '')
    const { rest, config } = extractPageComment(withoutNote)
    const fields: SlideFields = { body: rest, note, config }
    setEditorSession({ kind: 'editing', index, saved: fields, draft: fields })
    syncEditorFields()
  }

  async function handleSave(): Promise<void> {
    const range = selectedRange()
    const index = selectedIndex()
    if (!range || index === null) return
    const body = bodyDraft()
    const note = noteDraft()
    const newSlideText = buildSlideText(pageConfig(), body, note)
    const source = fullSource()
    const nextSource = source.slice(0, range.start) + newSlideText + source.slice(range.end)
    await commitChange(nextSource, { kind: 'keep' }, { body, note })
  }

  // Rebuilds `fullSource` from an ordered list of slide texts, preserving
  // whatever precedes the first slide (YAML frontmatter) and follows the
  // last. Every operation that adds, removes, or reorders slides goes
  // through this rather than slicing `fullSource` directly, so none of
  // them can leave a doubled separator or stray blank line behind.
  function rebuildSource(texts: string[]): string {
    const ranges = slideRanges()
    const source = fullSource()
    const prefix = source.slice(0, ranges[0]?.start ?? 0)
    const suffix = source.slice(ranges[ranges.length - 1]?.end ?? source.length)
    return joinSlideTexts(prefix, texts, suffix)
  }

  // Same as `rebuildSource`, plus keeping the frontmatter `time:` in sync
  // with the sum of every section's own time — required whenever the
  // *set* of slides changes (adding, pasting, or deleting a slide can add
  // or remove a section along with it), unlike a plain reorder, which
  // never changes that sum. Left untouched when the deck uses no sections
  // at all, so a plain deck never gets a `time:` frontmatter block it
  // never asked for.
  function syncedSource(texts: string[]): string {
    const rebuilt = rebuildSource(texts)
    const totalMs = sumSectionTimesMs(texts)
    return totalMs > 0 ? updateFrontmatterTime(rebuilt, totalMs) : rebuilt
  }

  function onSectionNameInput(index: number, value: string): void {
    setSectionDrafts(prev => ({
      ...prev,
      [index]: { name: value, time: prev[index]?.time ?? formatDurationMs(sectionStartByIndex()[index].plannedDurationMs) },
    }))
  }

  function onSectionTimeInput(index: number, value: string): void {
    setSectionDrafts(prev => ({
      ...prev,
      [index]: { name: prev[index]?.name ?? sectionStartByIndex()[index].name, time: value },
    }))
  }

  async function commitSectionEdit(startIndex: number): Promise<void> {
    const draft = sectionDrafts()[startIndex]
    const range = slideRanges()[startIndex]
    if (!draft || !range) return
    const slideText = currentSlideText(startIndex)
    const updatedSlideText = updatePageComment(slideText, { section: draft.name, time: draft.time })
    if (updatedSlideText === slideText) return

    let nextSource = fullSource()
    nextSource = nextSource.slice(0, range.start) + updatedSlideText + nextSource.slice(range.end)

    // peitho requires the frontmatter's total time to equal the sum of
    // every section's time — keep that in sync so editing one section's
    // time here doesn't quietly break the next build.
    const editedMs = parseDurationToMs(draft.time)
    if (editedMs !== null) {
      const sections = manifest()?.sections ?? []
      const totalMs = sections.reduce(
        (sum, section) => sum + (section.startIndex === startIndex ? editedMs : section.plannedDurationMs),
        0,
      )
      nextSource = updateFrontmatterTime(nextSource, totalMs)
    }

    await commitChange(nextSource, { kind: 'keep' })
  }

  async function reorderSlides(from: number, to: number): Promise<void> {
    const ranges = slideRanges()
    const texts = ranges.map((_, i) => currentSlideText(i).trim())
    const cmd: SlideCommand = { type: 'move', from, to }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    // `commitChange`'s selection-follows-plan step assumes every caller
    // but this one already passes back a `keep` (a no-op for them) — so
    // unconditionally selecting `to` here would drag the *editor's*
    // selection over to whatever slide just got dropped even when a
    // *different* slide, mid-edit and not yet saved, was the one actually
    // open. `follow-move` keeps the open slide's own position (shifted
    // for the reorder) unless it's the one that moved, in which case
    // that's `to` anyway.
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
  }

  // `move` never changes *which* sections exist or their times, only
  // their positions — the frontmatter total can't have gone stale, so
  // this skips `syncedSource`'s (harmless, but pointless) recompute for
  // it; every other command routes through the resync.
  function sourceFor(texts: string[], cmd: SlideCommand): string {
    return needsTimeResync(cmd) ? syncedSource(texts) : rebuildSource(texts)
  }

  // Native HTML5 drag-and-drop (`draggable`/`onDragStart`/`onDrop`) used to
  // back slide reordering, but WKWebView's support for it is unreliable —
  // the same category of bug as `window.confirm` above. Plain
  // mousedown/mousemove/mouseup (already how the column-resize dividers
  // work) sidesteps the browser's native DnD stack entirely.
  function startSlideDrag(index: number) {
    return (event: MouseEvent) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('input, textarea')) return
      // Without this, the browser's own native text-selection drag runs
      // alongside the custom drag below — the mouse path highlights
      // whatever text/inputs it crosses (most visibly the section-name
      // inputs) at the same time the row is being dragged.
      event.preventDefault()
      setDragState(arm(index, event.clientX, event.clientY))
      attachDragListeners({
        onMove(moveEvent) {
          const wasArmed = dragState().kind === 'armed'
          setDragState(prev => move(prev, moveEvent.clientX, moveEvent.clientY, gapUnderCursor(moveEvent.clientY)))
          if (wasArmed && dragState().kind === 'dragging') setDragAffordance(true)
        },
        onUp() {
          const target = dropTarget(dragState())
          setDragState(cancel())
          setDragAffordance(false)
          if (target && target.from !== target.to) void reorderSlides(target.from, target.to)
        },
        // If the window loses focus mid-drag (e.g. a native dialog steals
        // focus, or the user alt-tabs away) the `mouseup` that would
        // normally end the drag can land outside this window and never
        // reach these listeners — WKWebView doesn't reliably deliver it
        // here either way. Without this, the drag state stays stuck at
        // whatever it was the moment focus was lost, permanently pinning a
        // leftover `border-t-primary`/`border-b-primary` line on whatever
        // row/gap the drag last passed over. Cancel outright (no reorder)
        // — unlike a normal `mouseup`, a focus loss isn't a deliberate
        // "drop here" gesture.
        onBlur() {
          setDragState(cancel())
          setDragAffordance(false)
        },
      })
    }
  }

  function closeContextMenu(): void {
    setContextMenu({ kind: 'closed' })
  }

  function openContextMenu(index: number | null, event: MouseEvent): void {
    event.preventDefault()
    // Without this, a right-click on a thumbnail bubbles up to the slide
    // list container's own `onContextMenu` (added so right-clicking empty
    // space still opens a menu) and immediately overwrites this call's
    // real index with `null`.
    event.stopPropagation()
    if (index !== null) void selectSlide(index)
    setContextMenu(
      index === null
        ? { kind: 'on-empty-space', x: event.clientX, y: event.clientY }
        : { kind: 'on-slide', index, x: event.clientX, y: event.clientY, layoutPickerOpen: false },
    )
    void loadLayoutPreviews()
  }

  function toggleLayoutPicker(): void {
    setContextMenu(menu => (menu.kind === 'on-slide' ? { ...menu, layoutPickerOpen: !menu.layoutPickerOpen } : menu))
  }

  // Keeps the context menu on-screen: it's positioned at the raw click
  // coordinates, with no clamping of its own, so a right-click low in the
  // slide list could open a menu whose bottom items render past the
  // window edge with no way to reach them. Runs on open and whenever
  // `layoutPickerOpen` changes (its expanded submenu can itself push the
  // menu's bottom edge off-screen) — both are captured just by reading the
  // whole `contextMenu()` ADT — via `requestAnimationFrame`, deferring to
  // the next paint, which is what guarantees the menu has actually been
  // laid out (at its current, possibly just-toggled height) before
  // `getBoundingClientRect` runs.
  createEffect(() => {
    if (contextMenu().kind === 'closed') return
    requestAnimationFrame(() => {
      // Re-read rather than closing over this run's `contextMenu()` value —
      // it may have moved (a new right-click) or closed by the time this
      // frame actually runs.
      const menu = contextMenu()
      if (!contextMenuEl || menu.kind === 'closed') return
      const rect = contextMenuEl.getBoundingClientRect()
      const { x, y } = clampMenuPosition(
        { x: menu.x, y: menu.y },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
        8,
      )
      if (x !== menu.x || y !== menu.y) {
        setContextMenu(prev => (prev.kind === 'closed' ? prev : { ...prev, x, y }))
      }
    })
  })

  // The index a slide-appending action (New Slide, Paste) should insert
  // after — the right-clicked slide, or the end of the list when the menu
  // is closed or was opened on empty space.
  function contextMenuAppendIndex(): number {
    return computeAppendIndex(contextMenu(), manifest()?.slideCount ?? 1)
  }

  async function loadLayoutPreviews(): Promise<void> {
    if (layoutPreviews() !== null) return
    try {
      const payload = await deckIpc.previewLayouts()
      setLayoutPreviewCss(payload.css)
      setLayoutPreviews(payload.previews)
    } catch {
      setLayoutPreviews([])
    }
  }

  function copySlide(index: number): void {
    setClipboardSlideText(currentSlideText(index))
  }

  // Removes a slide by re-joining every other slide's text — the frontmatter
  // time total is re-synced in case the removed slide was itself a section
  // start (see `syncedSource`).
  async function deleteSlide(index: number): Promise<void> {
    const texts = slideRanges().map((_, i) => currentSlideText(i).trim())
    const cmd: SlideCommand = { type: 'delete', index }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
  }

  async function cutSlide(index: number): Promise<void> {
    const ranges = slideRanges()
    if (ranges.length <= 1) return
    setClipboardSlideText(currentSlideText(index))
    await deleteSlide(index)
  }

  // Every currently-known slide key (derived or explicit) — the source of
  // truth for picking a new key that's guaranteed not to collide.
  function existingSlideKeys(): string[] {
    return (manifest()?.slides ?? []).map(s => s.key)
  }

  // Inserts a blank new slide right after `index`, with an explicit
  // PageComment `key` — pressing "New Slide" more than once always
  // produces the exact same heading ("New Slide"), and peitho derives a
  // key from a slide's heading when it has no explicit one, so leaving
  // the key unset (as this used to) meant a second press collided with
  // the first ("duplicate slide key 'new-slide'"). `uniqueSlideKey` picks
  // `new-slide`, `new-slide-2`, `new-slide-3`, ... against the deck's
  // actual current keys instead.
  async function addSlide(index: number): Promise<void> {
    const texts = slideRanges().map((_, i) => currentSlideText(i).trim())
    const insertAt = Math.min(index + 1, texts.length)
    const key = uniqueSlideKey(slugifyTitle('New Slide'), existingSlideKeys())
    const cmd: SlideCommand = { type: 'insert', at: insertAt, text: buildSlideText({ key }, NEW_SLIDE_MARKDOWN, '') }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
  }

  // Same collision as `addSlide`, one step removed: pasting the same
  // clipboard slide more than once (or a slide whose heading matches one
  // already in the deck) used to just drop the copied `key` and hope
  // peitho's own heading-derived fallback was unique — it isn't, when the
  // heading itself repeats. Re-key explicitly instead, based on the
  // original's own key if it had one, else its heading.
  async function pasteSlideAfter(index: number): Promise<void> {
    const clip = clipboardSlideText()
    if (clip === null) return
    const texts = slideRanges().map((_, i) => currentSlideText(i).trim())
    const insertAt = Math.min(index + 1, texts.length)
    const trimmedClip = clip.trim()
    const { config } = extractPageComment(trimmedClip)
    const baseKey = typeof config.key === 'string' && config.key !== ''
      ? config.key
      : slugifyTitle(extractHeadingText(trimmedClip) ?? '')
    const key = uniqueSlideKey(baseKey, existingSlideKeys())
    const cmd: SlideCommand = { type: 'insert', at: insertAt, text: updatePageComment(trimmedClip, { key }) }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
  }

  async function moveSlide(index: number, direction: 1 | -1): Promise<void> {
    await reorderSlides(index, index + direction)
  }

  // Reads a slide's PageComment config without going through `commitChange`
  // — the live `pageConfig` signal for the open slide (which may have
  // pending edits not yet reflected in `slideRanges`), the raw on-disk text
  // for any other slide.
  function slideConfigOf(index: number): PageConfig {
    if (index === selectedIndex()) return pageConfig()
    const { rest: withoutNote } = extractNote(slideRanges()[index]?.text ?? '')
    return extractPageComment(withoutNote).config
  }

  // Routed through `syncedSource` (not a direct range-slice replace) so a
  // config change that adds or removes a section (see `toggleSlideSection`)
  // keeps the frontmatter time total correct — a no-op resync for updates
  // (layout/draft/skip) that don't touch `section`/`time`.
  async function updateSlideConfig(index: number, updates: Partial<PageConfig>): Promise<void> {
    const slideText = currentSlideText(index)
    const updated = updatePageComment(slideText, updates)
    if (updated === slideText) return
    const texts = slideRanges().map((_, i) => currentSlideText(i).trim())
    const cmd: SlideCommand = { type: 'replace', index, text: updated.trim() }
    if (validate(texts, cmd)) return
    const nextTexts = applyCommand(texts, cmd)
    await commitChange(sourceFor(nextTexts, cmd), selectionPlanFor(cmd))
  }

  async function changeSlideLayout(index: number, layout: string): Promise<void> {
    await updateSlideConfig(index, { layout })
  }

  async function toggleSlideDraft(index: number): Promise<void> {
    await updateSlideConfig(index, { draft: slideConfigOf(index).draft !== true })
  }

  async function toggleSlideSkip(index: number): Promise<void> {
    await updateSlideConfig(index, { skip: slideConfigOf(index).skip !== true })
  }

  // Toggles whether this slide marks the *start* of a section. peitho
  // requires `section`/`time` to be set together, so both are set (with
  // sensible defaults the user immediately overwrites via the section
  // header's own inline name/time editing) or both cleared — never one
  // without the other.
  async function toggleSlideSection(index: number): Promise<void> {
    const config = slideConfigOf(index)
    if (typeof config.section === 'string') {
      await updateSlideConfig(index, { section: undefined, time: undefined })
    } else {
      await updateSlideConfig(index, { section: 'New Section', time: '30s' })
    }
  }

  // Reacts to the Rust-side file watcher (`deck-file-changed`): an external
  // editor (or an AI agent) wrote deck.md. With no unsaved edits it's safe
  // to just reload; with unsaved edits in the open slide, ask — and if the
  // user wants to keep editing, still adopt the new file for everything
  // *except* that one slide, so a later Save targets the right offsets
  // instead of stomping the external change with stale surrounding text.
  async function handleExternalChange(): Promise<void> {
    if (!deckPath() || isBusy()) return
    const source = await deckIpc.readDeckSource()
    if (source === fullSource()) return
    if (isDirty()) {
      const discard = window.confirm(
        'This deck changed outside Peitho Studio (e.g. another editor). Reload it and discard your unsaved edits here?',
      )
      if (!discard) {
        const ranges = splitSlides(source)
        setFullSource(source)
        setSlideRanges(ranges)
        const i = selectedIndex()
        if (i !== null && i < ranges.length) {
          const { rest: withoutNote, note } = extractNote(ranges[i].text)
          const { rest, config } = extractPageComment(withoutNote)
          setEditorSession(session => withRefreshedSaved(session, { body: rest, note, config }))
        }
        await renderPreview(source)
        setStatusMessage('Deck changed on disk elsewhere — merged around your unsaved edit.')
        return
      }
    }
    await refreshSource(true)
    await renderPreview(fullSource())
    setStatusMessage('Reloaded — the deck changed on disk.')
  }

  onMount(() => {
    void refreshRecentDecks()

    // A window spawned by `open_deck_window` (native "Open Deck…"/"Open
    // Recent", or this app's own welcome-screen buttons) has a deck
    // waiting for it in Rust-side `PendingDecks` — that takes priority
    // over the dev-convenience env var, which only matters for a window
    // with nothing else assigned to it.
    void (async () => {
      const pending = await deckIpc.takePendingDeck()
      if (pending) {
        await dispatch({ type: 'open-requested', path: pending })
        if (deckLifecycle().kind !== 'open') {
          // This window exists solely to show `pending` (e.g. a Recent
          // entry that pointed at a folder deleted/moved since it was
          // remembered) — closing it returns focus to whichever window
          // the user was already on, instead of leaving a second,
          // otherwise-empty window sitting on screen with an error banner.
          await getCurrentWindow().close()
        }
        return
      }
      const devDeck = await deckIpc.devDefaultDeck()
      if (devDeck) await dispatch({ type: 'open-requested', path: devDeck })
    })()

    const unlistenFileChanged = deckIpc.onDeckFileChanged(() => {
      void handleExternalChange()
    })

    // Native "File > New Deck…" (see `build_menu` in lib.rs) still needs
    // this app's own name-entry modal, so it round-trips through here.
    // "Open Deck…"/"Open Recent" are handled entirely Rust-side now (a
    // native folder-picker dialog + `open_deck_window`), since neither
    // needs anything this webview can do.
    const unlistenMenuNew = deckIpc.onMenuNewDeck(() => { void handleNewDeck() })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && contextMenu().kind !== 'closed') {
        event.preventDefault()
        closeContextMenu()
        return
      }
      const tag = document.activeElement?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      const count = manifest()?.slides.length ?? 0
      if (count === 0) return
      const current = selectedIndex()
      const key = event.key.toLowerCase()
      if (current !== null) {
        if (event.metaKey && event.shiftKey && event.key === 'ArrowUp') {
          event.preventDefault()
          void moveSlide(current, -1)
          return
        }
        if (event.metaKey && event.shiftKey && event.key === 'ArrowDown') {
          event.preventDefault()
          void moveSlide(current, 1)
          return
        }
        if (event.metaKey && event.key === 'Enter') {
          event.preventDefault()
          void addSlide(current)
          return
        }
        if (event.metaKey && key === 'x') {
          event.preventDefault()
          void cutSlide(current)
          return
        }
        if (event.metaKey && key === 'c') {
          // A slide stays "selected" (and this handler active) the whole
          // time a deck is open, so Cmd+C over an ordinary text selection
          // elsewhere (the deck path, an error message, ...) hit this
          // unconditionally and stole it — `preventDefault` here blocks
          // the native Edit-menu Copy from ever running. Only intercept
          // when there's no real text selection to defer to.
          if ((window.getSelection()?.toString().length ?? 0) > 0) return
          event.preventDefault()
          copySlide(current)
          return
        }
        if (event.metaKey && key === 'v') {
          event.preventDefault()
          void pasteSlideAfter(current)
          return
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          void deleteSlide(current)
          return
        }
      }
      const base = current ?? 0
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        void selectSlide(Math.min(base + 1, count - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        void selectSlide(Math.max(base - 1, 0))
      }
    }
    window.addEventListener('keydown', onKeyDown)

    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown)
      unlistenFileChanged()
      unlistenMenuNew()
    })
  })

  async function handlePresent(rehearsal: boolean): Promise<void> {
    setErrorMessage(null)
    try {
      await deckIpc.presentDeck(rehearsal)
      setStatusMessage(rehearsal ? 'Presenting (rehearsal)…' : 'Presenting…')
    } catch (err) {
      setErrorMessage(String(err))
    }
  }

  function startResize(
    getWidth: () => number,
    setWidth: (next: number) => void,
    direction: 1 | -1,
  ) {
    return (event: MouseEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = getWidth()
      // Dragging the Editor/Preview divider toward the Preview side moves
      // the cursor over the Preview `<iframe>` — a separate browsing
      // context, so `mousemove` stops reaching this document's listener
      // the instant the cursor crosses into it (the drag "stops working"
      // past that point, but only in that direction, since dragging the
      // other way never crosses an iframe). Disabling pointer-events on
      // every iframe for the duration of the drag keeps the cursor's
      // moves targeted at this document throughout.
      const iframes = Array.from(document.querySelectorAll('iframe'))
      for (const frame of iframes) frame.style.pointerEvents = 'none'
      const onMove = (moveEvent: MouseEvent) => {
        const delta = (moveEvent.clientX - startX) * direction
        const next = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, startWidth + delta))
        setWidth(next)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        for (const frame of iframes) frame.style.pointerEvents = ''
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
  }

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {deckPath() === null ? (
        <WelcomeScreen
          isBusy={isBusy()}
          errorMessage={errorMessage()}
          recentDecks={recentDecks()}
          onOpenFolder={() => void handleOpenFolder()}
          onNewDeck={() => void handleNewDeck()}
          onOpenRecent={path => void dispatch({ type: 'open-requested', path })}
        />
      ) : (
        <>
      <DeckHeader
        deckPath={deckPath()}
        presentMenuOpen={presentMenuOpen()}
        onTogglePresentMenu={() => setPresentMenuOpen(!presentMenuOpen())}
        onClosePresentMenu={() => setPresentMenuOpen(false)}
        onPresent={rehearsal => void handlePresent(rehearsal)}
      />

      <div className="flex-1 flex min-h-0">
        <SlideList
          manifest={manifest()}
          slideListWidth={slideListWidth()}
          draggedIndex={draggedIndex()}
          dragOverGap={dragOverGap()}
          dragDeltaY={dragDeltaY()}
          selectedIndex={selectedIndex()}
          sectionStartByIndex={sectionStartByIndex()}
          sectionDrafts={sectionDrafts()}
          canvasWidth={canvasWidth()}
          canvasHeight={canvasHeight()}
          fragmentOf={fragmentOf}
          buildSlideDoc={buildSlideDoc}
          onContextMenu={openContextMenu}
          onDragStart={startSlideDrag}
          onSelectSlide={index => selectSlide(index)}
          onSectionNameInput={onSectionNameInput}
          onSectionTimeInput={onSectionTimeInput}
          onCommitSectionEdit={index => void commitSectionEdit(index)}
        />

        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startResize(slideListWidth, setSlideListWidth, 1)}
        />

        <div
          className="shrink-0 flex flex-col border-r border-border min-h-0"
          style={`width: ${editorWidth()}px`}
        >
          <SlideEditor
            hasSelection={selectedRange() !== null}
            onBodyRef={onBodyTextareaRef}
            onNoteRef={onNoteTextareaRef}
            onBodyInput={value => setEditorSession(session => withDraftBody(session, value))}
            onNoteInput={value => setEditorSession(session => withDraftNote(session, value))}
          />
        </div>

        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
          onMouseDown={startResize(editorWidth, setEditorWidth, 1)}
        />

        <SlidePreview
          selectedSlideKey={selectedSlideKey()}
          srcdoc={buildSelectedSlideDoc(selectedSlideKey())}
          hasDeck={Boolean(assetBaseUrl())}
        />
      </div>

      <StatusBar
        errorMessage={errorMessage()}
        errorMessageCopied={errorMessageCopied()}
        statusMessage={statusMessage()}
        onCopyErrorMessage={() => void copyErrorMessage()}
      />

      <SlideContextMenu
        hidden={contextMenu().kind === 'closed'}
        position={contextMenuPositionOf(contextMenu())}
        menuItems={currentMenuItems()}
        layoutPickerOpen={isLayoutPickerOpen(contextMenu())}
        layoutPickerView={layoutPickerView()}
        layoutPreviews={layoutPreviews()}
        layoutPreviewCss={layoutPreviewCss()}
        canvasWidth={canvasWidth()}
        canvasHeight={canvasHeight()}
        onMenuRef={el => { contextMenuEl = el }}
        onClose={closeContextMenu}
        onNewSlide={() => { void addSlide(contextMenuAppendIndex()); closeContextMenu() }}
        onCut={() => { void cutSlide(contextMenuIndexOf(contextMenu())!); closeContextMenu() }}
        onCopy={() => { copySlide(contextMenuIndexOf(contextMenu())!); closeContextMenu() }}
        onPaste={() => { void pasteSlideAfter(contextMenuAppendIndex()); closeContextMenu() }}
        onDelete={() => { void deleteSlide(contextMenuIndexOf(contextMenu())!); closeContextMenu() }}
        onToggleLayoutPicker={toggleLayoutPicker}
        onChangeLayout={name => { void changeSlideLayout(contextMenuIndexOf(contextMenu())!, name); closeContextMenu() }}
        onToggleDraft={() => { void toggleSlideDraft(contextMenuIndexOf(contextMenu())!); closeContextMenu() }}
        onToggleSkip={() => { void toggleSlideSkip(contextMenuIndexOf(contextMenu())!); closeContextMenu() }}
        onToggleSection={() => { void toggleSlideSection(contextMenuIndexOf(contextMenu())!); closeContextMenu() }}
        onMoveUp={() => { void moveSlide(contextMenuIndexOf(contextMenu())!, -1); closeContextMenu() }}
        onMoveDown={() => { void moveSlide(contextMenuIndexOf(contextMenu())!, 1); closeContextMenu() }}
      />
        </>
      )}

      <NewDeckModal
        isOpen={newDeckModalOpen()}
        name={newDeckName()}
        parentDir={newDeckParentDir()}
        isBusy={isBusy()}
        onNameChange={name => void dispatch({ type: 'name-changed', name })}
        onCancel={() => void dispatch({ type: 'create-cancelled' })}
        onConfirm={() => void dispatch({ type: 'create-confirmed' })}
      />
    </div>
  )
}
