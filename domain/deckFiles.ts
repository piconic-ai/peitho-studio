// The layout screen's file tree: the deck's files as `list_deck_files`
// lists them (`engine::deck_files`), the rows the tree shows with some
// folders collapsed, and which layout a file belongs to — the link between
// the tree / the editor's tabs and the layout list. Pure.

/** One entry of the tree as the Rust side lists it: a path relative to
 * the deck's folder (`/`-separated), whether it's a folder, and — for a
 * file — whether it opens as text in the editor. Listed depth-first, each
 * folder right before what's in it. */
export interface DeckFileEntry {
  path: string
  kind: 'dir' | 'file'
  editable: boolean
}

/** One row the tree shows: an entry with its name, how deep it sits (0 for
 * `layouts/`, `css/`, …) and, for a folder, whether it's open. */
export interface FileTreeRow {
  path: string
  name: string
  depth: number
  kind: 'dir' | 'file'
  editable: boolean
  /** A folder's state; always `false` for a file. */
  expanded: boolean
}

/** The last part of `path` — what the tree and a tab show. */
export function fileName(path: string): string {
  const parts = path.split('/').filter(part => part !== '')
  return parts[parts.length - 1] ?? ''
}

/** The folders `path` sits in, outermost first (`img/a/b.png` → `img`,
 * `img/a`). */
function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** The rows the tree shows for `entries`: every entry except those inside
 * a folder of `collapsed` (folders start open, so a new folder shows what's
 * in it). Each row's depth is its number of `/`. */
export function fileTreeRows(entries: readonly DeckFileEntry[], collapsed: ReadonlySet<string>): FileTreeRow[] {
  return entries
    .filter(entry => !ancestorsOf(entry.path).some(dir => collapsed.has(dir)))
    .map(entry => ({
      path: entry.path,
      name: fileName(entry.path),
      depth: entry.path.split('/').length - 1,
      kind: entry.kind,
      editable: entry.kind === 'file' && entry.editable,
      expanded: entry.kind === 'dir' && !collapsed.has(entry.path),
    }))
}

/** `collapsed` with folder `path` opened if it was closed, closed if open. */
export function toggledFolder(collapsed: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(collapsed)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

/** Layout `name`'s two files, relative to the deck's folder: its HTML and
 * its own CSS (which may not exist yet — `read_deck_file` reads it blank). */
export function layoutFilePaths(name: string): { html: string; css: string } {
  return { html: `layouts/${name}.html`, css: `css/${name}.css` }
}

const LAYOUT_FILE = /^(?:layouts\/([^/]+)\.html|css\/([^/]+)\.css)$/

/** The layout file `path` belongs to — `layouts/<name>.html`, or
 * `css/<name>.css` — when `name` is one of the deck's layouts (`names`);
 * `null` for any other file (`css/base.css`, an image), which belongs to no
 * single layout. */
export function layoutOfFile(path: string, names: readonly string[]): string | null {
  const match = LAYOUT_FILE.exec(path)
  const name = match?.[1] ?? match?.[2]
  return name !== undefined && names.includes(name) ? name : null
}

/** Which language a text file is in, by its extension — `null` for one
 * the editor doesn't open. */
export function fileLanguage(path: string): 'html' | 'css' | null {
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.css')) return 'css'
  return null
}
