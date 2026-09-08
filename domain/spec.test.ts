import { describe, expect, test } from 'bun:test'
import { defineExamples, isExhaustivelyAccountedFor, type Example } from './spec'

describe('defineExamples', () => {
  test('spec: partitions cases into automated and manual by the presence of `manual`', () => {
    const cases: Example<number, string>[] = [
      { id: 'a', given: 'g', when: 'w', then: 't', state: 1, event: 'e', expect: 1 },
      { id: 'b', given: 'g', when: 'w', then: 't', state: 2, event: 'e', expect: 2, manual: { reason: 'needs a real window' } },
    ]
    const set = defineExamples('thing', cases)
    expect(set.subject).toBe('thing')
    expect(set.all).toEqual(cases)
    expect(set.automated.map(c => c.id)).toEqual(['a'])
    expect(set.manual.map(c => c.id)).toEqual(['b'])
  })

  test('adversarial: an empty case list produces empty automated/manual lists', () => {
    const set = defineExamples('empty', [])
    expect(set.automated).toEqual([])
    expect(set.manual).toEqual([])
  })
})

describe('isExhaustivelyAccountedFor', () => {
  test('spec: true when every case is automated or manual (i.e. always, given the partition above)', () => {
    const set = defineExamples('thing', [
      { id: 'a', given: 'g', when: 'w', then: 't', state: 1, event: 'e', expect: 1 },
      { id: 'b', given: 'g', when: 'w', then: 't', state: 2, event: 'e', expect: 2, manual: { reason: 'x' } },
    ])
    expect(isExhaustivelyAccountedFor(set)).toBe(true)
  })

  test('adversarial: still true for an empty set', () => {
    expect(isExhaustivelyAccountedFor(defineExamples('empty', []))).toBe(true)
  })
})
