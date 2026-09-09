'use client'

import { menuItemEnabled, menuItemChecked, type MenuItem } from '../domain/contextMenu'
import { buildLayoutPreviewDoc } from '../domain/previewDoc'

export interface SlideContextMenuProps {
  hidden: boolean
  position: { x: number; y: number }
  menuItems: MenuItem[]
  layoutPickerOpen: boolean
  layoutPickerView: 'loading' | 'empty' | 'ready'
  layoutPreviews: { name: string; fragment: string }[] | null
  layoutPreviewCss: string
  canvasWidth: number
  canvasHeight: number
  onMenuRef: (el: HTMLElement) => void
  onClose: () => void
  onNewSlide: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onDelete: () => void
  onToggleLayoutPicker: () => void
  onChangeLayout: (name: string) => void
  onToggleDraft: () => void
  onToggleSkip: () => void
  onToggleSection: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function SlideContextMenu(props: SlideContextMenuProps) {
  return (
    <>
      {/* This whole block (backdrop + both panels) is mounted exactly once,
          for the app's entire lifetime — visibility is a `hidden` class
          toggle on `contextMenu() === null`, never a mount/unmount. A child
          conditional (`layoutPreviews() === null ? Loading : ... : ...`)
          inside a subtree that gets freshly mounted on every open (the old
          `{contextMenu() ? (...) : null}` gate) never showed its later,
          post-mount branches here — not from `.map()`, not from CSS Grid,
          not from any nesting/prop variant tried — while the exact same
          kind of conditional inside the app's permanently-mounted tree
          (e.g. `manifest() === null ? ... : ...` for the slide list) has
          worked correctly all session. Keeping this permanently mounted
          like that one, instead of gated on `contextMenu()`, sidesteps
          whatever that remount-specific issue is. */}
      <div
        className={(props.hidden ? 'hidden ' : '') + 'fixed top-0 right-0 bottom-0 left-0 z-30'}
        onClick={() => props.onClose()}
        onContextMenu={e => { e.preventDefault(); props.onClose() }}
      />
      <div
        ref={el => props.onMenuRef(el)}
        // Was `contextMenu() === null || layoutPickerOpen()` — the "Change
        // Layout" submenu (`layoutPickerOpen() ? <div>...` below) renders
        // as a CHILD of this same div, so that condition hid the whole
        // menu, submenu included, the instant it was expanded. Only
        // `hidden` (derived from `contextMenu().kind === 'closed'`) should
        // hide this.
        className={(props.hidden ? 'hidden ' : '') + 'fixed w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-40 text-sm'}
        style={`left: ${String(props.position.x)}px; top: ${String(props.position.y)}px`}
      >
        <button
          type="button"
          onClick={() => props.onNewSlide()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent"
        >
          <span>New Slide</span><span className="text-xs text-muted-foreground">⌘⏎</span>
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'cut')}
          onClick={() => props.onCut()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Cut</span><span className="text-xs text-muted-foreground">⌘X</span>
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'copy')}
          onClick={() => props.onCopy()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Copy</span><span className="text-xs text-muted-foreground">⌘C</span>
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'paste')}
          onClick={() => props.onPaste()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Paste</span><span className="text-xs text-muted-foreground">⌘V</span>
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'delete')}
          onClick={() => props.onDelete()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent text-destructive"
        >
          <span>Delete</span><span className="text-xs text-muted-foreground">⌦</span>
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'change-layout')}
          onClick={() => props.onToggleLayoutPicker()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Change Layout</span><span aria-hidden="true">{props.layoutPickerOpen ? '▾' : '▸'}</span>
        </button>
        {props.layoutPickerOpen ? (
          <div className="pl-3 max-h-64 overflow-y-auto">
            {props.layoutPickerView === 'loading' ? (
              <div className="px-3 py-1.5 text-xs text-muted-foreground">Loading…</div>
            ) : props.layoutPickerView === 'empty' ? (
              <div className="px-3 py-1.5 text-xs text-muted-foreground">No layouts found</div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 px-2 py-1.5">
                {props.layoutPreviews!.map(preview => (
                  <button
                    type="button"
                    key={preview.name}
                    onClick={() => props.onChangeLayout(preview.name)}
                    className="flex flex-col gap-1 text-left group"
                  >
                    <span
                      className="block relative rounded border border-border bg-black overflow-hidden group-hover:border-muted-foreground"
                      style={`aspect-ratio: ${String(props.canvasWidth)} / ${String(props.canvasHeight)}`}
                    >
                      {preview.fragment ? (
                        <>
                          <iframe
                            title={preview.name}
                            srcdoc={buildLayoutPreviewDoc(preview.fragment, props.layoutPreviewCss, props.canvasWidth, props.canvasHeight)}
                            className="absolute top-0 right-0 bottom-0 left-0 w-full h-full border-0"
                          />
                          {/* Keeps the iframe from ever being the click/
                              right-click target — plain `pointer-events:
                              none` on an iframe still loses a right-click
                              to its own native context menu (see
                              CLAUDE.md's Tauri pitfalls). */}
                          <span className="absolute top-0 right-0 bottom-0 left-0" />
                        </>
                      ) : null}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate">{preview.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'toggle-draft')}
          onClick={() => props.onToggleDraft()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Mark as Draft</span>
          {menuItemChecked(props.menuItems, 'toggle-draft') ? <span aria-hidden="true">✓</span> : null}
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'toggle-skip')}
          onClick={() => props.onToggleSkip()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Skip in Present</span>
          {menuItemChecked(props.menuItems, 'toggle-skip') ? <span aria-hidden="true">✓</span> : null}
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'toggle-section')}
          onClick={() => props.onToggleSection()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Section Start</span>
          {menuItemChecked(props.menuItems, 'toggle-section') ? <span aria-hidden="true">✓</span> : null}
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'move-up')}
          onClick={() => props.onMoveUp()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Move Slide Up</span><span className="text-xs text-muted-foreground">⌘⇧↑</span>
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'move-down')}
          onClick={() => props.onMoveDown()}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>Move Slide Down</span><span className="text-xs text-muted-foreground">⌘⇧↓</span>
        </button>
      </div>
    </>
  )
}
