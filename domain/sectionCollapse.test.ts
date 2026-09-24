import { describe, expect, test } from 'bun:test'
import type { ManifestSection, ManifestSlide } from './render'
import { type SlideListEntry } from './slideList'
import { collapseKeyAt, collapsedSectionContaining, collapsedSectionStarts, lastVisibleRow, rowVisibilities, sectionSpans, toggleCollapsedKey } from './sectionCollapse'

function rendered(sourceIndex: number, manifestIndex: number, key: string): SlideListEntry {
  const slide: ManifestSlide = { index: manifestIndex, key, src: '', hasNotes: false, skip: false, revealSteps: 1, text: { title: key, body: '', code: '' } }
  return { kind: 'rendered', sourceIndex, manifestIndex, slide }
}

function placeholder(sourceIndex: number): SlideListEntry {
  return { kind: 'placeholder', sourceIndex, title: '', draft: true, key: `placeholder:${String(sourceIndex)}`, lastRenderedKey: null }
}

function section(name: string, startIndex: number, endIndex: number): ManifestSection {
  return { name, startIndex, endIndex, plannedDurationMs: 60_000 }
}

describe('toggleCollapsedKey', () => {
  test('spec: Given no collapsed sections, when a section is toggled, then it is collapsed', () => {
    expect(toggleCollapsedKey([], 'intro')).toEqual(['intro'])
  })

  test('spec: Given a collapsed section, when it is toggled again, then it is expanded and the others stay collapsed', () => {
    expect(toggleCollapsedKey(['intro', 'body'], 'intro')).toEqual(['body'])
  })

  test('adversarial: the input list is never mutated', () => {
    const collapsed = ['intro']
    toggleCollapsedKey(collapsed, 'body')
    toggleCollapsedKey(collapsed, 'intro')
    expect(collapsed).toEqual(['intro'])
  })

  test('adversarial: an empty-string key toggles like any other key', () => {
    expect(toggleCollapsedKey(toggleCollapsedKey([], ''), '')).toEqual([])
  })
})

describe('sectionSpans', () => {
  test('spec: Given headers on rows 0 and 3 of 5, then each section runs to the row before the next header, the last to the end', () => {
    expect(sectionSpans([0, 3], 5)).toEqual([{ start: 0, end: 2 }, { start: 3, end: 4 }])
  })

  test('spec: rows before the first header belong to no section', () => {
    expect(sectionSpans([2], 4)).toEqual([{ start: 2, end: 3 }])
  })

  test('spec: a section whose header is on the last row spans just that row', () => {
    expect(sectionSpans([0, 2], 3)).toEqual([{ start: 0, end: 1 }, { start: 2, end: 2 }])
  })

  test('adversarial: unsorted and duplicated starts give the same spans as sorted, unique ones', () => {
    expect(sectionSpans([3, 0, 3], 5)).toEqual(sectionSpans([0, 3], 5))
  })

  test('adversarial: starts outside the list (negative, past the end, fractional, NaN) are dropped', () => {
    expect(sectionSpans([-1, 1, 5, 1.5, Number.NaN], 5)).toEqual([{ start: 1, end: 4 }])
  })

  test('adversarial: an empty list or no headers gives no sections', () => {
    expect(sectionSpans([0], 0)).toEqual([])
    expect(sectionSpans([], 5)).toEqual([])
  })
})

describe('collapseKeyAt', () => {
  const entries = [rendered(0, 0, 'intro'), placeholder(1)]

  test('spec: Given a header on a rendered slide, then its key is that slide\'s key', () => {
    expect(collapseKeyAt(entries, 0)).toBe('intro')
  })

  test('adversarial: a placeholder row, a negative row or a row past the end has no key', () => {
    expect(collapseKeyAt(entries, 1)).toBeNull()
    expect(collapseKeyAt(entries, -1)).toBeNull()
    expect(collapseKeyAt(entries, 2)).toBeNull()
    expect(collapseKeyAt([], 0)).toBeNull()
  })
})

describe('collapsedSectionStarts', () => {
  const entries = [rendered(0, 0, 'intro'), rendered(1, 1, 'more'), placeholder(2), rendered(3, 2, 'demo')]
  const starts = { 0: section('Intro', 0, 1), 3: section('Demo', 2, 2) }

  test('spec: Given the Demo section collapsed by its first slide\'s key, then its header row is reported', () => {
    expect(collapsedSectionStarts(entries, starts, ['demo'])).toEqual([3])
  })

  test('spec: Given a slide inserted above Demo, then the same key still finds Demo on its new row', () => {
    const shifted = [rendered(0, 0, 'intro'), rendered(1, 1, 'new'), rendered(2, 2, 'more'), placeholder(3), rendered(4, 3, 'demo')]
    expect(collapsedSectionStarts(shifted, { 0: section('Intro', 0, 2), 4: section('Demo', 3, 3) }, ['demo'])).toEqual([4])
  })

  test('adversarial: a key of a slide that does not start a section folds nothing', () => {
    expect(collapsedSectionStarts(entries, starts, ['more'])).toEqual([])
  })

  test('adversarial: a stale key no longer in the deck folds nothing', () => {
    expect(collapsedSectionStarts(entries, starts, ['gone'])).toEqual([])
  })

  test('adversarial: a section start pointing at a placeholder or past the rows is skipped', () => {
    expect(collapsedSectionStarts(entries, { 2: section('X', 0, 0), 9: section('Y', 0, 0) }, ['placeholder:2', 'intro'])).toEqual([])
  })

  test('adversarial: results come back in row order whatever order the keys were collapsed in', () => {
    expect(collapsedSectionStarts(entries, starts, ['demo', 'intro'])).toEqual([0, 3])
  })
})

