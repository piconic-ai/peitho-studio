'use client'

import { createSignal, onMount, onCleanup } from '@barefootjs/client'
import { createTauriUpdateIpc } from '../ipc/updateIpc'
import { createTauriSettingsIpc } from '../ipc/settingsIpc'
import { createSettingsStore } from '../state/settingsStore'
import {
  canPrepareUpdate,
  canRetryUpdate,
  failUpdateCommand,
  initialUpdateStatus,
  showsReleasesLink,
  startUpdateCheck,
  updateMessages,
  updateNotes,
  updateStatusText,
  type UpdateStatus,
} from '../domain/updates'

/** The "Check for Updates…" window's page (`pages/update.html`), opened from
 * the app menu by `src-tauri/src/update_window.rs`. Checks as soon as it
 * opens, and again whenever the menu item is chosen while it's open. The
 * update state itself is app-wide (`updates.rs`): this page only shows it
 * and calls the same commands the settings panel does. */
export function UpdateScreen() {
  const updateIpc = createTauriUpdateIpc()
  const settingsIpc = createTauriSettingsIpc()
  // Same language as the Studio windows: the saved choice, or the OS's.
  const settings = createSettingsStore(typeof navigator === 'undefined' ? [] : navigator.languages)
  const [status, setStatus] = createSignal<UpdateStatus>(initialUpdateStatus())

  async function check(): Promise<void> {
    setStatus(startUpdateCheck(status()))
    try { setStatus(await updateIpc.check()) }
    catch (error) { setStatus(failUpdateCommand(status(), error)) }
  }

  async function prepare(): Promise<void> {
    try { setStatus(await updateIpc.prepare()) }
    catch (error) { setStatus(failUpdateCommand(status(), error)) }
  }

  function openReleases(): void {
    updateIpc.openReleases().catch((error: unknown) => { console.error('failed to open the releases page', error) })
  }

  onMount(() => {
    // Best-effort, like the About window's: on failure the defaults stay.
    settingsIpc.getSettings().then(settings.applyLoaded, () => {})
    settingsIpc.getSystemLocales().then(settings.applySystemLocales, () => {})
    const unlistenSettingsChanged = settingsIpc.onSettingsChanged(settings.applyChanged)
    const unlistenChanged = updateIpc.onChanged(setStatus)
    const unlistenCheckAgain = updateIpc.onCheckAgain(() => { void check() })
    void check()
    onCleanup(() => { unlistenSettingsChanged(); unlistenChanged(); unlistenCheckAgain() })
  })

  return (
    <div className="h-full flex flex-col gap-3 px-6 py-5 select-none">
      <div className="flex items-center gap-3">
        <img src="/static/app-icon.svg" alt="" className="block w-12 h-12" />
        <h1 className="text-base font-semibold">{updateMessages(settings.language()).title}</h1>
      </div>
      <p role="status" data-update-status className="text-sm whitespace-pre-wrap">{updateStatusText(status(), settings.language())}</p>
      {/* Always mounted and hidden when empty — see CLAUDE.md's BarefootJS
          pitfalls on conditional branches. */}
      <p data-update-security hidden={!status().security} className="text-sm font-medium whitespace-pre-wrap">{status().security ?? ''}</p>
      <p role="alert" data-update-error hidden={!status().error} className="text-xs text-destructive whitespace-pre-wrap">{status().error ?? ''}</p>
      <div hidden={updateNotes(status()) === null} className="flex-1 min-h-0 flex flex-col gap-1">
        <h2 className="text-xs text-muted-foreground">{updateMessages(settings.language()).notes}</h2>
        <p data-update-notes className="flex-1 min-h-0 overflow-auto m-0 p-2 rounded border border-border text-sm whitespace-pre-wrap select-text">{updateNotes(status()) ?? ''}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          data-update-action="releases"
          hidden={!showsReleasesLink(status())}
          onClick={() => openReleases()}
          className="mr-auto p-0 bg-transparent border-0 text-sm text-foreground underline cursor-pointer"
        >
          {updateMessages(settings.language())[status().version !== null ? 'releases' : 'openReleases']}
        </button>
        <button
          type="button"
          data-update-action="retry"
          hidden={!canRetryUpdate(status())}
          onClick={() => { void check() }}
          className="px-4 py-1.5 rounded-md border border-border bg-background text-sm cursor-pointer"
        >
          {updateMessages(settings.language()).retry}
        </button>
        <button
          type="button"
          data-update-action="prepare"
          hidden={!canPrepareUpdate(status())}
          onClick={() => { void prepare() }}
          className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm cursor-pointer"
        >
          {updateMessages(settings.language()).prepare}
        </button>
      </div>
    </div>
  )
}
