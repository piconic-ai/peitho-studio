'use client'

import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import { type ReviewRow } from '../domain/reviewComment'

export interface ReviewPanelProps {
  language: Language
  /** Shown while a deck is open. */
  shown: boolean
  /** The panel's one status line: what sending waits on, or a hint. */
  status: string
  canSend: boolean
  sending: boolean
  error: string | null
  /** `domain/reviewComment.ts`'s `reviewRows`. */
  rows: ReviewRow[]
  /** The crit comment a reply is being written under, if any. */
  replyingTo: string | null
  replyText: string
  onSend: () => void
  onDiscard: (id: string) => void
  onStartReply: (commentId: string) => void
  onReplyInput: (text: string) => void
  onReplyAdd: () => void
  onReplyCancel: () => void
  onResolve: (commentId: string) => void
}

/** The comments for the Coding Agent, under the preview
 * (todo/review-comment-ui.md): each thread in crit with the agent's
 * replies, what hasn't been sent yet, and the button that sends it all.
 * Every row and control stays mounted and is toggled with `hidden`, as
 * elsewhere, rather than branched in and out. */
export function ReviewPanel(props: ReviewPanelProps) {
  return (
    <section
      data-review-panel=""
      aria-label={messagesFor(props.language).reviewComments}
      hidden={!props.shown}
      className="shrink-0 border-t border-border flex flex-col max-h-72 min-h-0 text-sm"
    >
      <div className="shrink-0 flex items-center gap-3 px-3 py-2">
        <span className="font-semibold">{messagesFor(props.language).reviewComments}</span>
        <span data-review-status="" className="flex-1 text-xs text-muted-foreground">{props.status}</span>
        <button
          type="button"
          data-review-send=""
          disabled={!props.canSend}
          onClick={() => props.onSend()}
          className="shrink-0 px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {/* One expression, not a `? :` of two texts: a conditional text
              child here left `Studio.tsx`'s deck-open branch half-entered
              (its "Loading deck…" never went away). */}
          {messagesFor(props.language)[props.sending ? 'sendingToAgent' : 'sendToAgent']}
        </button>
      </div>
      <div role="alert" data-review-error="" hidden={props.error === null} className="shrink-0 px-3 pb-2 text-xs text-destructive">
        {props.error ?? ''}
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 flex flex-col gap-1">
        {props.rows.map(row => (
          <li
            key={row.key}
            data-review-row={row.kind}
            className={(row.kind === 'reply' || row.kind === 'unsent-reply' ? 'ml-4 pl-2 border-l-2 border-border ' : '') + (row.resolved ? 'opacity-60 ' : '') + 'py-1'}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{row.author}</span>
              <span className={row.kind === 'unsent-comment' || row.kind === 'unsent-reply' ? 'rounded-sm px-1 bg-[#eab308] text-black' : 'hidden'}>
                {messagesFor(props.language).unsentComment}
              </span>
              <span className={row.kind === 'comment' && row.resolved ? '' : 'hidden'}>{messagesFor(props.language).resolvedComment}</span>
              <span className="flex-1" />
              <button
                type="button"
                data-review-reply=""
                className={row.kind === 'comment' && !row.resolved ? 'hover:text-foreground' : 'hidden'}
                onClick={() => props.onStartReply(row.id)}
              >
                {messagesFor(props.language).reply}
              </button>
              <button
                type="button"
                data-review-resolve=""
                className={row.kind === 'comment' && !row.resolved ? 'hover:text-foreground' : 'hidden'}
                onClick={() => props.onResolve(row.id)}
              >
                {messagesFor(props.language).resolveComment}
              </button>
              <button
                type="button"
                data-review-discard=""
                className={row.kind === 'unsent-comment' || row.kind === 'unsent-reply' ? 'hover:text-foreground' : 'hidden'}
                onClick={() => props.onDiscard(row.id)}
              >
                {messagesFor(props.language).discardComment}
              </button>
            </div>
            <p className="whitespace-pre-wrap break-words">{row.body}</p>
          </li>
        ))}
      </ul>
      <div data-review-reply-box="" hidden={props.replyingTo === null} className="shrink-0 px-3 pb-2 flex flex-col gap-2">
        <textarea
          rows={2}
          value={props.replyText}
          placeholder={messagesFor(props.language).replyPlaceholder}
          onInput={e => props.onReplyInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault()
              props.onReplyCancel()
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              props.onReplyAdd()
            }
          }}
          className="w-full resize-none rounded-md border border-border bg-background px-2 py-1"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => props.onReplyCancel()} className="px-3 py-1 rounded-md hover:bg-accent">
            {messagesFor(props.language).cancel}
          </button>
          <button
            type="button"
            data-review-reply-add=""
            disabled={props.replyText.trim() === ''}
            onClick={() => props.onReplyAdd()}
            className="px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {messagesFor(props.language).reply}
          </button>
        </div>
      </div>
    </section>
  )
}
