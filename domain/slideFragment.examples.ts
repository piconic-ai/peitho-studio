// Given-When-Then examples for `hasFixedCanvas` — the human-readable source
// of truth for "which slides keep their own 16:9 canvas in the phone
// preview" (see docs/architecture.md's "Examples by Specification"). Run by
// slideFragment.test.ts.
import { defineExamples } from './spec'

/** The only event these examples describe: the preview checking the
 * selected slide before it picks a canvas size. */
type PreviewChecksSlide = 'preview-checks-slide'

export const fixedCanvasExamples = defineExamples<string, PreviewChecksSlide, boolean>(
  'hasFixedCanvas',
  [
    {
      id: 'fixed-slide',
      given: 'a slide whose root <section> is marked data-canvas="fixed" (an arcade layout drawn in 1280x720 coordinates)',
      when: 'the preview checks the slide',
      then: 'the slide keeps its own canvas',
      state: '<section class="peitho-slide layout-arcade" data-ground="dark" data-canvas="fixed" data-slide-key="what-arcade"><p>Play</p></section>',
      event: 'preview-checks-slide',
      expect: true,
    },
    {
      id: 'ordinary-slide',
      given: 'an ordinary slide whose root <section> has no data-canvas attribute',
      when: 'the preview checks the slide',
      then: 'the slide follows the phone canvas',
      state: '<section class="peitho-slide layout-belief" data-slide-key="why-backend"><h1>Keep the backend you love.</h1></section>',
      event: 'preview-checks-slide',
      expect: false,
    },
    {
      id: 'fixed-slide-after-explaining-comment',
      given: 'a fixed slide whose layout opens with a comment that mentions data-canvas="fixed" in prose',
      when: 'the preview checks the slide',
      then: 'the slide keeps its own canvas, read from the <section> and not from the comment',
      state: '<!--\n  data-canvas="fixed": the play field is authored in 1280x720 coordinates.\n-->\n'
        + '<section class="peitho-slide" data-canvas="fixed" data-slide-key="a"></section>',
      event: 'preview-checks-slide',
      expect: true,
      tags: ['bug-regression'],
    },
    {
      id: 'ordinary-slide-after-explaining-comment',
      given: 'an ordinary slide whose layout opens with a comment quoting <section data-canvas="fixed"> as an example',
      when: 'the preview checks the slide',
      then: 'the slide follows the phone canvas — text inside a comment is not an opt-out',
      state: '<!-- Example: <section data-canvas="fixed"> keeps 16:9 -->\n<section class="peitho-slide" data-slide-key="a"></section>',
      event: 'preview-checks-slide',
      expect: false,
      tags: ['bug-regression'],
    },
    {
      id: 'only-a-child-is-marked',
      given: 'an ordinary slide with data-canvas="fixed" on an element inside it, not on the <section> itself',
      when: 'the preview checks the slide',
      then: 'the slide follows the phone canvas — only the slide\'s own root counts',
      state: '<section class="peitho-slide"><div data-canvas="fixed"></div></section>',
      event: 'preview-checks-slide',
      expect: false,
      tags: ['boundary'],
    },
    {
      id: 'other-canvas-value',
      given: 'a slide whose root <section> says data-canvas="flex"',
      when: 'the preview checks the slide',
      then: 'the slide follows the phone canvas — only the value "fixed" opts out',
      state: '<section class="peitho-slide" data-canvas="flex"></section>',
      event: 'preview-checks-slide',
      expect: false,
      tags: ['boundary'],
    },
    {
      id: 'empty-fragment',
      given: 'a slide with no HTML at all (nothing rendered yet)',
      when: 'the preview checks the slide',
      then: 'the slide follows the phone canvas',
      state: '',
      event: 'preview-checks-slide',
      expect: false,
      tags: ['boundary'],
    },
  ],
)
