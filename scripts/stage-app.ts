// Assembles `dist/app/`, the directory Tauri bundles as `frontendDist`
// (see src-tauri/tauri.conf.json), from `bun run build`'s output.
//
// `bun run build` leaves the pages at `dist/pages/*.html` and the
// stylesheets in `public/`; only server.ts's routing makes them reachable
// at `/` and `/static/*` in dev. A bundled app has no server: Tauri
// resolves each URL as a path under `frontendDist` (and looks for
// `index.html` at its root), so this copies everything to the path its
// URL names:
//
//   dist/pages/index.html -> dist/app/index.html
//   dist/pages/about.html -> dist/app/about.html (the About window)
//   dist/pages/update.html -> dist/app/update.html (the update window)
//   dist/assets/*         -> dist/app/static/assets/*
//   public/*              -> dist/app/static/*
//
// Then it fails the build if any root-relative URL in a page doesn't
// resolve, instead of the app showing "asset not found" at launch.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rootRelativeRefs } from './appBundle'

const ROOT = resolve(import.meta.dir, '..')
const DIST = join(ROOT, 'dist')
const OUT = join(DIST, 'app')

rmSync(OUT, { recursive: true, force: true })
const pages = readdirSync(join(DIST, 'pages')).filter(name => name.endsWith('.html'))
for (const page of pages) cpSync(join(DIST, 'pages', page), join(OUT, page))
cpSync(join(DIST, 'assets'), join(OUT, 'static', 'assets'), { recursive: true })
cpSync(join(ROOT, 'public'), join(OUT, 'static'), { recursive: true })

let failed = false
for (const page of pages) {
  const missing = rootRelativeRefs(readFileSync(join(OUT, page), 'utf8'))
    .filter(ref => !existsSync(join(OUT, ref)))
  if (missing.length === 0) continue
  failed = true
  console.error(`stage-app: ${page} references files missing from ${OUT}:`)
  for (const ref of missing) console.error(`  ${ref}`)
}
if (failed) process.exit(1)
console.log(`stage-app: staged ${OUT}`)
