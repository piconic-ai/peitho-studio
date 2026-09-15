// Given-When-Then examples for `buildSlideList` — the human-readable
// source of truth for "which row does each source slide land on, and with
// what data" (see docs/architecture.md's "Examples by Specification"). Run
// by slideList.test.ts.
import { defineExamples } from './spec'
import type { ManifestSlide } from './render'
import type { SlideListEntry } from './slideList'

interface BuildSlideListState {
  fullSource: string
  manifestSlides: ManifestSlide[]
}

/** The only event these examples describe: the slide list being (re)built
 * from a fresh render. */
type SlideListBuilt = 'slide-list-built'

function slide(index: number, key: string, title: string, skip = false): ManifestSlide {
  return { index, key, src: '', hasNotes: false, skip, revealSteps: 1, text: { title, body: '', code: '' } }
}

export const buildSlideListExamples = defineExamples<BuildSlideListState, SlideListBuilt, SlideListEntry[]>(
  'buildSlideList',
  [
    {
      id: 'no-drafts',
      given: 'a two-slide deck with no draft slides',
      when: 'the slide list is built from the deck and its manifest',
      then: 'every row is rendered, in source order, sourceIndex equal to manifestIndex',
      state: {
        fullSource: '# One\n\n---\n\n# Two\n',
        manifestSlides: [slide(0, 'one', 'One'), slide(1, 'two', 'Two')],
      },
      event: 'slide-list-built',
      expect: [
        { kind: 'rendered', sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'one', 'One') },
        { kind: 'rendered', sourceIndex: 1, manifestIndex: 1, slide: slide(1, 'two', 'Two') },
      ],
    },
    {
      id: 'draft-in-the-middle',
      given: 'a three-slide deck whose middle slide is marked {"draft":true}',
      when: 'the slide list is built from the deck and the manifest peitho-core rendered (which dropped the draft slide)',
      then: 'the draft slide shows as a placeholder at its own row, and the slide after it keeps its own sourceIndex despite the manifest only holding two slides',
      state: {
        fullSource: '# One\n\n---\n\n<!-- {"draft":true} -->\n# Hidden\n\n---\n\n# Three\n',
        manifestSlides: [slide(0, 'one', 'One'), slide(1, 'three', 'Three')],
      },
      event: 'slide-list-built',
      expect: [
        { kind: 'rendered', sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'one', 'One') },
        { kind: 'placeholder', sourceIndex: 1, title: 'Hidden', draft: true, key: 'placeholder-1' },
        { kind: 'rendered', sourceIndex: 2, manifestIndex: 1, slide: slide(1, 'three', 'Three') },
      ],
    },
    {
      id: 'manifest-not-caught-up-yet',
      given: 'a two-slide deck where the manifest still only has the first slide (a render for the just-added second slide hasn\'t landed yet)',
      when: 'the slide list is built from the deck and that stale manifest',
      then: 'the second slide is a non-draft placeholder rather than a crash or a silently dropped row',
      state: {
        fullSource: '# One\n\n---\n\n# Two\n',
        manifestSlides: [slide(0, 'one', 'One')],
      },
      event: 'slide-list-built',
      expect: [
        { kind: 'rendered', sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'one', 'One') },
        { kind: 'placeholder', sourceIndex: 1, title: 'Two', draft: false, key: 'placeholder-1' },
      ],
    },
    {
      id: 'draft-with-explicit-key',
      given: 'a slide marked both {"draft":true,"key":"cover"}',
      when: 'the slide list is built',
      then: 'the placeholder uses that key instead of a position-derived fallback',
      state: {
        fullSource: '<!-- {"draft":true,"key":"cover"} -->\n# Cover\n',
        manifestSlides: [],
      },
      event: 'slide-list-built',
      expect: [
        { kind: 'placeholder', sourceIndex: 0, title: 'Cover', draft: true, key: 'cover' },
      ],
    },
  ],
)
