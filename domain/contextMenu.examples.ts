// Given-When-Then examples for the "Change Layout" picker's handling of a
// layout the right-clicked slide doesn't fit — marked, but still applied (see docs/architecture.md's
// "Examples by Specification"). Run by contextMenu.test.ts.
import { defineExamples } from './spec'
import type { ContextMenu, LayoutChoice } from './contextMenu'
import type { LayoutFitCheck, LayoutVerdict } from './layoutFit'

function slideMenu(layoutFit: LayoutFitCheck, index = 1): ContextMenu {
  return { kind: 'on-slide', index, x: 10, y: 20, layoutPickerOpen: true, layoutFit, comment: null }
}

const MISSING_BODY = "unassigned content remains for missing 'body' slot"
const MISSING_IMAGE = "slot 'image' got 0 item(s), but layout 'title-body-image' allows 1..1"

/** Slide 2 of a deck with a title-only `cover` layout and a title+body
 * `statement` layout, where the slide itself has a title and a body. */
const TITLE_AND_BODY_VERDICTS: LayoutVerdict[] = [
  { layout: 'cover', fit: { kind: 'mismatch', reason: MISSING_BODY } },
  { layout: 'statement', fit: { kind: 'fits' } },
]

/** A new slide (a lone heading) in a deck with the standard layouts plus
 * the image layout, whose image is required. */
const NEW_SLIDE_VERDICTS: LayoutVerdict[] = [
  { layout: 'title-body', fit: { kind: 'fits' } },
  { layout: 'title-body-image', fit: { kind: 'mismatch', reason: MISSING_IMAGE } },
]

export const layoutChoiceExamples = defineExamples<ContextMenu, { layout: string }, LayoutChoice>(
  'choosing a layout from the Change Layout picker',
  [
    {
      id: 'fitting-layout-is-applied',
      given: 'a slide with a title and a body, whose fit check says it fits "statement"',
      when: 'the user chooses "statement"',
      then: 'the layout is applied to that slide',
      state: slideMenu({ kind: 'checked', verdicts: TITLE_AND_BODY_VERDICTS }),
      event: { layout: 'statement' },
      expect: { kind: 'apply', index: 1 },
    },
    {
      id: 'mismatched-layout-is-applied-anyway',
      given: 'a slide with a title and a body, whose fit check says "cover" has nowhere to put the body',
      when: 'the user chooses "cover"',
      then: 'the layout is applied — the picker only marked it, and the build error it leaves shows in the error bar',
      state: slideMenu({ kind: 'checked', verdicts: TITLE_AND_BODY_VERDICTS }),
      event: { layout: 'cover' },
      expect: { kind: 'apply', index: 1 },
    },
    {
      id: 'new-slide-can-take-the-image-layout',
      given: 'a new slide holding only a heading, whose fit check says "title-body-image" is missing its required image',
      when: 'the user chooses "title-body-image"',
      then: 'the layout is applied, so the image can be added to it next',
      state: slideMenu({ kind: 'checked', verdicts: NEW_SLIDE_VERDICTS }),
      event: { layout: 'title-body-image' },
      expect: { kind: 'apply', index: 1 },
      tags: ['bug-regression'],
    },
    {
      id: 'choice-does-not-wait-for-the-check',
      given: 'a slide whose fit check has not answered yet',
      when: 'the user chooses any layout',
      then: 'the layout is applied — the check only marks entries, it never blocks one',
      state: slideMenu({ kind: 'checking', requestId: 7 }),
      event: { layout: 'cover' },
      expect: { kind: 'apply', index: 1 },
      tags: ['boundary'],
    },
    {
      id: 'failed-check-never-blocks',
      given: 'a slide whose fit check could not be made (e.g. the deck currently fails to parse)',
      when: 'the user chooses a layout',
      then: 'the layout is applied',
      state: slideMenu({ kind: 'unavailable' }),
      event: { layout: 'cover' },
      expect: { kind: 'apply', index: 1 },
    },
    {
      id: 'layout-without-a-verdict-stays-choosable',
      given: 'a slide whose fit check has no verdict for "poster" (a layout that appeared after the check ran)',
      when: 'the user chooses "poster"',
      then: 'the layout is applied',
      state: slideMenu({ kind: 'checked', verdicts: TITLE_AND_BODY_VERDICTS }),
      event: { layout: 'poster' },
      expect: { kind: 'apply', index: 1 },
      tags: ['boundary'],
    },
    {
      id: 'no-slide-no-choice',
      given: 'a context menu opened on empty space in the slide list',
      when: 'a layout choice somehow arrives',
      then: 'nothing happens — there is no slide to change',
      state: { kind: 'on-empty-space', x: 10, y: 20 },
      event: { layout: 'cover' },
      expect: { kind: 'ignore' },
      tags: ['boundary'],
    },
    {
      id: 'mismatch-is-visible-on-a-real-device',
      given: 'the real app with a deck whose layouts include one the right-clicked slide does not fit',
      when: 'the user expands Change Layout and clicks that layout',
      then: 'it is marked with ⚠ and the reason on hover, clicking it pins it, and the build error shows in the error bar',
      state: slideMenu({ kind: 'checked', verdicts: TITLE_AND_BODY_VERDICTS }),
      event: { layout: 'cover' },
      expect: { kind: 'apply', index: 1 },
      manual: { reason: 'needs real peitho-core verdicts and WKWebView rendering (title tooltip, error bar)' },
    },
  ],
)

