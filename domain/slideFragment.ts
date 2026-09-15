// A slide fragment's only relative references are `<img src="assets/...">`
// and a layout author's own `<script src="assets/...">` — a Shadow root
// has no `<base href>` to resolve either against, unlike the iframe
// `srcdoc` documents this replaces. (peitho-core resolves every other
// asset reference — theme `url()`s, etc. — into that same `assets/` form
// itself; see `engine::pipeline`.)

// The leading `\s` keeps this to a real `src` attribute: a bare `\b` also
// matches the tail of `data-src="…"`, which is not part of that contract.
const FRAGMENT_ASSET_SRC_PATTERN = /(\s)src="(assets\/[^"]*)"/g

/** A `<script>...</script>` block, captured whole so `split` below hands
 * it back as one piece instead of splitting through it. */
const SCRIPT_BLOCK_PATTERN = /(<script\b[^>]*>[\s\S]*?<\/script>)/gi
const SCRIPT_OPEN_TAG_PATTERN = /^<script\b[^>]*>/i

function absolutizeSrcAttributes(text: string, baseUrl: string): string {
  return text.replace(FRAGMENT_ASSET_SRC_PATTERN, (_match, space: string, path: string) => `${space}src="${new URL(path, baseUrl).href}"`)
}

/** An empty `baseUrl` (no asset server resolved yet) is a no-op — there's
 * nothing to resolve against, and `new URL` would throw on it.
 *
 * A `<script>` element's body is arbitrary JS source, not HTML attributes
 * — rewriting it with the same attribute-shaped pattern used for the rest
 * of the fragment risks corrupting a string literal that happens to look
 * like `src="assets/…"` (e.g. a script that itself builds an `<img>` tag
 * as a string). Only a `<script>` tag's own `src` attribute is a real
 * reference this function is responsible for; everything between its
 * `<script>` and `</script>` is left byte-for-byte alone. */
export function absolutizeFragmentUrls(html: string, baseUrl: string): string {
  if (!baseUrl) return html
  return html
    .split(SCRIPT_BLOCK_PATTERN)
    .map(part => (SCRIPT_OPEN_TAG_PATTERN.test(part)
      ? part.replace(SCRIPT_OPEN_TAG_PATTERN, openTag => absolutizeSrcAttributes(openTag, baseUrl))
      : absolutizeSrcAttributes(part, baseUrl)))
    .join('')
}
