'use client'

import type { Language } from '../domain/language'
import { messagesFor } from '../domain/messages'

interface ReviewSendContentProps {
  language: Language
  sending: boolean
  working: boolean
}

export function ReviewSendContent(props: ReviewSendContentProps) {
  return (
    <>
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
      <span className={props.working && !props.sending ? 'animate-pulse' : ''}>{props.sending ? messagesFor(props.language).sendingToAgent : props.working ? messagesFor(props.language).agentThinking : messagesFor(props.language).sendToAgent}</span>
    </>
  )
}
