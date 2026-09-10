// Transforms applied to a deck theme's compiled CSS (`RenderPayload.css`)
// before it's handed to a slide's Shadow DOM style sheet — see
// `dom/slideCanvas.ts`. A Shadow root has no `<base href>` of its own, so
// any relative `url(...)` needs absolutizing by hand, and `:root` (where a
// theme defines CSS custom properties) resolves to the *document* root,
// not the shadow host, so it never matches inside a shadow tree.

const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'"()]*)\1\s*\)/g
const FONT_FACE_RULE_PATTERN = /@font-face\s*\{[^}]*\}/g

function isAbsoluteOrProtocolRelative(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')
}

/** Rewrites every relative `url(...)` in `css` against `baseUrl`. An empty,
 * data:, or already-absolute URL is left untouched. `baseUrl` empty (no
 * asset server resolved yet) is a no-op — there's nothing to resolve
 * against. */
export function absolutizeCssUrls(css: string, baseUrl: string): string {
  if (!baseUrl) return css
  return css.replace(CSS_URL_PATTERN, (match, quote: string, path: string) => {
    if (path === '' || isAbsoluteOrProtocolRelative(path)) return match
    return `url(${quote}${new URL(path, baseUrl).href}${quote})`
  })
}

/** Splits `@font-face` rules out of `css` — `dom/slideCanvas.ts` hoists
 * these into a shared `<style>` in `<head>` instead of the per-slide
 * Shadow root's style sheet (WKWebView font registration inside a shadow
 * tree is unconfirmed; see `todo/thumbnail-iframe-removal.md`). Assumes
 * `@font-face` bodies never nest braces, true of CSS syntax generally. */
export function splitFontFaceRules(css: string): { fontFaces: string; rest: string } {
  const fontFaces = css.match(FONT_FACE_RULE_PATTERN) ?? []
  const rest = css.replace(FONT_FACE_RULE_PATTERN, '')
  return { fontFaces: fontFaces.join('\n'), rest }
}

/** Rewrites `:root` to `:host` so a theme's custom-property declarations
 * (e.g. `:root { --peitho-canvas-width: ... }`) still reach `.peitho-slide`
 * once that CSS is scoped to a Shadow root, where `:root` itself would
 * otherwise match the *document* root instead. */
export function scopeRootToHost(css: string): string {
  return css.replace(/:root\b/g, ':host')
}
