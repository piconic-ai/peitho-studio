import { createMemo, createSignal } from '@barefootjs/client'
import { SETTINGS_SCHEMA, defaultsOf, type Settings } from '../domain/settings'
import { resolveLanguage } from '../domain/language'
import { messagesFor } from '../domain/messages'

/** The app-wide settings as this window knows them, whether its settings
 * panel is open, and the UI language they come to.
 *
 * Settings arrive two ways: the launch-time read (`applyLoaded`) and the
 * `settings:changed` broadcast after any window saves a change
 * (`applyChanged`). A change can be heard before a slow launch-time read
 * answers, so once one has, the read's older answer is dropped.
 *
 * The UI language (`language`, and its `messages`) is the saved choice, or
 * — while that is `system` — the OS's preferred language. The window starts
 * from `initialSystemLocales` (the webview's own guess) and switches to
 * the OS's answer once `applySystemLocales` hands it over.
 *
 * A factory, like the other stores — see `state/uiStore.ts`. */
export function createSettingsStore(initialSystemLocales: readonly string[] = []) {
  const [settings, setSettings] = createSignal<Settings>(defaultsOf(SETTINGS_SCHEMA))
  const [panelOpen, setPanelOpen] = createSignal(false)
  const [systemLocales, setSystemLocales] = createSignal<readonly string[]>(initialSystemLocales)
  const language = createMemo(() => resolveLanguage(settings().uiLanguage, systemLocales()))
  const messages = createMemo(() => messagesFor(language()))
  let heardChange = false

  return {
    settings,
    panelOpen,
    language,
    messages,
    openPanel: () => { setPanelOpen(true) },
    closePanel: () => { setPanelOpen(false) },
    applyLoaded: (loaded: Settings) => {
      if (!heardChange) setSettings(loaded)
    },
    applyChanged: (changed: Settings) => {
      heardChange = true
      setSettings(changed)
    },
    applySystemLocales: (locales: readonly string[]) => { setSystemLocales(locales) },
  }
}
