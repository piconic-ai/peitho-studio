'use client'

import type { Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import type { PanelRow } from '../domain/reviewPanel'

interface ReviewThreadHeaderProps {
  language: Language
  row: PanelRow
  onResolve: (commentId: string) => void
}

export function ReviewThreadHeader(props: ReviewThreadHeaderProps) {
  return (
    <div data-review-thread-header="" className={props.row.threadStart && props.row.target !== null ? 'flex items-center gap-1.5 text-xs text-muted-foreground min-w-0' : 'hidden'}>
      <span data-review-target="" className="flex-1 min-w-0 truncate">{props.row.target ?? ''}</span>
      <span
        data-review-resolved=""
        role="img"
        aria-label={messagesFor(props.language).resolvedComment}
        title={messagesFor(props.language).resolvedComment}
        className={props.row.kind === 'comment' && props.row.resolved ? 'shrink-0 text-[#16a34a]' : 'hidden'}
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
        className={props.row.kind === 'comment' && !props.row.resolved ? 'shrink-0 p-0.5 rounded hover:bg-muted hover:text-[#16a34a]' : 'hidden'}
        onClick={() => props.onResolve(props.row.id)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
      </button>
    </div>
  )
}
