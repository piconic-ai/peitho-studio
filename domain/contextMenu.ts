import { type PageConfig } from './pageConfig'

/** The thumbnail context menu's own state. `layoutPickerOpen` only exists
 * on `on-slide` — right-clicking empty space can't expand a layout picker
 * there's no slide to change the layout of, and this makes that
 * unrepresentable instead of just "always false in that case". */
export type ContextMenu =
  | { kind: 'closed' }
  | { kind: 'on-empty-space'; x: number; y: number }
  | { kind: 'on-slide'; index: number; x: number; y: number; layoutPickerOpen: boolean }

export type MenuAction =
  | 'new-slide' | 'cut' | 'copy' | 'paste' | 'delete' | 'change-layout'
  | 'toggle-draft' | 'toggle-skip' | 'toggle-section' | 'move-up' | 'move-down'

export interface MenuItem {
  action: MenuAction
  enabled: boolean
  checked?: boolean
}

export interface MenuContext {
  slideCount: number
  hasClipboard: boolean
  configOf: (index: number) => PageConfig
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
  return [
    { action: 'new-slide', enabled: true },
    { action: 'cut', enabled: hasSlide },
    { action: 'copy', enabled: hasSlide },
    { action: 'paste', enabled: ctx.hasClipboard },
    { action: 'delete', enabled: hasSlide && ctx.slideCount > 1 },
    { action: 'change-layout', enabled: hasSlide },
    { action: 'toggle-draft', enabled: hasSlide, checked: isDraft },
    { action: 'toggle-skip', enabled: hasSlide && !isDraft, checked: config?.skip === true },
    { action: 'toggle-section', enabled: hasSlide && !isDraft, checked: typeof config?.section === 'string' },
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
