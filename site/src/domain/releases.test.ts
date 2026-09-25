import { describe, expect, test } from 'bun:test'
import {
  classifyAsset,
  detectArch,
  detectPlatform,
  formatSize,
  groupByPlatform,
  recommendedAssets,
  type ReleaseAsset,
} from './releases'

const asset = (name: string, size = 1024 * 1024): ReleaseAsset => ({
  name,
  browser_download_url: `https://example.invalid/${name}`,
  size,
})

const TAURI_ASSETS = [
  asset('Peitho.Studio_0.1.0_aarch64.dmg'),
  asset('Peitho.Studio_0.1.0_x64.dmg'),
  asset('Peitho.Studio_aarch64.app.tar.gz'),
  asset('Peitho.Studio_aarch64.app.tar.gz.sig'),
  asset('Peitho.Studio_0.1.0_x64_en-US.msi'),
  asset('Peitho.Studio_0.1.0_x64-setup.exe'),
  asset('peitho-studio_0.1.0_amd64.AppImage'),
  asset('peitho-studio_0.1.0_amd64.deb'),
  asset('peitho-studio-0.1.0-1.x86_64.rpm'),
  asset('latest.json'),
]

describe('detectPlatform', () => {
  test('Given a macOS Safari UA, When detected, Then macos', () => {
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toBe('macos')
  })
  test('Given a Windows Chrome UA, When detected, Then windows', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36')).toBe('windows')
  })
  test('Given a Linux Firefox UA, When detected, Then linux', () => {
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe('linux')
  })
  test('Given an iPhone UA (which says "like Mac OS X"), When detected, Then unknown, not macos', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('unknown')
  })
  test('Given an Android UA (which says "Linux"), When detected, Then unknown, not linux', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe('unknown')
  })
  test('Given an empty UA, When detected, Then unknown', () => {
    expect(detectPlatform('')).toBe('unknown')
  })
})

describe('detectArch', () => {
  test('Chromium client hints: arm + 64 → arm64, x86 + 64 → x64', () => {
    expect(detectArch('arm', '64')).toBe('arm64')
    expect(detectArch('x86', '64')).toBe('x64')
  })
  test('32-bit x86 is not x64', () => {
    expect(detectArch('x86', '32')).toBe('unknown')
  })
  test('missing hints (Safari, Firefox) → unknown', () => {
    expect(detectArch(undefined, undefined)).toBe('unknown')
    expect(detectArch('', '')).toBe('unknown')
  })
})

describe('classifyAsset', () => {
  test('Tauri bundle names classify to their platform, arch and kind', () => {
    expect(classifyAsset(asset('Peitho.Studio_0.1.0_aarch64.dmg'))).toMatchObject({ platform: 'macos', arch: 'arm64', kind: 'dmg' })
    expect(classifyAsset(asset('Peitho.Studio_0.1.0_x64_en-US.msi'))).toMatchObject({ platform: 'windows', arch: 'x64', kind: 'msi' })
    expect(classifyAsset(asset('peitho-studio_0.1.0_amd64.AppImage'))).toMatchObject({ platform: 'linux', arch: 'x64', kind: 'AppImage' })
    expect(classifyAsset(asset('Peitho.Studio_0.1.0_universal.dmg'))).toMatchObject({ platform: 'macos', arch: 'universal' })
  })
  test('signatures, updater manifests and unknown extensions are not downloads', () => {
    expect(classifyAsset(asset('Peitho.Studio_aarch64.app.tar.gz.sig'))).toBeNull()
    expect(classifyAsset(asset('latest.json'))).toBeNull()
    expect(classifyAsset(asset('README'))).toBeNull()
    expect(classifyAsset(asset(''))).toBeNull()
  })
  test('extension matching is case-insensitive and needs the full suffix', () => {
    expect(classifyAsset(asset('Setup.EXE'))?.platform).toBe('windows')
    expect(classifyAsset(asset('notes-about-dmg.txt'))).toBeNull()
  })
  test('an asset with no arch in its name is arch unknown, still listed', () => {
    expect(classifyAsset(asset('Peitho.Studio.dmg'))).toMatchObject({ platform: 'macos', arch: 'unknown' })
  })
})

