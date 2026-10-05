// The app's own right-click menu on the slide preview and on the editors
// (the slide body and notes, the layout screen's file editor), in place of
// the webview's: what it was opened on, which items it offers and whether
// each can run now. Pure — `components/ContextMenu.tsx` draws the items
// this computes, and `Studio.tsx` runs the chosen action.
//
// Its items are data, like the layout menu's (`domain/layoutMenu.ts`): a
// comment on what was right-clicked, and on an editor the Cut / Copy /
// Paste the native menu offered, since this menu replaces it.
import type { Messages } from './messages'
import type { PreviewClick } from './reviewComment'

/** The editors the menu opens on: the slide's body and notes, and the
 * layout screen's file editor. */
export type MenuEditor = 'body' | 'note' | 'layout'

/** What the menu is open on, and where on screen.
 * - `on-slide-preview`: the slide preview, `click` being what a left-click
 *   at the same spot would comment on.
 * - `on-editor`: an editor, `from`/`to` its selection as the right-click
 *   left it (`selectionForMenu`; a caret when equal) — what the comment is
 *   on, and what Cut and Copy take. */
export type CommentMenu =
  | { kind: 'closed' }
  | { kind: 'on-slide-preview'; x: number; y: number; click: PreviewClick }
  | { kind: 'on-editor'; editor: MenuEditor; x: number; y: number; from: number; to: number }

export const COMMENT_MENU_CLOSED: CommentMenu = { kind: 'closed' }

export type CommentMenuAction = 'comment' | 'comment-lines' | 'cut' | 'copy' | 'paste'

export interface CommentMenuItem {
  action: CommentMenuAction
  enabled: boolean
  /** A rule above it, setting it apart from the items before. */
  separatorBefore: boolean
}

/** The menu opened by right-clicking the slide preview. */
export function openOnSlidePreview(x: number, y: number, click: PreviewClick): CommentMenu {
  return { kind: 'on-slide-preview', x, y, click }
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

/** The menu's items, in order, each with whether it can run now. The
 * preview offers a comment; an editor a comment on its lines, then — set
 * apart — Cut and Copy (with text selected) and Paste. */
export function commentMenuItems(menu: CommentMenu): CommentMenuItem[] {
  switch (menu.kind) {
    case 'closed':
      return []
    case 'on-slide-preview':
      return [{ action: 'comment', enabled: true, separatorBefore: false }]
    case 'on-editor': {
      const selected = menu.from !== menu.to
      return [
        { action: 'comment-lines', enabled: true, separatorBefore: false },
        { action: 'cut', enabled: selected, separatorBefore: true },
        { action: 'copy', enabled: selected, separatorBefore: false },
        { action: 'paste', enabled: true, separatorBefore: false },
      ]
    }
    default: {
      const _exhaustive: never = menu
      return _exhaustive
    }
  }
}

/** `action`'s label in `menu`: a comment on lines says whether it's on the
 * line the cursor is on or on the lines selected. */
export function commentMenuLabel(action: CommentMenuAction, menu: CommentMenu, messages: Messages): string {
  switch (action) {
    case 'comment': return messages.commentHere
    case 'comment-lines':
      return menu.kind === 'on-editor' && menu.from !== menu.to ? messages.commentOnSelectedLines : messages.commentOnThisLine
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
