'use client'

import { type ImageSlotFix, imageSlotFixLabel } from '../domain/imageSlot'
import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
export interface StatusBarProps {
  /** The UI language every label here is shown in. */
  language: Language
  errorMessage: string | null
  errorMessageCopied: boolean
  /** What the bar offers next to the error shown (`domain/errorBar.ts`):
   * a build error goes to the AI (`send`), or is with it already
   * (`fixing`, no button); any other error is copied. */
  errorAction: 'copy' | 'send' | 'fixing'
  /** A send to the AI is on its way: the send button waits for it. */
  sendingError: boolean
  /** The way out of the error shown, if the app has one — see
   * `domain/imageSlot.ts`. */
  imageSlotFix: ImageSlotFix['kind']
  /** The image layout is being added: the button is disabled meanwhile. */
  imageLayoutAdding: boolean
  statusMessage: string
  onCopyErrorMessage: () => void
  onSendErrorToAi: () => void
  onImageSlotFix: (event: MouseEvent) => void
}

export function StatusBar(props: StatusBarProps) {
  return (
    <>
      {/* Keep controls mounted: conditional mounting freezes their later
          disabled/hidden updates on BarefootJS 0.40.2. */}
      <div
        hidden={props.errorMessage === null}
        className="px-3 py-1.5 bg-destructive/10 text-destructive text-xs shrink-0 border-t border-destructive/30 flex items-start gap-2"
      >
        <span className="flex-1 select-text">{props.errorMessage}</span>
        <button
          type="button"
          data-image-slot-fix={props.imageSlotFix}
          hidden={props.imageSlotFix === 'none'}
          disabled={props.imageLayoutAdding}
          onClick={e => props.onImageSlotFix(e)}
          className="shrink-0 px-1.5 py-0.5 rounded border border-destructive bg-destructive/20 font-medium hover:bg-destructive/30 disabled:opacity-50"
        >
          {imageSlotFixLabel(messagesFor(props.language), props.imageSlotFix, props.imageLayoutAdding)}
        </button>
        <button
          type="button"
          data-error-action="send"
          hidden={props.errorAction !== 'send'}
          disabled={props.sendingError}
          onClick={() => props.onSendErrorToAi()}
          className="shrink-0 px-1.5 py-0.5 rounded border border-destructive bg-destructive/20 font-medium hover:bg-destructive/30 disabled:opacity-50"
        >
          {messagesFor(props.language).sendErrorToAi}
        </button>
        <span
          data-error-action="fixing"
          hidden={props.errorAction !== 'fixing'}
          className="shrink-0 px-1.5 py-0.5 rounded border border-destructive/30 font-medium"
        >
          {messagesFor(props.language).aiFixingError}
        </span>
        <button
          type="button"
          data-error-action="copy"
          hidden={props.errorAction !== 'copy'}
          onClick={() => props.onCopyErrorMessage()}
          className="shrink-0 px-1.5 py-0.5 rounded border border-destructive/30 hover:bg-destructive/20"
        >
          {props.errorMessageCopied ? messagesFor(props.language).errorCopied : messagesFor(props.language).copyError}
        </button>
      </div>
      <footer className="h-6 shrink-0 flex items-center px-3 text-xs text-muted-foreground border-t border-border">
        {props.statusMessage}
      </footer>
    </>
  )
}
