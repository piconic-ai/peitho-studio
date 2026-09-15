import { describe, expect, test } from 'bun:test'
import { savedSectionDraft, sectionStartByIndex, type ManifestSection } from './render'

function section(name: string, startIndex: number): ManifestSection {
  return { name, startIndex, endIndex: startIndex + 1, plannedDurationMs: 60_000 }
}

describe('savedSectionDraft', () => {
  test('spec: starts from the section\'s saved name and planned time in milliseconds', () => {
    expect(savedSectionDraft({ name: 'Intro', startIndex: 0, endIndex: 2, plannedDurationMs: 90_000 }))
      .toEqual({ name: 'Intro', timeMs: 90_000 })
  })

  test('adversarial: an empty name and a zero-length section are carried over as-is', () => {
    expect(savedSectionDraft({ name: '', startIndex: 4, endIndex: 4, plannedDurationMs: 0 }))
      .toEqual({ name: '', timeMs: 0 })
  })

  test('adversarial: a planned time written in a format parseDurationToMs doesn\'t read (e.g. "1h") still arrives intact, since peitho-core already parsed it into milliseconds', () => {
    expect(savedSectionDraft({ name: 'Long', startIndex: 0, endIndex: 0, plannedDurationMs: 3_600_000 }).timeMs)
      .toBe(3_600_000)
  })
})

describe('sectionStartByIndex', () => {
  test('spec: indexes each section under its startIndex', () => {
    const sections = [section('Intro', 0), section('Middle', 3)]
    expect(sectionStartByIndex(sections)).toEqual({ 0: section('Intro', 0), 3: section('Middle', 3) })
  })

  test('spec: a slide index with no section starting there has no entry', () => {
    const result = sectionStartByIndex([section('Intro', 0)])
    expect(result[1]).toBeUndefined()
  })

  test('adversarial: an empty section list yields an empty record', () => {
    expect(sectionStartByIndex([])).toEqual({})
  })

  test('adversarial: two sections claiming the same startIndex — the later one wins (last write)', () => {
    const first = section('First', 0)
    const second = section('Second', 0)
    expect(sectionStartByIndex([first, second])).toEqual({ 0: second })
  })
})
