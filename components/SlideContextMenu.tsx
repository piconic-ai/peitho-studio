'use client'

import { moveImageOrder, type ImageOrderAction } from '../domain/imageOrder'
import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import { menuItemEnabled, menuItemChecked, type MenuItem } from '../domain/contextMenu'
import { COMMENT_ACTION, commentItemLabel } from '../domain/menuComment'
import { entryTitle, isSelectable, layoutNoticeText, type LayoutFitCheck, type LayoutNotice } from '../domain/layoutFit'
import { layoutDisplayName } from '../domain/standardLayouts'
import { mountSlideCanvas, observeCanvasScale } from '../dom/slideCanvas'

export interface SlideContextMenuProps {
  /** The UI language every label here is shown in. */
  language: Language
  hidden: boolean
  position: { x: number; y: number }
  menuItems: MenuItem[]
  image?: { slot: string; order: string[] } | null
  elementMenu?: boolean
  imageBusy?: boolean
  onImageOrder?: (action: ImageOrderAction) => void
  layoutPickerOpen: boolean
  layoutPickerView: 'loading' | 'empty' | 'ready'
  layoutPreviews: { name: string; fragment: string }[] | null
  /** Which layouts the right-clicked slide fits — entries it doesn't (or
   * all of them, while the check is still running) are dimmed. */
  layoutFit: LayoutFitCheck
  /** Why the last layout chosen from the picker was refused, shown under
   * the picker grid; `null` hides it. */
  layoutNotice: LayoutNotice | null
  layoutPreviewStylesheet: () => CSSStyleSheet
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
  onTogglePageNumber: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  /** The comment: on the slide right-clicked in the list, or on what was
   * right-clicked on its preview. */
  onCommentSlide: () => void
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
        role="menu"
        data-slide-menu
        // Was `contextMenu() === null || layoutPickerOpen()` — the "Change
        // Layout" submenu (`layoutPickerOpen() ? <div>...` below) renders
        // as a CHILD of this same div, so that condition hid the whole
        // menu, submenu included, the instant it was expanded. Only
        // `hidden` (derived from `contextMenu().kind === 'closed'`) should
        // hide this.
        className={(props.hidden ? 'hidden ' : '') + 'fixed w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-40 text-sm'}
        style={`left: ${String(props.position.x)}px; top: ${String(props.position.y)}px`}
      >
        {/* The comment every right-click menu opens with
            (`domain/menuComment.ts`), its speech bubble in the gutter the
            other items keep (`pl-9`), as in `ContextMenu.tsx`. */}
        <button
          type="button"
          data-slide-menu-item={COMMENT_ACTION}
          disabled={!menuItemEnabled(props.menuItems, COMMENT_ACTION)}
          onClick={() => props.onCommentSlide()}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <svg aria-hidden="true" data-menu-icon="comment" className="block w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4.2 3.4a.5.5 0 0 1-.8-.4V5a1 1 0 0 1 1-1z" />
          </svg>
          <span>{commentItemLabel(messagesFor(props.language))}</span>
        </button>
        <div hidden={props.elementMenu && !props.image} className="my-1 border-t border-border" />
        <div hidden={!props.image} data-image-order-menu>
          {(['front', 'forward', 'backward', 'back'] as ImageOrderAction[]).map(action => (
            <button key={action} type="button" data-image-order-action={action}
              disabled={!props.image || props.imageBusy || moveImageOrder(props.image.order, props.image.slot, action).join() === props.image.order.join()}
              onClick={() => props.onImageOrder?.(action)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent">
              <svg aria-hidden="true" className="block w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="9" width="12" height="12" />
                <rect x="9" y="3" width="12" height="12" fill="var(--popover, white)" />
                <path d={action === 'front' || action === 'forward' ? 'M5 14V3m-3 3 3-3 3 3' : 'M19 10v11m-3-3 3 3 3-3'} />
                <path d={action === 'front' ? 'M2 1h6' : action === 'back' ? 'M16 23h6' : ''} />
              </svg>
              <span>{({ ja: { front: '最前面', forward: '前面', backward: '背面', back: '最背面' }, en: { front: 'Bring to front', forward: 'Bring forward', backward: 'Send backward', back: 'Send to back' } }[props.language])[action]}</span>
            </button>
          ))}
        </div>
        <div hidden={props.elementMenu} data-slide-menu-controls>
        <button
          type="button"
          onClick={() => props.onNewSlide()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent"
        >
          <span>{messagesFor(props.language).newSlide}</span><span className="text-xs text-muted-foreground">⌘⏎</span>
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'cut')}
          onClick={() => props.onCut()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).cut}</span><span className="text-xs text-muted-foreground">⌘X</span>
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'copy')}
          onClick={() => props.onCopy()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).copy}</span><span className="text-xs text-muted-foreground">⌘C</span>
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'paste')}
          onClick={() => props.onPaste()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).paste}</span><span className="text-xs text-muted-foreground">⌘V</span>
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'delete')}
          onClick={() => props.onDelete()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent text-destructive"
        >
          <span>{messagesFor(props.language).delete}</span><span className="text-xs text-muted-foreground">⌦</span>
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'change-layout')}
          onClick={() => props.onToggleLayoutPicker()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).changeLayout}</span><span aria-hidden="true">{props.layoutPickerOpen ? '▾' : '▸'}</span>
        </button>
        {props.layoutPickerOpen ? (
          <div className="pl-3 max-h-64 overflow-y-auto">
            {props.layoutPickerView === 'loading' ? (
              <div className="px-3 py-1.5 text-xs text-muted-foreground">{messagesFor(props.language).loading}</div>
            ) : props.layoutPickerView === 'empty' ? (
              <div className="px-3 py-1.5 text-xs text-muted-foreground">{messagesFor(props.language).noLayouts}</div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 px-2 py-1.5">
                {props.layoutPreviews!.map(preview => (
                  <button
                    type="button"
                    key={preview.name}
                    // `aria-disabled`, not `disabled`: a refused layout must
                    // still receive the click, so `onChangeLayout` can explain
                    // why it was refused instead of the click doing nothing.
                    aria-disabled={isSelectable(props.layoutFit, preview.name) ? 'false' : 'true'}
                    title={entryTitle(props.layoutFit, preview.name, messagesFor(props.language))}
                    onClick={() => props.onChangeLayout(preview.name)}
                    className={(isSelectable(props.layoutFit, preview.name) ? '' : 'opacity-40 ') + 'flex flex-col gap-1 text-left group'}
                  >
                    <span
                      className="block relative rounded border border-border bg-black overflow-hidden group-hover:border-muted-foreground"
                      style={`aspect-ratio: ${String(props.canvasWidth)} / ${String(props.canvasHeight)}`}
                    >
                      {preview.fragment ? (
                        <div
                          ref={el => {
                            const canvas = { width: props.canvasWidth, height: props.canvasHeight }
                            mountSlideCanvas(el, props.layoutPreviewStylesheet(), preview.fragment, canvas, 'thumbnail')
                            observeCanvasScale(el, canvas)
                          }}
                          className="absolute top-0 right-0 bottom-0 left-0"
                        />
                      ) : null}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate">{layoutDisplayName(preview.name, props.language)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {/* Outside the picker's own scroll area, so the notice stays in view
            whichever entry was clicked; permanently mounted with `hidden`
            rather than a conditional, like StatusBar's error banner. */}
        <div
          role="alert"
          hidden={props.layoutNotice === null || !props.layoutPickerOpen}
          className="mx-3 my-1.5 text-xs text-destructive break-words"
        >
          {props.layoutNotice === null ? '' : layoutNoticeText(messagesFor(props.language), props.layoutNotice)}
        </div>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'toggle-draft')}
          onClick={() => props.onToggleDraft()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).markAsDraft}</span>
          {menuItemChecked(props.menuItems, 'toggle-draft') ? <span aria-hidden="true">✓</span> : null}
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'toggle-skip')}
          onClick={() => props.onToggleSkip()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).skipInPresent}</span>
          {menuItemChecked(props.menuItems, 'toggle-skip') ? <span aria-hidden="true">✓</span> : null}
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'toggle-section')}
          onClick={() => props.onToggleSection()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).sectionStart}</span>
          {menuItemChecked(props.menuItems, 'toggle-section') ? <span aria-hidden="true">✓</span> : null}
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'toggle-page-number')}
          onClick={() => props.onTogglePageNumber()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).hidePageNumber}</span>
          {menuItemChecked(props.menuItems, 'toggle-page-number') ? <span aria-hidden="true">✓</span> : null}
        </button>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'move-up')}
          onClick={() => props.onMoveUp()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).moveSlideUp}</span><span className="text-xs text-muted-foreground">⌘⇧↑</span>
        </button>
        <button
          type="button"
          disabled={!menuItemEnabled(props.menuItems, 'move-down')}
          onClick={() => props.onMoveDown()}
          className="w-full flex items-center justify-between pl-9 pr-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span>{messagesFor(props.language).moveSlideDown}</span><span className="text-xs text-muted-foreground">⌘⇧↓</span>
        </button>
        </div>
      </div>
    </>
  )
}
