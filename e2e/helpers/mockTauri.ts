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
  /** When set, `render_draft` rejects with the returned message instead of
   * succeeding, for any `content` this returns non-null for — lets a test
   * simulate a peitho-core build error (e.g. an ambiguous-layout slide)
   * without this helper needing to model real layout dispatch itself. */
  renderDraftError?: (content: string) => string | null
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
  await page.exposeFunction('__mockInvoke', (cmd: string, args: Record<string, unknown>) => {
    switch (cmd) {
      case 'dev_default_deck': return '/fake/deck.md'
      case 'take_pending_deck': return null
      case 'get_recent_decks': return []
      case 'open_deck':
        return { deckPath: deck.source, deckDir: '/fake', render: renderPayloadFor(deck.source) }
      case 'render_draft': {
        const content = args.content as string
        const error = deck.renderDraftError?.(content)
        if (error !== null && error !== undefined) throw new Error(error)
        return renderPayloadFor(content)
      }
      case 'read_deck_source': return deck.source
      case 'save_deck_source':
        deck.source = args.content as string
        return null
      case 'preview_layouts': return { previews: [], css: '' }
      case 'present_deck': return null
      default: return null
    }
  })

  // `plugin:event|listen`'s `handler` is a callback ID transformCallback()
  // produced, not the callback itself — this mock never actually invokes
  // it (no #[tauri::command] the fake set below emits an event), so it's
  // only tracked to keep `unlisten()` a well-formed no-op.
  await page.addInitScript(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: Record<string, unknown>
      __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>
      __mockInvoke: (cmd: string, args: unknown) => Promise<unknown>
    }
    w.__TAURI_INTERNALS__ = w.__TAURI_INTERNALS__ ?? {}
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = w.__TAURI_EVENT_PLUGIN_INTERNALS__ ?? {}
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd.startsWith('plugin:event|') || cmd === 'plugin:dialog|open') return null
      return w.__mockInvoke(cmd, args)
    }
    let nextCallbackId = 1
    w.__TAURI_INTERNALS__.transformCallback = () => nextCallbackId++
  })
}
