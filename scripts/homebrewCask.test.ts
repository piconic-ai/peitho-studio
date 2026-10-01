import { expect, test } from 'bun:test'
import { updateHomebrewCask } from './homebrewCask'

const oldHash = 'a'.repeat(64)
const newHash = 'b'.repeat(64)
const cask = `cask "peitho-studio" do
  version "0.1.0-rc.7"
  sha256 "${oldHash}"

  auto_updates true
  depends_on arch: :arm64
  app "Peitho Studio.app"
end
`

test('spec: update RC and stable metadata, preserving installation settings', () => {
  for (const version of ['0.1.0-rc.8', '0.1.0', '1.0.0']) {
    const updated = updateHomebrewCask(cask, `v${version}`, newHash)
    expect(updated).toBe(cask.replace('0.1.0-rc.7', version).replace(oldHash, newHash))
    expect(updateHomebrewCask(updated, `v${version}`, newHash)).toBe(updated)
  }
})

test('adversarial: delayed releases cannot downgrade a newer RC or stable cask', () => {
  const rc10 = updateHomebrewCask(cask, 'v0.1.0-rc.10', newHash)
  expect(updateHomebrewCask(rc10, 'v0.1.0-rc.9', oldHash)).toBe(rc10)
  const stable = updateHomebrewCask(cask, 'v0.1.0', newHash)
  expect(updateHomebrewCask(stable, 'v0.1.0-rc.8', oldHash)).toBe(stable)
})

test('spec: rebuilding the same version updates its checksum', () => {
  expect(updateHomebrewCask(cask, 'v0.1.0-rc.7', newHash)).toBe(cask.replace(oldHash, newHash))
})

test('adversarial: invalid versions, checksums and unexpected casks fail', () => {
  for (const tag of ['', 'latest', 'v1.0', 'v01.0.0', 'v1.0.0-01', 'v1.0.0"\napp "Bad.app']) {
    expect(() => updateHomebrewCask(cask, tag, newHash)).toThrow()
  }
  for (const hash of ['', 'b'.repeat(63), 'z'.repeat(64), `${newHash}\n`]) {
    expect(() => updateHomebrewCask(cask, 'v1.0.0', hash)).toThrow()
  }
  for (const invalid of ['', cask.replace('peitho-studio', 'pedit'), cask.replace('  version', '  # version'),
    cask.replace(oldHash, ':no_check'), cask + '  version "1.0.0"\n', cask + `  sha256 "${oldHash}"\n`]) {
    expect(() => updateHomebrewCask(invalid, 'v1.0.0', newHash)).toThrow()
  }
})
