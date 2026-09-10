// A slide fragment's only relative references are `<img src="assets/...">`
// (peitho-core resolves every other asset reference into that form — see
// `engine::pipeline`) — a Shadow root has no `<base href>` to resolve them
// against, unlike the iframe `srcdoc` documents this replaces.

const FRAGMENT_ASSET_SRC_PATTERN = /\bsrc="assets\/([^"]*)"/g

/** Rewrites every `src="assets/..."` in `html` against `baseUrl`. `baseUrl`
 * empty (no asset server resolved yet) is a no-op. */
export function absolutizeFragmentUrls(html: string, baseUrl: string): string {
  if (!baseUrl) return html
  return html.replace(FRAGMENT_ASSET_SRC_PATTERN, (_match, rest: string) => `src="${new URL(`assets/${rest}`, baseUrl).href}"`)
}
