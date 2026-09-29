'use client'

import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import { type PanelRow } from '../domain/reviewPanel'

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
  error: string | null
  /** `domain/reviewPanel.ts`'s `reviewRows`, each with its time worded. */
  rows: PanelRow[]
  /** How many resolved threads are left out, and whether they're shown. */
  resolvedCount: number
  showResolved: boolean
  /** The toggle's label (it names the count). */
  resolvedToggleLabel: string
  onToggleResolved: () => void
  /** A row was clicked: open its slide. */
  onSelectSlide: (index: number) => void
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

// A click on a row opens its slide, except on the row's own controls: a
// `.map()` row's handlers are delegated, so the button's own click reaches
// the row's too (CLAUDE.md, barefootjs#2930).
function isRowControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, textarea, [data-review-reply-box]') !== null
}

/** The comments for the Coding Agent, in the rightmost column
 * (todo/review-comment-ui.md), as a chat: the user's words on the right in
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
              data-review-thread-start={row.threadStart ? 'true' : 'false'}
              onClick={e => {
                if (!isRowControl(e.target) && row.slideIndex !== null) props.onSelectSlide(row.slideIndex)
              }}
              className={(row.threadStart ? 'mt-3 pt-2 border-t rounded-t-xl ' : 'pt-2 ') + (row.threadEnd ? 'pb-3 border-b rounded-b-xl ' : '') + (row.resolved ? 'opacity-60 ' : '') + (row.slideIndex === null ? '' : 'cursor-pointer ') + 'px-3 border-x border-border bg-background flex flex-col gap-2'}
            >
              {/* Each thread is one card: its first row carries the card's
                  header — what it's on, and what can be done with it. */}
              <div data-review-thread-header="" className={row.threadStart && row.target !== null ? 'flex items-center gap-1.5 text-xs text-muted-foreground min-w-0' : 'hidden'}>
                <span data-review-target="" className="flex-1 min-w-0 truncate">{row.target ?? ''}</span>
                <span
                  data-review-resolved=""
                  role="img"
                  aria-label={messagesFor(props.language).resolvedComment}
                  title={messagesFor(props.language).resolvedComment}
                  className={row.kind === 'comment' && row.resolved ? 'shrink-0 text-[#16a34a]' : 'hidden'}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="9" />
                      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
                    </svg>
                </span>
                <button
                  type="button"
                  data-review-resolve=""
                  aria-label={messagesFor(props.language).resolveComment}
                  title={messagesFor(props.language).resolveComment}
                  className={row.kind === 'comment' && !row.resolved ? 'shrink-0 p-0.5 rounded hover:bg-muted hover:text-[#16a34a]' : 'hidden'}
                  onClick={() => props.onResolve(row.id)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                </button>
              </div>
              <div className={(row.byAgent ? 'justify-start' : 'justify-end') + ' flex items-start gap-2'}>
                <span data-review-agent-icon="" aria-hidden="true" className={row.byAgent ? 'w-7 h-7 shrink-0 rounded-full bg-muted text-foreground flex items-center justify-center' : 'hidden'}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="4" y="8" width="16" height="11" rx="3" />
                  <path d="M12 8V4.5" />
                  <circle cx="12" cy="3.5" r="1" />
                  <circle cx="9" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
                </svg>
                </span>
                <div className={(row.byAgent ? 'items-start ' : 'items-end ') + 'min-w-0 max-w-[85%] flex flex-col gap-1'}>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span data-review-agent="" className={row.byAgent ? 'shrink-0 font-semibold text-foreground' : 'hidden'}>{row.author}</span>
                    <span className={row.kind === 'unsent-comment' || row.kind === 'unsent-reply' ? 'shrink-0 rounded-sm px-1 bg-[#eab308] text-black' : 'hidden'}>
                      {messagesFor(props.language).unsentComment}
                    </span>
                    <span data-review-time="" className="shrink-0">{row.time}</span>
                    <button
                      type="button"
                      data-review-discard=""
                      aria-label={messagesFor(props.language).discardComment}
                      title={messagesFor(props.language).discardComment}
                      className={row.kind === 'unsent-comment' || row.kind === 'unsent-reply' ? 'shrink-0 p-0.5 rounded hover:bg-muted hover:text-destructive' : 'hidden'}
                      onClick={() => props.onDiscard(row.id)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                    </button>
                  </div>
                  {/* The user's words on the right, dark; the agent's on the
                      left, light; not sent yet, outlined. */}
                  <p
                    data-review-bubble=""
                    className={(row.byAgent
                      ? 'rounded-tl-sm bg-muted text-foreground '
                      : row.kind === 'unsent-comment' || row.kind === 'unsent-reply'
                        ? 'rounded-tr-sm border-2 border-dashed border-[#eab308] bg-background text-foreground '
                        : 'rounded-tr-sm bg-primary text-primary-foreground ') + 'rounded-2xl px-3 py-2 whitespace-pre-wrap break-words'}
                  >
                    {row.body}
                  </p>
                  {/* Under the agent's last word: what a reply answers. */}
                  <button
                    type="button"
                    data-review-reply=""
                    className={row.replyHere && !row.replyBoxHere ? 'flex items-center gap-1 px-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-muted' : 'hidden'}
                    onClick={() => props.onStartReply(row.id)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 14 4 9l5-5" />
                      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                    </svg>
                    {messagesFor(props.language).reply}
                  </button>
                </div>
              </div>
                {/* The reply box sits under the thread it answers. */}
                <div data-review-reply-box="" hidden={!row.replyBoxHere} className="w-full flex flex-col gap-2">
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
            </li>
          ))}
        </ul>
      </div>
      {/* Bottom bar: resolved threads on request at the left, the send
          button at the panel's bottom right. */}
      <div className="shrink-0 border-t border-border px-3 py-2 flex items-center gap-2">
        <button
          type="button"
          data-review-show-resolved=""
          aria-pressed={props.showResolved ? 'true' : 'false'}
          hidden={props.resolvedCount === 0}
          onClick={() => props.onToggleResolved()}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {props.resolvedToggleLabel}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          data-review-send=""
          data-review-send-state={props.sending ? 'sending' : props.working ? 'thinking' : 'idle'}
          disabled={!props.canSend}
          onClick={() => props.onSend()}
          className={(props.working || props.sending ? 'disabled:opacity-100 ' : 'disabled:opacity-50 ') + 'shrink-0 flex items-center gap-2 px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90'}
        >
          {/* Sending: a spinner. The agent at work: its icon, breathing. */}
          <svg aria-hidden="true" viewBox="0 0 24 24" className={props.sending ? 'w-4 h-4 animate-spin' : 'hidden'} fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M12 3a9 9 0 1 1-9 9" />
          </svg>
          <svg aria-hidden="true" viewBox="0 0 24 24" className={props.working && !props.sending ? 'w-4 h-4 animate-pulse' : 'hidden'} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="8" width="16" height="11" rx="3" />
            <path d="M12 8V4.5" />
            <circle cx="12" cy="3.5" r="1" />
            <circle cx="9" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
          </svg>
          {/* One expression picking the text, not a `? :` of two texts: a
              conditional text child here left `Studio.tsx`'s deck-open
              branch half-entered (its "Loading deck…" never went away). */}
          <span className={props.working && !props.sending ? 'animate-pulse' : ''}>{messagesFor(props.language)[props.sending ? 'sendingToAgent' : props.working ? 'agentThinking' : 'sendToAgent']}</span>
          <span
            data-review-send-count=""
            hidden={props.sendCount === 0 || props.sending || props.working}
            className="min-w-5 h-5 px-1.5 rounded-full bg-primary-foreground/20 text-xs font-semibold flex items-center justify-center"
          >
            {props.sendCount}
          </span>
        </button>
      </div>
    </section>
  )
}
