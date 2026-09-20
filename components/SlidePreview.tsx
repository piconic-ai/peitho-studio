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
  /** Which shape segment is lit; the shape switch only shows in phone
   * display. */
  phoneShape: PhoneShape
  onTogglePhoneShape: () => void
  canvasFragmentOf: (key: string) => string
  slideStylesheet: () => CSSStyleSheet
  canvasWidth: number
  canvasHeight: number
}

export function SlidePreview(props: SlidePreviewProps) {
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      {/* Permanently mounted like the two children below, hidden while no
          slide is selected (there is nothing to preview then). Each control
          is one switch rather than two buttons, so pressing the lit segment
          can't be misread as a request for the state already showing. The
          segments are icons (monitor / smartphone; a tall / a wide canvas),
          so the button's `aria-label` and each segment's `title` carry the
          words. */}
      <div className={(props.selectedSlideKey === null ? 'hidden ' : '') + 'shrink-0 h-9 flex items-center justify-end gap-2 px-3'}>
        {/* Phone display only: which canvas it gives. Permanently mounted
            and toggled by class, like everything else in this component. */}
        <button
          type="button"
          role="switch"
          data-phone-shape-toggle
          aria-label="Same ratio as PC"
          aria-checked={props.phoneShape === 'deck' ? 'true' : 'false'}
          onClick={() => props.onTogglePhoneShape()}
          className={(props.viewportMode === 'mobile' ? 'flex' : 'hidden') + ' items-center rounded-full border border-border overflow-hidden'}
        >
          <span title="Tall phone canvas" className={(props.phoneShape === 'portrait' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'px-2.5 py-1'}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="block w-3.5 h-3.5">
              <rect x="6" y="2" width="12" height="20" rx="2" />
              <path d="M11 18h2" />
            </svg>
          </span>
          <span title="Same ratio as PC" className={(props.phoneShape === 'deck' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'px-2.5 py-1'}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="block w-3.5 h-3.5">
              <rect x="2" y="6" width="20" height="12" rx="2" />
            </svg>
          </span>
        </button>
        <button
          type="button"
          role="switch"
          data-viewport-toggle
          aria-label="Preview as phone"
          aria-checked={props.viewportMode === 'mobile' ? 'true' : 'false'}
          onClick={() => props.onToggleViewportMode()}
          className="flex items-center rounded-full border border-border overflow-hidden"
        >
          <span title="PC" className={(props.viewportMode === 'desktop' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'px-2.5 py-1'}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="block w-3.5 h-3.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
          </span>
          <span title="Phone" className={(props.viewportMode === 'mobile' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'px-2.5 py-1'}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="block w-3.5 h-3.5">
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <path d="M12 18h.01" />
            </svg>
          </span>
        </button>
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
          // toggle) does re-mount, and `observeCanvasScale` re-fits it.
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
