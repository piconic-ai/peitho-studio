// Pure helpers for scripts/stage-app.ts, which assembles the directory
// Tauri bundles as `frontendDist`.

/**
 * Root-relative URLs (`/static/...`) an HTML page loads via `src`/`href`,
 * deduplicated in document order. Absolute (`https:`, `//host`) and
 * relative URLs are skipped: only root-relative ones depend on the staged
 * directory's layout. Query strings and fragments are dropped.
 */
export function rootRelativeRefs(html: string): string[] {
  const refs: string[] = []
  for (const match of html.matchAll(/(?<![\w-])(?:src|href)\s*=\s*(["'])(.*?)\1/g)) {
    const url = match[2]
    if (!url.startsWith('/') || url.startsWith('//')) continue
    const path = url.split(/[?#]/)[0]
    if (!refs.includes(path)) refs.push(path)
  }
  return refs
}
