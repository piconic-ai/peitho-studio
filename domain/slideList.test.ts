import { describe, expect, test } from 'bun:test'
import { isExhaustivelyAccountedFor } from './spec'
import type { ManifestSection, ManifestSlide } from './render'
import {
  buildSlideList, manifestIndexAt, manifestIndexToSourceIndex, recordByManifestIndex, sectionStartBySourceIndex,
  type SlideListEntry,
} from './slideList'
import { buildSlideListExamples } from './slideList.examples'

function slide(index: number, key: string, title: string, skip = false): ManifestSlide {
  return { index, key, src: '', hasNotes: false, skip, revealSteps: 1, text: { title, body: '', code: '' } }
}

describe('buildSlideList', () => {
  test.each(buildSlideListExamples.automated.map(e => [`${e.id}: Given ${e.given}, when ${e.when}, then ${e.then}`, e] as const))(
    'example: %s',
    (_title, example) => {
      expect(buildSlideList(example.state.fullSource, example.state.manifestSlides)).toEqual(example.expect)
    },
  )

  test('spec: every example is either automated or carries a manual reason', () => {
    expect(isExhaustivelyAccountedFor(buildSlideListExamples)).toBe(true)
  })

  test('adversarial: empty source has no rows at all', () => {
    expect(buildSlideList('', [])).toEqual([])
  })

  test('adversarial: an all-draft deck never claims a manifest slide, however many are handed to it', () => {
    const source = '<!-- {"draft":true} -->\n# One\n\n---\n\n<!-- {"draft":true} -->\n# Two\n'
    // peitho-core would refuse to build this deck at all ("every slide is
    // marked draft"), so a real caller would never have manifest slides to
    // pass here — but the function itself shouldn't assume that and crash.
    const entries = buildSlideList(source, [slide(0, 'stray', 'Stray')])
    expect(entries.every(e => e.kind === 'placeholder' && e.draft)).toBe(true)
  })

  test('adversarial: only a strict JSON true counts as draft, matching domain/slideStatus.ts\'s own rule', () => {
    const source = '<!-- {"draft":"true"} -->\n# Looks draft\n'
    const entries = buildSlideList(source, [slide(0, 'looks-draft', 'Looks draft')])
    expect(entries).toEqual([{ kind: 'rendered', sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'looks-draft', 'Looks draft') }])
  })

  test('adversarial: a title-less draft slide gets an empty placeholder title, not a crash', () => {
    const entries = buildSlideList('<!-- {"draft":true} -->\nJust a paragraph, no heading.\n', [])
    expect(entries).toEqual([{ kind: 'placeholder', sourceIndex: 0, title: '', draft: true, key: 'placeholder:0' }])
  })

  test('adversarial: a placeholder never reuses the slide\'s own explicit key, even across a draft toggle', () => {
    // A key a placeholder shares with its slide's eventual `rendered` form
    // is exactly what leaves a thumbnail's canvas permanently blank after
    // un-drafting it — BarefootJS's keyed `.map()` doesn't remount a row's
    // canvas `ref` when a key returns to `rendered` after a stint as
    // `placeholder` on that same key (see PlaceholderSlideEntry's own doc
    // comment). Simulates the toggle by calling buildSlideList twice with
    // the same explicit key, draft then not.
    const draftEntry = buildSlideList('<!-- {"draft":true,"key":"cover"} -->\n# Cover\n', [])[0]
    const renderedEntry = buildSlideList('<!-- {"key":"cover"} -->\n# Cover\n', [slide(0, 'cover', 'Cover')])[0]
    if (draftEntry.kind !== 'placeholder' || renderedEntry.kind !== 'rendered') throw new Error('unexpected entry kind')
    expect(draftEntry.key).not.toBe('cover')
    expect(renderedEntry.slide.key).toBe('cover')
    expect(draftEntry.key).not.toBe(renderedEntry.slide.key)
  })
})

describe('manifestIndexAt / manifestIndexToSourceIndex', () => {
  const entries: SlideListEntry[] = [
    { kind: 'rendered', sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'a', 'A') },
    { kind: 'placeholder', sourceIndex: 1, title: 'Hidden', draft: true, key: 'placeholder:1' },
    { kind: 'rendered', sourceIndex: 2, manifestIndex: 1, slide: slide(1, 'c', 'C') },
  ]

  test('spec: a rendered row resolves to its manifest index, a placeholder to null', () => {
    expect(manifestIndexAt(entries, 0)).toBe(0)
    expect(manifestIndexAt(entries, 1)).toBeNull()
    expect(manifestIndexAt(entries, 2)).toBe(1)
  })

  test('adversarial: an out-of-range sourceIndex resolves to null rather than throwing', () => {
    expect(manifestIndexAt(entries, -1)).toBeNull()
    expect(manifestIndexAt(entries, 99)).toBeNull()
  })

  test('spec: the manifest-index -> sourceIndex mapping skips the placeholder entirely', () => {
    expect(manifestIndexToSourceIndex(entries)).toEqual([0, 2])
  })

  test('adversarial: an empty entry list maps to an empty array', () => {
    expect(manifestIndexToSourceIndex([])).toEqual([])
  })
})

describe('recordByManifestIndex', () => {
  const entries: SlideListEntry[] = [
    { kind: 'rendered', sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'a', 'A') },
    { kind: 'placeholder', sourceIndex: 1, title: 'Hidden', draft: true, key: 'placeholder:1' },
    { kind: 'rendered', sourceIndex: 2, manifestIndex: 1, slide: slide(1, 'c', 'C') },
  ]

  test('spec: a draft record keyed by manifest index 1 lands on sourceIndex 2', () => {
    expect(recordByManifestIndex({ 1: { name: 'Part Two', time: '1m' } }, entries))
      .toEqual({ 2: { name: 'Part Two', time: '1m' } })
  })

  test('adversarial: a manifest index the mapping can\'t place is dropped, not thrown', () => {
    expect(recordByManifestIndex({ 5: { name: 'Nowhere', time: '1m' } }, entries)).toEqual({})
  })

  test('adversarial: an empty record stays empty', () => {
    expect(recordByManifestIndex({}, entries)).toEqual({})
  })
})

describe('sectionStartBySourceIndex', () => {
  const entries: SlideListEntry[] = [
    { kind: 'rendered', sourceIndex: 0, manifestIndex: 0, slide: slide(0, 'a', 'A') },
    { kind: 'placeholder', sourceIndex: 1, title: 'Hidden', draft: true, key: 'placeholder:1' },
    { kind: 'rendered', sourceIndex: 2, manifestIndex: 1, slide: slide(1, 'c', 'C') },
  ]

  test('spec: a section starting at manifest index 1 lands on its slide\'s real row (sourceIndex 2), not manifest index 1', () => {
    const section: ManifestSection = { name: 'Part Two', startIndex: 1, endIndex: 1, plannedDurationMs: 30_000 }
    expect(sectionStartBySourceIndex([section], entries)).toEqual({ 2: section })
  })

  test('adversarial: a section index the manifest mapping can\'t place is dropped, not thrown', () => {
    const section: ManifestSection = { name: 'Nowhere', startIndex: 5, endIndex: 5, plannedDurationMs: 1000 }
    expect(sectionStartBySourceIndex([section], entries)).toEqual({})
  })

  test('adversarial: no sections at all yields an empty record', () => {
    expect(sectionStartBySourceIndex([], entries)).toEqual({})
  })
})
