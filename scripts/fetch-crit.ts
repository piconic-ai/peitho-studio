// Downloads the crit release pinned in src-tauri/crit-release.json into
// src-tauri/binaries/crit-<target-triple>, where Tauri's
// `bundle.externalBin: ["binaries/crit"]` picks it up (tauri-build copies it
// next to the app's executable on every `cargo build`, and `tauri build`
// puts it in `Peitho Studio.app/Contents/MacOS/crit`). The binaries aren't
// committed; run `bun run crit:fetch` once after cloning and after each
// version bump. Already-downloaded binaries whose hash matches are kept.
//
// Each download is checked against the hash pinned in crit-release.json and
// discarded on a mismatch.
//
// Usage: bun run scripts/fetch-crit.ts [target-triple ...]
//        (default: every target in CRIT_TARGETS)
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { CRIT_TARGETS, critAssetUrl, critSidecarPath, parseCritRelease } from './critRelease'

const SRC_TAURI = resolve(import.meta.dir, '..', 'src-tauri')
const release = parseCritRelease(JSON.parse(readFileSync(join(SRC_TAURI, 'crit-release.json'), 'utf8')))

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fetchTarget(target: string): Promise<void> {
  const dest = join(SRC_TAURI, critSidecarPath(target))
  const expected = release.sha256[target]
  if (existsSync(dest) && sha256(readFileSync(dest)) === expected) {
    console.log(`fetch-crit: ${critSidecarPath(target)} is already crit ${release.version}`)
    return
  }
  const url = critAssetUrl(release, target)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fetch-crit: GET ${url} failed: ${response.status} ${response.statusText}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actual = sha256(bytes)
  if (actual !== expected) {
    throw new Error(`fetch-crit: ${url} has sha256 ${actual}, but crit-release.json pins ${expected}`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  const partial = `${dest}.partial`
  writeFileSync(partial, bytes)
  chmodSync(partial, 0o755)
  renameSync(partial, dest)
  console.log(`fetch-crit: wrote ${critSidecarPath(target)} (crit ${release.version})`)
}

const targets = process.argv.slice(2)
for (const target of targets.length > 0 ? targets : CRIT_TARGETS) await fetchTarget(target)
