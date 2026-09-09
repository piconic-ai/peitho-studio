'use client'

// `srcdoc` must be computed at the call site (`buildSelectedSlideDoc(
// selectedSlideKey())`), not inside this component from a raw `key` prop —
// see `Studio.tsx`'s comment on `buildSelectedSlideDoc` for why: the WKWebView
// iframe reloads (a visible flash) on *any* `.srcdoc` reassignment, even to a
// byte-identical string, so the value passed here must only actually change
// when the selected slide's fragment does. Computing it at the call site
// (a `createSignal`/`createMemo` read) keeps this component's own binding
// keyed on `props.srcdoc`'s call-site tracked dependency instead of re-deriving
// it from an untracked fragment lookup on every unrelated re-render.
export interface SlidePreviewProps {
  selectedSlideKey: string | null
  srcdoc: string
  hasDeck: boolean
}

export function SlidePreview(props: SlidePreviewProps) {
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      {props.selectedSlideKey !== null ? (
        <iframe
          title="Selected slide preview"
          data-slide-preview-key={props.selectedSlideKey}
          srcdoc={props.srcdoc}
          className="flex-1 w-full border-0"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {props.hasDeck ? 'Select a slide to preview it.' : 'Open a deck to preview it.'}
        </div>
      )}
    </div>
  )
}
