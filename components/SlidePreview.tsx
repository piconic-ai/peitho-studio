'use client'

import { createEffect, untrack } from '@barefootjs/client'
import { mountSlideCanvas, observeCanvasScale } from '../dom/slideCanvas'

export interface SlidePreviewProps {
  selectedSlideKey: string | null
  hasDeck: boolean
  canvasFragmentOf: (key: string) => string
  slideStylesheet: () => CSSStyleSheet
  canvasWidth: number
  canvasHeight: number
}

export function SlidePreview(props: SlidePreviewProps) {
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      {/* Both children stay mounted for this component's whole life and
          only toggle `hidden`, rather than one conditional swapping them:
          BarefootJS re-runs a conditional branch's bindings every time that
          branch is re-entered and never disposes what the previous run
          created, so a selection that goes away and comes back would leave
          the `ref`'s effect below running against the detached host while a
          second one started on the new host. (`SlideContextMenu` is kept
          permanently mounted for a related reason.) */}
      <div
        ref={el => {
          // Tracks `selectedSlideKey` and the canvas size, but reads the
          // fragment `untrack`ed: an edit to the *already-selected* slide
          // has to patch in place through `Studio.tsx`'s
          // `patchSlideCanvases` — which finds this host by the
          // `data-slide-canvas-key` set here — instead of re-mounting the
          // whole canvas on every keystroke.
          createEffect(() => {
            const key = props.selectedSlideKey
            if (key === null) return
            el.dataset.slideCanvasKey = key
            const canvas = { width: props.canvasWidth, height: props.canvasHeight }
            mountSlideCanvas(el, props.slideStylesheet(), untrack(() => props.canvasFragmentOf(key)), canvas)
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
