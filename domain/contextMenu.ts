import { type PageConfig } from './pageConfig'
import { COMMENT_ACTION, type CommentAction } from './menuComment'
import type { PreviewClick } from './reviewComment'
import { type LayoutFitCheck, type LayoutVerdict, settledFitCheck } from './layoutFit'

/** The thumbnail context menu's own state. `layoutPickerOpen` only exists
 * on `on-slide` — right-clicking empty space can't expand a layout picker
 * there's no slide to change the layout of, and this makes that
 * unrepresentable instead of just "always false in that case". The same
 * goes for `layoutFit` (which layouts that slide fits): it belongs to one
 * right-click on one slide, so closing the menu or opening it again
 * elsewhere can't carry it over. */
export type ContextMenu =
  | { kind: 'closed' }
  | { kind: 'on-empty-space'; x: number; y: number }
  | {
    kind: 'on-slide'
    index: number
    x: number
    y: number
    layoutPickerOpen: boolean
    layoutFit: LayoutFitCheck
    /** What the comment item is on: where the slide preview was
     * right-clicked (the target a left-click there gives), or `null` from
     * the slide list — the slide as a whole. */
    comment: PreviewClick | null
  }

export type MenuAction =
  | CommentAction
  | 'new-slide' | 'cut' | 'copy' | 'paste' | 'delete' | 'change-layout'
  | 'toggle-draft' | 'toggle-skip' | 'toggle-section' | 'toggle-page-number' | 'move-up' | 'move-down'

export interface MenuItem {
  action: MenuAction
  enabled: boolean
  checked?: boolean
}

export interface MenuContext {
  slideCount: number
  hasClipboard: boolean
  configOf: (index: number) => PageConfig
  /** Whether the deck shows page numbers at all (`page_numbers` is
   * `current` or `current_of_total`) — see `pageNumbersShown`. */
  pageNumbersShown: boolean
}

/** The right-clicked slide's index, or `null` when the menu is closed or
 * was opened on empty space. */
export function indexOf(menu: ContextMenu): number | null {
  return menu.kind === 'on-slide' ? menu.index : null
}

/** Whether the "Change Layout" submenu is expanded — always `false`
 * outside `on-slide`, where there's no such submenu to expand. */
export function isLayoutPickerOpen(menu: ContextMenu): boolean {
  return menu.kind === 'on-slide' && menu.layoutPickerOpen
}

/** Where to render the menu — `{x: 0, y: 0}` while closed, since nothing
 * reads it in that state (the menu subtree stays permanently mounted and
 * hidden via a class, not gated on this). */
export function positionOf(menu: ContextMenu): { x: number; y: number } {
  return menu.kind === 'closed' ? { x: 0, y: 0 } : { x: menu.x, y: menu.y }
}

/** Every menu item's enabled/checked state for the given menu + slide-list
 * context — replaces the eleven separate `disabled={...}` ternaries that
 * used to live inline in Studio.tsx's JSX, each re-deriving `index` and
 * re-reading `configOf` for itself. */
export function menuItems(menu: ContextMenu, ctx: MenuContext): MenuItem[] {
  const index = indexOf(menu)
  const hasSlide = index !== null
  const config = index !== null ? ctx.configOf(index) : null
  // peitho-core rejects a slide marked both draft and skip, and a draft
  // slide that declares a section marker (see domain/slideStatus.ts's own
  // doc comment) — so once a draft slide has a reachable, right-clickable
  // row of its own (the slide list no longer hides it), these two toggles
  // must disable themselves for it rather than reach commitChange with a
  // combination peitho-core is guaranteed to refuse.
  const isDraft = config?.draft === true
  // peitho-core also refuses `page_number:false` on a draft slide, or on
  // any slide of a deck with no `page_numbers` setting — so hiding a
  // slide's number needs the deck to show numbers, and a slide that
  // already hides its own can't be made a draft until it stops. Showing a
  // hidden number again is always allowed: it's the way out of either
  // refused combination, should a hand edit have produced one.
  const hidesPageNumber = config?.page_number === false
  return [
    // First, as in every right-click menu (`domain/menuComment.ts`): on the
    // slide right-clicked, or on what was right-clicked on its preview.
    { action: COMMENT_ACTION, enabled: hasSlide },
    { action: 'new-slide', enabled: true },
    { action: 'cut', enabled: hasSlide },
    { action: 'copy', enabled: hasSlide },
    { action: 'paste', enabled: ctx.hasClipboard },
    { action: 'delete', enabled: hasSlide && ctx.slideCount > 1 },
    { action: 'change-layout', enabled: hasSlide },
    { action: 'toggle-draft', enabled: hasSlide && (isDraft || !hidesPageNumber), checked: isDraft },
    { action: 'toggle-skip', enabled: hasSlide && !isDraft, checked: config?.skip === true },
    { action: 'toggle-section', enabled: hasSlide && !isDraft, checked: typeof config?.section === 'string' },
    { action: 'toggle-page-number', enabled: hasSlide && (hidesPageNumber || (!isDraft && ctx.pageNumbersShown)), checked: hidesPageNumber },
    { action: 'move-up', enabled: hasSlide && index > 0 },
    { action: 'move-down', enabled: hasSlide && index < ctx.slideCount - 1 },
  ]
}

