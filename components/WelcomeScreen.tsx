'use client'

import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
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
  /** The UI language every label here is shown in. */
  language: Language
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
        {/* The brand mark: brand/logo-mark.svg, generated from
            scripts/brand/mark.ts. JSX can't take that markup as a string,
            so it's inlined here; scripts/brand/mark.test.ts fails if these
            paths drift from the source. Decorative: the heading right after
            it already names the app. */}
        <svg aria-hidden="true" viewBox="19 16.2 59 75.8" className="block w-16 h-16">
          <path fill="#111111" d="M60 85L60 71C64 70.5 68.5 68 70 64.5C71.3 61.5 72.5 59 74.5 56.5C76 54.8 77 53.3 76.9 52C76.7 50 74.6 46 73.6 42C72.5 36 71 30 66 25C60 19 52 17 46 17.5C35 18.5 26 26 24 36C22 46 25 56 32 63C36 67 40 70 42 72C42.5 77 42 81 41 85C47 87 54 87 60 85Z" />
          <g fill="none" stroke-linecap="round">
            <path stroke="#ffffff" stroke-width="13.5" d="M63 26.5C57 22.2 50.5 21.6 46 22.3C37 23.2 30.2 29.2 28.8 36.5C27.2 46 28.2 56 32.2 64C36 71.8 36.2 80.6 31.5 84.8C27.5 88 23.5 85 25.3 82C26.8 79.7 30 80.8 29.5 83.5" />
            <path stroke="#111111" stroke-width="9.5" d="M63 26.5C57 22.2 50.5 21.6 46 22.3C37 23.2 30.2 29.2 28.8 36.5C27.2 46 28.2 56 32.2 64C36 71.8 36.2 80.6 31.5 84.8C27.5 88 23.5 85 25.3 82C26.8 79.7 30 80.8 29.5 83.5" />
          </g>
          <circle cx="64" cy="46" r="1.9" fill="#ffffff" />
        </svg>
        <h1 className="text-lg font-semibold">Peitho Studio</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => props.onOpenFolder()}
            disabled={props.isBusy}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            {props.isBusy ? messagesFor(props.language).opening : messagesFor(props.language).openDeck}
          </button>
          <button
            type="button"
            onClick={() => props.onNewDeck()}
            disabled={props.isBusy}
            className="px-4 py-2 rounded-md border border-border text-sm disabled:opacity-50"
          >
            {messagesFor(props.language).newDeck}
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
        <div className="h-4 text-xs text-muted-foreground">{props.isBusy ? messagesFor(props.language).opening : ''}</div>
        {/* Always mounted, visibility toggled by `hidden` rather than
            `{errorMessage ? <div/> : null}` — see CLAUDE.md's BarefootJS
            pitfalls (a failed open/create while this screen stays mounted
            is exactly the null-to-string, well-after-mount transition that
            pattern silently drops). */}
        <div hidden={props.errorMessage === null} className="text-xs text-destructive text-center">{props.errorMessage}</div>
        {props.recentDecks.length > 0 ? (
          <div className="w-full">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{messagesFor(props.language).recentDecks}</div>
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