export const fitAnswerExamples = defineExamples<ContextMenu, { requestId: number; verdicts: LayoutVerdict[] | null }, LayoutFitCheck>(
  'the fit check answering while the context menu is open',
  [
    {
      id: 'answer-settles-the-check',
      given: 'a context menu just opened on a slide, waiting on fit check #3',
      when: 'check #3 answers with a verdict per layout',
      then: 'the picker knows which layouts the slide fits',
      state: slideMenu({ kind: 'checking', requestId: 3 }),
      event: { requestId: 3, verdicts: TITLE_AND_BODY_VERDICTS },
      expect: { kind: 'checked', verdicts: TITLE_AND_BODY_VERDICTS },
    },
    {
      id: 'no-answer-means-unavailable',
      given: 'a context menu waiting on fit check #3',
      when: 'check #3 fails, or finds nothing to judge (a draft slide)',
      then: 'the check is unavailable, so every layout stays choosable',
      state: slideMenu({ kind: 'checking', requestId: 3 }),
      event: { requestId: 3, verdicts: null },
      expect: { kind: 'unavailable' },
    },
    {
      id: 'late-answer-for-an-earlier-right-click-is-dropped',
      given: 'the user right-clicked slide 1 (check #3), then right-clicked slide 2 (check #4) before #3 answered',
      when: 'check #3 finally answers',
      then: 'slide 2\'s menu keeps waiting for its own check #4 — slide 1\'s verdicts never show up on slide 2',
      state: slideMenu({ kind: 'checking', requestId: 4 }, 2),
      event: { requestId: 3, verdicts: TITLE_AND_BODY_VERDICTS },
      expect: { kind: 'checking', requestId: 4 },
      tags: ['bug-regression'],
    },
    {
      id: 'answer-after-the-menu-closed-is-dropped',
      given: 'the user closed the context menu while fit check #3 was still running',
      when: 'check #3 answers',
      then: 'the menu stays closed',
      state: { kind: 'closed' },
      event: { requestId: 3, verdicts: TITLE_AND_BODY_VERDICTS },
      expect: { kind: 'unavailable' },
      tags: ['boundary'],
    },
    {
      id: 'settled-check-is-not-overwritten',
      given: 'a context menu whose fit check #3 already answered',
      when: 'another answer tagged #3 arrives',
      then: 'the first answer stands',
      state: slideMenu({ kind: 'checked', verdicts: TITLE_AND_BODY_VERDICTS }),
      event: { requestId: 3, verdicts: null },
      expect: { kind: 'checked', verdicts: TITLE_AND_BODY_VERDICTS },
      tags: ['boundary'],
    },
  ],
)