describe('rowVisibilities', () => {
  const spans = [{ start: 0, end: 2 }, { start: 3, end: 4 }]

  test('spec: Given nothing collapsed, then every row shows in full', () => {
    expect(rowVisibilities(spans, [], 5)).toEqual(['full', 'full', 'full', 'full', 'full'])
  })

  test('spec: Given the first section collapsed, then its header row keeps only the header, its other rows hide, and the next section is untouched', () => {
    expect(rowVisibilities(spans, [0], 5)).toEqual(['header-only', 'hidden', 'hidden', 'full', 'full'])
  })

  test('spec: Given both sections collapsed, then only the two header rows show', () => {
    expect(rowVisibilities(spans, [0, 3], 5)).toEqual(['header-only', 'hidden', 'hidden', 'header-only', 'hidden'])
  })

  test('adversarial: a collapsed start that is not a section start is ignored', () => {
    expect(rowVisibilities(spans, [1, 7], 5)).toEqual(['full', 'full', 'full', 'full', 'full'])
  })

  test('adversarial: spans reaching past rowCount never grow the result', () => {
    expect(rowVisibilities([{ start: 0, end: 10 }], [0], 2)).toEqual(['header-only', 'hidden'])
  })

  test('adversarial: zero or negative rowCount gives no rows', () => {
    expect(rowVisibilities(spans, [0], 0)).toEqual([])
    expect(rowVisibilities(spans, [0], -1)).toEqual([])
  })
})

describe('collapsedSectionContaining', () => {
  const spans = [{ start: 1, end: 2 }, { start: 3, end: 4 }]

  test('spec: Given the first section collapsed, when a slide inside it is selected, then that section is the one to expand', () => {
    expect(collapsedSectionContaining(spans, [1], 2)).toBe(1)
  })

  test('spec: the header row\'s own slide counts too, since its thumbnail is hidden', () => {
    expect(collapsedSectionContaining(spans, [1], 1)).toBe(1)
  })

  test('spec: Given a slide selected in an expanded section, then there is nothing to expand', () => {
    expect(collapsedSectionContaining(spans, [1], 3)).toBeNull()
  })

  test('adversarial: rows before the first section, past the end, negative or null have nothing to expand', () => {
    expect(collapsedSectionContaining(spans, [1, 3], 0)).toBeNull()
    expect(collapsedSectionContaining(spans, [1, 3], 5)).toBeNull()
    expect(collapsedSectionContaining(spans, [1, 3], -1)).toBeNull()
    expect(collapsedSectionContaining(spans, [1, 3], null)).toBeNull()
  })

  test('adversarial: no sections at all has nothing to expand', () => {
    expect(collapsedSectionContaining([], [0], 0)).toBeNull()
  })
})

describe('lastVisibleRow', () => {
  test('spec: Given the last section collapsed, then the drop line after the list goes on its header row', () => {
    expect(lastVisibleRow(['full', 'header-only', 'hidden', 'hidden'])).toBe(1)
  })

  test('spec: Given nothing hidden, then it is the last row', () => {
    expect(lastVisibleRow(['full', 'full'])).toBe(1)
  })

  test('adversarial: no rows, or every row hidden, gives null', () => {
    expect(lastVisibleRow([])).toBeNull()
    expect(lastVisibleRow(['hidden', 'hidden'])).toBeNull()
  })
})

describe('non-functional: a large deck', () => {
  test('Given 2000 slides in 200 sections, all collapsed, then visibility is computed well under a frame budget', () => {
    const rowCount = 2000
    const starts = Array.from({ length: 200 }, (_, i) => i * 10)
    const t0 = performance.now()
    const spans = sectionSpans(starts, rowCount)
    const visibility = rowVisibilities(spans, starts, rowCount)
    const elapsed = performance.now() - t0
    expect(visibility.filter(v => v === 'header-only')).toHaveLength(200)
    expect(visibility.filter(v => v === 'hidden')).toHaveLength(1800)
    expect(elapsed).toBeLessThan(50)
  })
})
