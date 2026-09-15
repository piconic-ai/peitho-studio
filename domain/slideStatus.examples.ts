// Given-When-Then examples for `slideStatusBadge` — the human-readable
// source of truth for "which thumbnails get which badge" (see
// docs/architecture.md's "Examples by Specification"). Run by
// slideStatus.test.ts.
import { defineExamples } from './spec'
import type { SlideStatusBadge, SlideStatusFlags } from './slideStatus'

/** The only event these examples describe: the slide list drawing a
 * slide's thumbnail. */
type ThumbnailShown = 'thumbnail-shown'

export const slideStatusBadgeExamples = defineExamples<SlideStatusFlags, ThumbnailShown, SlideStatusBadge | null>(
  'slideStatusBadge',
  [
    {
      id: 'draft-slide',
      given: 'a slide marked {"draft":true}',
      when: 'its thumbnail is shown in the slide list',
      then: 'it wears a DRAFT badge',
      state: { draft: true },
      event: 'thumbnail-shown',
      expect: 'draft',
    },
    {
      id: 'skip-slide',
      given: 'a slide marked {"skip":true}',
      when: 'its thumbnail is shown in the slide list',
      then: 'it wears a SKIP badge',
      state: { skip: true },
      event: 'thumbnail-shown',
      expect: 'skip',
    },
    {
      id: 'plain-slide',
      given: 'a slide with no PageComment flags at all',
      when: 'its thumbnail is shown in the slide list',
      then: 'it wears no badge',
      state: {},
      event: 'thumbnail-shown',
      expect: null,
    },
    {
      id: 'flags-explicitly-off',
      given: 'a slide marked {"draft":false,"skip":false}',
      when: 'its thumbnail is shown in the slide list',
      then: 'it wears no badge, same as a slide that never set them',
      state: { draft: false, skip: false },
      event: 'thumbnail-shown',
      expect: null,
      tags: ['boundary'],
    },
    {
      id: 'draft-and-skip-together',
      given: 'a slide marked both {"draft":true,"skip":true} (which peitho-core itself rejects)',
      when: 'its thumbnail is shown in the slide list',
      then: 'it wears the DRAFT badge only — the two badges are never shown together',
      state: { draft: true, skip: true },
      event: 'thumbnail-shown',
      expect: 'draft',
      tags: ['boundary'],
    },
  ],
)
