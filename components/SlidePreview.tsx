'use client'

import { createEffect, untrack } from '@barefootjs/client'
import type { PhoneShape, ViewportMode } from '../domain/viewport'
import { mountSlideCanvas, observeCanvasScale } from '../dom/slideCanvas'

export interface SlidePreviewProps {
  selectedSlideKey: string | null
  hasDeck: boolean
  /** Which toggle segment is lit; the canvas size for it arrives as
   * `canvasWidth`/`canvasHeight`. */
  viewportMode: ViewportMode
  onToggleViewportMode: () => void
  /** Which shape the menu marks as chosen; the ▾ that opens the menu only
   * shows in phone display. */
  phoneShape: PhoneShape
  phoneShapeMenuOpen: boolean
  onTogglePhoneShapeMenu: () => void
  onClosePhoneShapeMenu: () => void
  onSelectPhoneShape: (shape: PhoneShape) => void
  canvasFragmentOf: (key: string) => string
  slideStylesheet: () => CSSStyleSheet
  canvasWidth: number
  canvasHeight: number
}

export function SlidePreview(props: SlidePreviewProps) {
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      {/* Permanently mounted like the two children below, hidden while no
          slide is selected (there is nothing to preview then). One pill
          holds the PC / Phone switch (one switch rather than two buttons,
          so pressing the lit segment can't be misread as a request for the
          mode already showing) and, in phone display, the ▾ that opens the
          shape menu — the split-button shape `DeckHeader.tsx`'s Present
          uses. The segments are icons, so the switch's `aria-label` and each
          segment's `title` carry the words. */}
      <div className={(props.selectedSlideKey === null ? 'hidden ' : '') + 'shrink-0 h-9 flex items-center justify-end px-3'}>
        <div className="relative">
          <div className="flex rounded-full border border-border overflow-hidden">
            <button
              type="button"
              role="switch"
              data-viewport-toggle
              aria-label="Preview as phone"
              aria-checked={props.viewportMode === 'mobile' ? 'true' : 'false'}
              onClick={() => props.onToggleViewportMode()}
              className="flex"
            >
              <span title="PC" className={(props.viewportMode === 'desktop' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'flex items-center px-2.5 py-1'}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="block w-3.5 h-3.5">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8" />
                  <path d="M12 17v4" />
                </svg>
              </span>
              <span title="Phone" className={(props.viewportMode === 'mobile' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'flex items-center px-2.5 py-1'}>
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
              title="Phone canvas shape"
              aria-label="Phone canvas shape"
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
            aria-label="Phone canvas shape"
            className={(props.phoneShapeMenuOpen ? '' : 'hidden ') + 'absolute right-0 top-full mt-2 w-96 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-20'}
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
                <span className="block text-sm">Tall</span>
                <span className="block text-xs text-muted-foreground">A tall canvas shaped like a portrait phone</span>
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
                <span className="block text-sm">Same ratio as PC</span>
                <span className="block text-xs text-muted-foreground">Keeps the deck's own ratio (16:9 / 4:3)</span>
              </span>
            </button>
          </div>
        </div>
      </div>
      {/* Both children stay mounted for this component's whole life and
          only toggle `hidden`, rather than one conditional swapping them:
          BarefootJS re-runs a conditional branch's bindings every time that
          branch is re-entered and never disposes what the previous run
          created, so a selection that goes away and comes back would leave
          the `ref`'s effect below running against the detached host while a
          second one started on the new host. (`SlideContextMenu` is kept
          permanently mounted for a related reason.) */}
      <div
        data-preview-host
        ref={el => {
          // Tracks `selectedSlideKey` and the canvas size, but reads the
          // fragment `untrack`ed: an edit to the *already-selected* slide
          // has to patch in place through `Studio.tsx`'s
          // `patchSlideCanvases` — which finds this host by the
          // `data-slide-canvas-key` set here — instead of re-mounting the
          // whole canvas on every keystroke. A canvas change (the PC/phone
          // toggle, or the phone shape) does re-mount, and
          // `observeCanvasScale` re-fits it.
          createEffect(() => {
            const key = props.selectedSlideKey
            if (key === null) return
            el.dataset.slideCanvasKey = key
            const canvas = { width: props.canvasWidth, height: props.canvasHeight }
            mountSlideCanvas(el, props.slideStylesheet(), untrack(() => props.canvasFragmentOf(key)), canvas, 'interactive')
            observeCanvasScale(el, canvas)
          })
        }}
        className={(props.selectedSlideKey === null ? 'hidden ' : '') + 'flex-1 w-full'}
      />
      <div className={(props.selectedSlideKey === null ? '' : 'hidden ') + 'flex-1 flex items-center justify-center text-sm text-muted-foreground'}>
        {props.hasDeck ? 'Select a slide to preview it.' : 'Open a deck to preview it.'}
      </div>
    </div>
  )
}
