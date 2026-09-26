// Assembles `dist/app/`, the directory Tauri bundles as `frontendDist`
// (see src-tauri/tauri.conf.json), from `bun run build`'s output.
//
// `bun run build` leaves the page at `dist/pages/index.html` and the
// stylesheets in `public/`; only server.ts's routing makes them reachable
// at `/` and `/static/*` in dev. A bundled app has no server: Tauri
// resolves each URL as a path under `frontendDist` (and looks for
// `index.html` at its root), so this copies everything to the path its
// URL names:
//
//   dist/pages/index.html -> dist/app/index.html
//   dist/assets/*         -> dist/app/static/assets/*
//   public/*              -> dist/app/static/*
//
// Then it fails the build if any root-relative URL in the page doesn't
// resolve, instead of the app showing "asset not found" at launch.
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rootRelativeRefs } from './appBundle'

const ROOT = resolve(import.meta.dir, '..')
const DIST = join(ROOT, 'dist')
const OUT = join(DIST, 'app')

rmSync(OUT, { recursive: true, force: true })
cpSync(join(DIST, 'pages', 'index.html'), join(OUT, 'index.html'))
cpSync(join(DIST, 'assets'), join(OUT, 'static', 'assets'), { recursive: true })
cpSync(join(ROOT, 'public'), join(OUT, 'static'), { recursive: true })

const missing = rootRelativeRefs(readFileSync(join(OUT, 'index.html'), 'utf8'))
  .filter(ref => !existsSync(join(OUT, ref)))
if (missing.length > 0) {
  console.error(`stage-app: index.html references files missing from ${OUT}:`)
  for (const ref of missing) console.error(`  ${ref}`)
  process.exit(1)
}
console.log(`stage-app: staged ${OUT}`)
