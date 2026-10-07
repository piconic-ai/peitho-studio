// Release metadata is signed separately from the updater archive so that
// security notices and the announced version are authenticated too.
export interface SecurityAdvisory {
  affectedFrom: string
  fixedIn: string
  reason: string
}
export function makeUpdateManifest(version: string, signature: string, url: string, notes: string, security: SecurityAdvisory[] = []) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Only stable releases have update manifests')
  if (!signature.trim()) throw new Error('Missing archive signature')
  const download = new URL(url)
  if (download.protocol !== 'https:' || download.hostname !== 'github.com' || !download.pathname.startsWith('/piconic-ai/peitho-studio/releases/download/')) {
    throw new Error('Unexpected update download URL')
  }
  // GitHub stores a release asset under a rewritten name when the uploaded
  // one has a space or other special character ("Peitho Studio.app.tar.gz"
  // became "Peitho.Studio.app.tar.gz"), so a URL built from the local file
  // name 404s. Only accept names GitHub keeps as they are.
  const asset = decodeURIComponent(download.pathname.split('/').at(-1) ?? '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset)) throw new Error(`Release asset name would be rewritten by GitHub: ${asset}`)
  for (const advisory of security) {
    if (typeof advisory.affectedFrom !== 'string' || typeof advisory.fixedIn !== 'string' || typeof advisory.reason !== 'string' || !advisory.reason.trim()) {
      throw new Error('Invalid security advisory')
    }
    // Version ordering is checked by the Rust client with SemVer.
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(advisory.affectedFrom) || !/^\d+\.\d+\.\d+$/.test(advisory.fixedIn)) {
      throw new Error('Invalid advisory version')
    }
    const compare = (a: string, b: string) => {
      const aa = a.split('-')[0].split('.').map(Number)
      const bb = b.split('-')[0].split('.').map(Number)
      for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]
      return a.includes('-') ? -1 : 0
    }
    if (compare(advisory.affectedFrom, advisory.fixedIn) >= 0 || compare(advisory.fixedIn, version) > 0) throw new Error('Invalid advisory range')
  }
  return {
    version, notes, security,
    platforms: { 'darwin-aarch64': { signature: signature.trim(), url } },
  }
}
