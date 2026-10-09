'use client'

import { createEffect, untrack } from '@barefootjs/client'
import type { PhoneShape, ViewportMode } from '../domain/viewport'
import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import { mountSlideCanvas, observeCanvasScale } from '../dom/slideCanvas'
import { ViewportToggle } from './ViewportToggle'
import { watchCommentClicks, type PreviewClick } from '../dom/previewComments'
import { type PreviewPin } from '../domain/reviewComment'
import { watchSlideEditing } from '../dom/slideEditing'
import type { SlideEditTarget, SlideEditSession } from '../domain/slideEdit'

export interface SlidePreviewProps {
  /** The UI language every label here is shown in. */
  language: Language
  selectedSlideKey: string | null
  hasDeck: boolean
  /** peitho-core's refusal of the deck on disk (`renderFailureMessage`),
   * shown in place of the "select a slide" hint while nothing is selected
   * — a deck that opened broken has no slide to select, since every row
   * is a placeholder. `null` while the deck builds. */
  buildError: string | null
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
  /** The CSS width of the device phone display shows the slide at real
   * size (`previewDevice`), `null` to fill the panel (PC display, the
   * deck-ratio shape). */
  deviceWidth: number | null
  /** "Scaled to N%" while the device doesn't fit the panel at real size,
   * `''` otherwise (no label at real size). */
  scaleLabel: string
  /** The preview host, once mounted: `Studio.tsx` measures it for
   * `scaleLabel`. */
  onPreviewHost: (el: HTMLElement) => void
  /** The selected slide's comment pins. */
  pins: PreviewPin[]
  /** A click on the slide meant as a comment (`dom/previewComments.ts`). */
  onCommentClick: (click: PreviewClick) => void
  /** A right-click on the slide: the app's own menu, whose comment is on
   * what a left-click there would be on. */
  onCommentMenu: (click: PreviewClick) => void
  /** A pin was clicked: show its comment rather than start a new one. */
  onPinClick: (pinId: string) => void
  onTextEdit: (target: SlideEditTarget) => SlideEditSession | null
  onAddImages: (files: File[], slot: string | null) => void
  onImagePosition: (slot: string, rect: { x: number; y: number; width: number; height: number }) => Promise<boolean>
  imageBusy: boolean
  onPasteElement: (text: string, gesture?: object) => boolean
  onPasteShortcut: (gesture: object) => void
  onTextAction: (target: Extract<SlideEditTarget, { kind: 'text' }>, action: 'cut' | 'copy' | 'delete') => void
  onImageClipboard: (slot: string, action: 'cut' | 'copy') => void
  onRemoveImage: (slot: string) => void
}

