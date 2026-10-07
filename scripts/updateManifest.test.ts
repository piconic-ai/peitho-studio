import { expect, test } from 'bun:test'
import { makeUpdateManifest } from './updateManifest'
const url = 'https://github.com/piconic-ai/peitho-studio/releases/download/v1.1.0/Peitho.app.tar.gz'
test('spec: stable metadata includes signed archive and affected versions', () => {
  const security = [{ affectedFrom: '0.1.0-rc.1', fixedIn: '1.1.0', reason: 'Unsafe previews' }]
  const manifest = makeUpdateManifest('1.1.0', 'sig\n', url, 'Release notes', security)
  expect(manifest.security).toEqual(security)
  expect(manifest.platforms['darwin-aarch64'].signature).toBe('sig')
})
test('adversarial: prereleases, unsafe URLs, missing signatures and invalid ranges fail publication', () => {
  expect(() => makeUpdateManifest('1.1.0-rc.1', 'sig', url, '')).toThrow()
  expect(() => makeUpdateManifest('1.1.0', '', url, '')).toThrow()
  expect(() => makeUpdateManifest('1.1.0', 'sig', 'http://example.com/app', '')).toThrow()
  for (const fixedIn of ['0.1.0', '2.0.0', 'bad']) {
    expect(() => makeUpdateManifest('1.1.0', 'sig', url, '', [{ affectedFrom: '0.1.0', fixedIn, reason: 'x' }])).toThrow()
  }
})
test('spec: an asset name GitHub stores unchanged is accepted as the download URL', () => {
  const manifest = makeUpdateManifest('1.1.0', 'sig', 'https://github.com/piconic-ai/peitho-studio/releases/download/v1.1.0/Peitho-Studio_1.1.0_aarch64.app.tar.gz', '')
  expect(manifest.platforms['darwin-aarch64'].url).toEndWith('/Peitho-Studio_1.1.0_aarch64.app.tar.gz')
})
test('adversarial: an asset name GitHub would rewrite is rejected before it is published', () => {
  const base = 'https://github.com/piconic-ai/peitho-studio/releases/download/v1.1.0/'
  // The v0.1.4/v0.1.5 manifests pointed at this name, which GitHub had stored as Peitho.Studio.app.tar.gz.
  expect(() => makeUpdateManifest('1.1.0', 'sig', base + 'Peitho%20Studio.app.tar.gz', '')).toThrow(/rewritten/)
  for (const name of ['Peitho Studio.app.tar.gz', 'Peitho+Studio.app.tar.gz', 'Peitho%2FStudio.tar.gz', '.hidden.tar.gz', '', 'ペイト.tar.gz']) {
    expect(() => makeUpdateManifest('1.1.0', 'sig', base + name, '')).toThrow()
  }
})
