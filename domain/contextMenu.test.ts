import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  indexOf, positionOf, isLayoutPickerOpen, menuItems, appendIndex, menuItemEnabled, menuItemChecked,
  openOnSlide, withLayoutFitResult, layoutFitOf, layoutNoticeOf, chooseLayout, withLayoutNotice,
  type ContextMenu, type MenuContext, type MenuItem,
} from './contextMenu'
import { layoutChoiceExamples, fitAnswerExamples } from './contextMenu.examples'
import { isExhaustivelyAccountedFor } from './spec'
import type { LayoutNotice, LayoutVerdict } from './layoutFit'

const CHECKING_NOTICE: LayoutNotice = { kind: 'checking' }
const notice = (reason: string): LayoutNotice => ({ kind: 'mismatch', layout: 'cover', reason })

const ctx = (overrides: Partial<MenuContext> = {}): MenuContext => ({
  slideCount: 3,
  hasClipboard: false,
  configOf: () => ({}),
  ...overrides,
})

type SlideMenu = Extract<ContextMenu, { kind: 'on-slide' }>

/** An `on-slide` menu at the origin, picker collapsed, with no fit check
 * and no notice — override only the fields a test is about. */
const onSlide = (fields: Partial<SlideMenu> & Pick<SlideMenu, 'index'>): SlideMenu => ({
  kind: 'on-slide',
  x: 0,
  y: 0,
  layoutPickerOpen: false,
  layoutFit: { kind: 'unavailable' },
  layoutNotice: null,
  ...fields,
})

describe('indexOf', () => {
  test('spec: on-slide carries its index', () => {
    expect(indexOf(onSlide({ index: 2 }))).toBe(2)
  })

  test('adversarial: closed and on-empty-space both have no index', () => {
    expect(indexOf({ kind: 'closed' })).toBeNull()
    expect(indexOf({ kind: 'on-empty-space', x: 0, y: 0 })).toBeNull()
  })
})

