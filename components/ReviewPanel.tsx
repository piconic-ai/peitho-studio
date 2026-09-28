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
  /** The "Connect your Coding Agent" card (`domain/agentConnect.ts`): shown
   * until an agent is seen waiting, with the prompt and the command to copy
   * and which of them was just copied. */
  connectShown: boolean
  connectPrompt: string
  connectCommand: string
  copied: 'prompt' | 'command' | null
  onCopyPrompt: () => void
  onCopyCommand: () => void
}

/** The comments for the Coding Agent, in the rightmost column
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
      className="flex-1 flex flex-col min-h-0 text-sm"
    >
      {/* Title and button on one line, the status under them: in a column
          this narrow, sharing one line squeezed both texts into wraps. */}
      <div className="shrink-0 flex items-center gap-3 px-3 pt-2">
        <span className="flex-1 font-semibold">{messagesFor(props.language).reviewComments}</span>
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
      <p data-review-status="" className="shrink-0 px-3 pt-1 pb-2 text-xs text-muted-foreground">{props.status}</p>
      {/* The card, the error and the threads scroll together: in a short
          window the card alone can run past the column's bottom, which left
          its Copy Command button out of reach. */}
      <div data-review-body="" className="flex-1 min-h-0 overflow-y-auto">
        {/* Always mounted and toggled with `hidden`, like the rest of the
            panel. Text that changes with state picks one message by key
            (see the Send button) rather than a `? :` of two texts. */}
        <div
          data-agent-connect=""
          hidden={!props.connectShown}
          className="mx-3 mb-3 rounded-lg border-2 border-[#eab308] bg-muted p-3 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{messagesFor(props.language).connectAgentTitle}</p>
            <p className="text-xs text-muted-foreground">{messagesFor(props.language).connectAgentLead}</p>
          </div>
          <ol className="flex flex-col gap-3 text-xs">
            <li className="flex gap-2">
              <span className="w-5 h-5 shrink-0 rounded-full bg-[#eab308] text-black font-semibold flex items-center justify-center">1</span>
              <span className="pt-0.5">{messagesFor(props.language).connectAgentStepOpen}</span>
            </li>
            <li className="flex gap-2">
              <span className="w-5 h-5 shrink-0 rounded-full bg-[#eab308] text-black font-semibold flex items-center justify-center">2</span>
              <div className="flex-1 min-w-0 flex flex-col gap-2 pt-0.5">
                <span>{messagesFor(props.language).connectAgentStepPaste}</span>
                <pre
                  data-agent-connect-prompt=""
                  className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2 font-mono whitespace-pre-wrap break-words select-text"
                >
                  {props.connectPrompt}
                </pre>
                <button
                  type="button"
                  data-agent-connect-copy-prompt=""
                  onClick={() => props.onCopyPrompt()}
                  className="self-start px-3 py-1 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90"
                >
                  {messagesFor(props.language)[props.copied === 'prompt' ? 'copiedToClipboard' : 'copyPrompt']}
                </button>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="w-5 h-5 shrink-0 rounded-full bg-[#eab308] text-black font-semibold flex items-center justify-center">3</span>
              <div className="flex-1 min-w-0 flex flex-col gap-1 pt-0.5">
                <span>{messagesFor(props.language).connectAgentStepWait}</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span aria-hidden="true" className="w-2 h-2 shrink-0 rounded-full bg-[#eab308] animate-pulse" />
                  {messagesFor(props.language).connectAgentWaiting}
                </span>
              </div>
            </li>
          </ol>
          <div className="border-t border-border pt-2 flex flex-col gap-2 text-xs">
            <span className="text-muted-foreground">{messagesFor(props.language).connectAgentTerminal}</span>
            <code data-agent-connect-command="" className="rounded-md border border-border bg-background p-2 font-mono break-words select-text">
              {props.connectCommand}
            </code>
            <button
              type="button"
              data-agent-connect-copy-command=""
              onClick={() => props.onCopyCommand()}
              className="self-start px-3 py-1 rounded-md border border-border hover:bg-background"
            >
              {messagesFor(props.language)[props.copied === 'command' ? 'copiedToClipboard' : 'copyCommand']}
            </button>
          </div>
        </div>
        <div role="alert" data-review-error="" hidden={props.error === null} className="px-3 pb-2 text-xs text-destructive">
          {props.error ?? ''}
        </div>
        <ul className="px-3 pb-2 flex flex-col gap-1">
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
      </div>
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
