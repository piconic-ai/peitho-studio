// The layout list's right-click menu (the layout screen): what it was
// opened on, which items it offers and whether each can run now. Pure —
// `components/ContextMenu.tsx` draws the items this computes, and
// `Studio.tsx` runs the chosen action.
//
// The items are data (`layoutMenuItems`), not one hard-wired button each,
// so another per-layout or whole-list action — a comment on this layout,
// or on every layout (`todo/layout-review-comments.md`) — is one more
// `LayoutMenuAction` and one more entry below, with no change to the menu
// component or to how it opens.
import { type LayoutFitCheck, type LayoutVerdict, availabilityOf, settledFitCheck } from './layoutFit'
import type { Messages } from './messages'

/** What the menu is open on. Only `on-layout` names a layout, and only it
 * carries the fit check (does the slide open in the slides screen fit
 * this layout) that Apply to Slide waits on — empty list space has
 * nothing to apply. */
export type LayoutMenu =
  | { kind: 'closed' }
  | { kind: 'on-list'; x: number; y: number }
  | { kind: 'on-layout'; name: string; x: number; y: number; fit: LayoutFitCheck }

export const LAYOUT_MENU_CLOSED: LayoutMenu = { kind: 'closed' }

export type LayoutMenuAction = 'new-layout' | 'apply' | 'edit' | 'duplicate' | 'delete' | 'comment-layout' | 'comment-all-layouts'

export interface LayoutMenuItem {
  action: LayoutMenuAction
  enabled: boolean
  /** Why it's off, worded by `layoutMenuTitle`; `null` when there's
   * nothing to explain. */
  reason: LayoutMenuReason | null
}

/** Why an item is off. */
export type LayoutMenuReason =
  | { kind: 'no-slide' }
  | { kind: 'checking' }
  | { kind: 'mismatch'; reason: string }
  | { kind: 'only-layout' }

export interface LayoutMenuContext {
  /** Whether a slide is open in the slides screen (Apply's target). */
  hasSlide: boolean
  /** How many layouts the deck has: its last can't be deleted. */
  layoutCount: number
  /** A layout operation is running; the rest wait for it. */
  busy: boolean
}

/** The menu opened by right-clicking layout `name`. With a slide to apply
 * it to, the fit check waits on the `check_slide_layouts` call
 * `requestId`; without one (`null`) there's nothing to check. */
export function openOnLayout(name: string, x: number, y: number, requestId: number | null): LayoutMenu {
  const fit: LayoutFitCheck = requestId === null ? { kind: 'unavailable' } : { kind: 'checking', requestId }
  return { kind: 'on-layout', name, x, y, fit }
}

/** The menu opened by right-clicking the list's empty space. */
export function openOnList(x: number, y: number): LayoutMenu {
  return { kind: 'on-list', x, y }
}

/** Settles the fit check with the answer to `requestId` (`null`: nothing to
 * judge, or the call failed). An answer to any other request — the menu
 * closed or was opened again meanwhile — leaves `menu` as it is. */
export function withLayoutMenuFit(menu: LayoutMenu, requestId: number, verdicts: readonly LayoutVerdict[] | null): LayoutMenu {
  if (menu.kind !== 'on-layout' || menu.fit.kind !== 'checking' || menu.fit.requestId !== requestId) return menu
  return { ...menu, fit: settledFitCheck(verdicts) }
}

/** The layout the menu is open on, `null` on empty space or closed. */
export function layoutMenuTarget(menu: LayoutMenu): string | null {
  return menu.kind === 'on-layout' ? menu.name : null
}

/** Where the menu is drawn — `{0, 0}` while closed (nothing reads it). */
export function layoutMenuPosition(menu: LayoutMenu): { x: number; y: number } {
  return menu.kind === 'closed' ? { x: 0, y: 0 } : { x: menu.x, y: menu.y }
}

/** `menu` moved to `at` (kept on-screen) — a no-op while closed. */
export function withLayoutMenuPosition(menu: LayoutMenu, at: { x: number; y: number }): LayoutMenu {
  return menu.kind === 'closed' ? menu : { ...menu, x: at.x, y: at.y }
}

function item(action: LayoutMenuAction, reason: LayoutMenuReason | null, busy: boolean): LayoutMenuItem {
  return { action, enabled: reason === null && !busy, reason }
}

function applyReason(menu: Extract<LayoutMenu, { kind: 'on-layout' }>, ctx: LayoutMenuContext): LayoutMenuReason | null {
  if (!ctx.hasSlide) return { kind: 'no-slide' }
  const availability = availabilityOf(menu.fit, menu.name)
  switch (availability.kind) {
    case 'selectable': return null
    case 'checking': return { kind: 'checking' }
    case 'mismatch': return { kind: 'mismatch', reason: availability.reason }
    default: {
      const _exhaustive: never = availability
      return _exhaustive
    }
  }
}

/** The menu's items, in order, each with whether it can run now. Empty
 * space offers New Layout and a comment on every layout; a layout offers
 * Apply to Slide (only with a slide open that fits it), Edit, Duplicate,
 * Delete (not the deck's last layout) and a comment on it. Everything but
 * Edit and the comments waits while another operation runs — a comment
 * touches no file until it's sent. */
export function layoutMenuItems(menu: LayoutMenu, ctx: LayoutMenuContext): LayoutMenuItem[] {
  switch (menu.kind) {
    case 'closed':
      return []
    case 'on-list':
      return [item('new-layout', null, ctx.busy), item('comment-all-layouts', null, false)]
    case 'on-layout':
      return [
        item('apply', applyReason(menu, ctx), ctx.busy),
        item('edit', null, false),
        item('duplicate', null, ctx.busy),
        item('delete', ctx.layoutCount > 1 ? null : { kind: 'only-layout' }, ctx.busy),
        item('comment-layout', null, false),
      ]
    default: {
      const _exhaustive: never = menu
      return _exhaustive
    }
  }
}

/** `action`'s label in the menu. */
export function layoutMenuLabel(action: LayoutMenuAction, messages: Messages): string {
  switch (action) {
    case 'new-layout': return messages.newLayout
    case 'apply': return messages.applyLayoutToSlide
    case 'edit': return messages.editLayout
    case 'duplicate': return messages.duplicateLayout
    case 'delete': return messages.deleteLayout
    case 'comment-layout': return messages.commentOnLayout
    case 'comment-all-layouts': return messages.commentOnAllLayouts
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}

/** Why an item is off, as its tooltip; `''` when it isn't. */
export function layoutMenuTitle(reason: LayoutMenuReason | null, messages: Messages): string {
  if (reason === null) return ''
  switch (reason.kind) {
    case 'no-slide': return messages.applyLayoutNeedsSlide
    case 'checking': return messages.layoutChecking
    case 'mismatch': return reason.reason
    case 'only-layout': return messages.onlyLayoutCannotBeDeleted
    default: {
      const _exhaustive: never = reason
      return _exhaustive
    }
  }
}