describe('positionOf', () => {
  test('spec: on-slide/on-empty-space report their click position', () => {
    expect(positionOf({ kind: 'on-empty-space', x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
    expect(positionOf(onSlide({ index: 0, x: 30, y: 40, layoutPickerOpen: true }))).toEqual({ x: 30, y: 40 })
  })

  test('adversarial: closed reports the origin, not a stale position', () => {
    expect(positionOf({ kind: 'closed' })).toEqual({ x: 0, y: 0 })
  })
})

describe('isLayoutPickerOpen', () => {
  test('spec: reflects on-slide\'s own flag', () => {
    expect(isLayoutPickerOpen(onSlide({ index: 0, layoutPickerOpen: true }))).toBe(true)
    expect(isLayoutPickerOpen(onSlide({ index: 0 }))).toBe(false)
  })

  test('adversarial: closed and on-empty-space are never open (there is no picker to open)', () => {
    expect(isLayoutPickerOpen({ kind: 'closed' })).toBe(false)
    expect(isLayoutPickerOpen({ kind: 'on-empty-space', x: 0, y: 0 })).toBe(false)
  })
})

describe('menuItems', () => {
  test('spec: on-slide enables every per-slide action', () => {
    const menu: ContextMenu = onSlide({ index: 1 })
    const items = menuItems(menu, ctx())
    const byAction = Object.fromEntries(items.map(i => [i.action, i]))
    expect(byAction['cut'].enabled).toBe(true)
    expect(byAction['copy'].enabled).toBe(true)
    expect(byAction['delete'].enabled).toBe(true)
    expect(byAction['change-layout'].enabled).toBe(true)
    expect(byAction['move-up'].enabled).toBe(true)
    expect(byAction['move-down'].enabled).toBe(true)
  })

  test('spec: closed/on-empty-space disable every per-slide action but keep new-slide enabled', () => {
    const menus: ContextMenu[] = [{ kind: 'closed' }, { kind: 'on-empty-space', x: 0, y: 0 }]
    for (const menu of menus) {
      const items = menuItems(menu, ctx())
      const byAction = Object.fromEntries(items.map(i => [i.action, i]))
      expect(byAction['new-slide'].enabled).toBe(true)
      expect(byAction['cut'].enabled).toBe(false)
      expect(byAction['copy'].enabled).toBe(false)
      expect(byAction['delete'].enabled).toBe(false)
      expect(byAction['change-layout'].enabled).toBe(false)
      expect(byAction['toggle-draft'].enabled).toBe(false)
      expect(byAction['move-up'].enabled).toBe(false)
      expect(byAction['move-down'].enabled).toBe(false)
    }
  })

  test('spec: paste is driven by the clipboard, independent of which slide (if any) is targeted', () => {
    const menu: ContextMenu = { kind: 'closed' }
    expect(menuItems(menu, ctx({ hasClipboard: false })).find(i => i.action === 'paste')?.enabled).toBe(false)
    expect(menuItems(menu, ctx({ hasClipboard: true })).find(i => i.action === 'paste')?.enabled).toBe(true)
  })

  test('adversarial: delete disables itself on the last remaining slide even when targeted', () => {
    const menu: ContextMenu = onSlide({ index: 0 })
    expect(menuItems(menu, ctx({ slideCount: 1 })).find(i => i.action === 'delete')?.enabled).toBe(false)
  })

  test('adversarial: move-up/move-down disable at the respective ends of the list', () => {
    const first: ContextMenu = onSlide({ index: 0 })
    const last: ContextMenu = onSlide({ index: 2 })
    expect(menuItems(first, ctx()).find(i => i.action === 'move-up')?.enabled).toBe(false)
    expect(menuItems(first, ctx()).find(i => i.action === 'move-down')?.enabled).toBe(true)
    expect(menuItems(last, ctx()).find(i => i.action === 'move-up')?.enabled).toBe(true)
    expect(menuItems(last, ctx()).find(i => i.action === 'move-down')?.enabled).toBe(false)
  })

  test('spec: toggle-draft/skip/section reflect the targeted slide\'s own config', () => {
    const menu: ContextMenu = onSlide({ index: 1 })
    const items = menuItems(menu, ctx({ configOf: () => ({ draft: true, skip: false, section: 'Intro' }) }))
    const byAction = Object.fromEntries(items.map(i => [i.action, i]))
    expect(byAction['toggle-draft'].checked).toBe(true)
    expect(byAction['toggle-skip'].checked).toBe(false)
    expect(byAction['toggle-section'].checked).toBe(true)
  })

  test('adversarial: an empty (falsy) section string is not treated as a section start', () => {
    const menu: ContextMenu = onSlide({ index: 0 })
    const items = menuItems(menu, ctx({ configOf: () => ({ section: undefined }) }))
    expect(items.find(i => i.action === 'toggle-section')?.checked).toBe(false)
  })

  test('adversarial: toggle-skip/toggle-section disable themselves on a draft slide — peitho-core rejects both combinations', () => {
    const menu = onSlide({ index: 0 })
    const items = menuItems(menu, ctx({ configOf: () => ({ draft: true }) }))
    const byAction = Object.fromEntries(items.map(i => [i.action, i]))
    expect(byAction['toggle-skip'].enabled).toBe(false)
    expect(byAction['toggle-section'].enabled).toBe(false)
    // Every other per-slide action stays available on a draft slide —
    // only the two combinations peitho-core actually refuses are disabled.
    expect(byAction['toggle-draft'].enabled).toBe(true)
    expect(byAction['cut'].enabled).toBe(true)
    expect(byAction['change-layout'].enabled).toBe(true)
  })
})

describe('appendIndex', () => {
  test('spec: on-slide appends after the targeted slide', () => {
    expect(appendIndex(onSlide({ index: 1 }), 5)).toBe(1)
  })

  test('adversarial: closed/on-empty-space append at the end of the list', () => {
    expect(appendIndex({ kind: 'closed' }, 5)).toBe(4)
    expect(appendIndex({ kind: 'on-empty-space', x: 0, y: 0 }, 5)).toBe(4)
  })

  test('adversarial: an empty list still returns a usable (negative) anchor for the caller\'s own Math.min clamp', () => {
    expect(appendIndex({ kind: 'closed' }, 0)).toBe(-1)
  })
})

describe('menuItemEnabled', () => {
  const items: MenuItem[] = [
    { action: 'cut', enabled: true },
    { action: 'paste', enabled: false },
  ]

  test('spec: reports the matching action\'s own enabled flag', () => {
    expect(menuItemEnabled(items, 'cut')).toBe(true)
    expect(menuItemEnabled(items, 'paste')).toBe(false)
  })

  test('adversarial: an action absent from the list is treated as disabled, not thrown on', () => {
    expect(menuItemEnabled(items, 'delete')).toBe(false)
  })

  test('adversarial: an empty list disables every action', () => {
    expect(menuItemEnabled([], 'new-slide')).toBe(false)
  })
})

describe('menuItemChecked', () => {
  const items: MenuItem[] = [
    { action: 'toggle-draft', enabled: true, checked: true },
    { action: 'toggle-skip', enabled: true, checked: false },
    { action: 'toggle-section', enabled: true },
  ]

  test('spec: reports the matching action\'s own checked flag', () => {
    expect(menuItemChecked(items, 'toggle-draft')).toBe(true)
    expect(menuItemChecked(items, 'toggle-skip')).toBe(false)
  })

  test('adversarial: an action with no checked field at all reports false, not undefined', () => {
    expect(menuItemChecked(items, 'toggle-section')).toBe(false)
  })

  test('adversarial: an action absent from the list is treated as unchecked, not thrown on', () => {
    expect(menuItemChecked(items, 'cut')).toBe(false)
  })

  test('adversarial: an empty list unchecks every action', () => {
    expect(menuItemChecked([], 'toggle-draft')).toBe(false)
  })
})

const VERDICTS: LayoutVerdict[] = [
  { layout: 'cover', fit: { kind: 'mismatch', reason: "unassigned content remains for missing 'body' slot" } },
  { layout: 'statement', fit: { kind: 'fits' } },
]

describe('Change Layout picker examples', () => {
  test('example: every layout-choice example is automated or manual with a reason', () => {
    expect(isExhaustivelyAccountedFor(layoutChoiceExamples)).toBe(true)
    expect(layoutChoiceExamples.manual.every(example => example.manual!.reason.length > 0)).toBe(true)
  })

  test.each(layoutChoiceExamples.automated.map(example => [example.id, example] as const))('example: %s', (_id, example) => {
    expect(chooseLayout(example.state, example.event.layout)).toEqual(example.expect)
  })

  test('example: every fit-answer example is automated or manual with a reason', () => {
    expect(isExhaustivelyAccountedFor(fitAnswerExamples)).toBe(true)
  })

  test.each(fitAnswerExamples.automated.map(example => [example.id, example] as const))('example: %s', (_id, example) => {
    expect(layoutFitOf(withLayoutFitResult(example.state, example.event.requestId, example.event.verdicts))).toEqual(example.expect)
  })
})

describe('openOnSlide', () => {
  test('spec: opens collapsed, with no notice, waiting on the given fit check', () => {
    expect(openOnSlide(2, 30, 40, 9)).toEqual({
      kind: 'on-slide', index: 2, x: 30, y: 40, layoutPickerOpen: false, layoutFit: { kind: 'checking', requestId: 9 }, layoutNotice: null,
    })
  })

  test('adversarial: boundary indices and coordinates are carried as-is', () => {
    expect(indexOf(openOnSlide(0, 0, 0, 0))).toBe(0)
    expect(positionOf(openOnSlide(0, -5, Number.MAX_SAFE_INTEGER, 0))).toEqual({ x: -5, y: Number.MAX_SAFE_INTEGER })
  })
})

describe('withLayoutFitResult', () => {
  test('spec: the awaited answer settles the check and keeps everything else', () => {
    const opened = onSlide({ index: 1, x: 10, y: 20, layoutPickerOpen: true, layoutFit: { kind: 'checking', requestId: 5 } })
    const settled = withLayoutFitResult(opened, 5, VERDICTS)
    expect(settled).toEqual({ ...opened, layoutFit: { kind: 'checked', verdicts: VERDICTS } })
  })

  test('spec: the answer clears the "still checking" notice a too-early click left behind', () => {
    const early = withLayoutNotice(openOnSlide(1, 10, 20, 5), CHECKING_NOTICE)
    expect(layoutNoticeOf(withLayoutFitResult(early, 5, VERDICTS))).toBeNull()
    expect(layoutNoticeOf(withLayoutFitResult(early, 5, null))).toBeNull()
  })

  test('adversarial: a stale answer leaves the "still checking" notice in place', () => {
    const early = withLayoutNotice(openOnSlide(1, 10, 20, 5), CHECKING_NOTICE)
    expect(layoutNoticeOf(withLayoutFitResult(early, 4, VERDICTS))).toEqual(CHECKING_NOTICE)
  })

  test('adversarial: an answer for another request returns the very same menu object', () => {
    const opened = openOnSlide(1, 10, 20, 5)
    expect(withLayoutFitResult(opened, 4, VERDICTS)).toBe(opened)
    expect(withLayoutFitResult(opened, 6, null)).toBe(opened)
  })

  test('adversarial: closed and on-empty-space menus ignore any answer', () => {
    const closed: ContextMenu = { kind: 'closed' }
    const empty: ContextMenu = { kind: 'on-empty-space', x: 1, y: 2 }
    expect(withLayoutFitResult(closed, 0, VERDICTS)).toBe(closed)
    expect(withLayoutFitResult(empty, 0, VERDICTS)).toBe(empty)
  })
})

describe('layoutFitOf / layoutNoticeOf', () => {
  test('spec: read the on-slide menu\'s own fields', () => {
    const menu = withLayoutNotice(openOnSlide(0, 0, 0, 1), notice('why'))
    expect(layoutFitOf(menu)).toEqual({ kind: 'checking', requestId: 1 })
    expect(layoutNoticeOf(menu)).toEqual(notice('why'))
  })

  test('adversarial: closed and on-empty-space have no check and no notice', () => {
    const menus: ContextMenu[] = [{ kind: 'closed' }, { kind: 'on-empty-space', x: 0, y: 0 }]
    for (const menu of menus) {
      expect(layoutFitOf(menu)).toEqual({ kind: 'unavailable' })
      expect(layoutNoticeOf(menu)).toBeNull()
    }
  })
})

describe('withLayoutNotice', () => {
  test('spec: a later notice replaces an earlier one', () => {
    const menu = withLayoutNotice(withLayoutNotice(openOnSlide(0, 0, 0, 1), notice('first')), notice('second'))
    expect(layoutNoticeOf(menu)).toEqual(notice('second'))
  })

  test('adversarial: a notice with an empty layout and reason is still a notice, not "no notice"', () => {
    expect(layoutNoticeOf(withLayoutNotice(openOnSlide(0, 0, 0, 1), { kind: 'mismatch', layout: '', reason: '' }))).toEqual({ kind: 'mismatch', layout: '', reason: '' })
  })

  test('adversarial: a no-op outside on-slide', () => {
    const closed: ContextMenu = { kind: 'closed' }
    expect(withLayoutNotice(closed, notice('why'))).toBe(closed)
  })

  test('adversarial: the notice does not survive the menu being opened again', () => {
    expect(layoutNoticeOf(withLayoutNotice(openOnSlide(0, 0, 0, 1), notice('why')))).toEqual(notice('why'))
    expect(layoutNoticeOf(openOnSlide(0, 0, 0, 2))).toBeNull()
  })
})

describe('non-functional: fit check answers racing right-clicks', () => {
  // Robustness under arbitrary interleaving: however right-clicks, menu
  // closes, and (late, duplicated, or out-of-order) answers interleave, the
  // open menu only ever shows the answer to its *own* request — never
  // another right-click's verdicts — and a settled check never changes.
  type Step =
    | { type: 'open'; index: number }
    | { type: 'close' }
    | { type: 'answer'; request: number; fits: boolean }

  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.record({ type: fc.constant('open' as const), index: fc.nat({ max: 3 }) }),
    fc.record({ type: fc.constant('close' as const) }),
    fc.record({ type: fc.constant('answer' as const), request: fc.nat({ max: 8 }), fits: fc.boolean() }),
  )

  const verdictsFor = (request: number, fits: boolean): LayoutVerdict[] => [
    { layout: `for-request-${String(request)}`, fit: fits ? { kind: 'fits' } : { kind: 'mismatch', reason: 'x' } },
  ]

  test('property: a settled check always carries its own request\'s answer, and never settles twice', () => {
    fc.assert(fc.property(fc.array(step, { maxLength: 40 }), steps => {
      let menu: ContextMenu = { kind: 'closed' }
      let nextRequest = 0
      let openRequest: number | null = null
      for (const s of steps) {
        if (s.type === 'open') {
          openRequest = nextRequest++
          menu = openOnSlide(s.index, 0, 0, openRequest)
        } else if (s.type === 'close') {
          openRequest = null
          menu = { kind: 'closed' }
        } else {
          const before = layoutFitOf(menu)
          menu = withLayoutFitResult(menu, s.request, verdictsFor(s.request, s.fits))
          if (before.kind !== 'checking') expect(layoutFitOf(menu)).toEqual(before)
        }
        const fit = layoutFitOf(menu)
        if (fit.kind === 'checking') expect(fit.requestId).toBe(openRequest!)
        if (fit.kind === 'checked') expect(fit.verdicts[0].layout).toBe(`for-request-${String(openRequest)}`)
      }
    }))
  })
})
