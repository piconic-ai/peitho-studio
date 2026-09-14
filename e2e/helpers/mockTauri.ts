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
import { splitSlides, extractPageComment, extractHeadingText, slugifyTitle, uniqueSlideKey } from '../../domain/slides'
import type { Manifest, ManifestSlide, RenderPayload } from '../../domain/render'

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
  /** Milliseconds `open_deck` waits before resolving/rejecting — defaults
   * to 0 (settles on the same tick), matching a real in-process
   * peitho-core render of a small deck closely enough to observe
   * WelcomeScreen's min-display-duration floor on its busy feedback (see
   * `remainingMinDisplayMs`/`todo/welcome-open-feels-frozen.md`) even
   * when this resolves near-instantly. */
  openDeckDelayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildManifest(source: string): { manifest: Manifest; fragments: Record<string, string> } {
  const ranges = splitSlides(source)
  const keys: string[] = []
  const slides: ManifestSlide[] = ranges.map((range, index) => {
    const { rest, config } = extractPageComment(range.text)
    const title = extractHeadingText(rest) ?? ''
    const key = config.key ?? uniqueSlideKey(slugifyTitle(title || `slide-${String(index)}`), keys)
    keys.push(key)
    return {
      index, key, src: range.text, hasNotes: false, skip: config.skip ?? false,
      revealSteps: 1, text: { title, body: rest, code: '' },
    }
  })
  const fragments: Record<string, string> = {}
  for (const s of slides) fragments[s.key] = `<section class="peitho-slide"><h1>${s.text.title}</h1></section>`
  const manifest: Manifest = {
    title: 'Fake Deck', slideCount: slides.length, canvasWidth: 1280, canvasHeight: 720, sections: [], slides,
  }
  return { manifest, fragments }
}

function renderPayloadFor(source: string): RenderPayload {
  const { manifest, fragments } = buildManifest(source)
  return { manifest, fragments, assetBaseUrl: 'http://localhost:9/', css: '.peitho-slide { color: black; }' }
}

/** Wires `page` up to open `deck.source` as a fake deck on load, and keeps
 * `deck.source` in sync with every `save_deck_source` call — so a test can
 * read it back afterward to assert on the persisted content. Call before
 * `page.goto('/')`. */
export async function mockTauri(page: Page, deck: MockDeck): Promise<void> {
  await page.exposeFunction('__mockInvoke', async (cmd: string, args: Record<string, unknown>) => {
    const error = deck.commandError?.(cmd, args)
    if (cmd === 'present_deck' && deck.presentDeckDelayMs) await sleep(deck.presentDeckDelayMs)
    if (cmd === 'open_deck' && deck.openDeckDelayMs) await sleep(deck.openDeckDelayMs)
    if (error !== null && error !== undefined) throw new Error(error)
    switch (cmd) {
      case 'dev_default_deck': return deck.devDefaultDeck === undefined ? '/fake/deck.md' : deck.devDefaultDeck
      case 'take_pending_deck': return null
      case 'get_recent_decks': return deck.recentDecks ?? []
      case 'open_deck':
        return { deckPath: deck.source, deckDir: '/fake', render: renderPayloadFor(deck.source) }
      case 'render_draft':
        return renderPayloadFor(args.content as string)
      case 'read_deck_source': return deck.source
      case 'save_deck_source':
        deck.source = args.content as string
        return null
      case 'preview_layouts': return { previews: [], css: '' }
      case 'present_deck':
        // Fires after the spawn itself resolves, matching real timing —
        // `watch_present_readiness` (peitho.rs) only starts watching
        // stdout once `Command::spawn()` has already returned. Not a
        // real subprocess, so this stands in for however long `peitho
        // present` would take to render and start serving.
        void sleep(deck.presentReadyDelayMs ?? 0).then(() => (
          page.evaluate(() => { (window as unknown as { __mockEmitTauriEvent?: (event: string, payload: unknown) => void }).__mockEmitTauriEvent?.('present-ready', null) })
        ))
        return null
      case 'create_deck': return '/fake/new-deck/deck.md'
      case 'plugin:dialog|open': return deck.dialogPath ?? null
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
      __mockEmitTauriEvent?: (event: string, payload: unknown) => void
    }
    const callbacks = w as unknown as Record<string, ((payload: unknown) => void) | undefined>
    w.__TAURI_INTERNALS__ = w.__TAURI_INTERNALS__ ?? {}
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = w.__TAURI_EVENT_PLUGIN_INTERNALS__ ?? {}

    const listenerIdsByEvent = new Map<string, Set<number>>()
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

    w.__mockEmitTauriEvent = (event: string, payload: unknown) => {
      for (const id of listenerIdsByEvent.get(event) ?? []) {
        callbacks[`_${id}`]?.({ event, id, payload })
      }
    }

    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === 'plugin:event|listen') {
        const event = args.event as string
        const handlerId = args.handler as number
        if (!listenerIdsByEvent.has(event)) listenerIdsByEvent.set(event, new Set())
        listenerIdsByEvent.get(event)?.add(handlerId)
        return handlerId
      }
      if (cmd.startsWith('plugin:event|')) return null
      return w.__mockInvoke(cmd, args)
    }
  })
}
