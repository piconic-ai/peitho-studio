import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { pairwiseCases, type ParamSpace } from './pairwise'

function allPairsCovered(space: ParamSpace, cases: Case[]): boolean {
  const keys = Object.keys(space)
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      for (const va of space[keys[i]]) {
        for (const vb of space[keys[j]]) {
          const covered = cases.some(c => c[keys[i]] === va && c[keys[j]] === vb)
          if (!covered) return false
        }
      }
    }
  }
  return true
}

type Case = Record<string, unknown>

describe('pairwiseCases', () => {
  test('spec: two 2-valued params yields the full 2x2 combination set (no pair to skip)', () => {
    const cases = pairwiseCases({ a: [1, 2], b: ['x', 'y'] })
    expect(cases.length).toBe(4)
    expect(allPairsCovered({ a: [1, 2], b: ['x', 'y'] }, cases)).toBe(true)
  })

  test('spec: every pairwise combination is covered for a larger space, using far fewer cases than the full product', () => {
    const space = { a: [1, 2, 3], b: ['x', 'y'], c: [true, false], d: ['p', 'q', 'r'] }
    const cases = pairwiseCases(space)
    expect(allPairsCovered(space, cases)).toBe(true)
    // Full product would be 3*2*2*3 = 36; pairwise should need far fewer.
    expect(cases.length).toBeLessThan(36)
  })

  test('property: for any space of 2-4 params with 1-4 values each, every pairwise combination is covered', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 3 }).filter(s => /^[a-zA-Z]+$/.test(s)),
          fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 4 }).map(vs => [...new Set(vs)]),
          { minKeys: 2, maxKeys: 4 },
        ).filter(space => Object.values(space).every(vs => vs.length > 0)),
        space => {
          const cases = pairwiseCases(space)
          expect(allPairsCovered(space, cases)).toBe(true)
        },
      ),
      { numRuns: 50 },
    )
  })

  test('adversarial: an empty param space produces no cases', () => {
    expect(pairwiseCases({})).toEqual([])
  })

  test('adversarial: a single param yields one case per value, unchanged', () => {
    expect(pairwiseCases({ a: [1, 2, 3] })).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })

  test('adversarial: a param with exactly one value still gets covered', () => {
    const space = { a: ['only'], b: [1, 2, 3] }
    const cases = pairwiseCases(space)
    expect(allPairsCovered(space, cases)).toBe(true)
  })
})
