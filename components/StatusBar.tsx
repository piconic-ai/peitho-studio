'use client'

// Props here are values, not signal getters — see `components/
// WelcomeScreen.tsx` for why (BF044).
export interface StatusBarProps {
  errorMessage: string | null
  errorMessageCopied: boolean
  statusMessage: string
  onCopyErrorMessage: () => void
}

export function StatusBar(props: StatusBarProps) {
  return (
    <>
      {props.errorMessage ? (
        <div className="px-3 py-1.5 bg-destructive/10 text-destructive text-xs shrink-0 border-t border-destructive/30 flex items-start gap-2">
          <span className="flex-1 select-text">{props.errorMessage}</span>
          <button
            type="button"
            onClick={() => props.onCopyErrorMessage()}
            className="shrink-0 px-1.5 py-0.5 rounded border border-destructive/30 hover:bg-destructive/20"
          >
            {props.errorMessageCopied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}
      <footer className="h-6 shrink-0 flex items-center px-3 text-xs text-muted-foreground border-t border-border">
        {props.statusMessage}
      </footer>
    </>
  )
}
