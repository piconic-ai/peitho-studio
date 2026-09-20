// A slide fragment's only relative references are `<img src="assets/...">`,
// a `<video poster="assets/...">`/`<source src="assets/...">`, and a layout
// author's own `<script src="assets/...">` — a Shadow root has no
// `<base href>` to resolve any of these against, unlike the iframe
// `srcdoc` documents this replaces. (peitho-core resolves every other
// asset reference — theme `url()`s, etc. — into that same `assets/` form
// itself; see `engine::pipeline`.)

// The leading `\s` keeps this to a real `src`/`poster` attribute: a bare
// `\b` also matches the tail of `data-src="…"`, which is not part of that
// contract.
const FRAGMENT_ASSET_SRC_PATTERN = /(\s)(src|poster)="(assets\/[^"]*)"/g

/** A `<script>...</script>` block, captured whole so `split` below hands
 * it back as one piece instead of splitting through it. */
const SCRIPT_BLOCK_PATTERN = /(<script\b[^>]*>[\s\S]*?<\/script>)/gi
const SCRIPT_OPEN_TAG_PATTERN = /^<script\b[^>]*>/i

function absolutizeSrcAttributes(text: string, baseUrl: string): string {
  return text.replace(FRAGMENT_ASSET_SRC_PATTERN, (_match, space: string, attr: string, path: string) => `${space}${attr}="${new URL(path, baseUrl).href}"`)
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

// A slide opts out of the preview's phone-shaped canvas with
// `data-canvas="fixed"` on its root `<section>` (a layout authored in
// absolute 16:9 coordinates). Only that one start tag is read: a layout's
// leading comment often documents the attribute in prose, and a child
// element may carry the same attribute for its own reasons — neither is the
// slide's own opt-out.

/** Whitespace and HTML comments a fragment may open with (peitho-core keeps
 * a layout's leading `<!-- ... -->` block ahead of its root element). */
const LEADING_TRIVIA_PATTERN = /^(?:\s|<!--[\s\S]*?-->)*/

/** The root `<section>`'s start tag, capturing its attribute text. A quoted
 * value may contain `>`, so quotes are consumed as units. The lookahead
 * keeps `<section-x>` and `<sections>` from matching. */
const SECTION_START_TAG_PATTERN = /^<section(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/i

/** One attribute: name, then an optional double-quoted, single-quoted or
 * unquoted value. Read left to right, so a quoted value is never mistaken
 * for further attributes. */
const ATTRIBUTE_PATTERN = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** The attribute text of the fragment's root `<section>` start tag, or null
 * when the fragment does not open with one. */
function rootSectionAttributes(fragmentHtml: string): string | null {
  const body = fragmentHtml.replace(LEADING_TRIVIA_PATTERN, '')
  return SECTION_START_TAG_PATTERN.exec(body)?.[1] ?? null
}

/** An attribute's value ('' when it has none), or null when absent. Names
 * are case-insensitive and the first of a duplicated name wins, as in an
 * HTML parser. */
function attributeValue(attributes: string, name: string): string | null {
  for (const match of attributes.matchAll(ATTRIBUTE_PATTERN)) {
    if (match[1].toLowerCase() === name) return match[2] ?? match[3] ?? match[4] ?? ''
  }
  return null
}

/** Whether the slide's root `<section>` carries `data-canvas="fixed"`. The
 * value is matched exactly (`FIXED` is not `fixed`), as the CSS selector
 * `section[data-canvas="fixed"]` the other viewers use would. */
export function hasFixedCanvas(fragmentHtml: string): boolean {
  const attributes = rootSectionAttributes(fragmentHtml)
  return attributes !== null && attributeValue(attributes, 'data-canvas') === 'fixed'
}
