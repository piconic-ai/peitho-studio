'use client'

import { type SlideStatusBadge } from '../domain/slideStatus'
import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'

interface SlideStatusOverlayProps {
  badge: SlideStatusBadge | null
  language: Language
}

export function SlideStatusOverlay(props: SlideStatusOverlayProps) {
  return (
    props.badge !== null ? (
      <span
        data-slide-status={props.badge}
        className="absolute top-0 right-0 bottom-0 left-0 flex items-start justify-end p-1 bg-black/40 pointer-events-none"
      >
        {/* DRAFT and SKIP share the same subdued, dark
            treatment — SKIP used to be a solid destructive
            red, which read as an error/alert rather than
            an ordinary editorial state, easily the most
            eye-catching thing on the whole slide list.
            ERROR is exactly that alert — the slide was
            left out of the render for not building — so
            it alone takes the destructive color. */}
        <span className={(props.badge === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-foreground') + ' rounded-sm px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide'}>
          {messagesFor(props.language)[props.badge === 'error' ? 'errorBadge' : props.badge === 'draft' ? 'draftBadge' : 'skipBadge']}
        </span>
      </span>
    ) : null
  )
}
