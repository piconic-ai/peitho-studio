import { describe, expect, test } from 'bun:test'
import { initialUpdateStatus, parseUpdateStatus, showUpdateNotice, updateBlocksEditing, updateBusy, canPrepareUpdate, updateStatusText, startUpdateCheck, failUpdateCommand, canRetryUpdate, updateNotes, showsReleasesLink, updateMessages, type UpdateStatus } from './updates'

describe('update status', () => {
  test('spec: security notifications remain visible and do not block editing', () => {
    const status = { ...initialUpdateStatus(), phase: 'available' as const, version: '1.1.0', security: 'Unsafe previews' }
    expect(showUpdateNotice(status)).toBe(true)
    expect(updateBlocksEditing(status)).toBe(false)
    expect(canPrepareUpdate(status)).toBe(true)
    expect(updateStatusText(status, 'ja')).toContain('セキュリティ')
  })
  test('spec: normal updates can be dismissed; applying waits for saves', () => {
    expect(showUpdateNotice({ ...initialUpdateStatus(), phase: 'available', dismissed: true })).toBe(false)
    for (const phase of ['saving', 'installing'] as const) {
      const status = { ...initialUpdateStatus(), phase }
      expect(updateBusy(status)).toBe(true)
      expect(updateBlocksEditing(status)).toBe(true)
      expect(canPrepareUpdate(status)).toBe(false)
    }
    expect(updateBlocksEditing({ ...initialUpdateStatus(), phase: 'error' })).toBe(false)
    expect(showUpdateNotice({ ...initialUpdateStatus(), phase: 'ready', dismissed: true, error: 'Save failed' })).toBe(true)
  })
  test('adversarial: malformed IPC cannot create busy states or invalid progress', () => {
    for (const value of [null, [], false, 'ready', 42]) expect(parseUpdateStatus(value)).toEqual(initialUpdateStatus())
    const status = parseUpdateStatus({ phase: 'bogus', downloaded: NaN, total: -1, security: {}, dismissed: 'true' })
    expect(status).toEqual(initialUpdateStatus())
    expect(updateStatusText({ ...initialUpdateStatus(), phase: 'downloading', downloaded: 200, total: 100 }, 'en')).toContain('100%')
  })
})

describe('the Check for Updates window', () => {
  const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({ ...initialUpdateStatus(), ...patch })

  test('spec: Given an idle, current or failed status, when the window starts a check, then it shows checking and drops the old error', () => {
    for (const phase of ['idle', 'current', 'available', 'error', 'unconfigured'] as const) {
      const started = startUpdateCheck(status({ phase, error: 'Offline' }))
      expect(started.phase).toBe('checking')
      expect(started.error).toBeNull()
    }
  })
  test('spec: Given a known new version, when the window starts a check, then the version stays shown', () => {
    expect(startUpdateCheck(status({ phase: 'available', version: '1.1.0' })).version).toBe('1.1.0')
  })
  test('adversarial: Given a download, quit-to-install or ready update, when the window starts a check, then that state is left as it is', () => {
    for (const phase of ['downloading', 'saving', 'installing', 'ready', 'checking'] as const) {
      const before = status({ phase, version: '1.1.0' })
      expect(startUpdateCheck(before)).toEqual(before)
    }
  })
  test('spec: Given the check command fails, when its error is shown, then the window is in the error state with that message', () => {
    expect(failUpdateCommand(status({ phase: 'checking', version: '1.1.0' }), 'Offline')).toEqual(status({ phase: 'error', version: '1.1.0', error: 'Offline' }))
  })
  test('adversarial: Given a non-string failure, when its error is shown, then it is turned into text', () => {
    expect(failUpdateCommand(status({}), new Error('boom')).error).toBe('Error: boom')
    expect(failUpdateCommand(status({}), undefined).error).toBe('undefined')
    expect(failUpdateCommand(status({}), '').error).toBe('')
  })
  test('spec: Given a failed check, when the window decides its buttons, then only that state offers Retry', () => {
    expect(canRetryUpdate(status({ phase: 'error' }))).toBe(true)
    for (const phase of ['idle', 'unconfigured', 'checking', 'current', 'available', 'downloading', 'ready', 'saving', 'installing'] as const) {
      expect(canRetryUpdate(status({ phase, error: 'leftover' }))).toBe(false)
    }
  })
  test('spec: Given a new version with notes, when the window shows it, then the notes are shown trimmed', () => {
    expect(updateNotes(status({ phase: 'available', version: '1.1.0', notes: '  - Faster previews\n' }))).toBe('- Faster previews')
  })
  test('adversarial: Given no new version, or blank or missing notes, when the window shows it, then there are no notes', () => {
    expect(updateNotes(status({ phase: 'current', notes: 'Stale notes' }))).toBeNull()
    expect(updateNotes(status({ phase: 'available', version: '1.1.0', notes: null }))).toBeNull()
    expect(updateNotes(status({ phase: 'available', version: '1.1.0', notes: '' }))).toBeNull()
    expect(updateNotes(status({ phase: 'available', version: '1.1.0', notes: ' \n\t' }))).toBeNull()
  })
  test('spec: Given a new version or a build without in-app updates, when the window decides its links, then it links to the releases', () => {
    expect(showsReleasesLink(status({ phase: 'available', version: '1.1.0' }))).toBe(true)
    expect(showsReleasesLink(status({ phase: 'unconfigured' }))).toBe(true)
  })
  test('adversarial: Given no new version in a configured build, when the window decides its links, then there is no releases link', () => {
    for (const phase of ['idle', 'checking', 'current', 'error'] as const) expect(showsReleasesLink(status({ phase }))).toBe(false)
  })
  test('spec: Given either language, when the window labels its buttons, then each has its own text', () => {
    for (const key of ['retry', 'openReleases', 'notes'] as const) {
      expect(updateMessages('en')[key]).not.toBe('')
      expect(updateMessages('ja')[key]).not.toBe(updateMessages('en')[key])
    }
  })
})
