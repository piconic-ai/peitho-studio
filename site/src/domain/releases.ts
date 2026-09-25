// Pure logic behind the download panel: which platform the visitor is on,
// which platform/architecture each GitHub release asset is for, and which
// asset(s) to put on the big button. No `fetch`, no `navigator` — the
// component passes their values in, so every rule here runs under
// `bun test`.

export type Platform = 'macos' | 'windows' | 'linux' | 'unknown'
export type Arch = 'arm64' | 'x64' | 'universal' | 'unknown'

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface ClassifiedAsset {
  asset: ReleaseAsset
  platform: Platform
  arch: Arch
  /** The file kind shown next to the name, e.g. `dmg`, `msi`, `AppImage`. */
  kind: string
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  unknown: 'your platform',
}

export const ARCH_LABEL: Record<Arch, string> = {
  arm64: 'Apple Silicon / ARM64',
  x64: 'Intel / x64',
  universal: 'Universal',
  unknown: '',
}

/** Platform from the browser's user-agent string (case-insensitive). */
export function detectPlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase()
  // iPhone/iPad UAs contain "like Mac OS X"; they get no desktop build.
  if (/iphone|ipad|ipod|android/.test(ua)) return 'unknown'
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos'
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('linux') || ua.includes('x11')) return 'linux'
  return 'unknown'
}

/**
 * Architecture from the UA Client Hints values (Chromium only). Safari and
 * Firefox don't expose them, so callers must cope with `unknown`.
 */
export function detectArch(architecture: string | undefined, bitness: string | undefined): Arch {
  const arch = (architecture ?? '').toLowerCase()
  if (arch === 'arm' && bitness === '64') return 'arm64'
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64'
  if (arch === 'x86' && bitness === '64') return 'x64'
  if (arch === 'x86_64' || arch === 'amd64' || arch === 'x64') return 'x64'
  return 'unknown'
}

// Tauri's bundler names assets like `Peitho.Studio_0.1.0_aarch64.dmg`,
// `peitho-studio_0.1.0_amd64.AppImage`, `Peitho.Studio_0.1.0_x64-setup.exe`.
// Signatures (`.sig`) and updater manifests (`latest.json`) are not
// downloads a visitor wants, so they classify to `null`.
const KINDS: Array<{ suffix: string; platform: Platform; kind: string }> = [
  { suffix: '.dmg', platform: 'macos', kind: 'dmg' },
  { suffix: '.app.tar.gz', platform: 'macos', kind: 'app.tar.gz' },
  { suffix: '.msi', platform: 'windows', kind: 'msi' },
  { suffix: '.exe', platform: 'windows', kind: 'exe' },
  { suffix: '.appimage', platform: 'linux', kind: 'AppImage' },
  { suffix: '.deb', platform: 'linux', kind: 'deb' },
  { suffix: '.rpm', platform: 'linux', kind: 'rpm' },
]

export function classifyAsset(asset: ReleaseAsset): ClassifiedAsset | null {
  const lower = asset.name.toLowerCase()
  const match = KINDS.find((k) => lower.endsWith(k.suffix))
  if (!match) return null
  return { asset, platform: match.platform, arch: archFromName(lower), kind: match.kind }
}

function archFromName(lowerName: string): Arch {
  if (lowerName.includes('universal')) return 'universal'
  if (/aarch64|arm64/.test(lowerName)) return 'arm64'
  if (/x86_64|amd64|x64/.test(lowerName)) return 'x64'
  return 'unknown'
}

/** Every downloadable asset, grouped by platform in display order. */
export function groupByPlatform(assets: ReleaseAsset[]): Array<{ platform: Platform; assets: ClassifiedAsset[] }> {
  const classified = assets.map(classifyAsset).filter((c): c is ClassifiedAsset => c !== null)
  const order: Platform[] = ['macos', 'windows', 'linux']
  return order
    .map((platform) => ({ platform, assets: classified.filter((c) => c.platform === platform) }))
    .filter((group) => group.assets.length > 0)
}

/**
 * The asset(s) for the primary button. One when the architecture is known
 * or a universal build exists; on macOS with an unknown architecture both
 * the ARM64 and x64 builds, side by side, since Safari can't tell us which
 * chip the visitor has. Empty when nothing fits the visitor's platform.
 */
export function recommendedAssets(assets: ReleaseAsset[], platform: Platform, arch: Arch): ClassifiedAsset[] {
  if (platform === 'unknown') return []
  const mine = groupByPlatform(assets).find((g) => g.platform === platform)?.assets ?? []
  if (mine.length === 0) return []

  // One installer per (arch), preferring the platform's friendliest kind.
  const preferredKind: Record<Platform, string[]> = {
    macos: ['dmg', 'app.tar.gz'],
    windows: ['msi', 'exe'],
    linux: ['AppImage', 'deb', 'rpm'],
    unknown: [],
  }
  const byPreference = (list: ClassifiedAsset[]) =>
    [...list].sort((a, b) => preferredKind[platform].indexOf(a.kind) - preferredKind[platform].indexOf(b.kind))

  const universal = byPreference(mine.filter((c) => c.arch === 'universal'))
  if (universal.length > 0) return [universal[0]]

  if (arch === 'arm64' || arch === 'x64') {
    const exact = byPreference(mine.filter((c) => c.arch === arch))
    if (exact.length > 0) return [exact[0]]
  }

  // Architecture unknown (or nothing built for it): offer one per arch.
  const picks: ClassifiedAsset[] = []
  for (const a of ['arm64', 'x64', 'unknown'] as const) {
    const first = byPreference(mine.filter((c) => c.arch === a))[0]
    if (first) picks.push(first)
  }
  return picks
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
