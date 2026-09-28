// Whether the open deck may run its own scripts, and whether the banner
// offering to trust it is shown — see `todo/archive/deck-script-trust.md`. An
// untrusted deck's slide HTML is sanitized before it reaches the DOM
// (`dom/slideSanitizer.ts`); the banner appears only once that actually
// took something executable out, so a deck with no scripts never shows it.

/** One thing the sanitizer took out of a slide's HTML: a whole element,
 * or one attribute (its value included, for `javascript:` URLs). */
export type RemovedContent =
  | { kind: 'element'; tag: string }
  | { kind: 'attribute'; name: string; value: string }

// Elements that run script or load a document of their own. An `<iframe
// srcdoc>` shares this document's origin, so it could reach the app's IPC.
const EXECUTABLE_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet'])

// Browsers ignore ASCII whitespace/control characters inside a URL's
// scheme (`java\tscript:` still runs), so they're dropped before comparing.
const URL_IGNORED_CHARS = /[\x00-\x20]/g
const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/
// The schemes DOMPurify's default `ALLOWED_URI_REGEXP` lets through.
// Anything else in a URL attribute (`javascript:`, `vbscript:`, `data:`,
// a scheme nobody has thought of yet) is dropped by it, and counts here.
const SAFE_URL_SCHEMES = new Set(['http', 'https', 'ftp', 'ftps', 'mailto', 'tel', 'callto', 'sms', 'cid', 'xmpp', 'matrix'])
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'data', 'codebase', 'cite'])

/** Whether `value` names a scheme outside `SAFE_URL_SCHEMES`. A relative
 * URL (no scheme) is safe. */
function hasUnsafeScheme(value: string): boolean {
  const scheme = URL_SCHEME.exec(value.replace(URL_IGNORED_CHARS, '').toLowerCase())?.[1]
  return scheme !== undefined && !SAFE_URL_SCHEMES.has(scheme)
}

/** Whether `removed` is something that would have run code — as opposed
 * to markup the sanitizer drops for other reasons (a `<meta>`, an unknown
 * element), which alone shouldn't ask the user to trust the deck. */
export function isExecutableRemoval(removed: RemovedContent): boolean {
  if (removed.kind === 'element') return EXECUTABLE_TAGS.has(removed.tag.toLowerCase())
  const name = removed.name.toLowerCase()
  if (name.length > 2 && name.startsWith('on')) return true
  if (name === 'srcdoc') return true
  return URL_ATTRIBUTES.has(name) && hasUnsafeScheme(removed.value)
}

/** The open deck's script trust. `trusting`: "Trust and Run" was pressed
 * and `trust_open_deck` hasn't answered yet. */
export type ScriptTrust =
  | { kind: 'trusted' }
  | { kind: 'untrusted'; blocked: boolean }
  | { kind: 'trusting' }

export type ScriptTrustEvent =
  /** The sanitizer took something executable out of a slide. */
  | 'blocked'
  | 'trust-requested'
  | 'trust-succeeded'
  | 'trust-failed'

/** The trust a deck starts with, as `open_deck` reported it. */
export function scriptTrustOnOpen(trusted: boolean): ScriptTrust {
  return trusted ? { kind: 'trusted' } : { kind: 'untrusted', blocked: false }
}

/** `state` after `event`. Returns `state` itself (same object) when nothing
 * changes, so a signal holding it doesn't notify its readers again. */
export function nextScriptTrust(state: ScriptTrust, event: ScriptTrustEvent): ScriptTrust {
  switch (event) {
    case 'blocked':
      return state.kind === 'untrusted' && !state.blocked ? { kind: 'untrusted', blocked: true } : state
    case 'trust-requested':
      return state.kind === 'untrusted' ? { kind: 'trusting' } : state
    case 'trust-succeeded':
      return state.kind === 'trusting' ? { kind: 'trusted' } : state
    case 'trust-failed':
      // Only a blocked deck ever offers the button, so a failure goes back
      // to showing it.
      return state.kind === 'trusting' ? { kind: 'untrusted', blocked: true } : state
  }
}

/** Whether the "scripts are disabled" banner is shown. It stays up while
 * trusting, so the button doesn't vanish before the trust is saved. */
export function trustBannerShown(state: ScriptTrust): boolean {
  return state.kind === 'trusting' || (state.kind === 'untrusted' && state.blocked)
}
