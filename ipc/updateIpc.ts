import { invoke } from '@tauri-apps/api/core'
import { parseUpdateStatus } from '../domain/updates'
import { subscribeToThisWindow, subscribeWithPayload, type Unsubscribe } from './deckIpc'
import type { UpdateStatus } from '../domain/updates'

export function createTauriUpdateIpc() {
  const call = async (command: string) => parseUpdateStatus(await invoke(command))
  return {
    openReleases: () => invoke('open_update_releases'),
    getStatus: () => call('get_update_status'),
    check: () => call('check_for_updates'),
    prepare: () => call('prepare_update'),
    dismiss: () => call('dismiss_update'),
    onChanged: (callback: (status: UpdateStatus) => void): Unsubscribe => subscribeWithPayload<unknown>('updates:changed', raw => callback(parseUpdateStatus(raw))),
    /** The "Check for Updates…" window (`update_window.rs`) is asked to check
     * again: its menu item was chosen while it was already open. */
    onCheckAgain: (callback: () => void): Unsubscribe => subscribeToThisWindow('update-window:check', callback),
    onBeforeExit: (callback: (token: number) => void): Unsubscribe => subscribeWithPayload<number>('updates:before-exit', callback),
    acknowledgeSave: (token: number, saved: boolean) => invoke('acknowledge_update_save', { token, saved }),
  }
}
