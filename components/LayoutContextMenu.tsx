'use client'

import { type LayoutMenuAction } from '../domain/layoutMenu'

/** One item as the menu draws it (`domain/layoutMenu.ts` decides which). */
export interface LayoutMenuEntry {
  action: LayoutMenuAction
  label: string
  enabled: boolean
  /** Why it's off, as a tooltip; `''` when it isn't. */
  title: string
}

export interface LayoutContextMenuProps {
  hidden: boolean
  position: { x: number; y: number }
  items: LayoutMenuEntry[]
  onMenuRef: (el: HTMLElement) => void
  onClose: () => void
  onAction: (action: LayoutMenuAction) => void
}

/** The layout list's right-click menu. Permanently mounted and hidden by
 * class, like `SlideContextMenu.tsx` (see its comment, and CLAUDE.md's
 * BarefootJS pitfalls on branches). Its items are whatever
 * `layoutMenuItems` lists, so a new action needs no change here. A click
 * on the backdrop — anywhere outside the menu — closes it. */
export function LayoutContextMenu(props: LayoutContextMenuProps) {
  return (
    <>
      <div
        className={(props.hidden ? 'hidden ' : '') + 'fixed top-0 right-0 bottom-0 left-0 z-30'}
        onClick={() => props.onClose()}
        onContextMenu={e => { e.preventDefault(); props.onClose() }}
      />
      <div
        ref={el => props.onMenuRef(el)}
        role="menu"
        data-layout-menu
        className={(props.hidden ? 'hidden ' : '') + 'fixed w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-40 text-sm'}
        style={`left: ${String(props.position.x)}px; top: ${String(props.position.y)}px`}
        onContextMenu={e => e.preventDefault()}
      >
        {props.items.map(item => (
          <button
            type="button"
            role="menuitem"
            key={item.action}
            data-layout-menu-item={item.action}
            disabled={!item.enabled}
            title={item.title}
            onClick={() => props.onAction(item.action)}
            className={(item.action === 'delete' ? 'text-destructive ' : '') + 'w-full flex items-center px-3 py-1.5 text-left hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent'}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
