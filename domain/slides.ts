// Splits deck.md source text into per-slide byte ranges.
//
// Mirrors peitho-core's own slide splitter (crates/peitho-core/src/parser.rs
// `split_slide_ranges`): a slide boundary is a line that is exactly `---`,
// found outside YAML frontmatter and outside a fenced code block. peitho
// uses a real Markdown parser (pulldown-cmark thematic-break events) to make
// that distinction; this is a line-based approximation good enough for a
// GUI "jump to slide" / "edit this slide" feature — it does not need to be
// byte-for-byte identical to peitho's parser, since peitho itself remains
// the source of truth for build/validation. A `---` that appears inside a
// blockquote or list continuation line (rare in practice) is not
// special-cased here.

import { parsePageComment, configOf, serializePageConfig, type PageConfig } from './pageConfig'

export interface SlideRange {
  /** Character offset into the source where this slide's text starts. */
  start: number
  /** Character offset into the source where this slide's text ends (exclusive). */
  end: number
  /** The slide's raw markdown, including its own PageComment/notes comments. */
  text: string
}

export function splitSlides(source: string): SlideRange[] {
  const lines = source.split('\n')
  const lineStarts: number[] = []
  let offset = 0
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }

  let contentStartLine = 0
  if (lines[0]?.trim() === '---') {
    const closeIndex = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (closeIndex !== -1) contentStartLine = closeIndex + 1
  }

  const boundaries: number[] = []
  let inFence = false
  for (let i = contentStartLine; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (!inFence && trimmed === '---') boundaries.push(i)
  }

  const startLines = [contentStartLine, ...boundaries.map(i => i + 1)]
  const endLines = [...boundaries, lines.length]

  const ranges: SlideRange[] = []
  for (let i = 0; i < startLines.length; i++) {
    const startLine = startLines[i]
    const endLine = endLines[i]
    const start = lineStarts[startLine] ?? source.length
    const end = endLine < lines.length ? lineStarts[endLine] : source.length
    const text = source.slice(start, end)
    if (text.trim().length === 0) continue
    ranges.push({ start, end, text })
  }
  return ranges
}

// A slide's PageComment config (`<!-- {"key":...} -->`) and its speaker note
// (a plain-text HTML comment) use the same syntax, which is exactly what
// makes them hard to tell apart by eye in a raw editor. peitho's own parser
// already treats them as distinct (config comments start with `{`, notes
// don't); these two functions let the GUI edit them as separate fields and
// write them back in a fixed, predictable spot.

const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/g

/** Pulls the first non-JSON HTML comment (the speaker note, if any) out of
 * a slide's raw text. Everything else — the PageComment config, the
 * Markdown body, any other stray comment — is left untouched in `rest`. */
export function extractNote(raw: string): { rest: string; note: string } {
  HTML_COMMENT_RE.lastIndex = 0
  let note = ''
  let removedMatch: string | null = null
  let match: RegExpExecArray | null
  while ((match = HTML_COMMENT_RE.exec(raw)) !== null) {
    const trimmed = match[1].trim()
    if (!trimmed.startsWith('{')) {
      note = trimmed
      removedMatch = match[0]
      break
    }
  }
  const withoutNote = removedMatch ? raw.replace(removedMatch, '') : raw
  const rest = withoutNote.replace(/\n{3,}/g, '\n\n').trim()
  return { rest, note }
}

/** Inverse of `extractNote`: reattaches the note as a block HTML comment
 * after the rest of the slide, or omits it entirely when empty. */
export function injectNote(rest: string, note: string): string {
  const trimmedRest = rest.trim()
  const trimmedNote = note.trim()
  if (!trimmedNote) return `${trimmedRest}\n`
  return `${trimmedRest}\n\n<!--\n${trimmedNote}\n-->\n`
}

/** Pulls a slide's PageComment JSON (the first HTML comment whose trimmed
 * body starts with `{`) out of its raw text, parsed. `rest` is everything
 * else — the Markdown body plus, if present, the speaker-note comment (call
 * this *after* `extractNote` to get body only). Used to keep the config
 * comment out of the body textarea entirely: it's edited exclusively through
 * the thumbnail context menu / section-header inputs instead, since a
 * hand-written JSON comment sharing HTML-comment syntax with the speaker
 * note is exactly the "hard to tell apart, easy to fat-finger" problem this
 * app exists to solve. */
export function extractPageComment(raw: string): { rest: string; config: PageConfig } {
  const re = /<!--([\s\S]*?)-->/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    const trimmed = match[1].trim()
    if (trimmed.startsWith('{')) {
      const parsed = parsePageComment(trimmed)
      // A malformed comment is left in place (not stripped out) — same
      // "leave it, don't guess" contract as before this function
      // delegated parsing to parsePageComment.
      if (parsed.kind === 'malformed') return { rest: raw, config: {} }
      const rest = raw.replace(match[0], '').replace(/\n{3,}/g, '\n\n').trim()
      return { rest, config: configOf(parsed) }
    }
  }
  return { rest: raw, config: {} }
}

