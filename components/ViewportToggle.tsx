'use client'

import type { PhoneShape, ViewportMode } from '../domain/viewport'
import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'

// Props are values, not signal getters (BF044) — see `WelcomeScreen.tsx`.
export interface ViewportToggleProps {
  language: Language
  /** Which segment is lit. */
  viewportMode: ViewportMode
  onToggleViewportMode: () => void
  /** Which shape the menu marks as chosen; the ▾ that opens the menu only
   * shows in phone display. */
  phoneShape: PhoneShape
  phoneShapeMenuOpen: boolean
  onTogglePhoneShapeMenu: () => void
  onClosePhoneShapeMenu: () => void
  onSelectPhoneShape: (shape: PhoneShape) => void
  /** Which edge of the toggle the shape menu lines up with: `left` grows it
   * rightwards (the slide preview, at the left of its pane), `right` grows
   * it leftwards (the layout list, near the window's right edge). */
  menuSide: 'left' | 'right'
}

function menuSideClass(side: 'left' | 'right'): string {
  return side === 'right' ? 'right-0' : 'left-0'
}

/** The PC / Phone switch and its phone shape menu, shared by the slide
 * preview (`SlidePreview.tsx`) and the layout list (`LayoutScreen.tsx`):
 * both read and write the same `uiStore` state, so a switch on either
 * screen shows on both. One pill holds the switch (one switch rather than
 * two buttons, so pressing the lit segment can't be misread as a request
 * for the mode already showing) and, in phone display, the ▾ that opens
 * the shape menu — the split-button shape `DeckHeader.tsx`'s Present uses.
 * The segments are icons, so the switch's `aria-label` and each segment's
 * `title` carry the words. */
export function ViewportToggle(props: ViewportToggleProps) {
  return (
    <div className="relative">
      <div className="flex rounded-full border border-border overflow-hidden">
        <button
          type="button"
          role="switch"
          data-viewport-toggle
          aria-label={messagesFor(props.language).previewAsPhone}
          aria-checked={props.viewportMode === 'mobile' ? 'true' : 'false'}
          onClick={() => props.onToggleViewportMode()}
          className="flex"
        >
          <span title={messagesFor(props.language).previewPc} className={(props.viewportMode === 'desktop' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'flex items-center px-2.5 py-1'}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="block w-3.5 h-3.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
          </span>
          <span title={messagesFor(props.language).previewPhone} className={(props.viewportMode === 'mobile' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'flex items-center px-2.5 py-1'}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="block w-3.5 h-3.5">
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <path d="M12 18h.01" />
            </svg>
          </span>
        </button>
        {/* Phone display only, when the Phone segment is lit: the ▾ is
            that segment's own dropdown, so it shares its fill and is
            cut off from it by a hairline (as in the Present button).
            Permanently mounted and toggled by class, like the menu
            below. */}
        <button
          type="button"
          data-phone-shape-menu-button
          title={messagesFor(props.language).phoneCanvasShape}
          aria-label={messagesFor(props.language).phoneCanvasShape}
          aria-haspopup="menu"
          aria-expanded={props.phoneShapeMenuOpen ? 'true' : 'false'}
          onClick={() => props.onTogglePhoneShapeMenu()}
          className={(props.viewportMode === 'mobile' ? 'flex' : 'hidden') + ' items-center px-2 text-xs bg-primary text-primary-foreground border-l border-primary-foreground/25'}
        >
          <span aria-hidden="true">▾</span>
        </button>
      </div>
      {/* The overlay swallows the outside click that closes the menu
          (the same trick as the Present / variant menus), so the click
          never reaches whatever is underneath. A right-click closes it
          too, without the native context menu. `z-10` / `z-20` put both
          above the canvas. The ▾ toggles rather than only opens, so a
          keyboard user (the overlay only shields the mouse) can collapse
          the menu from it; picking an option closes it too (the store
          does both). */}
      <div
        data-phone-shape-backdrop
        className={(props.phoneShapeMenuOpen ? '' : 'hidden ') + 'fixed top-0 right-0 bottom-0 left-0 z-10'}
        onClick={() => props.onClosePhoneShapeMenu()}
        onContextMenu={event => {
          event.preventDefault()
          props.onClosePhoneShapeMenu()
        }}
      />
      <div
        role="menu"
        data-phone-shape-menu
        aria-label={messagesFor(props.language).phoneCanvasShape}
        className={(props.phoneShapeMenuOpen ? '' : 'hidden ') + menuSideClass(props.menuSide) + ' absolute top-full mt-2 w-96 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-20'}
      >
        <button
          type="button"
          role="menuitemradio"
          data-phone-shape-option="portrait"
          aria-checked={props.phoneShape === 'portrait' ? 'true' : 'false'}
          onClick={() => props.onSelectPhoneShape('portrait')}
          className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-start gap-2"
        >
          <span aria-hidden="true" className="w-3 text-sm">{props.phoneShape === 'portrait' ? '✓' : ''}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="block w-4 h-4 mt-0.5 shrink-0">
            <rect x="6" y="2" width="12" height="20" rx="2" />
          </svg>
          <span className="block">
            <span className="block text-sm">{messagesFor(props.language).phoneShapeTall}</span>
            <span className="block text-xs text-muted-foreground">{messagesFor(props.language).phoneShapeTallDetail}</span>
          </span>
        </button>
        <button
          type="button"
          role="menuitemradio"
          data-phone-shape-option="deck"
          aria-checked={props.phoneShape === 'deck' ? 'true' : 'false'}
          onClick={() => props.onSelectPhoneShape('deck')}
          className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-start gap-2"
        >
          <span aria-hidden="true" className="w-3 text-sm">{props.phoneShape === 'deck' ? '✓' : ''}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="block w-4 h-4 mt-0.5 shrink-0">
            <rect x="2" y="6" width="20" height="12" rx="2" />
          </svg>
          <span className="block">
            <span className="block text-sm">{messagesFor(props.language).phoneShapeDeck}</span>
            <span className="block text-xs text-muted-foreground">{messagesFor(props.language).phoneShapeDeckDetail}</span>
          </span>
        </button>
      </div>
    </div>
  )
}
