// Which status badge a slide's thumbnail wears in the slide list — the
// decision only; `components/SlideList.tsx` just renders whatever this
// returns as an overlay on top of the (still visible) thumbnail.
import type { PageConfig } from './pageConfig'

export type SlideStatusBadge = 'draft' | 'skip'

/** The two PageComment flags a badge is derived from. Narrower than
 * `PageConfig` on purpose, so both a raw `PageConfig` and a rendered
 * `ManifestSlide` (which carries `skip` but not `draft`) can be passed as-is. */
export type SlideStatusFlags = Pick<PageConfig, 'draft' | 'skip'>

/** `draft` wins over `skip`. peitho-core rejects a slide carrying both
 * (`slide cannot be both draft and skipped`, whose own help text says
 * draft slides are excluded from the build), so a render never delivers
 * that combination — but a hand-edited PageComment can still hold it, and
 * a draft is the stronger statement of the two. Only a strict `true`
 * counts: peitho-core only accepts JSON booleans there, so anything else
 * (`"true"`, `1`, `null`) is treated as unset rather than guessed at. */
export function slideStatusBadge(flags: SlideStatusFlags): SlideStatusBadge | null {
  if (flags.draft === true) return 'draft'
  if (flags.skip === true) return 'skip'
  return null
}
