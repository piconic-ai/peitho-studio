import { describe, expect, test } from 'bun:test'
import { createRoot } from '@barefootjs/client'
import { createSettingsStore } from './settingsStore'
import type { Settings } from '../domain/settings'

// `Settings` has no fields yet, so each test tells settings apart by
// object identity: a distinct object stands for each saved version.
function version(): Settings {
  return {}
}

describe('settings store', () => {
  test('spec: Given a new window, when nothing has loaded yet, then the settings are the defaults and the panel is closed', () => {
    createRoot(() => {
      const store = createSettingsStore()
      expect(store.settings()).toEqual({})
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
      const saved = version()
      store.applyLoaded(saved)
      expect(store.settings()).toBe(saved)
    })
  })

  test('spec: Given another window saves a change, when this window hears it, then this window uses the new settings', () => {
    createRoot(() => {
      const store = createSettingsStore()
      store.applyLoaded(version())
      const changed = version()
      store.applyChanged(changed)
      expect(store.settings()).toBe(changed)
    })
  })

  test('adversarial: Given a change heard before a slow launch-time read answers, when the read answers, then the newer change is kept', () => {
    createRoot(() => {
      const store = createSettingsStore()
      const changed = version()
      store.applyChanged(changed)
      store.applyLoaded(version())
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
})
