// Strips everything that could run code out of an untrusted deck's slide
// HTML before it reaches the DOM — see `todo/deck-script-trust.md`.
// Stopping `<script>` alone isn't enough: `innerHTML` never runs a parsed
// `<script>`, but an `<img onerror>` fires as soon as it's inserted, and an
// `<iframe srcdoc>` shares this document's origin (and so the app's IPC).
// DOMPurify parses in an inert document, so nothing runs while it works.
// Lives in `dom/` because DOMPurify needs a real DOM.

import DOMPurify, { type RemovedAttribute, type RemovedElement } from 'dompurify'
import { isExecutableRemoval, type RemovedContent } from '../domain/scriptTrust'

// DOMPurify's defaults already drop these; listed so the intent survives a
// change of defaults. Styling survives on purpose (`<style>`, `class`,
// `style`, `data-*`, SVG) so a sanitized slide looks the same.
const SANITIZE_CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta'],
  FORBID_ATTR: ['srcdoc'],
  // A fragment that starts with `<style>` would otherwise lose it: the
  // HTML parser moves a leading `<style>` into `<head>`, which DOMPurify
  // doesn't return.
  FORCE_BODY: true,
}

function describeRemoval(entry: RemovedElement | RemovedAttribute): RemovedContent | null {
  if ('element' in entry) return { kind: 'element', tag: entry.element.nodeName }
  return entry.attribute ? { kind: 'attribute', name: entry.attribute.name, value: entry.attribute.value } : null
}

export interface SanitizedSlide {
  html: string
  /** Whether anything executable was taken out (`isExecutableRemoval`) —
   * what decides whether the trust banner is offered. */
  blockedScripts: boolean
}

/** `html` with its scripts, event handlers, `javascript:` URLs and
 * embedded documents removed. */
export function sanitizeSlideHtml(html: string): SanitizedSlide {
  const clean = DOMPurify.sanitize(html, SANITIZE_CONFIG)
  const blockedScripts = DOMPurify.removed.some(entry => {
    const removal = describeRemoval(entry)
    return removal !== null && isExecutableRemoval(removal)
  })
  return { html: clean, blockedScripts }
}
