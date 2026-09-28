// Pure helpers for scripts/fetch-crit.ts, which downloads the pinned crit
// release (src-tauri/crit-release.json) into src-tauri/binaries/ for Tauri's
// `bundle.externalBin`.

/** src-tauri/crit-release.json: the one place the bundled crit version is
 * decided. `sha256` is keyed by Rust target triple and pinned here rather
 * than read from the release's `checksums.txt`, so a replaced release asset
 * fails the download instead of being trusted. */
export interface CritRelease {
  version: string
  repository: string
  sha256: Record<string, string>
}

/** crit's release asset for each Rust target triple Studio ships. */
const ASSET_BY_TARGET: Readonly<Record<string, string>> = {
  'aarch64-apple-darwin': 'crit-darwin-arm64',
  'x86_64-apple-darwin': 'crit-darwin-amd64',
}

/** The Rust target triples a crit binary can be fetched for. */
export const CRIT_TARGETS: readonly string[] = Object.keys(ASSET_BY_TARGET)

/** Validates crit-release.json's parsed content. Throws with the reason
 * when a field is missing or malformed. */
export function parseCritRelease(value: unknown): CritRelease {
  if (typeof value !== 'object' || value === null) throw new Error('crit-release.json: expected an object')
  const { version, repository, sha256 } = value as Record<string, unknown>
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`crit-release.json: "version" must look like 1.2.3, got ${JSON.stringify(version)}`)
  }
  if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error(`crit-release.json: "repository" must look like owner/name, got ${JSON.stringify(repository)}`)
  }
  if (typeof sha256 !== 'object' || sha256 === null) throw new Error('crit-release.json: "sha256" must be an object')
  const hashes: Record<string, string> = {}
  for (const target of CRIT_TARGETS) {
    const hash = (sha256 as Record<string, unknown>)[target]
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`crit-release.json: "sha256.${target}" must be 64 lowercase hex digits`)
    }
    hashes[target] = hash
  }
  return { version, repository, sha256: hashes }
}

/** The GitHub release download URL of `target`'s crit binary. */
export function critAssetUrl(release: CritRelease, target: string): string {
  const asset = ASSET_BY_TARGET[target]
  if (asset === undefined) throw new Error(`no crit binary for target ${JSON.stringify(target)}`)
  return `https://github.com/${release.repository}/releases/download/v${release.version}/${asset}`
}

/** Where Tauri's `bundle.externalBin: ["binaries/crit"]` looks for
 * `target`'s binary, relative to src-tauri/. */
export function critSidecarPath(target: string): string {
  if (ASSET_BY_TARGET[target] === undefined) throw new Error(`no crit binary for target ${JSON.stringify(target)}`)
  return `binaries/crit-${target}`
}
