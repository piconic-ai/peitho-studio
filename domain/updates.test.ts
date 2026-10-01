import { describe, expect, test } from 'bun:test'
import { initialUpdateStatus, parseUpdateStatus, showUpdateNotice, updateBlocksEditing, updateBusy, canPrepareUpdate, updateStatusText } from './updates'

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
