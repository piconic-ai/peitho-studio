'use client'

// Props here are values (`isBusy={isBusy()}`), not signal getters
// (`isBusy={isBusy}`) — BarefootJS's compiler rejects the latter with
// BF044 ("Signal/Memo getter passed without calling it"). Unlike a
// design this refactor's docs/architecture.md briefly assumed (a
// `Memo<T>`-typed prop, recognized as reactive via a `Reactive<T>`
// brand), the actual model matches SolidJS: the compiler lowers
// `value={count()}` into a getter property (`{ get value() { return
// count() } }`) on the props object it builds for the child, so reading
// `props.xxx` here (never destructured — that captures once and goes
// stale, BF043) re-tracks the parent's signal on every access.
export interface WelcomeScreenProps {
  isBusy: boolean
  errorMessage: string | null
  recentDecks: string[]
  onOpenFolder: () => void
  onNewDeck: () => void
  onOpenRecent: (path: string) => void
}

export function WelcomeScreen(props: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-sm flex flex-col items-center gap-4 px-6">
        <h1 className="text-lg font-semibold">Peitho Studio</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => props.onOpenFolder()}
            disabled={props.isBusy}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            {props.isBusy ? 'Opening…' : 'Open Deck…'}
          </button>
          <button
            type="button"
            onClick={() => props.onNewDeck()}
            disabled={props.isBusy}
            className="px-4 py-2 rounded-md border border-border text-sm disabled:opacity-50"
          >
            New Deck…
          </button>
        </div>
        {/* `disabled` on the buttons above (and on each Recent entry
            below) was the only previously-existing feedback while
            `loadDeck`/`create_deck` are in flight — easy to miss
            (opacity-50 on an already-plain button) and gives no signal
            at all once a button is clicked, so a slow open/create read
            as a frozen window rather than "still working". This is
            deliberately unconditional layout space (not conditionally
            rendered) so its appearance doesn't itself shift the
            surrounding buttons. */}
        <div className="h-4 text-xs text-muted-foreground">{props.isBusy ? 'Opening…' : ''}</div>
        {/* Always mounted, visibility toggled by `hidden` rather than
            `{errorMessage ? <div/> : null}` — see CLAUDE.md's BarefootJS
            pitfalls (a failed open/create while this screen stays mounted
            is exactly the null-to-string, well-after-mount transition that
            pattern silently drops). */}
        <div hidden={props.errorMessage === null} className="text-xs text-destructive text-center">{props.errorMessage}</div>
        {props.recentDecks.length > 0 ? (
          <div className="w-full">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recent</div>
            <div className="flex flex-col gap-1">
              {props.recentDecks.map(path => (
                <button
                  type="button"
                  key={path}
                  onClick={() => props.onOpenRecent(path)}
                  disabled={props.isBusy}
                  title={path}
                  // A path's most distinguishing part (the deck's own
                  // folder name) is at the *end* — plain `truncate`
                  // elides there first, leaving every entry looking
                  // like the same shared parent directory. `dir="rtl"`
                  // flips which side the ellipsis lands on (to the
                  // left) while the path text itself still renders
                  // left-to-right, so the tail stays visible instead.
                  dir="rtl"
                  className="w-full text-left px-3 py-2 rounded-md border border-border hover:bg-accent text-sm truncate disabled:opacity-50"
                >
                  {path}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
