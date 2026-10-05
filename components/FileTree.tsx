'use client'

import { type FileTreeRow } from '../domain/deckFiles'

// Props are values, not signal getters (BF044) — see `WelcomeScreen.tsx`.
export interface FileTreeProps {
  /** The rows shown (`fileTreeRows`): folders closed by the user hide what
   * is in them. */
  rows: FileTreeRow[]
  /** The folders the user closed. A row's own open/closed look reads this
   * rather than its `expanded` field: a keyed row kept across an update
   * may hold the field it was first rendered with (CLAUDE.md's BarefootJS
   * pitfalls). */
  collapsed: string[]
  /** The file shown in the editor, highlighted. */
  activePath: string | null
  /** The files open as tabs, marked. */
  openPaths: string[]
  /** A click on row `path`: a folder opens or closes, a text file opens in
   * the editor; any other file (an image, a font) does nothing. */
  onRowClick: (path: string) => void
  width: number
}

function rowClass(active: boolean, open: boolean, editable: boolean, isDir: boolean): string {
  const tone = active ? 'bg-accent text-foreground font-medium ' : open ? 'text-foreground ' : isDir || editable ? 'text-foreground/90 ' : 'text-muted-foreground '
  return tone + 'w-full flex items-center gap-1 h-6 pr-2 text-left text-xs truncate rounded-sm hover:bg-accent/60'
}

/** The layout screen's leftmost column: the deck's `layouts/`, `css/`,
 * `img/` and `fonts/` as a tree, like an editor's file explorer. Only the
 * layout and CSS files open (in the editor's tabs); the rest are listed. */
export function FileTree(props: FileTreeProps) {
  return (
    <div data-file-tree className="shrink-0 flex flex-col min-h-0 border-r border-border" style={`width: ${String(props.width)}px`}>
      {/* No heading: the folders say what this column is. */}
      <div role="tree" className="flex-1 min-h-0 overflow-y-auto px-1 pt-1 pb-4">
        {props.rows.map(row => (
          <button
            type="button"
            key={row.path}
            role="treeitem"
            data-tree-row={row.path}
            data-tree-kind={row.kind}
            aria-current={props.activePath === row.path ? 'true' : 'false'}
            aria-expanded={row.kind === 'dir' ? (props.collapsed.includes(row.path) ? 'false' : 'true') : undefined}
            aria-disabled={row.kind === 'file' && !row.editable ? 'true' : 'false'}
            title={row.path}
            onClick={() => props.onRowClick(row.path)}
            className={rowClass(props.activePath === row.path, props.openPaths.includes(row.path), row.editable, row.kind === 'dir')}
            style={`padding-left: ${String(4 + row.depth * 12)}px`}
          >
            <span aria-hidden="true" className="shrink-0 w-3 text-center text-muted-foreground">{row.kind === 'dir' ? (props.collapsed.includes(row.path) ? '▸' : '▾') : ''}</span>
            <span className="truncate">{row.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
