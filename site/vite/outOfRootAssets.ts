// Vite's dev server only serves URLs under the site root. index.html
// references the brand assets as `../brand/x.svg` (the single source of
// truth at the repository root), which the browser resolves to `/brand/x.svg`
// — a path the dev server has nothing for, so the SPA fallback answers with
// index.html itself and every logo and icon renders broken. The production
// build is unaffected: it resolves the same references against the file
// system and copies them into `dist/assets` with hashed names.
//
// Vite exposes any file under `server.fs.allow` at `/@fs/<absolute path>`,
// so in dev the out-of-root references are rewritten to that endpoint.
import { posix } from 'node:path'

const OUT_OF_ROOT_URL = /(\s(?:src|href)=")(\.\.\/[^"]*)"/g

// Rewrites every `src`/`href` that climbs out of `htmlDir` (`../...`) into
// the `/@fs/` URL of the same file. `htmlDir` must be an absolute path with
// forward slashes (Vite's `normalizePath` form), which is what `/@fs/`
// expects on every platform, Windows included (`/@fs/C:/...`).
export function rewriteOutOfRootUrls(html: string, htmlDir: string): string {
  return html.replace(OUT_OF_ROOT_URL, (_, attr: string, relative: string) => {
    const absolute = posix.normalize(posix.join(htmlDir, relative))
    return `${attr}/@fs${absolute.startsWith('/') ? '' : '/'}${absolute}"`
  })
}
