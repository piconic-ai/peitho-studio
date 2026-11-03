'use client'

import type { Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import type { PanelRow } from '../domain/reviewPanel'

interface ReviewMessageMetadataProps {
  language: Language
  row: PanelRow
  onStartEdit: (id: string) => void
  onDiscard: (id: string) => void
}

export function ReviewMessageMetadata(props: ReviewMessageMetadataProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span data-review-agent="" className={props.row.byAgent ? 'shrink-0 font-semibold text-foreground' : 'hidden'}>{props.row.author}</span>
      <span className={props.row.kind === 'unsent-comment' || props.row.kind === 'unsent-reply' ? 'shrink-0 rounded-sm px-1 bg-[#eab308] text-black' : 'hidden'}>
        {messagesFor(props.language).unsentComment}
      </span>
      <span data-review-time="" className="shrink-0">{props.row.time}</span>
      <button
        type="button"
        data-review-edit=""
        aria-label={messagesFor(props.language).editComment}
        title={messagesFor(props.language).editComment}
        className={(props.row.kind === 'unsent-comment' || props.row.kind === 'unsent-reply') && !props.row.editing ? 'shrink-0 p-0.5 rounded hover:bg-muted hover:text-foreground' : 'hidden'}
        onClick={() => props.onStartEdit(props.row.id)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4Z" />
        <path d="m13.5 6.5 4 4" />
      </svg>
      </button>
      <button
        type="button"
        data-review-discard=""
        aria-label={messagesFor(props.language).discardComment}
        title={messagesFor(props.language).discardComment}
        className={props.row.kind === 'unsent-comment' || props.row.kind === 'unsent-reply' ? 'shrink-0 p-0.5 rounded hover:bg-muted hover:text-destructive' : 'hidden'}
        onClick={() => props.onDiscard(props.row.id)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
      </button>
    </div>
  )
}
