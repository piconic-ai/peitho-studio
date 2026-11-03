'use client'

import type { Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import type { PanelRow } from '../domain/reviewPanel'
import { ReviewMessageMetadata } from './ReviewMessageMetadata'

interface ReviewMessageProps {
  language: Language
  row: PanelRow
  editText: string
  onStartEdit: (id: string) => void
  onDiscard: (id: string) => void
  onEditInput: (text: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onStartReply: (commentId: string) => void
}

export function ReviewMessage(props: ReviewMessageProps) {
  return (
    <div className={(props.row.byAgent ? 'justify-start' : 'justify-end') + ' flex items-start gap-2'}>
      <span data-review-agent-icon="" aria-hidden="true" className={props.row.byAgent ? 'w-7 h-7 shrink-0 rounded-full bg-muted text-foreground flex items-center justify-center' : 'hidden'}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="8" width="16" height="11" rx="3" />
          <path d="M12 8V4.5" />
          <circle cx="12" cy="3.5" r="1" />
          <circle cx="9" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <div className={(props.row.byAgent ? 'items-start ' : 'items-end ') + 'min-w-0 max-w-[85%] flex flex-col gap-1'}>
        <ReviewMessageMetadata language={props.language} row={props.row} onStartEdit={props.onStartEdit} onDiscard={props.onDiscard} />
        {/* The user's words on the right, dark; the agent's on the
            left, light; not sent yet, outlined. */}
        <div className="flex flex-col gap-0.5 max-w-full">
          <p
            data-review-bubble=""
            hidden={props.row.editing}
            className={(props.row.byAgent
              ? 'rounded-tl-sm bg-muted text-foreground '
              : props.row.kind === 'unsent-comment' || props.row.kind === 'unsent-reply'
                ? 'rounded-tr-sm border-2 border-dashed border-[#eab308] bg-background text-foreground '
                : 'rounded-tr-sm bg-primary text-primary-foreground ') + 'min-w-0 rounded-2xl px-3 py-2 whitespace-pre-wrap break-words'}
          >
            {props.row.body}
          </p>
          {/* An unsent bubble rewritten where it stands. */}
          <div data-review-edit-box="" hidden={!props.row.editing} className="w-72 max-w-full flex flex-col gap-2">
            <textarea
              rows={3}
              value={props.editText}
              onInput={e => props.onEditInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  props.onEditCancel()
                } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  props.onEditSave()
                }
              }}
              className="w-full resize-none rounded-2xl rounded-tr-sm border-2 border-dashed border-[#eab308] bg-background px-3 py-2 outline-none"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => props.onEditCancel()} className="px-3 py-1 rounded-md hover:bg-accent">
                {messagesFor(props.language).cancel}
              </button>
              <button
                type="button"
                data-review-edit-save=""
                disabled={props.editText.trim() === ''}
                onClick={() => props.onEditSave()}
                className="px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {messagesFor(props.language).saveEdit}
              </button>
            </div>
          </div>
          {/* Under the agent's last word, flush with its right edge:
              what a reply answers. */}
          <button
            type="button"
            data-review-reply=""
            className={props.row.replyHere && !props.row.replyBoxHere ? 'self-end flex items-center gap-1 px-1 py-0.5 text-xs whitespace-nowrap text-muted-foreground rounded hover:text-foreground hover:bg-muted' : 'hidden'}
            onClick={() => props.onStartReply(props.row.id)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
            {messagesFor(props.language).reply}
          </button>
        </div>
      </div>
    </div>
  )
}