export function SlidePreview(props: SlidePreviewProps) {
  let imageInput: HTMLInputElement | null = null
  let previewHost: HTMLElement | null = null
  let imageSlot: string | null = null
  function pickImage(slot: string | null): void {
    imageSlot = slot
    if (imageInput) imageInput.multiple = slot === null
    imageInput?.click()
  }
  createEffect(() => {
    props.language
    previewHost?.dispatchEvent(new Event('studio-edit-mode'))
  })
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      {/* Permanently mounted like the two children below, hidden while no
          slide is selected (there is nothing to preview then). The PC /
          Phone switch is shared with the layout list (`ViewportToggle`). */}
      <div className={(props.selectedSlideKey === null ? 'hidden ' : '') + 'shrink-0 h-9 flex items-center justify-start gap-2 px-3'}>
        <ViewportToggle
          language={props.language}
          viewportMode={props.viewportMode}
          onToggleViewportMode={props.onToggleViewportMode}
          phoneShape={props.phoneShape}
          phoneShapeMenuOpen={props.phoneShapeMenuOpen}
          onTogglePhoneShapeMenu={props.onTogglePhoneShapeMenu}
          onClosePhoneShapeMenu={props.onClosePhoneShapeMenu}
          onSelectPhoneShape={props.onSelectPhoneShape}
          menuSide="left"
        />
        <input data-preview-image-input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden"
          ref={el => { imageInput = el; el.addEventListener('studio-add-image', () => pickImage(null)) }}
          onChange={e => { props.onAddImages(Array.from(e.target.files ?? []), imageSlot); e.target.value = '' }} />
        {/* Only while a device is shown smaller than its real size; at real
            size nothing is said. */}
        <span
          data-preview-scale-label
          title={messagesFor(props.language).previewScaledDownDetail}
          className={(props.scaleLabel === '' ? 'hidden ' : '') + 'ml-auto text-xs text-muted-foreground tabular-nums'}
        >
          {props.scaleLabel}
        </span>
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
        data-preview-device-width={props.deviceWidth === null ? '' : String(props.deviceWidth)}
        ref={el => {
          previewHost = el
          props.onPreviewHost(el)
          // Tracks `selectedSlideKey` and the canvas size, but reads the
          // fragment `untrack`ed: an edit to the *already-selected* slide
          // has to patch in place through `Studio.tsx`'s
          // `patchSlideCanvases` — which finds this host by the
          // `data-slide-canvas-key` set here — instead of re-mounting the
          // whole canvas on every keystroke. A canvas change (the PC/phone
          // toggle, or the phone shape) does re-mount, and
          // `observeCanvasScale` re-fits it — at the device's real width in
          // phone display (`deviceWidth`), which a fixed-canvas slide's
          // unchanged canvas also follows.
          createEffect(() => {
            const key = props.selectedSlideKey
            if (key === null) return
            el.dataset.slideCanvasKey = key
            const canvas = { width: props.canvasWidth, height: props.canvasHeight }
            mountSlideCanvas(el, props.slideStylesheet(), untrack(() => props.canvasFragmentOf(key)), canvas, 'interactive')
            observeCanvasScale(el, canvas, props.deviceWidth)
            watchCommentClicks(el, () => {}, click => props.onCommentMenu(click))
            untrack(() => watchSlideEditing(el, {
              language: () => props.language,
              enabled: () => true,
              edit: target => props.onTextEdit(target),
              image: pickImage,
              imageGesture: (slot, rect) => props.onImagePosition(slot, rect),
              pasteImages: files => props.onAddImages(files, null),
              pasteElement: (text, gesture) => props.onPasteElement(text, gesture),
              pasteShortcut: gesture => props.onPasteShortcut(gesture),
              textAction: (target, action) => props.onTextAction(target, action),
              imageClipboard: (slot, action) => props.onImageClipboard(slot, action),
              removeImage: slot => props.onRemoveImage(slot),
            }))
          })
        }}
        className={(props.selectedSlideKey === null ? 'hidden ' : '') + 'relative flex-1 w-full'}
      >
        {/* The comment pins, drawn over the slide through the canvas's
            overlay slot (`dom/slideCanvas.ts`): a box the slide's own size,
            centered and scaled exactly as the slide is, so a pin placed at
            a fraction of the slide stays on the spot it was put on. Each
            pin is scaled back so it keeps one size on screen. A click on a
            pin shows its comment; a click anywhere else on the overlay goes
            through to the slide. */}
        <div
          slot="overlay"
          data-comment-overlay
          className="pointer-events-none"
          style="position: absolute; left: 50%; top: 50%; width: var(--peitho-canvas-width); height: var(--peitho-canvas-height); transform: translate(-50%, -50%) scale(var(--peitho-thumb-scale, 1))"
        >
          {props.pins.map(pin => (
            <span
              key={pin.id}
              data-comment-pin={pin.sent ? 'sent' : 'unsent'}
              onClick={() => props.onPinClick(pin.id)}
              className={(pin.sent ? 'bg-primary text-primary-foreground ' : 'bg-[#eab308] text-black ') + 'pointer-events-auto cursor-pointer flex items-center justify-center w-6 h-6 rounded-full rounded-bl-none text-xs font-semibold shadow-md border-2 border-white'}
              style={`position: absolute; left: ${String(pin.x * 100)}%; top: ${String(pin.y * 100)}%; transform-origin: bottom left; transform: translate(0, -100%) scale(calc(1 / var(--peitho-thumb-scale, 1)))`}
            >
              {pin.number}
            </span>
          ))}
        </div>
      </div>
      <div className={(props.selectedSlideKey === null && props.buildError === null ? '' : 'hidden ') + 'flex-1 flex items-center justify-center text-sm text-muted-foreground'}>
        {props.hasDeck ? messagesFor(props.language).selectSlideToPreview : messagesFor(props.language).openDeckToPreview}
      </div>
      {/* Permanently mounted like its siblings (see above): the deck on
          disk doesn't build, and there is no slide to show — peitho-core's
          error, as the error bar has it, stays readable here. */}
      <div
        data-preview-build-error
        className={(props.selectedSlideKey === null && props.buildError !== null ? '' : 'hidden ') + 'flex-1 min-h-0 overflow-auto flex flex-col justify-center gap-3 p-6 text-sm'}
      >
        <p className="text-destructive font-medium">{messagesFor(props.language).deckDoesNotBuild}</p>
        {/* Not `bg-destructive/10`: that class is how the e2e suite finds
            the error bar (`StatusBar.tsx`), one element at a time. */}
        <pre className="font-mono text-xs whitespace-pre-wrap select-text text-destructive bg-muted rounded p-3">{props.buildError ?? ''}</pre>
        <p className="text-muted-foreground">{messagesFor(props.language).fixSourceToPreview}</p>
      </div>
    </div>
  )
}
