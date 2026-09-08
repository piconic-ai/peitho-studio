import { describe, expect, test } from 'bun:test'
import { sectionStartByIndex, type ManifestSection } from './render'

function section(name: string, startIndex: number): ManifestSection {
  return { name, startIndex, endIndex: startIndex + 1, plannedDurationMs: 60_000 }
}

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
