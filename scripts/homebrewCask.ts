/** Update only release metadata, preserving the tap's installation policy. */
export function updateHomebrewCask(cask: string, tag: string, sha256: string): string {
  const version = tag.replace(/^v/, '')
  const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/
  if (!versionPattern.test(version)) throw new Error('Invalid release version')
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid DMG SHA-256')
  if (!/^cask "peitho-studio" do$/m.test(cask)) throw new Error('Unexpected cask')
  const versions = [...cask.matchAll(/^  version "([^"]+)"$/gm)]
  const checksums = [...cask.matchAll(/^  sha256 "[a-f0-9]{64}"$/gm)]
  if (versions.length !== 1 || checksums.length !== 1 || !versionPattern.test(versions[0][1])) {
    throw new Error('Expected exactly one version and SHA-256')
  }
  // A delayed release or manual retry must not roll the tap back.
  if (Bun.semver.order(version, versions[0][1]) < 0) return cask
  return cask
    .replace(/^  version "[^"]+"$/m, `  version "${version}"`)
    .replace(/^  sha256 "[a-f0-9]{64}"$/m, `  sha256 "${sha256}"`)
}
