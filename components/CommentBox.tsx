'use client'

import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'

export interface CommentBoxProps {
  language: Language
  open: boolean
  /** What the comment is on: `Slide 2 › heading "…"`. */
  label: string
  draft: string
  /** Where the box sits on screen (its top-left corner, CSS px). */
  left: number
  top: number
  onDraftInput: (text: string) => void
  onCancel: () => void
  onAdd: () => void
}

/** The box a comment is written in, opened by a click on the preview
 * (todo/review-comment-ui.md). In-app rather than `window.prompt()`, which
 * WKWebView can silently treat as cancelled. Always mounted and toggled
 * with `hidden`, like `ScriptTrustBanner.tsx`; `Studio.tsx` focuses the
 * text field when it opens (`focusCommentBox`). ⌘/Ctrl+Enter adds, Escape
 * cancels. */
export function CommentBox(props: CommentBoxProps) {
  return (
    <div
      role="dialog"
      data-comment-box=""
      aria-label={messagesFor(props.language).addComment}
      hidden={!props.open}
      className="fixed z-30 w-80 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-3 flex flex-col gap-2"
      style={`left: ${String(props.left)}px; top: ${String(props.top)}px`}
    >
      <div data-comment-target="" className="text-xs text-muted-foreground truncate">{props.label}</div>
      <textarea
        rows={3}
        value={props.draft}
        placeholder={messagesFor(props.language).commentPlaceholder}
        onInput={e => props.onDraftInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.preventDefault()
            props.onCancel()
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            props.onAdd()
          }
        }}
        className="w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-sm"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => props.onCancel()} className="px-3 py-1 rounded-md text-sm hover:bg-accent">
          {messagesFor(props.language).cancel}
        </button>
        <button
          type="button"
          data-comment-add=""
          disabled={props.draft.trim() === ''}
          onClick={() => props.onAdd()}
          className="px-3 py-1 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {messagesFor(props.language).addComment}
        </button>
      </div>
    </div>
  )
}
