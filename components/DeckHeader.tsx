'use client'

import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import type { VariantOption } from '../domain/deckVariants'

// Props here are values (`presentMenuOpen={presentMenuOpen()}`), not signal
// getters — see `components/WelcomeScreen.tsx` for why (BF044).
export interface DeckHeaderProps {
  /** The UI language every label here is shown in. */
  language: Language
  deckPath: string | null
  /** Whether there's another same-base deck (deck.ja.md, ...) to switch to
   * — see `toVariantSwitcher` in domain/deckVariants.ts. */
  variantSwitcherShown: boolean
  currentVariantLabel: string
  variantOptions: readonly VariantOption[]
  variantMenuOpen: boolean
  onToggleVariantMenu: () => void
  onCloseVariantMenu: () => void
  onOpenVariant: (path: string) => void
  presentMenuOpen: boolean
  presentPending: boolean
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
      {/* Permanently mounted, toggled by a `hidden` class rather than a
          `cond ? <.../> : null` branch: the variant list arrives after this
          header has already mounted (see `refreshDeckVariants` in
          Studio.tsx), and a conditional's post-mount branches inside a
          freshly mounted subtree are exactly what SlideContextMenu.tsx
          found unreliable. */}
      <div className={(props.variantSwitcherShown ? '' : 'hidden ') + 'relative shrink-0'}>
        <button
          type="button"
          onClick={() => props.onToggleVariantMenu()}
          aria-label={messagesFor(props.language).switchDeckVariant}
          aria-haspopup="menu"
          aria-expanded={props.variantMenuOpen ? 'true' : 'false'}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-border text-xs hover:bg-accent"
        >
          <span>{props.currentVariantLabel}</span>
          <span aria-hidden="true">▾</span>
        </button>
        <div
          className={(props.variantMenuOpen ? '' : 'hidden ') + 'fixed top-0 right-0 bottom-0 left-0 z-10'}
          onClick={() => props.onCloseVariantMenu()}
        />
        <div
          role="menu"
          className={(props.variantMenuOpen ? '' : 'hidden ') + 'absolute left-0 top-full mt-2 min-w-40 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 z-20'}
        >
          {/* Picking a variant opens it in a new window, the same as
              every other way of opening a deck while one is already open
              (`decide`'s `open` + `open-requested` -> `spawn-window`), so
              this window keeps its deck and any unsaved edit. The current
              deck is listed (checked) but can't be picked. */}
          {props.variantOptions.map(option => (
            <button
              type="button"
              key={option.path}
              role="menuitemradio"
              aria-checked={option.isCurrent ? 'true' : 'false'}
              disabled={option.isCurrent}
              onClick={() => {
                props.onCloseVariantMenu()
                props.onOpenVariant(option.path)
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-accent disabled:hover:bg-transparent disabled:cursor-default flex items-start gap-2"
            >
              <span aria-hidden="true" className="w-3 text-sm">{option.isCurrent ? '✓' : ''}</span>
              <span>
                <div className="text-sm">{option.label}</div>
                <div className={(option.detail === null ? 'hidden ' : '') + 'text-xs text-muted-foreground'}>{option.detail ?? ''}</div>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1" />
      <div className="relative">
        <div
          className={
            props.deckPath
              ? 'flex items-center rounded-full bg-primary text-primary-foreground overflow-hidden'
              : 'flex items-center rounded-full bg-primary text-primary-foreground overflow-hidden opacity-50'
          }
        >
          {/* `presentPending` disables both buttons and swaps the label —
              same click-to-completion pattern as WelcomeScreen's
              isBusy/"Opening…" — so a slow present launch reads as "still
              working" instead of a dead click, and a repeat click can't
              queue a second `present_deck` call while the first is still
              in flight. "In flight" here outlasts the `present_deck` call
              itself — see `handlePresent` in Studio.tsx for why. */}
          <button
            type="button"
            disabled={!props.deckPath || props.presentPending}
            onClick={() => {
              props.onClosePresentMenu()
              props.onPresent(false)
            }}
            className="pl-4 pr-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <span aria-hidden="true">▶</span>
            {props.presentPending ? messagesFor(props.language).presentPending : messagesFor(props.language).present}
          </button>
          <button
            type="button"
            disabled={!props.deckPath || props.presentPending}
            onClick={() => props.onTogglePresentMenu()}
            aria-label={messagesFor(props.language).presentOptions}
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
                  <div className="text-sm font-medium">{messagesFor(props.language).presentRehearsal}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{messagesFor(props.language).presentRehearsalDetail}</div>
                </span>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </header>
  )
}
