// Stubs window.__TAURI_INTERNALS__.invoke (via page.exposeFunction) so
// Studio.tsx runs against the plain dev server exactly as it does under a
// real Tauri window, past the welcome screen this suite used to be capped
// at — every #[tauri::command] renderDraft/openDeck touch is answered by
// domain/slides.ts run in Node instead of peitho-core, close enough to
// exercise the frontend's own reactive/DOM logic (this is how the New
// Slide regression in dom/slideCanvas.ts was actually caught and fixed).
// A synthetic RenderPayload, not real peitho-core output — verified
// against production behavior separately (run-peitho-studio skill).
import type { Page } from '@playwright/test'
import { splitSlides, extractPageComment, extractHeadingText, slugifyTitle, uniqueSlideKey, parseDurationToMs } from '../../domain/slides'
import type { Manifest, ManifestSection, ManifestSlide, RenderPayload } from '../../domain/render'
import type { DeckVariant } from '../../domain/deckVariants'
import type { LayoutVerdict } from '../../domain/layoutFit'
import type { Size } from '../../domain/geometry'

export interface MockDeck {
  source: string
  /** Paths `get_recent_decks` returns — defaults to none. */
  recentDecks?: string[]
  /** What `dev_default_deck` returns — defaults to `deck.source`'s own
   * fake path (auto-opening it, past the welcome screen, before a test's
   * first assertion). Pass `null` for a test that needs to actually land
   * on the welcome screen (e.g. to exercise a failed `open_deck`/
   * `create_deck` from there). */
  devDefaultDeck?: string | null
  /** What the native folder-picker (`plugin:dialog|open`) resolves to —
   * defaults to `null` (cancelled), matching a real dialog nothing has
   * driven. Set a fake directory path for a test that needs "Open Deck…"/
   * "New Deck…" to proceed past the picker. */
  dialogPath?: string | null
  /** When this returns non-null for a given command + args, that
   * `invoke()` call rejects with the message instead of succeeding — lets
   * a test simulate any backend failure (a peitho-core build error on
   * `render_draft`, a failed `open_deck`/`create_deck`, ...) without this
   * helper needing to model the real failure condition itself. */
  commandError?: (cmd: string, args: Record<string, unknown>) => string | null
  /** Milliseconds `present_deck` waits before resolving/rejecting —
   * defaults to 0 (settles on the same tick). Represents latency in the
   * `spawn()` call itself (session-lock contention, a failing spawn), not
   * how long the presentation takes to actually render — that's
   * `presentReadyDelayMs` below, which is the one that matters for
   * observing `DeckHeader.tsx`'s `presentPending` busy state in a test. */
  presentDeckDelayMs?: number
  /** Milliseconds after a successful `present_deck` before the mock emits
   * the `present-ready` event — defaults to 0 (fires on the same tick,
   * same as a trivially fast deck). Mirrors `watch_present_readiness` in
   * peitho.rs: in reality this is how long `peitho present` takes to
   * render the deck and start serving it, which is the actual source of
   * lag a heavy deck causes — `present_deck`'s own resolution is near-
   * instant regardless of deck size, since it only waits for `spawn()`.
   * Set this to observe `presentPending` staying busy across a slow
   * render. Not emitted at all when `present_deck` itself is made to fail
   * via `commandError` — a failed spawn never starts a process to become
   * ready. */
  presentReadyDelayMs?: number
  /** When set, `present_deck` emits `present-failed` (with this message)
   * instead of `present-ready`, after `presentReadyDelayMs` — simulates
   * the subprocess exiting without ever signaling readiness (e.g.
   * `--rehearsal` rejected on a deck with no agenda sections; see
   * `watch_present_failure` in peitho.rs). Ignored when `commandError`
   * already fails `present_deck` itself — that's a failed spawn, which
   * never gets far enough to report this way. */
  presentFailedMessage?: string
  /** Milliseconds `open_deck` waits before resolving/rejecting — defaults
   * to 0 (settles on the same tick). Set this to observe Studio.tsx's
   * loading placeholder, which shows only until `open_deck` resolves (on a
   * real device, from tens of milliseconds up to ~0.6s for a code-heavy deck
   * the launch warm-up didn't cover — see
   * `todo/archive/open-deck-cold-start-latency.md`). */
  openDeckDelayMs?: number
  /** What `list_deck_variants` returns — defaults to none, which hides the
   * deck header's variant switcher. */
  deckVariants?: DeckVariant[]
  /** Called with every `invoke()` that reaches the mock — including ones
   * `commandError` then fails — so a test can assert on which commands a
   * UI action actually sent. */
  onInvoke?: (cmd: string, args: Record<string, unknown>) => void
  /** Layout names `preview_layouts` lists (each with `layoutFragment`,
   * empty by default, so the picker shows name-only cards) — defaults to
   * none ("No layouts found"). */
  layouts?: string[]
  /** What `check_slide_layouts` answers for the given source/slide index —
   * defaults to `null` (nothing to judge, every layout stays choosable).
   * Stands in for `engine::layout_fit`'s real peitho-core verdicts. */
  layoutVerdicts?: (content: string, slideIndex: number) => LayoutVerdict[] | null
  /** Milliseconds `check_slide_layouts` waits before answering — defaults
   * to 0. Set this to observe the picker while the check is in flight. */
  checkSlideLayoutsDelayMs?: number
  /** Every `invoke()` command name, in call order — appended to when
   * provided, so a test can assert a command never ran (e.g. nothing was
   * rendered or saved). */
  invokedCommands?: string[]
  /** Milliseconds `render_draft` waits before resolving/rejecting —
   * defaults to 0 (settles on the same tick). Set this to widen the window
   * in which a save is still in flight, e.g. to exercise edits the user
   * makes while a previous commit's re-render hasn't landed yet. */
  renderDraftDelayMs?: number
  /** Builds a slide's rendered fragment HTML from its title — defaults to
   * a bare `<h1>{title}</h1>`. Override to exercise fragment content the
   * default template can't produce (e.g. an embedded `<script>`, testing
   * `dom/slideCanvas.ts`'s script-execution fix). */
  fragmentFor?: (title: string) => string
  /** The deck's theme CSS (the payload's `css`) — defaults to a bare
   * `.peitho-slide { color: black; }`, which does not size the slide. Set it
   * to exercise CSS that reacts to the canvas's own shape (an `@container`
   * rule on `.peitho-slide`, which needs the same `width`/`height` from
   * `--peitho-canvas-width/height` that the real theme gives it). */
  css?: string
  /** The deck's native canvas size (the manifest's `canvasWidth/Height`) —
   * defaults to 16:9, 1280x720. peitho-core only produces that or 4:3
   * (960x720). */
  canvas?: Size
  /** The fragment every `preview_layouts` entry carries — defaults to an
   * empty one (the picker then draws name-only cards and mounts no canvas).
   * Set it to give the picker real slide canvases to inspect. */
  layoutFragment?: string
  /** What `get_settings` answers — defaults to `{}` (nothing saved yet).
   * Passed as is, so a test can hand over a malformed value too. */
  settings?: unknown
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const DEFAULT_CANVAS: Size = { width: 1280, height: 720 }

function buildManifest(source: string, fragmentFor: (title: string) => string, canvas: Size): { manifest: Manifest; fragments: Record<string, string> } {
  const ranges = splitSlides(source)
  const keys: string[] = []
  const slides: ManifestSlide[] = []
  const sections: ManifestSection[] = []
  // Mirrors real peitho-core: a slide marked `"draft":true` never reaches
  // the manifest at all (see `domain/slideList.ts`'s `buildSlideList`,
  // which is what actually copes with that on the frontend side). Getting
  // this right in the mock matters — a version that kept draft slides as
  // ordinary rows would hide the very bug (a thumbnail's row index
  // silently drifting from `editor.slideRanges()`'s once a draft precedes
  // it) this mock exists to catch.
  for (const range of ranges) {
    const { rest, config } = extractPageComment(range.text)
    if (config.draft === true) continue
    // A slide whose PageComment sets both `section` and `time` starts a
    // section running up to the next one, the same pairing peitho-core
    // requires. Only the `1m30s`-style times `parseDurationToMs` reads are
    // modeled; peitho-core also accepts `1h` and bare minute counts, and
    // rejects a deck whose time is 0 or unreadable. Such a slide gets no
    // section here rather than a section peitho-core would never report.
    // The section's own index is the manifest index this slide is about
    // to get (`slides.length`, not this range's raw position), since a
    // draft slide earlier in the deck is never counted here either.
    const plannedDurationMs = typeof config.time === 'string' ? parseDurationToMs(config.time) : null
    if (typeof config.section === 'string' && plannedDurationMs !== null && plannedDurationMs > 0) {
      const previous = sections[sections.length - 1]
      if (previous) previous.endIndex = slides.length - 1
      sections.push({ name: config.section, startIndex: slides.length, endIndex: ranges.length - 1, plannedDurationMs })
    }
    const title = extractHeadingText(rest) ?? ''
    const key = config.key ?? uniqueSlideKey(slugifyTitle(title || `slide-${String(slides.length)}`), keys)
    keys.push(key)
    slides.push({
      index: slides.length, key, src: range.text, hasNotes: false, skip: config.skip ?? false,
      revealSteps: 1, text: { title, body: rest, code: '' },
    })
  }
  const fragments: Record<string, string> = {}
  for (const s of slides) fragments[s.key] = fragmentFor(s.text.title)
  const manifest: Manifest = {
    title: 'Fake Deck', slideCount: slides.length, canvasWidth: canvas.width, canvasHeight: canvas.height, sections, slides,
  }
  return { manifest, fragments }
}

const DEFAULT_FRAGMENT_FOR = (title: string): string => `<section class="peitho-slide"><h1>${title}</h1></section>`

const DEFAULT_CSS = '.peitho-slide { color: black; }'

function renderPayloadFor(source: string, deck: MockDeck): RenderPayload {
  const { manifest, fragments } = buildManifest(source, deck.fragmentFor ?? DEFAULT_FRAGMENT_FOR, deck.canvas ?? DEFAULT_CANVAS)
  return { manifest, fragments, assetBaseUrl: 'http://localhost:9/', css: deck.css ?? DEFAULT_CSS }
}

/** Wires `page` up to open `deck.source` as a fake deck on load, and keeps
 * `deck.source` in sync with every `save_deck_source` call — so a test can
 * read it back afterward to assert on the persisted content. Call before
 * `page.goto('/')`. */
export async function mockTauri(page: Page, deck: MockDeck): Promise<void> {
  await page.exposeFunction('__mockInvoke', async (cmd: string, args: Record<string, unknown>) => {
    deck.invokedCommands?.push(cmd)
    const error = deck.commandError?.(cmd, args)
    if (cmd === 'present_deck' && deck.presentDeckDelayMs) await sleep(deck.presentDeckDelayMs)
    if (cmd === 'open_deck' && deck.openDeckDelayMs) await sleep(deck.openDeckDelayMs)
    if (cmd === 'check_slide_layouts' && deck.checkSlideLayoutsDelayMs) await sleep(deck.checkSlideLayoutsDelayMs)
    if (cmd === 'render_draft' && deck.renderDraftDelayMs) await sleep(deck.renderDraftDelayMs)
    deck.onInvoke?.(cmd, args)
    if (error !== null && error !== undefined) throw new Error(error)
    switch (cmd) {
      case 'dev_default_deck': return deck.devDefaultDeck === undefined ? '/fake/deck.md' : deck.devDefaultDeck
      case 'take_pending_deck': return null
      case 'get_recent_decks': return deck.recentDecks ?? []
      case 'open_deck':
        return { deckPath: deck.source, deckDir: '/fake', render: renderPayloadFor(deck.source, deck) }
      case 'render_draft':
        return renderPayloadFor(args.content as string, deck)
      case 'read_deck_source': return deck.source
      case 'save_deck_source':
        deck.source = args.content as string
        return null
      case 'preview_layouts': return { previews: (deck.layouts ?? []).map(name => ({ name, fragment: deck.layoutFragment ?? '' })), css: '' }
      case 'list_deck_variants': return deck.deckVariants ?? []
      case 'check_slide_layouts':
        return deck.layoutVerdicts?.(args.content as string, args.slideIndex as number) ?? null
      case 'present_deck':
        // Fires after the spawn itself resolves, matching real timing —
        // `watch_present_readiness`/`watch_present_failure` (peitho.rs)
        // only start watching stdout/stderr once `Command::spawn()` has
        // already returned. Not a real subprocess, so this stands in for
        // however long `peitho present` would take to either start
        // serving or exit having never gotten that far.
        void sleep(deck.presentReadyDelayMs ?? 0).then(() => (
          page.evaluate(({ event, payload }) => {
            (window as unknown as { __mockEmitTauriEvent?: (event: string, payload: unknown) => void }).__mockEmitTauriEvent?.(event, payload)
          }, deck.presentFailedMessage === undefined
            ? { event: 'present-ready', payload: null }
            : { event: 'present-failed', payload: deck.presentFailedMessage })
        ))
        return null
      case 'create_deck': return '/fake/new-deck/deck.md'
      case 'plugin:dialog|open': return deck.dialogPath ?? null
      case 'get_settings': return deck.settings ?? {}
      default: return null
    }
  })

  // A minimal but real implementation of Tauri's event-listener plumbing
  // (`transformCallback`/`plugin:event|listen`/`unregisterListener`) —
  // needed so `deckIpc.onPresentReady` (and any other `listen()` call) can
  // actually receive a simulated event via `__mockEmitTauriEvent` below,
  // rather than the previous version's permanent no-op (fine when nothing
  // needed to actually observe an event, but `handlePresent` now awaits
  // `present-ready` before clearing its busy state, so a listener that
  // never fires would make every present-click test hang until its
  // timeout).
  await page.addInitScript(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: Record<string, unknown>
      __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>
      __mockInvoke: (cmd: string, args: unknown) => Promise<unknown>
      __mockEmitTauriEvent?: (event: string, payload: unknown, toWindow?: string) => void
    }
    const callbacks = w as unknown as Record<string, ((payload: unknown) => void) | undefined>
    w.__TAURI_INTERNALS__ = w.__TAURI_INTERNALS__ ?? {}
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = w.__TAURI_EVENT_PLUGIN_INTERNALS__ ?? {}
    // This page plays the one webview window labeled `main`, the label
    // `getCurrentWebviewWindow()` (per-window listens) reads from here.
    w.__TAURI_INTERNALS__.metadata = {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    }

    const listenerIdsByEvent = new Map<string, Set<number>>()
    // The label a listener was registered for (`getCurrentWebviewWindow()
    // .listen`), or `null` for a plain `listen()`, which hears every event.
    const listenerLabels = new Map<number, string | null>()
    let nextCallbackId = 1

    // Mirrors real Tauri: registers `callback` under a numeric id and
    // exposes it as `window['_' + id]`, which is how the real IPC bridge
    // (and our own `__mockEmitTauriEvent` below) delivers a payload back
    // to it.
    w.__TAURI_INTERNALS__.transformCallback = (callback: (payload: unknown) => void, once?: boolean) => {
      const id = nextCallbackId++
      callbacks[`_${id}`] = payload => {
        if (once) delete callbacks[`_${id}`]
        return callback(payload)
      }
      return id
    }

    // Called directly (not through `invoke`) by `@tauri-apps/api/event`'s
    // `_unlisten` — without this, every `unlisten()` call (Studio.tsx
    // calls one on every present click, once `waitForEventOrTimeout`
    // settles) throws, since the real Tauri runtime normally supplies it.
    w.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = (event: string, eventId: number) => {
      listenerIdsByEvent.get(event)?.delete(eventId)
    }

    // `toWindow` mirrors Rust's `emit_to` a window label: like Tauri, a
    // plain `listen()` still hears it, a per-window listener only when the
    // label is its own. Omitted, it's a broadcast `emit`.
    w.__mockEmitTauriEvent = (event: string, payload: unknown, toWindow?: string) => {
      for (const id of listenerIdsByEvent.get(event) ?? []) {
        const label = listenerLabels.get(id) ?? null
        if (toWindow !== undefined && label !== null && label !== toWindow) continue
        callbacks[`_${id}`]?.({ event, id, payload })
      }
    }

    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === 'plugin:event|listen') {
        const event = args.event as string
        const handlerId = args.handler as number
        if (!listenerIdsByEvent.has(event)) listenerIdsByEvent.set(event, new Set())
        listenerIdsByEvent.get(event)?.add(handlerId)
        const target = args.target as { kind: string; label?: string } | undefined
        listenerLabels.set(handlerId, target && target.kind !== 'Any' ? target.label ?? null : null)
        return handlerId
      }
      if (cmd.startsWith('plugin:event|')) return null
      return w.__mockInvoke(cmd, args)
    }
  })
}
