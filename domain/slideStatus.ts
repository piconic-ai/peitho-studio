// Which status badge a slide's thumbnail wears in the slide list — the
// decision only; `components/SlideList.tsx` just renders whatever this
// returns as an overlay on top of the (still visible) thumbnail.
import type { PageConfig } from './pageConfig'
import type { SlideListEntry } from './slideList'

/** `error`: the slide doesn't build and was isolated from the render
 * (`domain/brokenSlides.ts`); `draft`/`skip`: its PageComment flags. */
export type SlideStatusBadge = 'draft' | 'skip' | 'error'

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

/** The badge a slide list row wears. A rendered slide follows
 * `slideStatusBadge` on its manifest flags (`skip`; a draft never
 * renders). A placeholder wears ERROR when it was isolated for not
 * building — the strongest statement, over a `draft` mark it may also
 * carry — else DRAFT exactly when `entry.draft` says so, and never SKIP:
 * peitho-core rejects a slide marked both draft and skip, so a placeholder
 * (which exists because it IS a draft, was isolated, or the manifest
 * hasn't caught up yet) is never meaningfully "skipped" too. */
export function slideEntryBadge(entry: SlideListEntry): SlideStatusBadge | null {
  if (entry.kind === 'rendered') return slideStatusBadge(entry.slide)
  if (entry.error !== null) return 'error'
  return entry.draft ? 'draft' : null
}
