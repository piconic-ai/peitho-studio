// Reads and writes single top-level keys of a deck's YAML frontmatter as
// plain text, line by line — no YAML parser. peitho-core stays the source of
// truth for whether the result is valid; these only have to find the one
// line a key lives on and leave every other line exactly as it was.
//
// A frontmatter block is recognized the same way `splitSlides` recognizes
// it: the source's first line is `---` and a later line closes it with
// `---`. Only a key at the start of a line counts (an indented line belongs
// to the key above it). When a key appears more than once, the first one is
// the one read, replaced, or removed; the others are left alone.

/** Where a key's line sits within `lines`, plus the indented lines under it
 * (a nested mapping or a multi-line value), which move with it. */
interface KeyLocation {
  start: number
  /** Exclusive. */
  end: number
}

interface FrontmatterBlock {
  lines: string[]
  /** Index of the closing `---` line. */
  closeIndex: number
}

function frontmatterBlock(source: string): FrontmatterBlock | null {
  const lines = source.split('\n')
  if (lines[0]?.trim() !== '---') return null
  const closeIndex = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (closeIndex === -1) return null
  return { lines, closeIndex }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keyLinePattern(key: string): RegExp {
  return new RegExp(`^${escapeRegExp(key)}[ \\t]*:`)
}

function locateKey(block: FrontmatterBlock, key: string): KeyLocation | null {
  if (key === '') return null
  const pattern = keyLinePattern(key)
  for (let i = 1; i < block.closeIndex; i++) {
    if (!pattern.test(block.lines[i])) continue
    let end = i + 1
    while (end < block.closeIndex && /^[ \t]+\S/.test(block.lines[end])) end++
    return { start: i, end }
  }
  return null
}

/** The value written on a key's own line: surrounding whitespace, a
 * trailing `# comment`, and one pair of matching quotes removed. */
function scalarOf(rawValue: string): string {
  const trimmed = rawValue.trim()
  const quote = trimmed[0]
  if (quote === '"' || quote === "'") {
    const close = trimmed.indexOf(quote, 1)
    if (close !== -1) return trimmed.slice(1, close)
  }
  return trimmed.replace(/(^|[ \t])#.*$/, '').trim()
}

/** The value of top-level key `key` in `source`'s frontmatter, or `null`
 * when there's no frontmatter block, the block isn't closed, or the key
 * isn't in it. A key written with nothing after its colon reads as `''`. */
export function readFrontmatterKey(source: string, key: string): string | null {
  const block = frontmatterBlock(source)
  if (block === null) return null
  const location = locateKey(block, key)
  if (location === null) return null
  const line = block.lines[location.start].replace(/\r$/, '')
  return scalarOf(line.slice(line.indexOf(':') + 1))
}

/** `source` with top-level key `key` set to `value`, written unquoted as
 * `key: value`. `null` removes the key, along with any indented lines under
 * it. Removing the last key removes the whole block: peitho-core refuses an
 * empty `---`/`---` block, but accepts a deck with no frontmatter at all.
 * A block left with only blank or `# comment` lines counts as empty too
 * (peitho reads it as null, not a mapping), so those comments go with it.
 *
 * Setting a key on a deck with no frontmatter adds a block for it. A block
 * that isn't closed is left as it is, since there's no telling where it
 * was meant to end. A replaced key keeps its line's CRLF ending; a new line
 * follows the closing `---` line's ending. */
export function setFrontmatterKey(source: string, key: string, value: string | null): string {
  if (key === '') return source
  const line = value === null ? null : value === '' ? `${key}:` : `${key}: ${value}`
  const block = frontmatterBlock(source)
  if (block === null) {
    if (line === null || source.split('\n')[0]?.trim() === '---') return source
    const eol = /^[^\n]*\r\n/.test(source) ? '\r\n' : '\n'
    return `---${eol}${line}${eol}---${eol}${source}`
  }
  const { lines, closeIndex } = block
  const location = locateKey(block, key)
  if (line === null) {
    if (location === null) return source
    lines.splice(location.start, location.end - location.start)
    const newCloseIndex = closeIndex - (location.end - location.start)
    const emptied = lines.slice(1, newCloseIndex).every(l => l.trim() === '' || l.trim().startsWith('#'))
    return (emptied ? lines.slice(newCloseIndex + 1) : lines).join('\n')
  }
  if (location === null) {
    const cr = lines[closeIndex].endsWith('\r') ? '\r' : ''
    lines.splice(closeIndex, 0, `${line}${cr}`)
    return lines.join('\n')
  }
  const cr = lines[location.start].endsWith('\r') ? '\r' : ''
  lines.splice(location.start, location.end - location.start, `${line}${cr}`)
  return lines.join('\n')
}

/** The frontmatter key holding a deck's page-number setting. */
export const PAGE_NUMBERS_KEY = 'page_numbers'

/** The three page-number settings peitho-core accepts, as the UI offers
 * them. `none` is the key being absent: peitho-core refuses `false`. */
export type PageNumbersChoice = 'none' | 'current' | 'current_of_total'

/** A deck's page-number setting as found in its frontmatter. `unknown`
 * holds a value peitho-core doesn't accept (a typo, `both`, `Current`), so
 * the UI can show it as such instead of guessing which one was meant. */
export type PageNumbersMode =
  | { kind: PageNumbersChoice }
  | { kind: 'unknown'; raw: string }

/** Normalizes `page_numbers`' value (`readFrontmatterKey`'s result) into a
 * `PageNumbersMode`. Matching is exact, as in peitho-core (serde's
 * `snake_case` names): any other spelling, the empty string included, is
 * `unknown`. */
export function parsePageNumbersMode(raw: string | null): PageNumbersMode {
  if (raw === null) return { kind: 'none' }
  if (raw === 'current' || raw === 'current_of_total') return { kind: raw }
  return { kind: 'unknown', raw }
}

/** The frontmatter value that selects `choice`: `null` (remove the key) for
 * `none`. */
export function pageNumbersValueOf(choice: PageNumbersChoice): string | null {
  return choice === 'none' ? null : choice
}

/** Whether `mode` shows page numbers on slides — the precondition for a
 * slide's own `page_number:false`, which peitho-core refuses otherwise. */
export function pageNumbersShown(mode: PageNumbersMode): boolean {
  return mode.kind === 'current' || mode.kind === 'current_of_total'
}
