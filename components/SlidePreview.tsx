'use client'

import { createEffect, untrack } from '@barefootjs/client'
import type { ViewportMode } from '../domain/viewport'
import { mountSlideCanvas, observeCanvasScale } from '../dom/slideCanvas'

// Props here are values (`viewportMode={ui.viewportMode()}`), not signal
// getters — see `components/WelcomeScreen.tsx` for why (BF044).
export interface SlidePreviewProps {
  selectedSlideKey: string | null
  hasDeck: boolean
  /** Which segment of the PC/phone toggle is lit. The canvas size that goes
   * with it arrives as `canvasWidth`/`canvasHeight`, already worked out by
   * `Studio.tsx`; this component never derives one from the mode itself. */
  viewportMode: ViewportMode
  onToggleViewportMode: () => void
  canvasFragmentOf: (key: string) => string
  slideStylesheet: () => CSSStyleSheet
  canvasWidth: number
  canvasHeight: number
}

export function SlidePreview(props: SlidePreviewProps) {
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      {/* Permanently mounted like the two children below, hidden while no
          slide is selected (there is nothing to preview then). One switch
          rather than two buttons, so pressing the lit segment can't be
          misread as a request for the mode already showing. */}
      <div className={(props.selectedSlideKey === null ? 'hidden ' : '') + 'shrink-0 h-9 flex items-center justify-end px-3 border-b border-border'}>
        <button
          type="button"
          role="switch"
          data-viewport-toggle
          aria-label="Preview as phone"
          aria-checked={props.viewportMode === 'mobile' ? 'true' : 'false'}
          onClick={() => props.onToggleViewportMode()}
          className="flex items-center rounded-full border border-border overflow-hidden text-xs"
        >
          <span className={(props.viewportMode === 'desktop' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'px-2.5 py-0.5'}>PC</span>
          <span className={(props.viewportMode === 'mobile' ? 'bg-primary text-primary-foreground ' : 'text-muted-foreground ') + 'px-2.5 py-0.5'}>Phone</span>
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
          // toggle, or moving between a fixed-canvas slide and an ordinary
          // one in phone display) does re-mount, and `observeCanvasScale`
          // then re-fits the scale to the new canvas on its own.
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
