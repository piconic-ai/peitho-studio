// Pure encoders for the two multi-resolution icon containers Tauri bundles:
// macOS `.icns` and Windows `.ico`. Both just wrap PNGs, which is what lets
// every size be rendered separately — `tauri icon` resizes one source image
// into all of them, so it can't swap in the small cut at 16/32 px.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Width and height from a PNG's IHDR chunk. Throws on anything that isn't a PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  if (png.length < 24 || !PNG_SIGNATURE.every((b, i) => png[i] === b)) {
    throw new TypeError('pngSize: not a PNG (bad signature or truncated header)')
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const chunkType = String.fromCharCode(png[12], png[13], png[14], png[15])
  if (chunkType !== 'IHDR') throw new TypeError(`pngSize: first chunk is ${JSON.stringify(chunkType)}, not IHDR`)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * The `.icns` element types that hold PNG data, and the pixel size each one
 * must be. The @2x types reuse a pixel size under a different point size.
 */
export const ICNS_TYPES = {
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
} as const

export type IcnsType = keyof typeof ICNS_TYPES

export function encodeIcns(entries: readonly { type: IcnsType; png: Uint8Array }[]): Uint8Array {
  if (entries.length === 0) throw new RangeError('encodeIcns: no entries')
  const seen = new Set<string>()
  for (const { type, png } of entries) {
    if (!(type in ICNS_TYPES)) throw new RangeError(`encodeIcns: unknown type ${JSON.stringify(type)}`)
    if (seen.has(type)) throw new RangeError(`encodeIcns: duplicate type ${type}`)
    seen.add(type)
    const { width, height } = pngSize(png)
    const expected = ICNS_TYPES[type]
    if (width !== expected || height !== expected) {
      throw new RangeError(`encodeIcns: ${type} must be ${expected}×${expected}, got ${width}×${height}`)
    }
  }
  const total = 8 + entries.reduce((sum, e) => sum + 8 + e.png.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  writeAscii(out, 0, 'icns')
  view.setUint32(4, total)
  let offset = 8
  for (const { type, png } of entries) {
    writeAscii(out, offset, type)
    view.setUint32(offset + 4, 8 + png.length)
    out.set(png, offset + 8)
    offset += 8 + png.length
  }
  return out
}

/** Encodes PNG-compressed `.ico` entries (read by Windows Vista and later), in the order given. */
export function encodeIco(pngs: readonly Uint8Array[]): Uint8Array {
  if (pngs.length === 0) throw new RangeError('encodeIco: no entries')
  if (pngs.length > 0xffff) throw new RangeError('encodeIco: too many entries')
  const sizes = pngs.map(png => {
    const { width, height } = pngSize(png)
    if (width < 1 || width > 256 || height < 1 || height > 256) {
      throw new RangeError(`encodeIco: entries must be 1–256 px, got ${width}×${height}`)
    }
    return { width, height }
  })
  const seen = new Set<string>()
  for (const { width, height } of sizes) {
    const key = `${width}x${height}`
    if (seen.has(key)) throw new RangeError(`encodeIco: duplicate size ${key}`)
    seen.add(key)
  }
  const headerSize = 6 + 16 * pngs.length
  const total = headerSize + pngs.reduce((sum, png) => sum + png.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint16(0, 0, true) // reserved
  view.setUint16(2, 1, true) // 1 = icon
  view.setUint16(4, pngs.length, true)
  let dataOffset = headerSize
  pngs.forEach((png, i) => {
    const entry = 6 + 16 * i
    const { width, height } = sizes[i]
    out[entry] = width === 256 ? 0 : width // 0 means 256
    out[entry + 1] = height === 256 ? 0 : height
    out[entry + 2] = 0 // palette size
    out[entry + 3] = 0 // reserved
    view.setUint16(entry + 4, 1, true) // colour planes
    view.setUint16(entry + 6, 32, true) // bits per pixel
    view.setUint32(entry + 8, png.length, true)
    view.setUint32(entry + 12, dataOffset, true)
    out.set(png, dataOffset)
    dataOffset += png.length
  })
  return out
}

function writeAscii(out: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
}
