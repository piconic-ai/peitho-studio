// Given-When-Then examples for `buildSlideList` — the human-readable
// source of truth for "which row does each source slide land on, and with
// what data" (see docs/architecture.md's "Examples by Specification"). Run
// by slideList.test.ts.
import { defineExamples } from './spec'
import type { ManifestSlide, RenderErrorPayload } from './render'
import type { SlideListEntry } from './slideList'
import type { BrokenSlides } from './brokenSlides'

interface BuildSlideListState {
  fullSource: string
  manifestSlides: ManifestSlide[]
  /** The source positions the render isolated — none when absent. */
  broken?: BrokenSlides
}

/** peitho-core's refusal of the slide isolated in the example below. */
const brokenError: RenderErrorPayload = {
  kind: 'Arity',
  line: 8,
  originFile: null,
  message: "slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  help: 'use a layout with a body slot or remove one paragraph',
  headline: "slide 2 ('two'), line 8: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  slide: { number: 2, key: 'two' },
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
        { kind: 'rendered', badge: null, sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'one', 'One') },
        { kind: 'rendered', badge: null, sourceIndex: 1, manifestIndex: 1, slide: slide(1, 'two', 'Two') },
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
        { kind: 'rendered', badge: null, sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'one', 'One') },
        { kind: 'placeholder', badge: 'draft', sourceIndex: 1, title: 'Hidden', draft: true, key: 'placeholder:1', lastRenderedKey: null, error: null },
        { kind: 'rendered', badge: null, sourceIndex: 2, manifestIndex: 1, slide: slide(1, 'three', 'Three') },
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
        { kind: 'rendered', badge: null, sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'one', 'One') },
        { kind: 'placeholder', badge: null, sourceIndex: 1, title: 'Two', draft: false, key: 'placeholder:1', lastRenderedKey: null, error: null },
      ],
    },
    {
      id: 'draft-with-explicit-key',
      given: 'a slide marked both {"draft":true,"key":"cover"}',
      when: 'the slide list is built',
      then: 'the placeholder\'s own `.map()` key stays position-derived, deliberately ignoring the slide\'s own explicit key — reusing it there would hand this row the exact key its `rendered` form uses right before/after the draft toggle, which BarefootJS\'s keyed `.map()` doesn\'t remount correctly (see the type\'s own doc comment) — but `lastRenderedKey` carries that explicit key through anyway, so the slide list can still show whatever was last rendered under it instead of a blank placeholder',
      state: {
        fullSource: '<!-- {"draft":true,"key":"cover"} -->\n# Cover\n',
        manifestSlides: [],
      },
      event: 'slide-list-built',
      expect: [
        { kind: 'placeholder', badge: 'draft', sourceIndex: 0, title: 'Cover', draft: true, key: 'placeholder:0', lastRenderedKey: 'cover', error: null },
      ],
    },
    {
      id: 'broken-slide-isolated',
      given: 'a three-slide deck whose middle slide does not build and was isolated from the render (rendered as a draft, though the source does not mark it)',
      when: 'the slide list is built from the deck, the manifest of the other two slides, and the isolated slide\'s error',
      then: 'the broken slide is a placeholder carrying its error at its own row — claiming no manifest entry, so the slide after it still pairs with its own',
      state: {
        fullSource: '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n',
        manifestSlides: [slide(0, 'one', 'One'), slide(1, 'three', 'Three')],
        broken: new Map([[1, brokenError]]),
      },
      event: 'slide-list-built',
      expect: [
        { kind: 'rendered', badge: null, sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'one', 'One') },
        { kind: 'placeholder', badge: 'error', sourceIndex: 1, title: 'Two', draft: false, key: 'placeholder:1', lastRenderedKey: 'two', error: brokenError },
        { kind: 'rendered', badge: null, sourceIndex: 2, manifestIndex: 1, slide: slide(1, 'three', 'Three') },
      ],
    },
  ],
)