describe('groupByPlatform', () => {
  test('groups in macOS → Windows → Linux order and drops non-downloads', () => {
    const groups = groupByPlatform(TAURI_ASSETS)
    expect(groups.map((g) => g.platform)).toEqual(['macos', 'windows', 'linux'])
    expect(groups[0].assets.map((a) => a.asset.name)).toEqual([
      'Peitho.Studio_0.1.0_aarch64.dmg',
      'Peitho.Studio_0.1.0_x64.dmg',
      'Peitho.Studio_aarch64.app.tar.gz',
    ])
  })
  test('platforms with no asset are omitted; empty input gives no groups', () => {
    expect(groupByPlatform([asset('a.msi')]).map((g) => g.platform)).toEqual(['windows'])
    expect(groupByPlatform([])).toEqual([])
  })
})

describe('recommendedAssets', () => {
  test('Given macOS with known arm64, Then the arm64 dmg alone', () => {
    const picks = recommendedAssets(TAURI_ASSETS, 'macos', 'arm64')
    expect(picks.map((p) => p.asset.name)).toEqual(['Peitho.Studio_0.1.0_aarch64.dmg'])
  })
  test('Given macOS with unknown arch (Safari), Then one dmg per arch, ARM first', () => {
    const picks = recommendedAssets(TAURI_ASSETS, 'macos', 'unknown')
    expect(picks.map((p) => p.asset.name)).toEqual(['Peitho.Studio_0.1.0_aarch64.dmg', 'Peitho.Studio_0.1.0_x64.dmg'])
  })
  test('Given a universal build, Then it wins even when the arch is known', () => {
    const assets = [asset('Peitho.Studio_0.1.0_universal.dmg'), asset('Peitho.Studio_0.1.0_aarch64.dmg')]
    expect(recommendedAssets(assets, 'macos', 'arm64').map((p) => p.asset.name)).toEqual(['Peitho.Studio_0.1.0_universal.dmg'])
  })
  test('Given Windows, Then the msi is preferred over the setup exe', () => {
    expect(recommendedAssets(TAURI_ASSETS, 'windows', 'x64').map((p) => p.kind)).toEqual(['msi'])
  })
  test('Given Linux, Then the AppImage is preferred', () => {
    expect(recommendedAssets(TAURI_ASSETS, 'linux', 'x64').map((p) => p.kind)).toEqual(['AppImage'])
  })
  test('Given a known arch with no matching build, Then fall back to what exists', () => {
    const assets = [asset('Peitho.Studio_0.1.0_x64.dmg')]
    expect(recommendedAssets(assets, 'macos', 'arm64').map((p) => p.asset.name)).toEqual(['Peitho.Studio_0.1.0_x64.dmg'])
  })
  test('Given an unknown platform or no assets for it, Then nothing is recommended', () => {
    expect(recommendedAssets(TAURI_ASSETS, 'unknown', 'x64')).toEqual([])
    expect(recommendedAssets([asset('a.msi')], 'macos', 'arm64')).toEqual([])
    expect(recommendedAssets([], 'linux', 'x64')).toEqual([])
  })
})

describe('formatSize', () => {
  test('formats KB below a MB and MB with one decimal above', () => {
    expect(formatSize(512)).toBe('1 KB')
    expect(formatSize(300 * 1024)).toBe('300 KB')
    expect(formatSize(12.34 * 1024 * 1024)).toBe('12.3 MB')
  })
  test('negative, NaN and Infinity sizes render as empty', () => {
    expect(formatSize(-1)).toBe('')
    expect(formatSize(Number.NaN)).toBe('')
    expect(formatSize(Number.POSITIVE_INFINITY)).toBe('')
  })
})
