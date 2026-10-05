// The app's own right-click menu on the editors (the slide body and
// notes, the layout screen's file editor), in place of
// the webview's: what it was opened on, which items it offers and whether
// each can run now. Pure — `components/ContextMenu.tsx` draws the items
// this computes, and `Studio.tsx` runs the chosen action.
//
// Its items are data, like the layout menu's (`domain/layoutMenu.ts`): the
// comment every menu opens with (`domain/menuComment.ts`), on the lines
// right-clicked, then the Cut / Copy / Paste the native menu offered, since
// this menu replaces it. (The slide preview's menu is the slide list's,
// `domain/contextMenu.ts`.)
import type { Messages } from './messages'
import { COMMENT_ACTION, commentItemLabel, setApartFromComment, type CommentAction } from './menuComment'

/** The editors the menu opens on: the slide's body and notes, and the
 * layout screen's file editor. */
export type MenuEditor = 'body' | 'note' | 'layout'

/** What the menu is open on, and where on screen: an editor, `from`/`to`
 * its selection as the right-click left it (`selectionForMenu`; a caret
 * when equal) — the lines the comment is on, and what Cut and Copy take. */
export type CommentMenu =
  | { kind: 'closed' }
  | { kind: 'on-editor'; editor: MenuEditor; x: number; y: number; from: number; to: number }

export const COMMENT_MENU_CLOSED: CommentMenu = { kind: 'closed' }

export type CommentMenuAction = CommentAction | 'cut' | 'copy' | 'paste'

export interface CommentMenuItem {
  action: CommentMenuAction
  enabled: boolean
  /** A rule above it, setting it apart from the items before. */
  separatorBefore: boolean
}

/** The menu opened by right-clicking `editor`, whose selection then runs
 * from `from` to `to`. */
export function openOnEditor(editor: MenuEditor, x: number, y: number, from: number, to: number): CommentMenu {
  return { kind: 'on-editor', editor, x, y, from, to }
}

/** Whether the menu is open on `editor`. */
export function isOpenOnEditor(menu: CommentMenu, editor: MenuEditor): boolean {
  return menu.kind === 'on-editor' && menu.editor === editor
}

/** The menu's items, in order, each with whether it can run now: the
 * comment on the lines picked, then — set apart — Cut and Copy (with text
 * selected) and Paste. */
export function commentMenuItems(menu: CommentMenu): CommentMenuItem[] {
  switch (menu.kind) {
    case 'closed':
      return []
    case 'on-editor': {
      const selected = menu.from !== menu.to
      const items: Omit<CommentMenuItem, 'separatorBefore'>[] = [
        { action: COMMENT_ACTION, enabled: true },
        { action: 'cut', enabled: selected },
        { action: 'copy', enabled: selected },
        { action: 'paste', enabled: true },
      ]
      const actions = items.map(item => item.action)
      return items.map((item, index) => ({ ...item, separatorBefore: setApartFromComment(actions, index) }))
    }
    default: {
      const _exhaustive: never = menu
      return _exhaustive
    }
  }
}

/** `action`'s label: the comment's is every menu's (`commentItemLabel`) —
 * the comment box's header says which lines. `menu` is kept for labels
 * that may depend on it. */
export function commentMenuLabel(action: CommentMenuAction, _menu: CommentMenu, messages: Messages): string {
  switch (action) {
    case COMMENT_ACTION: return commentItemLabel(messages)
    case 'cut': return messages.cut
    case 'copy': return messages.copy
    case 'paste': return messages.paste
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}

/** Where the menu is drawn — `{0, 0}` while closed (nothing reads it). */
export function commentMenuPosition(menu: CommentMenu): { x: number; y: number } {
  return menu.kind === 'closed' ? { x: 0, y: 0 } : { x: menu.x, y: menu.y }
}

/** `menu` moved to `at` (kept on-screen) — a no-op while closed. */
export function withCommentMenuPosition(menu: CommentMenu, at: { x: number; y: number }): CommentMenu {
  return menu.kind === 'closed' ? menu : { ...menu, x: at.x, y: at.y }
}

/** The selection an editor's menu acts on, given its selection (`from`/
 * `to`, either way round) and the offset right-clicked (`clicked`, `null`
 * when it couldn't be told): a right-click inside the selected text keeps
 * it; anywhere else puts the caret where it landed, as a native editor
 * does — so the comment is on the line right-clicked, and Paste goes
 * there. `moved` says whether the editor's selection must change. */
export function selectionForMenu(from: number, to: number, clicked: number | null): { from: number; to: number; moved: boolean } {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  if (clicked === null || !Number.isFinite(clicked)) return { from: start, to: end, moved: false }
  if (start !== end && clicked >= start && clicked <= end) return { from: start, to: end, moved: false }
  return { from: clicked, to: clicked, moved: clicked !== from || clicked !== to }
}

/** What an editor's Cut or Paste acts on, taken before it waits on the
 * clipboard: the editor, what it shows (the slide's key, or the file's
 * path; `null` for nothing) and its text then. */
export interface EditorTarget {
  editor: MenuEditor
  shows: string | null
  doc: string
}

/** Whether a Cut or Paste taken against `before` may still be applied
 * `now`, once the clipboard answered: the same editor shows the same slide
 * or file, its text untouched — otherwise the menu's offsets would land in
 * another document (a slide or tab switched meanwhile), and it's
 * dropped. */
export function sameEditorTarget(before: EditorTarget, now: EditorTarget | null): boolean {
  return now !== null && before.shows !== null && before.editor === now.editor && before.shows === now.shows && before.doc === now.doc
}
