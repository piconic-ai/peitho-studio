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
      {/* Always mounted, visibility toggled by `hidden` rather than
          `{errorMessage ? <div/> : null}`. Root cause (confirmed by
          inspecting the rendered DOM): when a ternary's *initially selected*
          branch is `null`, the compiler emits no anchor comment for that
          region at all (a non-`null` branch gets `<!--bf-cond-start/end-->`
          markers the runtime later swaps content into; `null` gets nothing),
          so a later transition to the other branch has no DOM location to
          insert into and silently never happens — confirmed via Playwright:
          `errorMessage()` held the right value throughout, no JS error was
          thrown, the div just never appeared. `errorMessage` starts `null`
          and only turns into a string well after mount, on the first
          `commitChange`/`runOpen`/etc. failure, so it always hit this. */}
      <div
        hidden={props.errorMessage === null}
        className="px-3 py-1.5 bg-destructive/10 text-destructive text-xs shrink-0 border-t border-destructive/30 flex items-start gap-2"
      >
        <span className="flex-1 select-text">{props.errorMessage}</span>
        <button
          type="button"
          onClick={() => props.onCopyErrorMessage()}
          className="shrink-0 px-1.5 py-0.5 rounded border border-destructive/30 hover:bg-destructive/20"
        >
          {props.errorMessageCopied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <footer className="h-6 shrink-0 flex items-center px-3 text-xs text-muted-foreground border-t border-border">
        {props.statusMessage}
      </footer>
    </>
  )
}
