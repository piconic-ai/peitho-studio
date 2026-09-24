import { createSignal } from '@barefootjs/client'
import { SETTINGS_SCHEMA, defaultsOf, type Settings } from '../domain/settings'

/** The app-wide settings as this window knows them, and whether its
 * settings panel is open.
 *
 * Settings arrive two ways: the launch-time read (`applyLoaded`) and the
 * `settings:changed` broadcast after any window saves a change
 * (`applyChanged`). A change can be heard before a slow launch-time read
 * answers, so once one has, the read's older answer is dropped.
 *
 * A factory, like the other stores — see `state/uiStore.ts`. */
export function createSettingsStore() {
  const [settings, setSettings] = createSignal<Settings>(defaultsOf(SETTINGS_SCHEMA))
  const [panelOpen, setPanelOpen] = createSignal(false)
  let heardChange = false

  return {
    settings,
    panelOpen,
    openPanel: () => { setPanelOpen(true) },
    closePanel: () => { setPanelOpen(false) },
    applyLoaded: (loaded: Settings) => {
      if (!heardChange) setSettings(loaded)
    },
    applyChanged: (changed: Settings) => {
      heardChange = true
      setSettings(changed)
    },
  }
}
