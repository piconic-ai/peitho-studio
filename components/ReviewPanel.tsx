'use client'

import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import { type LayoutCommentTarget } from '../domain/reviewComment'
import { type PanelRow } from '../domain/reviewPanel'
import { ReviewThreadHeader } from './ReviewThreadHeader'
import { ReviewMessage } from './ReviewMessage'
import { ReviewSendContent } from './ReviewSendContent'

export interface ReviewPanelProps {
  language: Language
  /** Shown while a deck is open. */
  shown: boolean
  /** What sending waits on, or a hint; nothing when all is ready. */
  status: string
  canSend: boolean
  sending: boolean
  /** How many a send hands the agent: shown as a badge on the button. */
  sendCount: number
  /** The agent is at work on what it was sent: the button says it's
   * thinking until the agent is back. */
  working: boolean
  /** The agent is taken to be gone: show the connect card again. */
  onReconnect: () => void
  error: string | null
  /** `domain/reviewPanel.ts`'s `reviewRows`, each with its time worded. */
  rows: PanelRow[]
  /** How many resolved threads are left out, and whether they're shown. */
  resolvedCount: number
  showResolved: boolean
  /** The toggle's label (it names the count). */
  resolvedToggleLabel: string
  onToggleResolved: () => void
  /** The thread shown on a pin's click (`threadOfPin`), lit up for a
   * moment. */
  highlightedThread: string | null
  /** A row was clicked: open its slide. */
  onSelectSlide: (index: number) => void
  /** A layout comment's row was clicked: open the layout screen on it. */
  onSelectLayout: (target: LayoutCommentTarget) => void
  replyText: string
  onSend: () => void
  onDiscard: (id: string) => void
  /** Rewriting an unsent comment or reply in place (`PanelRow.editing`). */
  editText: string
  onStartEdit: (id: string) => void
  onEditInput: (text: string) => void
  onEditSave: () => void
  onEditCancel: () => void
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

// A click on a row opens its slide, except on the row's own controls: a
// `.map()` row's handlers are delegated, so the button's own click reaches
// the row's too (AGENTS.md, barefootjs#2930).
function isRowControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, textarea, [data-review-reply-box], [data-review-edit-box]') !== null
}

/** The comments for the Coding Agent, in the rightmost column
 * (todo/archive/review-comment-ui.md), as a chat: the user's words on the right in
 * dark bubbles, the agent's on the left in light ones behind its icon, and
 * what the panel has to say (a hint, the state of things, how to connect)
 * in the agent's voice, from the same icon. Threads run in the order they
 * were written (resolved ones on request), with the box a reply is written
 * in under the thread it answers and the Send button at the bottom right. Every row and control stays mounted and is toggled with
 * `hidden`, as elsewhere, rather than branched in and out. */