/** Inverse of `extractPageComment` + `extractNote` combined: reassembles a
 * slide's full raw text from its config, body, and note. */
export function buildSlideText(config: PageConfig, body: string, note: string): string {
  const configComment = Object.keys(config).length > 0 ? `<!-- ${serializePageConfig(config)} -->\n` : ''
  return injectNote(`${configComment}${body.trim()}`, note)
}

/** Merges `updates` into a slide's PageComment JSON (the first HTML comment
 * whose trimmed body starts with `{`), rewriting that comment in place. If
 * the slide has no PageComment yet, a new one is prepended — `section` and
 * `time` are always set together since peitho requires them paired. */
export function updatePageComment(raw: string, updates: Partial<PageConfig>): string {
  const re = /<!--([\s\S]*?)-->/g
  let match: RegExpExecArray | null
  let existing: { commentText: string; config: PageConfig } | null = null
  while ((match = re.exec(raw)) !== null) {
    const trimmed = match[1].trim()
    if (trimmed.startsWith('{')) {
      const parsed = parsePageComment(trimmed)
      if (parsed.kind === 'ok') existing = { commentText: match[0], config: parsed.config }
      break
    }
  }
  const nextConfig: PageConfig = { ...(existing?.config ?? {}), ...updates }
  const nextComment = `<!-- ${serializePageConfig(nextConfig)} -->`
  if (existing) return raw.replace(existing.commentText, nextComment)
  return `${nextComment}\n${raw}`
}

/** Slugifies a title the same way peitho-core derives a slide's key from
 * its heading when no explicit `key` is given (`derive_key_from_fragments`
 * in peitho-core's `parser.rs`): lowercase, every run of non-alphanumeric
 * characters collapsed to one hyphen, no leading/trailing hyphens. Mirrored
 * here (not just left to peitho) so a slide *we* insert can be given an
 * explicit, already-known-unique key up front — see `uniqueSlideKey`. */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Picks a key guaranteed not to collide with any of `existingKeys` —
 * `baseKey` itself if it's free, otherwise `${baseKey}-2`, `${baseKey}-3`,
 * etc. An empty `baseKey` (e.g. a heading-less slide) falls back to
 * `slide`, matching peitho-core's own `slide-<n>` fallback prefix. */
