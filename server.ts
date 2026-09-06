// Tiny `node:http` server for the CSR starter:
//   - HTML pages from `./dist/pages/<name>.html` (`/` → index.html) —
//     vite's own build output, NOT the `pages/` source dir: the source
//     page's inline `<script type="module">` imports `Counter.tsx`
//     directly and `@barefootjs/client/runtime` by bare specifier —
//     both need `vite build`'s own HTML processing to become real,
//     resolvable, hashed asset references (see vite.config.ts).
//   - Everything else under `/static/` — vite's own hashed JS bundles
//     (`dist/assets/*`) AND the handwritten stylesheets (`public/*`),
//     tried in that order so the two never collide by filename.
//
// Plain `node:http` + `node:fs` so the starter runs on any JS runtime
// (Node via `tsx`, Bun, Deno) — no runtime is forced on you. No backend
// logic, no API. Replace with Hono / Express / Fastify / etc. when the
// app outgrows static-pages-plus-API.

import { createServer, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = resolve(ROOT, 'dist')
const PAGES_DIR = resolve(DIST_DIR, 'pages')
const PUBLIC_DIR = resolve(ROOT, 'public')

const port = Number(process.env.PORT ?? 3003)

const server = createServer(async (req, res) => {
  let path: string
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0])
  } catch {
    // Malformed percent-encoding (e.g. `/%%`) — answer 400 instead of
    // letting the decode throw take down the dev server.
    res.writeHead(400).end('Bad Request')
    return
  }

  if (path.startsWith('/static/')) {
    const rel = path.slice('/static/'.length)
    if (isTraversal(rel)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    // vite's hashed bundle output first (dist/assets/*.js, matching
    // vite.config.ts's `base: '/static/'`), then the handwritten
    // stylesheets in public/ — the two never share a filename, so this
    // fallback chain never masks one with the other.
    if (await serveFromDir(res, DIST_DIR, rel, { onMiss: 'fallthrough' })) return
    await serveFromDir(res, PUBLIC_DIR, rel, { onMiss: 'notFound' })
    return
  }

  const pageName = path === '/' ? 'index' : path.slice(1).replace(/\/$/, '')
  const rel = `${pageName}.html`
  if (isTraversal(rel)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  await serveFromDir(res, PAGES_DIR, rel, { onMiss: 'notFound' })
})

// Defense-in-depth path traversal guard. Compare via relative() so it
// holds on Windows (`\` separators) too — a literal `dir + '/'` prefix
// check would 403 every request there. Checked once against `rel`
// itself (not per candidate dir): the traversal outcome depends only
// on `rel`'s own `..` segments, not on which directory it's resolved
// against.
function isTraversal(rel: string): boolean {
  const target = resolve(DIST_DIR, rel)
  const rel2 = relative(DIST_DIR, target)
  return rel2 === '..' || rel2.startsWith('..' + sep) || isAbsolute(rel2)
}

async function serveFromDir(
  res: ServerResponse,
  dir: string,
  rel: string,
  opts: { onMiss: 'notFound' | 'fallthrough' },
): Promise<boolean> {
  const target = resolve(dir, rel)
  try {
    const body = await readFile(target)
    res.writeHead(200, { 'Content-Type': contentTypeFor(target) }).end(body)
    return true
  } catch (err) {
    // Missing path → 404 (unless a fallback dir still gets a turn);
    // anything else (permissions, IO) → 500, so real problems surface
    // in development instead of masquerading as 404s.
    const code = (err as { code?: string }).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      if (opts.onMiss === 'notFound') res.writeHead(404).end('Not Found')
      return false
    }
    res.writeHead(500).end('Internal Server Error')
    return true
  }
}

function contentTypeFor(path: string): string {
  const ext = path.split('.').pop() ?? ''
  switch (ext) {
    case 'html': return 'text/html; charset=utf-8'
    case 'js':   return 'application/javascript; charset=utf-8'
    case 'css':  return 'text/css; charset=utf-8'
    case 'json': return 'application/json; charset=utf-8'
    case 'svg':  return 'image/svg+xml'
    case 'png':  return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    default:     return 'application/octet-stream'
  }
}

server.listen(port, () => {
  console.log(`  ➜ http://localhost:${port}`)
})
