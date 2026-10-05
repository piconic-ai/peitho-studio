'use client'

/** One item as a right-click menu draws it — what `domain/layoutMenu.ts`
 * and `domain/commentMenu.ts` decide, worded. */
export interface ContextMenuEntry {
  action: string
  label: string
  enabled: boolean
  /** Why it's off, as a tooltip; `''` when it isn't. */
  title: string
  /** Drawn in the destructive color (Delete). */
  danger: boolean
  /** A rule above it, setting it apart from the items before. */
  separatorBefore: boolean
}

export interface ContextMenuProps {
  /** Which menu this is, as `data-menu` (`layout`, `comment`). */
  name: string
  hidden: boolean
  position: { x: number; y: number }
  items: ContextMenuEntry[]
  onMenuRef: (el: HTMLElement) => void
  onClose: () => void
  onAction: (action: string) => void
}

/** The app's own right-click menu, in place of the webview's: the layout
 * list's, and the one on the previews and the editors. Permanently
 * mounted and hidden by class, like `SlideContextMenu.tsx` (see its
 * comment, and CLAUDE.md's BarefootJS pitfalls on branches). Its items
 * are whatever the menu's domain module lists, so a new action needs no
 * change here. A click on the backdrop — anywhere outside the menu —
 * closes it. A press on the menu doesn't take focus: an editor keeps its
 * focus and selection (a vim visual selection too) for Cut and Copy. */
export function ContextMenu(props: ContextMenuProps) {
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
        data-menu={props.name}
        className={(props.hidden ? 'hidden ' : '') + 'fixed w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-40 text-sm'}
        style={`left: ${String(props.position.x)}px; top: ${String(props.position.y)}px`}
        onMouseDown={e => e.preventDefault()}
        onContextMenu={e => e.preventDefault()}
      >
        {props.items.map(item => (
          <button
            type="button"
            role="menuitem"
            key={item.action}
            data-menu-item={item.action}
            disabled={!item.enabled}
            title={item.title}
            onClick={() => props.onAction(item.action)}
            className={(item.danger ? 'text-destructive ' : '') + (item.separatorBefore ? 'mt-1 border-t border-border ' : '') + 'w-full flex items-center px-3 py-1.5 text-left hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent'}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
