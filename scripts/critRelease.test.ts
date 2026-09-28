import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CRIT_TARGETS, critAssetUrl, critSidecarPath, parseCritRelease } from './critRelease'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const valid = {
  version: '0.21.0',
  repository: 'tomasz-tomczyk/crit',
  sha256: { 'aarch64-apple-darwin': HASH_A, 'x86_64-apple-darwin': HASH_B },
}

describe('the pinned crit release', () => {
  test('Given the checked-in crit-release.json, When it is read, Then it pins a version and a hash for every macOS target', () => {
    const path = join(resolve(import.meta.dir, '..'), 'src-tauri', 'crit-release.json')
    const release = parseCritRelease(JSON.parse(readFileSync(path, 'utf8')))
    expect(release.version).toMatch(/^\d+\.\d+\.\d+$/)
    for (const target of CRIT_TARGETS) expect(release.sha256[target]).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('parseCritRelease', () => {
  test('Given a well-formed pin, When it is parsed, Then its version, repository and hashes come back as written', () => {
    expect(parseCritRelease(valid)).toEqual(valid)
  })

  test('Given a pin with a hash for an extra target, When it is parsed, Then only the shipped targets are kept', () => {
    const release = parseCritRelease({ ...valid, sha256: { ...valid.sha256, 'x86_64-pc-windows-msvc': HASH_A } })
    expect(Object.keys(release.sha256).sort()).toEqual([...CRIT_TARGETS].sort())
  })

  test.each([
    ['null', null],
    ['a string', 'x'],
    ['no version', { ...valid, version: undefined }],
    ['a version with a leading v', { ...valid, version: 'v0.21.0' }],
    ['an empty version', { ...valid, version: '' }],
    ['a repository without an owner', { ...valid, repository: 'crit' }],
    ['a repository with a path traversal', { ...valid, repository: '../x/y' }],
    ['no sha256', { ...valid, sha256: undefined }],
    ['a missing target hash', { ...valid, sha256: { 'aarch64-apple-darwin': HASH_A } }],
    ['an uppercase hash', { ...valid, sha256: { ...valid.sha256, 'aarch64-apple-darwin': 'A'.repeat(64) } }],
    ['a short hash', { ...valid, sha256: { ...valid.sha256, 'aarch64-apple-darwin': 'a'.repeat(63) } }],
  ])('Given %s, When it is parsed, Then it is rejected', (_label, value) => {
    expect(() => parseCritRelease(value)).toThrow()
  })
})

describe('critAssetUrl', () => {
  test('Given the Apple Silicon target, When its URL is built, Then it points at the darwin-arm64 asset of that release tag', () => {
    expect(critAssetUrl(valid, 'aarch64-apple-darwin'))
      .toBe('https://github.com/tomasz-tomczyk/crit/releases/download/v0.21.0/crit-darwin-arm64')
  })

  test('Given the Intel target, When its URL is built, Then it points at the darwin-amd64 asset', () => {
    expect(critAssetUrl(valid, 'x86_64-apple-darwin')).toEndWith('/v0.21.0/crit-darwin-amd64')
  })

  test.each(['', 'x86_64-unknown-linux-gnu', 'aarch64-apple-darwin '])('Given the unsupported target %p, When its URL is built, Then it throws', target => {
    expect(() => critAssetUrl(valid, target)).toThrow()
  })
})

describe('critSidecarPath', () => {
  test('Given a shipped target, When its sidecar path is built, Then it is binaries/crit-<triple>, the name bundle.externalBin expects', () => {
    expect(critSidecarPath('aarch64-apple-darwin')).toBe('binaries/crit-aarch64-apple-darwin')
  })

  test.each(['', 'wasm32-unknown-unknown'])('Given the unsupported target %p, When its sidecar path is built, Then it throws', target => {
    expect(() => critSidecarPath(target)).toThrow()
  })
})
