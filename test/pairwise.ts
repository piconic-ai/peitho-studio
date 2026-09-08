// A minimal, dependency-free pairwise (2-wise) test-case generator —
// see docs/architecture.md's "pairwise testing" note. Deterministic (no
// randomness), so the exact case list a test asserts against never shifts
// between runs. Not necessarily an *optimal* covering array (a true
// solver would produce fewer cases for large spaces) — this is a greedy
// approximation, which is enough for the handful-of-axes judgment
// functions this project uses it for.

export type ParamSpace = Record<string, readonly unknown[]>
export type Case = Record<string, unknown>

function pairId(ka: string, va: unknown, kb: string, vb: unknown): string {
  return `${ka}=${String(va)}|${kb}=${String(vb)}`
}

/** Every (paramA=valueA, paramB=valueB) pair across distinct params. */
function allPairs(space: ParamSpace): Set<string> {
  const keys = Object.keys(space)
  const pairs = new Set<string>()
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      for (const va of space[keys[i]]) {
        for (const vb of space[keys[j]]) {
          pairs.add(pairId(keys[i], va, keys[j], vb))
        }
      }
    }
  }
  return pairs
}

function pairsIn(keys: readonly string[], candidate: Case): string[] {
  const ids: string[] = []
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      ids.push(pairId(keys[i], candidate[keys[i]], keys[j], candidate[keys[j]]))
    }
  }
  return ids
}

/** Generates a case set covering every pairwise combination of parameter
 * values at least once. Each case is seeded from one still-uncovered pair
 * (guaranteeing progress every iteration — picking greedily from scratch
 * for every parameter, including the first, can otherwise pin the first
 * parameter to a single value forever, since a lone value covers no pair
 * by itself and so never looks better than any other), then the remaining
 * parameters are filled in greedily by whichever value covers the most
 * still-uncovered pairs against the choices already made. */
export function pairwiseCases(space: ParamSpace): Case[] {
  const keys = Object.keys(space)
  if (keys.length === 0) return []
  if (keys.length === 1) return space[keys[0]].map(v => ({ [keys[0]]: v }))

  const remaining = allPairs(space)
  const cases: Case[] = []

  while (remaining.size > 0) {
    const seedId = remaining.values().next().value as string
    const [left, right] = seedId.split('|')
    const [seedKeyA, seedValA] = splitPair(left)
    const [seedKeyB, seedValB] = splitPair(right)
    const candidate: Case = { [seedKeyA]: parseValue(space[seedKeyA], seedValA), [seedKeyB]: parseValue(space[seedKeyB], seedValB) }

    for (const key of keys) {
      if (key === seedKeyA || key === seedKeyB) continue
      let bestValue = space[key][0]
      let bestCovered = -1
      for (const value of space[key]) {
        const trial = { ...candidate, [key]: value }
        const covered = pairsIn(Object.keys(trial), trial).filter(id => remaining.has(id)).length
        if (covered > bestCovered) {
          bestCovered = covered
          bestValue = value
        }
      }
      candidate[key] = bestValue
    }
    cases.push(candidate)
    for (const id of pairsIn(keys, candidate)) remaining.delete(id)
  }
  return cases
}

function splitPair(side: string): [string, string] {
  const eq = side.indexOf('=')
  return [side.slice(0, eq), side.slice(eq + 1)]
}

/** `pairId` stringifies values with `String(...)` — recover the original
 * value (by matching its stringified form) so the candidate case holds
 * the real value, not its string form. */
function parseValue(candidates: readonly unknown[], stringified: string): unknown {
  return candidates.find(v => String(v) === stringified)
}
