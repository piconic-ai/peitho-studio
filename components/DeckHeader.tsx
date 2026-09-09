'use client'

// Props here are values (`presentMenuOpen={presentMenuOpen()}`), not signal
// getters — see `components/WelcomeScreen.tsx` for why (BF044).
export interface DeckHeaderProps {
  deckPath: string | null
  presentMenuOpen: boolean
  onTogglePresentMenu: () => void
  onClosePresentMenu: () => void
  onPresent: (rehearsal: boolean) => void
}

export function DeckHeader(props: DeckHeaderProps) {
  return (
    <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-border">
      {/* Selecting this text and Cmd+C just works (native Edit-menu
          Copy — src-tauri/src/lib.rs's build_menu — routes to whatever
          has focus, including a WKWebView selection), so a dedicated
          copy button here is unnecessary UI. */}
      <span className="text-sm text-muted-foreground truncate select-text">{props.deckPath}</span>
      <div className="flex-1" />
      <div className="relative">
        <div
          className={
            props.deckPath
              ? 'flex items-center rounded-full bg-primary text-primary-foreground overflow-hidden'
              : 'flex items-center rounded-full bg-primary text-primary-foreground overflow-hidden opacity-50'
          }
        >
          <button
            type="button"
            disabled={!props.deckPath}
            onClick={() => {
              props.onClosePresentMenu()
              props.onPresent(false)
            }}
            className="pl-4 pr-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <span aria-hidden="true">▶</span>
            Present
          </button>
          <button
            type="button"
            disabled={!props.deckPath}
            onClick={() => props.onTogglePresentMenu()}
            aria-label="Present options"
            className="pl-2 pr-3 py-1.5 border-l border-primary-foreground/25 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true">▾</span>
          </button>
        </div>
        {props.presentMenuOpen ? (
          <>
            <div className="fixed top-0 right-0 bottom-0 left-0 z-10" onClick={() => props.onClosePresentMenu()} />
            <div className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-20">
              <button
                type="button"
                onClick={() => {
                  props.onClosePresentMenu()
                  props.onPresent(true)
                }}
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-start gap-2.5"
              >
                <span aria-hidden="true" className="mt-0.5">▶</span>
                <span>
                  <div className="text-sm font-medium">Present (Rehearsal)</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Time each section as you go and save it for comparison against the plan.</div>
                </span>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </header>
  )
}
