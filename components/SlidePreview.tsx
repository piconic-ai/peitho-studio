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
      {props.selectedSlideKey !== null ? (
        <div
          ref={el => {
            // A `ref`-scoped effect, not a reactive `mountSlideCanvas` call
            // inline in the ref: the ref itself only runs once, at mount,
            // but this pane's host is reused across every slide selected
            // while the app stays open — each switch needs a fresh mount
            // (the whole point of tracking `selectedSlideKey`). The
            // fragment lookup is `untrack`ed so an edit to the *content* of
            // the already-selected slide doesn't also re-mount here — that
            // flows through `Studio.tsx`'s `patchSlideCanvases` instead,
            // keyed on the `data-slide-canvas-key` set below.
            createEffect(() => {
              const key = props.selectedSlideKey
              if (key === null) return
              el.dataset.slideCanvasKey = key
              const canvas = { width: props.canvasWidth, height: props.canvasHeight }
              mountSlideCanvas(el, props.slideStylesheet(), untrack(() => props.canvasFragmentOf(key)), canvas)
              observeCanvasScale(el, canvas)
            })
          }}
          className="flex-1 w-full"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {props.hasDeck ? 'Select a slide to preview it.' : 'Open a deck to preview it.'}
        </div>
      )}
    </div>
  )
}
