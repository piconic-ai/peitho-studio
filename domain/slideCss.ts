// Transforms applied to a deck theme's compiled CSS (`RenderPayload.css`)
// before it's handed to a slide's Shadow DOM style sheet — see
// `dom/slideCanvas.ts`. A Shadow root has no `<base href>` of its own, so
// any relative `url(...)` needs absolutizing by hand, and `:root` (where a
// theme defines CSS custom properties) resolves to the *document* root,
// not the shadow host, so it never matches inside a shadow tree.

// At-rules, functions and pseudo-classes are ASCII case-insensitive in CSS,
// and a deck's own theme files are concatenated into `RenderPayload.css`
// verbatim (`build_theme_css`) — so `URL(`/`@FONT-FACE`/`:ROOT` are all
// reachable inputs, hence the `i` flags.
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'"()]*)\1\s*\)/gi
const FONT_FACE_RULE_PATTERN = /@font-face\s*\{[^}]*\}/gi
const ROOT_SELECTOR_PATTERN = /:root\b/gi

// A scheme (`data:`, `https:`), a scheme-relative `//host/…`, or a
// same-document `#id` (SVG `filter: url(#blur)`) must survive untouched:
// resolving one against the asset server would repoint it somewhere real.
const NON_RELATIVE_URL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

/** An empty `baseUrl` (no asset server resolved yet) is a no-op — there's
 * nothing to resolve against, and `new URL` would throw on it. */
export function absolutizeCssUrls(css: string, baseUrl: string): string {
  if (!baseUrl) return css
  return css.replace(CSS_URL_PATTERN, (match, quote: string, path: string) =>
    path === '' || NON_RELATIVE_URL_PATTERN.test(path)
      ? match
      : `url(${quote}${new URL(path, baseUrl).href}${quote})`)
}

/** `dom/slideCanvas.ts` hoists the extracted rules into a shared `<style>`
 * in `<head>` instead of the per-slide Shadow root's style sheet (WKWebView
 * font registration inside a shadow tree is unconfirmed; see
 * `todo/thumbnail-iframe-removal.md`). Assumes `@font-face` bodies never
 * nest braces, true of CSS syntax generally. */
export function splitFontFaceRules(css: string): { fontFaces: string; rest: string } {
  const fontFaces = css.match(FONT_FACE_RULE_PATTERN) ?? []
  const rest = css.replace(FONT_FACE_RULE_PATTERN, '')
  return { fontFaces: fontFaces.join('\n'), rest }
}

export function scopeRootToHost(css: string): string {
  return css.replace(ROOT_SELECTOR_PATTERN, ':host')
}
