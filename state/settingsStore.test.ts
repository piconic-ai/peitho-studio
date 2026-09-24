import { describe, expect, test } from 'bun:test'
import { createRoot } from '@barefootjs/client'
import { createSettingsStore } from './settingsStore'
import type { Settings } from '../domain/settings'

// Each test tells settings apart by object identity as well as by value: a
// distinct object stands for each saved version.
function version(changes: Partial<Settings> = {}): Settings {
  return { uiLanguage: 'system', vimMode: false, ...changes }
}

describe('settings store', () => {
  test('spec: Given a new window, when nothing has loaded yet, then the settings are the defaults and the panel is closed', () => {
    createRoot(() => {
      const store = createSettingsStore()
      expect(store.settings()).toEqual({ uiLanguage: 'system', vimMode: false })
      expect(store.panelOpen()).toBe(false)
    })
  })

  test('spec: Given the Settings… menu, when opened and then closed, then the panel follows', () => {
    createRoot(() => {
      const store = createSettingsStore()
      store.openPanel()
      expect(store.panelOpen()).toBe(true)
      store.closePanel()
      expect(store.panelOpen()).toBe(false)
    })
  })

  test('spec: Given the launch-time read, when it answers, then the window uses the saved settings', () => {
    createRoot(() => {
      const store = createSettingsStore()
      const saved = version({ vimMode: true })
      store.applyLoaded(saved)
      expect(store.settings()).toBe(saved)
    })
  })

  test('spec: Given another window saves a change, when this window hears it, then this window uses the new settings', () => {
    createRoot(() => {
      const store = createSettingsStore()
      store.applyLoaded(version())
      const changed = version({ vimMode: true })
      store.applyChanged(changed)
      expect(store.settings()).toBe(changed)
    })
  })

  test('adversarial: Given a change heard before a slow launch-time read answers, when the read answers, then the newer change is kept', () => {
    createRoot(() => {
      const store = createSettingsStore()
      const changed = version({ vimMode: true })
      store.applyChanged(changed)
      store.applyLoaded(version({ vimMode: false }))
      expect(store.settings()).toBe(changed)
    })
  })

  test('adversarial: Given the panel is open, when a change is heard, then the panel stays open', () => {
    createRoot(() => {
      const store = createSettingsStore()
      store.openPanel()
      store.applyChanged(version())
      expect(store.panelOpen()).toBe(true)
    })
  })

  test('spec: Given a Japanese OS and nothing chosen yet, when the window starts, then the UI is Japanese', () => {
    createRoot(() => {
      const store = createSettingsStore(['ja-JP', 'en-US'])
      expect(store.language()).toBe('ja')
      expect(store.messages().settings).toBe('設定')
    })
  })

  test('spec: Given an English OS, when Japanese is chosen in any window, then this window switches to Japanese without a restart', () => {
    createRoot(() => {
      const store = createSettingsStore(['en-US'])
      expect(store.language()).toBe('en')
      store.applyChanged(version({ uiLanguage: 'ja' }))
      expect(store.language()).toBe('ja')
      expect(store.messages().openDeck).toBe('デッキを開く…')
    })
  })

  test('spec: Given a saved choice, when the window starts on an OS in the other language, then the saved choice wins', () => {
    createRoot(() => {
      const store = createSettingsStore(['ja-JP'])
      store.applyLoaded(version({ uiLanguage: 'en' }))
      expect(store.language()).toBe('en')
    })
  })

  test('spec: Given the webview\'s guess of the OS language, when the OS\'s own answer arrives, then the UI follows the OS\'s answer', () => {
    createRoot(() => {
      const store = createSettingsStore(['en-US'])
      store.applySystemLocales(['ja-JP'])
      expect(store.language()).toBe('ja')
    })
  })

  test('adversarial: Given a chosen language, when the OS\'s answer arrives, then it doesn\'t override the choice', () => {
    createRoot(() => {
      const store = createSettingsStore(['en-US'])
      store.applyLoaded(version({ uiLanguage: 'en' }))
      store.applySystemLocales(['ja-JP'])
      expect(store.language()).toBe('en')
    })
  })

  test('adversarial: Given no OS languages at all, when the window starts, then the UI is English', () => {
    createRoot(() => {
      expect(createSettingsStore().language()).toBe('en')
      expect(createSettingsStore([]).language()).toBe('en')
      expect(createSettingsStore(['']).language()).toBe('en')
    })
  })
})
