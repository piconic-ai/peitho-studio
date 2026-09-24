import { describe, expect, test } from 'bun:test'
import { createEditorSlideStates } from './editorSlideStates'

// Each kept state is stood in for by the name of the slide it belongs to,
// so every test reads as "the state of slide X ends up at position N".
function cacheOf(entries: Record<number, string>) {
  const cache = createEditorSlideStates<string>()
  for (const [index, entry] of Object.entries(entries)) cache.store(Number(index), entry)
  return cache
}

function positionsOf(cache: ReturnType<typeof cacheOf>, count: number): (string | undefined)[] {
  return Array.from({ length: count }, (_, i) => cache.take(i))
}

describe('createEditorSlideStates', () => {
  test('spec: Given a state kept for slide 1, when slide 1 is taken, then that state comes back once, and a second take finds nothing', () => {
    const cache = cacheOf({ 1: 'B' })
    expect(cache.take(1)).toBe('B')
    expect(cache.take(1)).toBeUndefined()
  })

  test('spec: Given a state kept for a slide, when another state is stored for it, then the newer one replaces it', () => {
    const cache = cacheOf({ 0: 'old' })
    cache.store(0, 'new')
    expect(cache.take(0)).toBe('new')
  })

  test('spec: Given states for slides A, B, C, when a slide is inserted before B, then B and C move down one and A stays', () => {
    const cache = cacheOf({ 0: 'A', 1: 'B', 2: 'C' })
    cache.shift({ type: 'insert', at: 1, text: 'new' })
    expect(positionsOf(cache, 4)).toEqual(['A', undefined, 'B', 'C'])
  })

  test('spec: Given states for slides A, B, C, when B is deleted, then its state is gone and C moves up one', () => {
    const cache = cacheOf({ 0: 'A', 1: 'B', 2: 'C' })
    cache.shift({ type: 'delete', index: 1 })
    expect(positionsOf(cache, 3)).toEqual(['A', 'C', undefined])
  })

  test('spec: Given states for slides A, B, C, when C is moved to the top, then every state follows its slide', () => {
    const cache = cacheOf({ 0: 'A', 1: 'B', 2: 'C' })
    cache.shift({ type: 'move', from: 2, to: 0 })
    expect(positionsOf(cache, 3)).toEqual(['C', 'A', 'B'])
  })

  test('spec: Given states for slides A, B, when B is replaced, then every state stays where it was', () => {
    const cache = cacheOf({ 0: 'A', 1: 'B' })
    cache.shift({ type: 'replace', index: 1, text: 'x' })
    expect(positionsOf(cache, 2)).toEqual(['A', 'B'])
  })

  test('spec: Given states kept for several slides, when the cache is cleared, then none of them comes back', () => {
    const cache = cacheOf({ 0: 'A', 1: 'B' })
    cache.clear()
    expect(positionsOf(cache, 2)).toEqual([undefined, undefined])
  })

  test('adversarial: an empty cache takes nothing and shifts without error', () => {
    const cache = createEditorSlideStates<string>()
    expect(cache.take(0)).toBeUndefined()
    cache.shift({ type: 'delete', index: 0 })
    cache.shift({ type: 'insert', at: 0, text: '' })
    expect(cache.take(0)).toBeUndefined()
  })

  test('adversarial: a state stored at a negative position is dropped by the next shift rather than landing on a real slide', () => {
    const cache = cacheOf({ [-1]: 'ghost' })
    cache.shift({ type: 'replace', index: 0, text: 'x' })
    expect(cache.take(-1)).toBeUndefined()
    expect(cache.take(0)).toBeUndefined()
  })

  test('adversarial: shifting a gap-filled cache (only some slides visited) keeps each state on its own slide', () => {
    const cache = cacheOf({ 0: 'A', 3: 'D' })
    cache.shift({ type: 'move', from: 3, to: 1 })
    cache.shift({ type: 'delete', index: 0 })
    expect(positionsOf(cache, 4)).toEqual(['D', undefined, undefined, undefined])
  })
})
