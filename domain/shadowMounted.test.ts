import { describe, expect, test } from 'bun:test'
import { nextShadowMountedBacklog, slideIdentity } from './shadowMounted'

describe('slideIdentity', () => {
  const keys = ['cover', 'body', 'wrap-up']

  test('spec: the index is the key\'s position in the manifest', () => {
    expect(slideIdentity('cover', keys)).toEqual({ key: 'cover', index: 0 })
    expect(slideIdentity('wrap-up', keys)).toEqual({ key: 'wrap-up', index: 2 })
  })

  test('adversarial: a key the manifest does not list gets index -1', () => {
    expect(slideIdentity('draft-slide', keys)).toEqual({ key: 'draft-slide', index: -1 })
  })

  test('adversarial: a missing key yields an empty key and index -1, even if the manifest has an empty key', () => {
    expect(slideIdentity(undefined, ['', 'a'])).toEqual({ key: '', index: -1 })
  })

  test('adversarial: an empty manifest gives every key index -1', () => {
    expect(slideIdentity('cover', [])).toEqual({ key: 'cover', index: -1 })
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
