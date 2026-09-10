// A slide fragment's only relative references are `<img src="assets/...">`
// (peitho-core resolves every other asset reference into that form — see
// `engine::pipeline`) — a Shadow root has no `<base href>` to resolve them
// against, unlike the iframe `srcdoc` documents this replaces.

// The leading `\s` keeps this to a real `src` attribute: a bare `\b` also
// matches the tail of `data-src="…"`, which is not part of that contract.
const FRAGMENT_ASSET_SRC_PATTERN = /(\s)src="(assets\/[^"]*)"/g

/** An empty `baseUrl` (no asset server resolved yet) is a no-op — there's
 * nothing to resolve against, and `new URL` would throw on it. */
export function absolutizeFragmentUrls(html: string, baseUrl: string): string {
  if (!baseUrl) return html
  return html.replace(FRAGMENT_ASSET_SRC_PATTERN, (_match, space: string, path: string) => `${space}src="${new URL(path, baseUrl).href}"`)
}
