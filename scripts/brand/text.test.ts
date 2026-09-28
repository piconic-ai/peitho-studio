import { describe, expect, test } from 'bun:test'
import { loadCharisSil, textPath } from './text'

const font = loadCharisSil()

describe('textPath', () => {
  test('Given a word, When set, Then it yields a non-empty path whose width grows with the size', () => {
    const small = textPath(font, 'Peitho', 10)
    const large = textPath(font, 'Peitho', 20)
    expect(small.d).toStartWith('M')
    expect(small.width).toBeGreaterThan(0)
    expect(large.width).toBeCloseTo(small.width * 2, 6)
    expect(large.capHeight).toBeCloseTo(small.capHeight * 2, 6)
  })

  test('Given tracking, When set, Then only the gaps between letters widen, not after the last one', () => {
    const plain = textPath(font, 'abc', 100)
    const tracked = textPath(font, 'abc', 100, 0.1)
    expect(tracked.width - plain.width).toBeCloseTo(2 * 10, 6)
  })

  test('Given a single letter, When set with tracking, Then tracking does not change its width', () => {
    expect(textPath(font, 'a', 100, 0.5).width).toBeCloseTo(textPath(font, 'a', 100).width, 6)
  })

  test('Given an empty string, When set, Then the path is empty and the width is zero even with tracking', () => {
    expect(textPath(font, '', 100)).toMatchObject({ d: '', width: 0 })
    expect(textPath(font, '', 100, -0.03).width).toBe(0)
  })

  test('Given a character the font lacks, When set, Then it falls back to a glyph instead of throwing', () => {
    const r = textPath(font, '漢', 100)
    expect(Number.isFinite(r.width)).toBe(true)
    expect(r.width).toBeGreaterThanOrEqual(0)
  })

  test('Given a zero size, When set, Then nothing has extent', () => {
    expect(textPath(font, 'abc', 0).width).toBe(0)
  })
})