export function ReviewPanel(props: ReviewPanelProps) {
  return (
    <section
      data-review-panel=""
      aria-label={messagesFor(props.language).reviewComments}
      hidden={!props.shown}
      className="flex-1 flex flex-col min-h-0 text-sm"
    >
      {/* What the panel has to say, in the agent's voice. */}
      <div data-review-say="" hidden={props.status === ''} className="shrink-0 px-3 pt-3 flex items-start gap-2">
        <span aria-hidden="true" className="w-7 h-7 shrink-0 rounded-full bg-muted text-foreground flex items-center justify-center">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="8" width="16" height="11" rx="3" />
            <path d="M12 8V4.5" />
            <circle cx="12" cy="3.5" r="1" />
            <circle cx="9" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <p data-review-status="" className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm">{props.status}</p>
      </div>
      {/* The card, the error and the threads scroll together: in a short
          window the card alone can run past the column's bottom, which left
          its Copy Command button out of reach. */}
      <div data-review-body="" className="flex-1 min-h-0 overflow-y-auto pt-2">
        {/* Always mounted and toggled with `hidden`, like the rest of the
            panel. Text that changes with state picks one message by key
            (see the Send button) rather than a `? :` of two texts. */}
        <div data-agent-connect="" hidden={!props.connectShown} className="px-3 mb-3 flex items-start gap-2">
          <span aria-hidden="true" className="w-7 h-7 shrink-0 rounded-full bg-muted text-foreground flex items-center justify-center">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="8" width="16" height="11" rx="3" />
              <path d="M12 8V4.5" />
              <circle cx="12" cy="3.5" r="1" />
              <circle cx="9" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <div className="flex-1 min-w-0 rounded-2xl rounded-tl-sm border-2 border-[#eab308] bg-muted p-3 flex flex-col gap-3">
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
          {/* The terminal route is the optional one: folded away by default. */}
          <details data-agent-connect-terminal="" className="border-t border-border pt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              {messagesFor(props.language).connectAgentTerminal}
            </summary>
            <div className="pt-2 flex flex-col gap-2">
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
          </details>
          </div>
        </div>
        <div role="alert" data-review-error="" hidden={props.error === null} className="px-3 pb-2 text-xs text-destructive">
          {props.error ?? ''}
        </div>
        <ul className="px-3 pb-3 flex flex-col">
          {props.rows.map(row => (
            <li
              key={row.key}
              data-review-row={row.kind}
              data-review-slide={row.slideIndex ?? ''}
              data-review-layout={row.layout === null ? '' : row.layout.kind === 'layout' ? row.layout.name : '*'}
              data-review-thread-start={row.threadStart ? 'true' : 'false'}
              data-review-thread={row.threadKey}
              data-review-highlighted={row.threadKey === props.highlightedThread ? 'true' : 'false'}
              data-review-editing={row.editing ? 'true' : 'false'}
              onClick={e => {
                if (isRowControl(e.target)) return
                if (row.slideIndex !== null) props.onSelectSlide(row.slideIndex)
                else if (row.layout !== null) props.onSelectLayout(row.layout)
              }}
              className={(row.threadStart ? 'mt-3 pt-2 border-t rounded-t-xl ' : 'pt-2 ') + (row.threadEnd ? 'pb-3 border-b rounded-b-xl ' : '') + (row.resolved ? 'opacity-60 ' : '') + (row.slideIndex === null && row.layout === null ? '' : 'cursor-pointer ') + (row.threadKey === props.highlightedThread ? 'bg-[#fef9c3] ' : 'bg-background ') + 'px-3 border-x border-border transition-colors flex flex-col gap-2'}
            >
              {/* Each thread is one card: its first row carries the card's
                  header — what it's on, and what can be done with it. */}
              <ReviewThreadHeader language={props.language} row={row} onResolve={props.onResolve} />
              <ReviewMessage
                language={props.language}
                row={row}
                editText={props.editText}
                onStartEdit={props.onStartEdit}
                onDiscard={props.onDiscard}
                onEditInput={props.onEditInput}
                onEditSave={props.onEditSave}
                onEditCancel={props.onEditCancel}
                onStartReply={props.onStartReply}
              />
                {/* The reply box sits under the thread it answers. */}
                <div data-review-reply-box="" hidden={!row.replyBoxHere} className="w-full flex flex-col gap-2">
                  <textarea
                    rows={2}
                    value={props.replyText}
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
            </li>
          ))}
        </ul>
        {/* A filter on the list, so at the list's end. */}
        <button
          type="button"
          data-review-show-resolved=""
          aria-pressed={props.showResolved ? 'true' : 'false'}
          hidden={props.resolvedCount === 0}
          onClick={() => props.onToggleResolved()}
          className="mx-3 mb-3 text-xs text-muted-foreground hover:text-foreground"
        >
          {props.resolvedToggleLabel}
        </button>
      </div>
      {/* Bottom bar: the Send button alone at the right — and, while the
          agent is taken to be at work, a quiet way back to the connect
          card under it, for when something's gone wrong. */}
      <div className="shrink-0 border-t border-border px-3 py-2 flex flex-col items-end gap-1">
        <button
          type="button"
          data-review-send=""
          data-review-send-state={props.sending ? 'sending' : props.working ? 'thinking' : 'idle'}
          disabled={!props.canSend}
          onClick={() => props.onSend()}
          className={(props.working || props.sending ? 'disabled:opacity-100 ' : 'disabled:opacity-50 ') + 'shrink-0 flex items-center gap-2 px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90'}
        >
          <ReviewSendContent language={props.language} sending={props.sending} working={props.working} />
          <span
            data-review-send-count=""
            hidden={props.sendCount === 0 || props.sending || props.working}
            className="min-w-5 h-5 px-1.5 rounded-full bg-primary-foreground/20 text-xs font-semibold flex items-center justify-center"
          >
            {props.sendCount}
          </span>
        </button>
        <p data-review-reconnect-hint="" hidden={!props.working || props.sending} className="text-xs text-muted-foreground opacity-70">
          {messagesFor(props.language).reconnectHint}
          <button
            type="button"
            data-review-reconnect=""
            onClick={() => props.onReconnect()}
            className="ml-1 underline underline-offset-2 hover:text-foreground"
          >
            {messagesFor(props.language).reconnectAgent}
          </button>
        </p>
      </div>
    </section>
  )
}
