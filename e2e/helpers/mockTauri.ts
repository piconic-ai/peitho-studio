import { initialUpdateStatus, type UpdateStatus } from '../../domain/updates'
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
import { splitSlides, extractNote, extractPageComment, extractHeadingText, slugifyTitle, uniqueSlideKey, parseDurationToMs } from '../../domain/slides'
import type { Manifest, ManifestSection, ManifestSlide, RenderPayload } from '../../domain/render'
import type { DeckVariant } from '../../domain/deckVariants'
import type { LayoutVerdict } from '../../domain/layoutFit'
import type { Size } from '../../domain/geometry'
import { readFrontmatterKey } from '../../domain/frontmatter'
import type { NewLayoutComment, NewReviewComment, NewReviewReply } from '../../domain/critReview'
import type { FakeCritIpc } from '../../ipc/fakeCritIpc'

export interface MockDeck {
  source: string
  /** Model Studio's editable slot wrappers from the supplied layout HTML. */
  editableLayouts?: boolean
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
  /** What `take_pending_deck` answers, consumed exactly once — defaults to
   * `null` (nothing waiting), matching a plain launch. Stands in for
   * Rust-side `PendingDecks`: a `deck-N` window `open_deck_window_impl`
   * spawned (Open Deck…/Open Recent/variant switch), or — since
   * `finder_open_target` in peitho.rs — the `main` window itself, reused
   * for Finder's first double-click since launch instead of opening a
   * redundant second window. This mock always plays `main` (see
   * `currentWindow` below), so setting this is how a test exercises that
   * second case. */
  pendingDeck?: string | null
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
  /** Every render's `headingLayouts` (the layouts a heading-only slide
   * builds on) — defaults to `layouts` plus any layout a slide names, i.e.
   * every layout taking a lone heading. */
  headingLayouts?: string[]
  /** What `check_slide_layouts` answers for the given source/slide index —
   * defaults to `null` (nothing to judge, every layout stays choosable).
   * Stands in for `engine::layout_fit`'s real peitho-core verdicts. */
  layoutVerdicts?: (content: string, slideIndex: number) => LayoutVerdict[] | null
  /** What `add_image_layout` resolves with for the given source/slide
   * index — defaults to no files written. Stands in for
   * `engine::image_layout`; make it throw (or use `commandError`) to
   * refuse, or return a promise to hold the command in flight. */
  addImageLayout?: (content: string, slideIndex: number) => string[] | Promise<string[]>
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
   * defaults to what the source's frontmatter `aspect_ratio` gives, as in
   * peitho-core: 4:3 is 960x720, anything else 16:9, 1280x720. Set it to
   * fix the size whatever the source says. peitho-core only produces those
   * two sizes. */
  canvas?: Size
  /** The layout screen's files, by layout name — what `read_deck_file`
   * answers for `layouts/<name>.html` and `css/<name>.css`, and
   * `save_deck_file` / `create_layout` / `duplicate_layout` /
   * `delete_layout` change (with `layouts`, which they keep in step).
   * Defaults to none: a layout read without an entry gets a bare
   * `<section>` and no CSS (its CSS reads blank). Stands in for
   * `engine::layout_files` / `engine::deck_files`, modeling only what the
   * frontend relies on: a name taken is refused, a copy is `<name>-copy`,
   * `check_layout_removal` refuses while a slide of `repinned` still names
   * the layout, and saving a layout's HTML refuses one with no
   * `<section`. */
  layoutFiles?: Record<string, { html: string; css: string | null }>
  /** The deck's other files under `layouts/`, `css/`, `img/` and `fonts/`,
   * by path — `css/base.css`, `img/logo.png` — listed by
   * `list_deck_files` and, for a `.css`, read and saved like a layout's.
   * Defaults to none. */
  otherFiles?: Record<string, string>
  /** Milliseconds `preview_layout_draft` waits for the given draft HTML —
   * defaults to 0. Make an earlier draft slower than a later one to
   * deliver the answers out of order. */
  layoutDraftPreviewDelayMs?: (html: string) => number
  /** Milliseconds `delete_layout` waits before resolving/rejecting —
   * defaults to 0. Set this to act (e.g. Undo) while a deletion is in
   * flight. */
  deleteLayoutDelayMs?: number
  /** When set, `render_draft` fails for a source with a slide naming a
   * layout `layouts` doesn't list — as peitho-core does once a layout's
   * file is gone. Off by default: most tests name layouts freely. */
  rejectUnknownLayouts?: boolean
  /** The fragment every `preview_layouts` entry carries — defaults to an
   * empty one (the picker then draws name-only cards and mounts no canvas).
   * Set it to give the picker real slide canvases to inspect. */
  layoutFragment?: string
  /** What `get_settings` answers — defaults to `{}` (nothing saved yet).
   * Passed as is, so a test can hand over a malformed value too.
   * `update_settings` merges its patch into this and, like `settings.rs`,
   * broadcasts the result as `settings:changed`. */
  settings?: unknown
  updateStatus?: UpdateStatus
  checkUpdateResult?: UpdateStatus
  updateSaveAcks?: { token: number; saved: boolean }[]
  beforeSave?: (source: string) => Promise<void>
  /** What `get_system_locales` answers (the OS's preferred languages) —
   * defaults to `['en-US']`. */
  systemLocales?: unknown
  /** The OS clipboard's text that `plugin:clipboard-manager|read_text`
   * answers and `write_text` replaces — defaults to none (`null`). */
  clipboardText?: string | null
  /** Milliseconds `plugin:clipboard-manager|read_text`/`write_text` wait
   * before answering — defaults to 0. Set it to act (switch slides or
   * tabs) while a menu's Cut or Paste is still talking to the clipboard. */
  clipboardDelayMs?: number
  /** Whether `open_deck` reports the deck's folder as trusted to run
   * scripts — defaults to `false`, like a deck somebody else wrote.
   * `trust_open_deck` sets it to `true` (so a reload opens it trusted, as a
   * restart would). */
  trusted?: boolean
  /** What `import_deck_image_file` / `import_deck_image_bytes` answer —
   * the deck-relative path of the saved image. Defaults to
   * `img/<file name>` (the dropped file's, or the pasted image's
   * `x-image-name` header), as `engine::images` names a plain name. For
   * `import_deck_image_bytes`, `args` is `{ bytes, headers }` (the raw body
   * as a number array). Nothing is written anywhere. */
  importImage?: (cmd: string, args: Record<string, unknown>) => string
  /** Milliseconds `import_deck_image_file`/`_bytes` wait before answering —
   * defaults to 0. Set it to act while an image is still being saved. */
  importImageDelayMs?: number
  /** What `get_about_info` answers (the About window's page) — defaults to
   * a CI build with a commit. Passed as is, so a test can hand over a
   * malformed value too. */
  aboutInfo?: unknown
  /** Renders each slide as peitho-core's `EditAnnotations::On` would —
   * `data-peitho-src`/`data-peitho-md` on its headings, list items and
   * paragraphs (see `annotatedFragment`) — instead of `fragmentFor`. */
  editAnnotations?: boolean
  /** The path `open_deck` reports — defaults to the source itself (which
   * the header then shows; most tests never read it). */
  deckPath?: string
  /** Answers the `crit_*` commands, and forwards its `crit-review` events
   * to the page. Without it they answer `null` (no crit at all). */
  crit?: FakeCritIpc
  /** What `layout_files_stamp` answers — defaults to `''`. Change it to
   * stand for a layout file written outside Studio (the agent's edit), and
   * `emitLayoutFilesChanged` for the watcher's report of it. A
   * `save_deck_file` moves it on (`saved-1`, `saved-2`, …) and answers it, as
   * the real one answers the files' fingerprint once written. */
  layoutFilesStamp?: string
  /** Milliseconds `save_deck_file` waits before writing — defaults to 0. Set
   * it to type or act while an autosave is in flight. */
  saveLayoutDelayMs?: number
  /** Milliseconds `read_deck_file` waits before answering what it read when
   * called — defaults to 0. Set it to act (start an IME composition, say)
   * while open files are being read back. */
  readDeckFileDelayMs?: number
  /** Milliseconds `layout_files_stamp` waits before answering what it read
   * when called — defaults to 0. Set it to let a write land while a read
   * of the older fingerprint is still in flight. */
  layoutFilesStampDelayMs?: number
}

