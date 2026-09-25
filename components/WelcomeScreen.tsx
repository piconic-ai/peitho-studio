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
        <svg aria-hidden="true" viewBox="17.5 6 65 76.5" className="block w-16 h-16">
          <circle cx="50" cy="17" r="10" fill="#111111" />
          <path fill="#111111" d="M50 22C29 22 18.5 37 18.5 56C18.5 64 20.5 71 23.5 76.5C24.5 78.3 26.8 78.6 28 77C29.5 75 30 72 30 69L70 69C70 72 70.5 75 72 77C73.2 78.6 75.5 78.3 76.5 76.5C79.5 71 81.5 64 81.5 56C81.5 37 71 22 50 22Z" />
          <path fill="#ffffff" d="M50 42C35 42 27.5 52 27.5 62.5C27.5 73.5 37 81.5 50 81.5C63 81.5 72.5 73.5 72.5 62.5C72.5 52 65 42 50 42Z" />
          <path fill="#111111" d="M26.8 62C26.8 46.5 37 35.5 50 35.5C63 35.5 73.2 46.5 73.2 62C67.5 57 61.5 51.5 56.8 45.5C55.3 50 52.9 53.2 50 54.8C47.1 53.2 44.7 50 43.2 45.5C38.5 51.5 32.5 57 26.8 62Z" />
          <path fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" d="M51.6 17a1.6 1.6 0 1 0-3.2 0a3.4 3.4 0 1 0 6.8 0a5.2 5.2 0 1 0-10.4 0" />
          <path fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" d="M33.8 32.6C43 27.4 57 27.4 66.2 32.6" />
          <circle cx="50" cy="28.9" r="1.9" fill="#ffffff" />
          <path fill="none" stroke="#111111" stroke-width="2.3" stroke-linecap="round" d="M38.8 64.6q3.4-3.8 6.8 0M54.4 64.6q3.4-3.8 6.8 0" />
          <path fill="#F4A6B8" d="M32.1 70.6a4.2 2.5 0 1 0 8.4 0a4.2 2.5 0 1 0 -8.4 0ZM59.5 70.6a4.2 2.5 0 1 0 8.4 0a4.2 2.5 0 1 0 -8.4 0Z" />
          <path fill="none" stroke="#111111" stroke-width="1.9" stroke-linecap="round" d="M47.9 72.3q2.1 1.9 4.2 0" />
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