/** The index a slide-appending action (New Slide, Paste) should insert
 * after — the right-clicked slide, or the end of the list when the menu
 * is closed or was opened on empty space. */
export function appendIndex(menu: ContextMenu, slideCount: number): number {
  return indexOf(menu) ?? slideCount - 1
}

/** A menu freshly opened by right-clicking slide `index` — its row, or
 * its preview at `comment` (what a comment from there is on): picker
 * collapsed, and its fit check waiting on the
 * `check_slide_layouts` call identified by `requestId`. */
export function openOnSlide(index: number, x: number, y: number, requestId: number, comment: PreviewClick | null = null): ContextMenu {
  return { kind: 'on-slide', index, x, y, layoutPickerOpen: false, layoutFit: { kind: 'checking', requestId }, comment }
}

/** Where the slide preview was right-clicked, for the comment item —
 * `null` from the slide list (the slide as a whole) or with no slide. */
export function commentClickOf(menu: ContextMenu): PreviewClick | null {
  return menu.kind === 'on-slide' ? menu.comment : null
}

/** Settles the menu's fit check with the answer to `requestId` (`null` when
 * there was nothing to judge or the call failed). An answer for any other
 * request is stale — the menu closed, or was reopened by a later
 * right-click, while it was in flight — and leaves `menu` unchanged. */
export function withLayoutFitResult(menu: ContextMenu, requestId: number, verdicts: readonly LayoutVerdict[] | null): ContextMenu {
  if (menu.kind !== 'on-slide' || menu.layoutFit.kind !== 'checking' || menu.layoutFit.requestId !== requestId) return menu
  return { ...menu, layoutFit: settledFitCheck(verdicts) }
}

/** The menu's fit check — `unavailable` outside `on-slide`, where there's
 * no picker to check for. */
export function layoutFitOf(menu: ContextMenu): LayoutFitCheck {
  return menu.kind === 'on-slide' ? menu.layoutFit : { kind: 'unavailable' }
}

/** What choosing a layout from the picker should do: pin it on slide
 * `index`, or nothing (no slide targeted). A layout the slide doesn't fit
 * is pinned too — the picker marks it, but which layout a slide is on is
 * the user's call: a new slide (a lone heading) can't fit a layout whose
 * image is required until the image is added, and the build error that
 * leaves meanwhile is shown in the error bar like any other. The fit check
 * is not waited on either, for the same reason. */
export type LayoutChoice =
  | { kind: 'apply'; index: number }
  | { kind: 'ignore' }

export function chooseLayout(menu: ContextMenu): LayoutChoice {
  return menu.kind === 'on-slide' ? { kind: 'apply', index: menu.index } : { kind: 'ignore' }
}

/** Whether a given action is enabled in the given `menuItems()` result. */
export function menuItemEnabled(items: MenuItem[], action: MenuAction): boolean {
  return items.find(item => item.action === action)?.enabled ?? false
}

/** Whether a given action is shown checked in the given `menuItems()`
 * result — `false` for an action without a `checked` field at all
 * (most actions), not just for an explicit `false`. */
export function menuItemChecked(items: MenuItem[], action: MenuAction): boolean {
  return items.find(item => item.action === action)?.checked ?? false
}
