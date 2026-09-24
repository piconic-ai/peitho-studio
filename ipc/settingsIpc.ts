// Typed boundary around the settings commands/events in
// src-tauri/src/settings.rs. Every value arriving from Rust goes through
// `parseSettings`, so the rest of the app only ever sees a valid
// `Settings`.
import { invoke } from '@tauri-apps/api/core'
import { SETTINGS_SCHEMA, parseSettings, type Settings, type SettingsPatch } from '../domain/settings'
import { subscribeToThisWindow, subscribeWithPayload, type Unsubscribe } from './deckIpc'

export interface SettingsIpc {
  /** The saved settings (defaults when nothing is saved yet). */
  getSettings(): Promise<Settings>
  /** Saves the settings in `patch`, leaving the others as they are, and
   * resolves to the settings as saved. Every window, this one included,
   * also hears the result through `onSettingsChanged`. */
  updateSettings(patch: SettingsPatch): Promise<Settings>
  /** Fires in every window once any window's change is saved. */
  onSettingsChanged(callback: (settings: Settings) => void): Unsubscribe
  /** The app menu's "Settings…" (or Cmd+,), sent only to the focused
   * window. */
  onMenuSettings(callback: () => void): Unsubscribe
}

export function createTauriSettingsIpc(): SettingsIpc {
  return {
    getSettings: async () => parseSettings(SETTINGS_SCHEMA, await invoke('get_settings')),
    updateSettings: async patch => parseSettings(SETTINGS_SCHEMA, await invoke('update_settings', { patch })),
    onSettingsChanged: callback => subscribeWithPayload<unknown>('settings:changed', raw => { callback(parseSettings(SETTINGS_SCHEMA, raw)) }),
    onMenuSettings: callback => subscribeToThisWindow('menu:settings', callback),
  }
}
