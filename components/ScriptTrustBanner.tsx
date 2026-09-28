'use client'

import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'

// Props here are values, not signal getters — see `components/
// WelcomeScreen.tsx` for why (BF044).
export interface ScriptTrustBannerProps {
  /** The UI language every label here is shown in. */
  language: Language
  /** `trustBannerShown` in domain/scriptTrust.ts. */
  shown: boolean
  /** "Trust and Run" was pressed and hasn't been saved yet. */
  pending: boolean
  onTrust: () => void
}

/** The strip under the deck header telling the user an untrusted deck's
 * scripts were turned off, with the button that trusts it — see
 * `todo/archive/deck-script-trust.md`. The button itself is the confirmation: no
 * `window.confirm()`, which WKWebView can silently treat as cancelled. */
export function ScriptTrustBanner(props: ScriptTrustBannerProps) {
  return (
    // Always mounted, toggled with `hidden` — see `StatusBar.tsx`.
    <div
      role="status"
      data-script-trust-banner=""
      hidden={!props.shown}
      className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-muted text-sm text-foreground"
    >
      <span className="flex-1">{messagesFor(props.language).scriptsDisabled}</span>
      <button
        type="button"
        disabled={props.pending}
        onClick={() => props.onTrust()}
        className="shrink-0 px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {props.pending ? messagesFor(props.language).trustingDeck : messagesFor(props.language).trustAndRun}
      </button>
    </div>
  )
}