export function uniqueSlideKey(baseKey: string, existingKeys: readonly string[]): string {
  const base = baseKey === '' ? 'slide' : baseKey
  const used = new Set(existingKeys)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${String(n)}`)) n++
  return `${base}-${String(n)}`
}

/** Where slide index `i` ends up after moving the slide at `from` to `to`
 * (the same two-step `splice(from, 1)` then `splice(to, 0, moved)` a
 * drag-reorder performs). `i === from` maps to `to` — the moved slide
 * follows itself — everything else shifts by however the removal/
 * insertion displaces it. Used to keep the *editor's* selection pointed at
 * whatever slide it already had open when a drag moves some *other* row,
 * rather than the drop target's position — see the `reorderSlides` call
 * site in Studio.tsx. */
export function indexAfterMove(i: number, from: number, to: number): number {
  if (i === from) return to
  let shifted = i
  if (i > from) shifted -= 1
  if (shifted >= to) shifted += 1
  return shifted
}

/** Pulls the text of a slide's first Markdown ATX heading (`# Title`),
 * ignoring PageComment/note HTML comments and the contents of fenced code
 * blocks — used as the base name for `uniqueSlideKey` when a slide has no
 * explicit `key` of its own (peitho itself derives a key the same way, from
 * the first heading it finds). Returns null if the slide has no heading. */
export function extractHeadingText(raw: string): string | null {
  const withoutComments = raw.replace(/<!--[\s\S]*?-->/g, '')
  let inFence = false
  for (const line of withoutComments.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^#{1,6}\s+(.+)$/.exec(trimmed)
    if (match) return match[1].trim()
  }
  return null
}

/** Parses a peitho-style duration ("1m", "90s", "1m30s") into milliseconds,
 * or null if it doesn't match that grammar. */
export function parseDurationToMs(value: string): number | null {
  const match = /^(?:(\d+)m)?(?:(\d+)s)?$/.exec(value.trim())
  if (!match || (match[1] === undefined && match[2] === undefined)) return null
  const minutes = match[1] ? parseInt(match[1], 10) : 0
  const seconds = match[2] ? parseInt(match[2], 10) : 0
  return (minutes * 60 + seconds) * 1000
}

/** Formats milliseconds as a peitho-style duration ("1m", "90s", "1m30s") —
 * inverse of `parseDurationToMs`. Rounds to the nearest second. */
export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${String(seconds)}s`
  if (seconds === 0) return `${String(minutes)}m`
  return `${String(minutes)}m${String(seconds)}s`
}

/** Rebuilds a deck's full source from an ordered list of slide texts,
 * joined with peitho's own `---` slide separator. `prefix` (YAML
 * frontmatter, if any) and `suffix` (anything after the last slide) are
 * passed through untouched — callers slice them from the original source
 * once, since splitting them back out of the rebuilt text isn't otherwise
 * possible. */
export function joinSlideTexts(prefix: string, texts: string[], suffix: string): string {
  return `${prefix}${texts.map(t => t.trim()).join('\n\n---\n\n')}\n${suffix}`
}

/** Sums every slide's own section time — only a slide whose PageComment
 * marks the *start* of a section counts (peitho requires `section`/`time`
 * to be set together), so a plain slide with neither contributes nothing.
 * Used to keep the deck's frontmatter `time:` in sync whenever the slide
 * list itself changes (adding, pasting, or deleting a slide can add or
 * remove a section along with it). */
export function sumSectionTimesMs(slideTexts: string[]): number {
  let total = 0
  for (const text of slideTexts) {
    const { config } = extractPageComment(text)
    if (typeof config.section === 'string' && typeof config.time === 'string') {
      total += parseDurationToMs(config.time) ?? 0
    }
  }
  return total
}

/** Rebuilds `next` reusing each `previous` entry's own object reference
 * wherever a same-keyed entry is deeply (structurally) unchanged.
 *
 * `manifest_json`/`render_draft` hand back a freshly-deserialized object on
 * every keystroke, including for slides whose content didn't change at all
 * — every slide is a brand-new object reference even when byte-identical.
 * BarefootJS's keyed `.map()` pushes each row's item through its own
 * per-row signal on every reconcile pass regardless of whether the pushed
 * value differs (`mapArray`'s `existing.setItem(item)` has no equality
 * check of its own), but the signal itself skips notifying subscribers
 * when the new value is `Object.is`-equal to the old one — so reusing the
 * *same reference* for an unchanged slide (rather than handing over a new,
 * merely-equal-by-value one) is what actually stops that row's bindings
 * (its thumbnail `<iframe srcdoc>` in particular — a real reload, not just
 * wasted work, since `.srcdoc` re-assignment reloads the frame even when
 * set to an identical string) from re-running on an edit to some *other*
 * slide. Same fix as `state/renderStore.ts`'s per-slide `fragmentSignal`,
 * applied to a different data shape (a signal holding a whole collection,
 * vs. object identity for one `.map()`'s items). */
export function stabilizeByKey<T extends { key: string }>(previous: T[], next: T[]): T[] {
  const byKey = new Map(previous.map(item => [item.key, item]))
  return next.map(item => {
    const prev = byKey.get(item.key)
    return prev && JSON.stringify(prev) === JSON.stringify(item) ? prev : item
  })
}

// peitho requires a deck's frontmatter `time:` to equal the sum of every
// section's planned time — editing one section's time from the slide list
// would otherwise silently break the very next build. This keeps the two
// in sync automatically instead of asking the user to hunt down and edit
// the frontmatter by hand.
export function updateFrontmatterTime(source: string, totalMs: number): string {
  const value = formatDurationMs(totalMs)
  const lines = source.split('\n')
  if (lines[0]?.trim() !== '---') {
    return `---\ntime: ${value}\n---\n${source}`
  }
  const closeIndex = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (closeIndex === -1) return source

  let replaced = false
  for (let i = 1; i < closeIndex; i++) {
    if (/^time\s*:/.test(lines[i])) {
      lines[i] = `time: ${value}`
      replaced = true
      break
    }
  }
  if (!replaced) lines.splice(closeIndex, 0, `time: ${value}`)
  return lines.join('\n')
}

/** Picks the index to focus after the slide list changes: `candidate` if
 * it's still a valid index into the new list, otherwise the first slide
 * (or `null` if the list is now empty). Shared shape behind two call
 * sites that used to duplicate this ternary chain — `refreshSource`
 * (candidate = the previously-selected index, only when preserving
 * selection) and `commitChange` (candidate = the caller's `focusIndex`). */
export function clampFocusIndex(candidate: number | null, count: number): number | null {
  if (candidate !== null && candidate >= 0 && candidate < count) return candidate
  return count > 0 ? 0 : null
}

/** Where a drag-reorder should drop the dragged slide, given the gap
 * (a `data-slide-row` boundary index) the cursor released over. Removing
 * `from` first shifts every later index down by one, so a gap that was
 * after the dragged row lands one earlier once it's gone; a gap at or
 * before it is unaffected. */
export function gapToIndex(gap: number, from: number): number {
  return gap <= from ? gap : gap - 1
}
