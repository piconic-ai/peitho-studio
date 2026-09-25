import { describe, expect, test } from 'bun:test'
import { encodeIco, encodeIcns, pngSize } from './iconContainers'

// The smallest byte string pngSize accepts: signature + an IHDR header.
function fakePng(width: number, height: number, extra = 0): Uint8Array {
  const out = new Uint8Array(33 + extra)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(out.buffer)
  view.setUint32(8, 13)
  out.set([0x49, 0x48, 0x44, 0x52], 12) // IHDR
  view.setUint32(16, width)
  view.setUint32(20, height)
  return out
}

const ascii = (bytes: Uint8Array, at: number, len: number) => String.fromCharCode(...bytes.slice(at, at + len))

describe('pngSize', () => {
  test('Given a PNG header, When read, Then returns its IHDR dimensions', () => {
    expect(pngSize(fakePng(1024, 512))).toEqual({ width: 1024, height: 512 })
  })

  test('Given a PNG inside a larger buffer (non-zero byteOffset), When read, Then still reads its own header', () => {
    const backing = new Uint8Array(100)
    backing.set(fakePng(16, 16), 40)
    expect(pngSize(backing.subarray(40))).toEqual({ width: 16, height: 16 })
  })

  test.each([
    ['empty', new Uint8Array(0)],
    ['truncated', fakePng(16, 16).slice(0, 20)],
    ['wrong signature', (() => { const p = fakePng(16, 16); p[1] = 0; return p })()],
    ['first chunk not IHDR', (() => { const p = fakePng(16, 16); p[12] = 0x58; return p })()],
  ])('Given %s input, When read, Then throws', (_label, bytes) => {
    expect(() => pngSize(bytes)).toThrow()
  })
})

describe('encodeIcns', () => {
  test('Given two PNG entries, When encoded, Then writes the icns header, total length and each typed element in order', () => {
    const a = fakePng(16, 16, 3)
    const b = fakePng(1024, 1024)
    const out = encodeIcns([{ type: 'icp4', png: a }, { type: 'ic10', png: b }])
    const view = new DataView(out.buffer)
    expect(ascii(out, 0, 4)).toBe('icns')
    expect(view.getUint32(4)).toBe(out.length)
    expect(out.length).toBe(8 + 8 + a.length + 8 + b.length)
    expect(ascii(out, 8, 4)).toBe('icp4')
    expect(view.getUint32(12)).toBe(8 + a.length)
    expect(Array.from(out.slice(16, 16 + a.length))).toEqual(Array.from(a))
    const second = 16 + a.length
    expect(ascii(out, second, 4)).toBe('ic10')
    expect(view.getUint32(second + 4)).toBe(8 + b.length)
  })

  test('Given the @2x type for 16pt (ic11), When given a 32 px PNG, Then accepts it', () => {
    expect(() => encodeIcns([{ type: 'ic11', png: fakePng(32, 32) }])).not.toThrow()
  })

  test('Given no entries, When encoded, Then throws', () => {
    expect(() => encodeIcns([])).toThrow(/no entries/)
  })

  test('Given a PNG whose size does not match its type, When encoded, Then throws naming both sizes', () => {
    expect(() => encodeIcns([{ type: 'ic07', png: fakePng(64, 64) }])).toThrow(/128×128.*64×64/)
  })

  test('Given a non-square PNG, When encoded, Then throws', () => {
    expect(() => encodeIcns([{ type: 'icp4', png: fakePng(16, 17) }])).toThrow()
  })

  test('Given the same type twice, When encoded, Then throws', () => {
    expect(() => encodeIcns([{ type: 'icp4', png: fakePng(16, 16) }, { type: 'icp4', png: fakePng(16, 16) }])).toThrow(/duplicate/)
  })

  test('Given an unknown type, When encoded, Then throws', () => {
    // @ts-expect-error — exercising the runtime guard for untyped callers
    expect(() => encodeIcns([{ type: 'ic99', png: fakePng(16, 16) }])).toThrow(/unknown type/)
  })
})

describe('encodeIco', () => {
  test('Given PNG entries, When encoded, Then writes an ICONDIR and one directory entry per PNG pointing at its data', () => {
    const small = fakePng(16, 16, 5)
    const large = fakePng(256, 256)
    const out = encodeIco([small, large])
    const view = new DataView(out.buffer)
    expect(view.getUint16(0, true)).toBe(0)
    expect(view.getUint16(2, true)).toBe(1)
    expect(view.getUint16(4, true)).toBe(2)
    // first entry: 16×16
    expect(out[6]).toBe(16)
    expect(out[7]).toBe(16)
    expect(view.getUint16(6 + 4, true)).toBe(1)
    expect(view.getUint16(6 + 6, true)).toBe(32)
    expect(view.getUint32(6 + 8, true)).toBe(small.length)
    const firstOffset = view.getUint32(6 + 12, true)
    expect(firstOffset).toBe(6 + 16 * 2)
    expect(Array.from(out.slice(firstOffset, firstOffset + small.length))).toEqual(Array.from(small))
    // second entry: 256 is encoded as 0
    expect(out[22]).toBe(0)
    expect(out[23]).toBe(0)
    expect(view.getUint32(22 + 12, true)).toBe(firstOffset + small.length)
    expect(out.length).toBe(6 + 32 + small.length + large.length)
  })

  test('Given no entries, When encoded, Then throws', () => {
    expect(() => encodeIco([])).toThrow(/no entries/)
  })

  test.each([[257, 257], [0, 16], [512, 512]])('Given a %i×%i PNG, When encoded, Then throws (ico holds 1–256 px)', (w, h) => {
    expect(() => encodeIco([fakePng(w, h)])).toThrow(/1–256/)
  })

  test('Given two PNGs of the same size, When encoded, Then throws', () => {
    expect(() => encodeIco([fakePng(32, 32), fakePng(32, 32)])).toThrow(/duplicate/)
  })

  test('Given bytes that are not a PNG, When encoded, Then throws', () => {
    expect(() => encodeIco([new Uint8Array([1, 2, 3])])).toThrow()
  })
})
