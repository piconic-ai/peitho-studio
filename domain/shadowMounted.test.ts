import { describe, expect, test } from 'bun:test'
import { nextShadowMountedBacklog, slideIdentity } from './shadowMounted'

describe('slideIdentity', () => {
  test('spec: the key and index peitho writes on .peitho-slide are read as-is', () => {
    expect(slideIdentity('cover', '0')).toEqual({ key: 'cover', index: 0 })
    expect(slideIdentity('wrap-up', '12')).toEqual({ key: 'wrap-up', index: 12 })
  })

  test('adversarial: missing attributes yield an empty key and index -1', () => {
    expect(slideIdentity(undefined, undefined)).toEqual({ key: '', index: -1 })
  })

  test('adversarial: an empty key is kept, not replaced', () => {
    expect(slideIdentity('', '3')).toEqual({ key: '', index: 3 })
  })

  test('adversarial: a non-integer index is -1, never NaN', () => {
    for (const raw of ['', 'abc', '-1', '1.5', ' 2', '2 ', '1e3']) {
      expect(slideIdentity('k', raw).index).toBe(-1)
    }
  })
})

describe('nextShadowMountedBacklog', () => {
  const live = new Set(['a', 'b', 'c'])
  const isConnected = (root: string) => live.has(root)

  test('spec: a newly mounted root is appended after the existing entries', () => {
    const backlog = [{ root: 'a', key: 'a', index: 0 }]
    expect(nextShadowMountedBacklog(backlog, { root: 'b', key: 'b', index: 1 }, isConnected))
      .toEqual([{ root: 'a', key: 'a', index: 0 }, { root: 'b', key: 'b', index: 1 }])
  })

  test('spec: re-announcing the same root replaces its earlier entry', () => {
    const backlog = [{ root: 'a', key: 'a', index: 0 }, { root: 'b', key: 'b', index: 1 }]
    expect(nextShadowMountedBacklog(backlog, { root: 'a', key: 'a2', index: 0 }, isConnected))
      .toEqual([{ root: 'b', key: 'b', index: 1 }, { root: 'a', key: 'a2', index: 0 }])
  })

  test('adversarial: disconnected roots are dropped', () => {
    const backlog = [{ root: 'gone', key: 'x', index: 0 }, { root: 'a', key: 'a', index: 1 }]
    expect(nextShadowMountedBacklog(backlog, { root: 'b', key: 'b', index: 2 }, isConnected))
      .toEqual([{ root: 'a', key: 'a', index: 1 }, { root: 'b', key: 'b', index: 2 }])
  })

  test('adversarial: the announced root is kept even if not reported connected yet', () => {
    expect(nextShadowMountedBacklog([], { root: 'detached', key: 'k', index: 0 }, isConnected))
      .toEqual([{ root: 'detached', key: 'k', index: 0 }])
  })

  test('adversarial: the input backlog is not mutated', () => {
    const backlog = [{ root: 'gone', key: 'x', index: 0 }]
    nextShadowMountedBacklog(backlog, { root: 'a', key: 'a', index: 0 }, isConnected)
    expect(backlog).toEqual([{ root: 'gone', key: 'x', index: 0 }])
  })
})
