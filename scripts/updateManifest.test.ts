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
