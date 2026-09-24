'use client'

import { LANGUAGES, type Language } from '../domain/language'
import { LANGUAGE_NAMES, messagesFor } from '../domain/messages'

// The app-wide settings, as an in-app modal opened from the app menu's
// "Settings…" (Cmd+,) — not a native dialog (CLAUDE.md, Tauri pitfalls)
// and not a window of its own: each window opens its own copy, and a change
// saved from one reaches the others through `settings:changed`.
//
// Permanently mounted, only `hidden` toggling, like `SlideContextMenu`:
// the settings items hold inputs whose state must survive the panel
// closing and reopening. Escape is handled in `Studio.tsx`'s `onKeyDown`,
// which also holds back every slide shortcut while this is open.
//
// Each item shows the setting as this window knows it and reports a change
// through a callback; `Studio.tsx` saves it (see `domain/settings.ts`).
export interface SettingsPanelProps {
  isOpen: boolean
  /** The UI language shown now — the saved choice, or the OS's while
   * nothing is chosen — which the language picker marks as chosen. */
  language: Language
  vimMode: boolean
  onClose: () => void
  /** A language picked in the language picker, to be saved. */
  onChangeLanguage: (language: Language) => void
  onVimModeChange: (on: boolean) => void
}

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <>
      <div
        className={(props.isOpen ? '' : 'hidden ') + 'fixed top-0 right-0 bottom-0 left-0 z-40 bg-black/40'}
        onClick={() => props.onClose()}
      />
      {/* Centers the dialog without covering the backdrop's clicks: the
          full-screen wrapper lets them through, the dialog takes its own. */}
      <div className={(props.isOpen ? '' : 'hidden ') + 'fixed top-0 right-0 bottom-0 left-0 z-50 flex items-center justify-center pointer-events-none'}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-panel-title"
        className="pointer-events-auto w-full max-w-md rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 id="settings-panel-title" className="text-sm font-medium">{messagesFor(props.language).settings}</h2>
          <button
            type="button"
            aria-label={messagesFor(props.language).closeSettings}
            data-settings-panel-close
            onClick={() => props.onClose()}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-4 flex items-center justify-between gap-4">
          <span id="settings-language-label" className="text-sm">{messagesFor(props.language).language}</span>
          {/* Buttons rather than a `<select>`: a select's `value` binding only
              writes when the language changes, so a pick that failed to save
              would leave the select showing a language the UI isn't in.
              Each language is named in itself (`LANGUAGE_NAMES`), so it can
              be found without reading the current one. */}
          <div role="radiogroup" aria-labelledby="settings-language-label" className="flex rounded-md border border-border overflow-hidden">
            {LANGUAGES.map(language => (
              <button
                type="button"
                key={language}
                role="radio"
                data-settings-language={language}
                aria-checked={props.language === language ? 'true' : 'false'}
                onClick={() => props.onChangeLanguage(language)}
                className={(props.language === language ? 'bg-primary text-primary-foreground ' : 'hover:bg-accent ') + 'px-3 py-1 text-sm'}
              >
                {LANGUAGE_NAMES[language]}
              </button>
            ))}
          </div>
        </div>
        <div className="px-4 pb-4">
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              data-setting="vim-mode"
              checked={props.vimMode}
              onChange={e => props.onVimModeChange((e.target as HTMLInputElement).checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">{messagesFor(props.language).vimMode}</span>
              <span className="block text-xs text-muted-foreground">
                {messagesFor(props.language).vimModeDescription}
              </span>
            </span>
          </label>
        </div>
      </div>
      </div>
    </>
  )
}
