'use client'

// The app-wide settings, as an in-app modal opened from the app menu's
// "Settings…" (Cmd+,) — not a native dialog (CLAUDE.md, Tauri pitfalls)
// and not a window of its own: each window opens its own copy, and a change
// saved from one reaches the others through `settings:changed`.
//
// Permanently mounted, only `hidden` toggling, like `SlideContextMenu`:
// the settings items added later hold inputs whose state must survive the
// panel closing and reopening. Escape is handled in `Studio.tsx`'s
// `onKeyDown`, which also holds back every slide shortcut while this is
// open.
//
// There are no settings yet (see `domain/settings.ts`); the first items
// go in the body below.
export interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
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
          <h2 id="settings-panel-title" className="text-sm font-medium">Settings</h2>
          <button
            type="button"
            aria-label="Close settings"
            data-settings-panel-close
            onClick={() => props.onClose()}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-6">
          <p className="text-sm text-muted-foreground">There are no settings to change yet.</p>
        </div>
      </div>
      </div>
    </>
  )
}