/** Stands in for the layout-files watcher (`watch_layout_dirs` in
 * peitho.rs): tells the page its deck's layout files changed on disk. */
export async function emitLayoutFilesChanged(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __mockEmitTauriEvent: (event: string, payload: unknown, toWindow?: string) => void })
      .__mockEmitTauriEvent('layout-files-changed', null, 'main')
  })
}

const DEFAULT_ABOUT_INFO = {
  name: 'Peitho Studio', version: '0.1.0', build: '42',
  commit: '5995c42a1b2c3d4e5f60718293a4b5c6d7e8f901', copyright: 'Copyright (c) 2026 kfly8',
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** The canvas peitho-core sizes a deck to from its `aspect_ratio`. */
function canvasFor(source: string): Size {
  return readFrontmatterKey(source, 'aspect_ratio') === '4:3' ? { width: 960, height: 720 } : { width: 1280, height: 720 }
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length

/** `markdown` as peitho-core writes it into `data-peitho-md`
 * (`encode_edit_markdown_attribute`). */
function encodeEditMarkdown(markdown: string): string {
  return markdown.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

/** A slide fragment carrying edit annotations the way peitho-core's
 * `EditAnnotations::On` does (UTF-8 byte spans into the whole `source`),
 * one element per line of the slide at `start`: `# x` a heading (annotated
 * through an inner `<span>`), `- x` a list item, `![…](…)` an image (not
 * annotated), anything else a paragraph. Comment lines are skipped. */
function annotatedFragment(source: string, start: number, text: string): string {
  const parts: string[] = []
  let offset = start
  for (const line of text.split('\n')) {
    const lineStart = offset
    offset += line.length + 1
    const heading = /^(#{1,6}) (.*)$/.exec(line)
    const item = /^- (.*)$/.exec(line)
    const content = heading?.[2] ?? item?.[1] ?? line
    if (line.trim() === '' || line.startsWith('<!--')) continue
    if (/^!\[/.test(line)) {
      parts.push('<p><img alt="" width="320" height="180" style="display: block; background: gray" src="data:,"></p>')
      continue
    }
    const at = lineStart + line.length - content.length
    const attrs = `data-peitho-src="${String(utf8Bytes(source.slice(0, at)))}-${String(utf8Bytes(source.slice(0, at + content.length)))}" data-peitho-md="${encodeEditMarkdown(content)}"`
    if (heading) parts.push(`<h${String(heading[1].length)}><span ${attrs}>${escapeHtml(content)}</span></h${String(heading[1].length)}>`)
    else if (item) parts.push(`<ul><li ${attrs}>${escapeHtml(content)}</li></ul>`)
    else parts.push(`<p ${attrs}>${escapeHtml(content)}</p>`)
  }
  return `<section class="peitho-slide" style="width: var(--peitho-canvas-width); height: var(--peitho-canvas-height); padding: 40px; box-sizing: border-box; background: white">${parts.join('')}</section>`
}

function buildManifest(source: string, fragmentFor: (title: string) => string, canvas: Size, annotate = false): { manifest: Manifest; fragments: Record<string, string> } {
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
  for (const s of slides) {
    const range = ranges.find(r => r.text === s.src)
    fragments[s.key] = annotate && range ? annotatedFragment(source, range.start, range.text) : fragmentFor(s.text.title)
  }
  const manifest: Manifest = {
    title: 'Fake Deck', slideCount: slides.length, canvasWidth: canvas.width, canvasHeight: canvas.height, sections, slides,
  }
  return { manifest, fragments }
}

const DEFAULT_FRAGMENT_FOR = (title: string): string => `<section class="peitho-slide"><h1>${title}</h1></section>`

const DEFAULT_CSS = '.peitho-slide { color: black; }'

/** The layout each manifest slide was built on, as peitho-core would
 * report it for the simple cases this mock models: the layout a slide
 * names, or the deck's only layout. A slide that names none in a deck of
 * several (structural matching, not modeled) reports none. */
function slideLayoutsFor(source: string, slides: readonly ManifestSlide[], layouts: readonly string[]): Record<string, string> {
  const configs = splitSlides(source).map(range => extractPageComment(range.text).config).filter(config => config.draft !== true)
  const result: Record<string, string> = {}
  slides.forEach((slide, i) => {
    const layout = configs[i]?.layout ?? (layouts.length === 1 ? layouts[0] : undefined)
    if (layout) result[slide.key] = layout
  })
  return result
}

function renderPayloadFor(source: string, deck: MockDeck): RenderPayload {
  const { manifest, fragments } = buildManifest(source, deck.fragmentFor ?? DEFAULT_FRAGMENT_FOR, deck.canvas ?? canvasFor(source), deck.editAnnotations ?? false)
  const layouts = deck.layouts ?? []
  const slideLayouts = slideLayoutsFor(source, manifest.slides, layouts)
  if (deck.editableLayouts) {
    for (const slide of manifest.slides) {
      const range = splitSlides(source).find(range => range.text === slide.src)!
      const template = layoutFileOf(deck, slideLayouts[slide.key])?.html
      if (!template) continue
      fragments[slide.key] = template.replace(/<slot\s+name="([^"]+)"\s+accepts="([^"]+)"[^>]*><\/slot>/g, (_, slot: string, accepts: string) => {
        let content = ''; let offset = range.start
        if (slot === 'title') {
          const heading = /^# (.+)$/m.exec(range.text)
          content = heading?.[1] ?? ''; offset += (heading?.index ?? 0) + 2
        } else {
          const fence = new RegExp(`::: \\{slot=${slot}\\}\\n([\\s\\S]*?)\\n:::`).exec(range.text)
          content = fence?.[1].trim() ?? ''
          offset += fence ? fence.index + fence[0].indexOf(fence[1]) + fence[1].indexOf(content) : 0
          if (!fence && slot === 'body') {
            content = extractPageComment(extractNote(range.text).rest).rest.replace(/^# [^\n]*(?:\n|$)/, '').trim()
            offset = range.start + range.text.indexOf(content)
          }
        }
        const attrs = `data-peitho-src="${utf8Bytes(source.slice(0, offset))}-${utf8Bytes(source.slice(0, offset + content.length))}" data-peitho-md="${encodeEditMarkdown(content)}"`
        const rendered = content === '' ? '' : accepts === 'inline' ? `<span ${attrs}>${escapeHtml(content)}</span>` : annotatedFragment(source, offset, content).replace(/^<section[^>]*>/, '').replace(/<\/section>$/, '')
        const tag = accepts === 'inline' ? 'span' : 'div'
        return `<${tag} data-studio-slot="${slot}" data-studio-accepts="${accepts}" style="display:contents">${rendered}</${tag}>`
      })
    }
  }
  const headingLayouts = deck.headingLayouts ?? [...new Set([...layouts, ...Object.values(slideLayouts)])]
  return { manifest, fragments, slideLayouts, headingLayouts, assetBaseUrl: 'http://localhost:9/', css: deck.css ?? DEFAULT_CSS }
}

/** Layout `name`'s files in `deck.layoutFiles` — an own entry only, so a
 * layout named like an `Object` prototype member (`constructor`) isn't
 * handed the prototype's value. */
function layoutFileOf(deck: MockDeck, name: string): { html: string; css: string | null } | undefined {
  return deck.layoutFiles && Object.hasOwn(deck.layoutFiles, name) ? deck.layoutFiles[name] : undefined
}

const LAYOUT_FILE_PATH = /^(?:layouts\/([^/]+)\.html|css\/([^/]+)\.css)$/

/** The layout `path` is a file of (`layouts/<name>.html` → html,
 * `css/<name>.css` → css) when `name` is one of `deck.layouts`. */
function layoutFileAt(deck: MockDeck, path: string): { name: string; side: 'html' | 'css' } | null {
  const match = LAYOUT_FILE_PATH.exec(path)
  const name = match?.[1] ?? match?.[2]
  if (name === undefined || !(deck.layouts ?? []).includes(name)) return null
  return { name, side: match?.[1] !== undefined ? 'html' : 'css' }
}

/** What `read_deck_file` answers for `path`, `null` for no such file. */
function deckFileText(deck: MockDeck, path: string): string | null {
  const layout = layoutFileAt(deck, path)
  if (layout !== null) {
    const files = layoutFileOf(deck, layout.name)
    return layout.side === 'html' ? files?.html ?? `<section class="peitho-slide layout-${layout.name}"></section>` : files?.css ?? ''
  }
  return deck.otherFiles && Object.hasOwn(deck.otherFiles, path) ? deck.otherFiles[path] : null
}

/** `list_deck_files`' answer: the four folders' entries, depth-first. */
function deckFileEntries(deck: MockDeck): { path: string; kind: 'dir' | 'file'; editable: boolean }[] {
  const files = new Set<string>()
  for (const name of deck.layouts ?? []) {
    files.add(`layouts/${name}.html`)
    if (layoutFileOf(deck, name)?.css != null) files.add(`css/${name}.css`)
  }
  for (const path of Object.keys(deck.otherFiles ?? {})) files.add(path)
  const entries: { path: string; kind: 'dir' | 'file'; editable: boolean }[] = []
  for (const dir of ['layouts', 'css', 'img', 'fonts']) {
    const inside = [...files].filter(path => path.startsWith(`${dir}/`)).sort()
    if (inside.length === 0) continue
    entries.push({ path: dir, kind: 'dir', editable: false })
    for (const path of inside) entries.push({ path, kind: 'file', editable: /^(?:layouts\/[^/]+\.html|css\/[^/]+\.css)$/.test(path) })
  }
  return entries
}

/** Wires `page` up to open `deck.source` as a fake deck on load, and keeps
 * `deck.source` in sync with every `save_deck_source` call — so a test can
 * read it back afterward to assert on the persisted content. Call before
 * `page.goto('/')`. */
export async function mockTauri(page: Page, deck: MockDeck): Promise<void> {
  let savedLayouts = 0
  // Mirrors `sync_crit_watch` in peitho.rs: crit's events reach this window.
  deck.crit?.onReviewEvent(event => {
    page.evaluate(payload => {
      (window as unknown as { __mockEmitTauriEvent?: (event: string, payload: unknown, toWindow?: string) => void }).__mockEmitTauriEvent?.('crit-review', payload, 'main')
    }, event).catch(() => {
      // An event fired as the test ends (e.g. the fake crit's `finish`
      // right after the last assertion) finds the page closed; nothing
      // is left to hear it. Unhandled, it failed the test after it passed.
    })
  })
  await page.exposeFunction('__mockInvoke', async (cmd: string, args: Record<string, unknown>) => {
    deck.invokedCommands?.push(cmd)
    const error = deck.commandError?.(cmd, args)
    if (cmd === 'present_deck' && deck.presentDeckDelayMs) await sleep(deck.presentDeckDelayMs)
    if (cmd === 'open_deck' && deck.openDeckDelayMs) await sleep(deck.openDeckDelayMs)
    if (cmd === 'check_slide_layouts' && deck.checkSlideLayoutsDelayMs) await sleep(deck.checkSlideLayoutsDelayMs)
    if (cmd === 'render_draft' && deck.renderDraftDelayMs) await sleep(deck.renderDraftDelayMs)
    if (cmd === 'delete_layout' && deck.deleteLayoutDelayMs) await sleep(deck.deleteLayoutDelayMs)
    if (cmd === 'save_deck_file' && deck.saveLayoutDelayMs) await sleep(deck.saveLayoutDelayMs)
    if (cmd === 'preview_layout_draft' && deck.layoutDraftPreviewDelayMs) await sleep(deck.layoutDraftPreviewDelayMs((args.html as string | null) ?? deckFileText(deck, `layouts/${args.name as string}.html`) ?? ''))
    if (cmd.startsWith('import_deck_image_') && deck.importImageDelayMs) await sleep(deck.importImageDelayMs)
    deck.onInvoke?.(cmd, args)
    if (error !== null && error !== undefined) throw new Error(error)
    switch (cmd) {
      case 'dev_default_deck': return deck.devDefaultDeck === undefined ? '/fake/deck.md' : deck.devDefaultDeck
      case 'take_pending_deck': {
        // Real `take_pending_deck` removes the entry it hands back —
        // consumed exactly once, same as `PendingDecks` in peitho.rs.
        const pending = deck.pendingDeck ?? null
        deck.pendingDeck = null
        return pending
      }
      case 'get_recent_decks': return deck.recentDecks ?? []
      case 'open_deck':
        return { deckPath: deck.deckPath ?? deck.source, deckDir: '/fake', trusted: deck.trusted ?? false, render: renderPayloadFor(deck.source, deck) }
      case 'render_draft':
        if (deck.rejectUnknownLayouts) {
          splitSlides(args.content as string).forEach((range, i) => {
            const layout = extractPageComment(range.text).config.layout
            if (layout !== undefined && !(deck.layouts ?? []).includes(layout)) throw new Error(`slide ${String(i + 1)} names layout '${layout}', which the deck doesn't have`)
          })
        }
        return renderPayloadFor(args.content as string, deck)
      case 'read_deck_source': return deck.source
      case 'save_deck_source':
        await deck.beforeSave?.(args.content as string)
        deck.source = args.content as string
        return null
      // Stands in for `engine::layout_files::preview_layout_draft`: the draft
      // HTML itself is the preview's fragment, and its CSS the CSS; HTML with
      // no `<section` is refused, as a layout's HTML is by `save_deck_file` here.
      case 'preview_layout_draft': {
        // A side with no tab open comes as `null`: as on disk.
        const name = args.name as string
        const html = (args.html as string | null) ?? deckFileText(deck, `layouts/${name}.html`) ?? ''
        if (!html.includes('<section')) throw new Error('a layout needs a <section> element')
        return { fragment: html, css: (args.css as string | null) ?? deckFileText(deck, `css/${name}.css`) ?? '' }
      }
      // A layout with files draws them (its HTML as the fragment), as the
      // real preview renders the saved files; any other `layoutFragment`.
      case 'preview_layouts': return { previews: (deck.layouts ?? []).map(name => ({ name, fragment: layoutFileOf(deck, name)?.html ?? deck.layoutFragment ?? '' })), css: '' }
      case 'list_deck_variants': return deck.deckVariants ?? []
      case 'check_slide_layouts':
        return deck.layoutVerdicts?.(args.content as string, args.slideIndex as number) ?? null
      case 'add_image_layout':
        return deck.addImageLayout?.(args.content as string, args.slideIndex as number) ?? []
      case 'layout_files_stamp': {
        const stamp = deck.layoutFilesStamp ?? ''
        if (deck.layoutFilesStampDelayMs) await sleep(deck.layoutFilesStampDelayMs)
        return stamp
      }
      case 'list_deck_files': return deckFileEntries(deck)
      case 'read_deck_file': {
        const text = deckFileText(deck, args.path as string)
        if (deck.readDeckFileDelayMs) await sleep(deck.readDeckFileDelayMs)
        if (text === null) throw new Error(`'${args.path as string}' is not a file of this deck`)
        return text
      }
      case 'create_layout': {
        const name = (args.name as string).trim()
        const layouts = deck.layouts ??= []
        if (layouts.some(taken => taken.toLowerCase() === name.toLowerCase())) throw new Error(`the deck already has a layout named '${name}'`)
        layouts.push(name)
        ;(deck.layoutFiles ??= {})[name] = { html: `<section class="peitho-slide layout-${name}"></section>`, css: `.peitho-slide.layout-${name} {\n}\n` }
        return name
      }
      case 'create_image_canvas': {
        const base = args.baseLayout as string
        const name = `studio-canvas-${Object.keys(deck.layoutFiles ?? {}).length}`
        let html = layoutFileOf(deck, base)?.html ?? '<section class="peitho-slide" style="position:relative"><h1><slot name="title" accepts="inline" arity="1"></slot></h1></section>'
        if (args.carryLayout) {
          const from = layoutFileOf(deck, args.carryLayout as string)?.html ?? ''
          const figures = [...from.matchAll(/<(?:figure|div)[^>]*data-studio-(?:image|text)="[^"]+"[\s\S]*?<\/(?:figure|div)>/g)].map(match => match[0]).join('')
          html = html.replace('</section>', `${figures}</section>`)
        }
        html = html.replace(/(<section[^>]*style=")([^"]*)"/, '$1$2;position:relative"')
        for (const slot of (args.removeSlots as string[] | undefined) ?? []) html = html.replace(new RegExp(`<(?:figure|div)[^>]*data-studio-(?:image|text)="${slot}"[\\s\\S]*?<\\/(?:figure|div)>`), '')
        for (const rect of args.placements as { slot: string; x: number; y: number; width: number; height: number }[]) {
          html = html.replace(new RegExp(`(data-studio-(image|text)="${rect.slot}" style=")[^"]*"`), (_, prefix: string, kind: string) => `${prefix}position:absolute;left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${kind === 'text' ? 'auto' : `${rect.height * 100}%`};margin:0;overflow:${kind === 'text' ? 'visible' : 'hidden'}"`)
        }
        if (args.imageOrder) {
          const figures = new Map([...html.matchAll(/<(?:figure|div)[^>]*data-studio-(?:image|text)="([^"]+)"[\s\S]*?<\/(?:figure|div)>/g)].map(match => [match[1], match[0]]))
          html = html.replace(/<(?:figure|div)[^>]*data-studio-(?:image|text)="[^"]+"[\s\S]*?<\/(?:figure|div)>/g, '')
          const order = args.imageOrder as string[]
          const content = order.indexOf('studio-content')
          html = html.replace('</section>', `${order.filter(slot => slot !== 'studio-content').map(slot => figures.get(slot)!.replace(/style="([^"]*)"/, (_, style: string) => `style="${style.replace(/z-index:[^;]*;?/g, '')};z-index:${order.indexOf(slot) - content};"`)).join('')}</section>`)
          html = html.replace(/(<section[^>]*style=")([^"]*)"/, '$1$2;isolation:isolate"')
        }
        const slots: string[] = []
        let i = 1
        for (let n = 0; n < Number(args.count); n++) {
          while (html.includes(`name="studio-image-${i}"`)) i++
          const slot = `studio-image-${i++}`; slots.push(slot)
          const layer = Math.max(0, ...[...html.matchAll(/z-index:(-?\d+)/g)].map(match => Number(match[1]))) + 1
          html = html.replace('</section>', `<figure data-studio-image="${slot}" style="position:absolute;left:15%;top:25%;width:55%;height:55%;margin:0;z-index:${layer}"><slot name="${slot}" accepts="image" arity="1"></slot></figure></section>`)
        }
        ;(deck.layouts ??= []).push(name)
        if (args.textCount) {
          let next = 1
          while (html.includes(`name="studio-text-${next}"`)) next++
          const slot = `studio-text-${next}`; slots.push(slot)
          html = html.replace('</section>', `<div data-studio-text="${slot}" style="position:absolute;left:20%;top:30%;width:55%;z-index:10"><slot name="${slot}" accepts="blocks" arity="0..*"></slot></div></section>`)
        }
        ;(deck.layoutFiles ??= {})[name] = { html, css: null }
        return { layout: name, slots }
      }
      case 'duplicate_layout': {
        const name = args.name as string
        const layouts = deck.layouts ??= []
        let copy = `${name}-copy`
        for (let n = 2; layouts.includes(copy); n++) copy = `${name}-copy-${String(n)}`
        layouts.push(copy)
        const files = layoutFileOf(deck, name)
        if (files) (deck.layoutFiles ??= {})[copy] = files
        return copy
      }
      case 'check_layout_removal': {
        const name = args.name as string
        splitSlides(args.repinned as string).forEach((range, i) => {
          if (extractPageComment(range.text).config.layout === name) throw new Error(`slide ${String(i + 1)} is on '${name}' — pick another layout for it first`)
        })
        if ((deck.layouts ?? []).length < 2) throw new Error(`'${name}' is the deck's only layout`)
        return null
      }
      case 'delete_layout': {
        const name = args.name as string
        deck.layouts = (deck.layouts ?? []).filter(layout => layout !== name)
        if (deck.layoutFiles) delete deck.layoutFiles[name]
        return null
      }
      case 'save_deck_file': {
        const path = args.path as string
        const text = args.text as string
        const layout = layoutFileAt(deck, path)
        if (layout?.side === 'html' && !text.includes('<section')) throw new Error('a layout needs a <section> element')
        // Like `engine::deck_files::save_deck_file`, refuses a file that no
        // longer holds what the editor last read or wrote.
        const current = deckFileText(deck, path)
        if (current === null) throw new Error(`'${path}' is not a file of this deck`)
        const base = args.base as string | null
        if (base !== null && current !== base) throw new Error('the layout\'s files changed on disk since they were read')
        if (layout !== null) {
          const files = layoutFileOf(deck, layout.name) ?? { html: deckFileText(deck, `layouts/${layout.name}.html`) ?? '', css: null }
          ;(deck.layoutFiles ??= {})[layout.name] = layout.side === 'html' ? { ...files, html: text } : { ...files, css: text }
        } else {
          (deck.otherFiles ??= {})[path] = text
        }
        savedLayouts++
        deck.layoutFilesStamp = `saved-${String(savedLayouts)}`
        return deck.layoutFilesStamp
      }
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
      case 'trust_open_deck':
        deck.trusted = true
        return null
      case 'plugin:dialog|open': return deck.dialogPath ?? null
      case 'get_update_status': return deck.updateStatus ?? initialUpdateStatus()
      case 'check_for_updates': return deck.checkUpdateResult ?? { ...initialUpdateStatus(), phase: 'current' }
      case 'prepare_update': {
        deck.updateStatus = { ...(deck.updateStatus ?? initialUpdateStatus()), phase: 'ready', installOnExit: true }
        return deck.updateStatus
      }
      case 'dismiss_update': {
        const status = deck.updateStatus ?? initialUpdateStatus()
        deck.updateStatus = { ...status, dismissed: status.security === null }
        return deck.updateStatus
      }
      case 'acknowledge_update_save':
        (deck.updateSaveAcks ??= []).push({ token: args.token as number, saved: args.saved as boolean })
        return null
      case 'get_settings': return deck.settings ?? {}
      case 'get_system_locales': return deck.systemLocales ?? ['en-US']
      case 'update_settings': {
        // Mirrors `settings::update_settings`: merges the patch over what is
        // saved, keeps it in `deck.settings` (so a reload reads it back, as
        // a restart would), and broadcasts the result to every window.
        const saved = typeof deck.settings === 'object' && deck.settings !== null ? deck.settings : {}
        deck.settings = { ...saved, ...(args.patch as Record<string, unknown>) }
        const normalized = deck.settings as Record<string, unknown>
        if ((args.patch as Record<string, unknown>).autoCheckUpdates === false) normalized.autoUpdate = false
        else if (normalized.autoUpdate) normalized.autoCheckUpdates = true
        const payload = deck.settings
        void page.evaluate(settings => {
          (window as unknown as { __mockEmitTauriEvent?: (event: string, payload: unknown) => void }).__mockEmitTauriEvent?.('settings:changed', settings)
        }, payload)
        return payload
      }
      case 'plugin:clipboard-manager|read_text':
        if (deck.clipboardDelayMs) await sleep(deck.clipboardDelayMs)
        return deck.clipboardText ?? null
      case 'plugin:clipboard-manager|write_text':
        if (deck.clipboardDelayMs) await sleep(deck.clipboardDelayMs)
        deck.clipboardText = args.text as string
        return null
      case 'get_about_info': return deck.aboutInfo ?? DEFAULT_ABOUT_INFO
      case 'crit_bundled_path': return deck.crit?.bundledCritPath() ?? null
      case 'crit_session_status': return deck.crit?.sessionStatus() ?? null
      case 'crit_start_session': return deck.crit?.startSession() ?? null
      case 'crit_add_comments': return deck.crit?.addComments(args.comments as NewReviewComment[]) ?? null
      case 'crit_add_layout_comments': return deck.crit?.addLayoutComments(args.comments as NewLayoutComment[]) ?? null
      case 'crit_session_dirs': return deck.crit?.sessionDirs() ?? null
      case 'crit_add_replies': return deck.crit?.addReplies(args.replies as NewReviewReply[]) ?? null
      case 'crit_resolve_comment': return deck.crit?.resolveComment(args.id as string) ?? null
      case 'crit_finish': return deck.crit?.finish() ?? null
      case 'crit_list_comments': return deck.crit?.listComments() ?? null
      case 'import_deck_image_file':
        return deck.importImage?.(cmd, args) ?? `img/${String(args.path).split('/').pop() ?? ''}`
      case 'import_deck_image_bytes':
        return deck.importImage?.(cmd, args) ?? `img/${String((args.headers as Record<string, string> | undefined)?.['x-image-name'])}`
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

    w.__TAURI_INTERNALS__.invoke = async (cmd: string, rawArgs: unknown = {}, options?: { headers?: Record<string, string> }) => {
      // A raw-body invoke (`import_deck_image_bytes`) can't cross
      // `exposeFunction` as bytes: it reaches the mock as a number array,
      // with the request's headers beside it.
      const args = rawArgs instanceof Uint8Array || rawArgs instanceof ArrayBuffer
        ? { bytes: Array.from(new Uint8Array(rawArgs)), headers: options?.headers ?? {} }
        : rawArgs as Record<string, unknown>
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
