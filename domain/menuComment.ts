// The comment item every right-click menu opens with: the slide list's and
// the layout list's, and the ones on the previews and the editors. One
// place for what it is — its action, its label, its icon, and the rule that
// sets it apart from the items under it — so the menus can't drift apart.
// What it comments on is each menu's own (the CommentBox's header names
// it). Pure.
import type { Messages } from './messages'

/** The comment item's action, the same in every menu. */
export const COMMENT_ACTION = 'comment'
export type CommentAction = typeof COMMENT_ACTION

/** The icon a menu item shows at the left of its label: the comment
 * item's speech bubble, or none (the gutter stays, so labels align). */
export type MenuIcon = 'comment' | null

/** The comment item's label, the same in every menu: `Comment…`. */
export function commentItemLabel(messages: Messages): string {
  return messages.comment
}

/** `action`'s icon in a menu. */
export function menuItemIcon(action: string): MenuIcon {
  return action === COMMENT_ACTION ? 'comment' : null
}

/** Whether item `index` of `actions` (a menu's items, in order) is set
 * apart from the ones before it by a rule: the item right after the
 * comment. */
export function setApartFromComment(actions: readonly string[], index: number): boolean {
  return index > 0 && actions[index - 1] === COMMENT_ACTION
}
