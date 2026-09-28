// Sets a line of text as one SVG path, so an asset needs no font installed.
import opentype, { type Font } from 'opentype.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHARIS_SIL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../node_modules/@fontsource/charis-sil/files/charis-sil-latin-400-normal.woff',
)

/** Charis SIL (OFL), the face the wordmark is set in. */
export function loadCharisSil(): Font {
  return opentype.loadSync(CHARIS_SIL)
}

/**
 * `text` set in `font` on a baseline at y=0, from x=0, with kerning.
 * `tracking` is extra space between letters, in ems; `width` is the
 * advance up to the last glyph, without trailing tracking.
 */
export function textPath(font: Font, text: string, size: number, tracking = 0): { d: string; width: number; capHeight: number } {
  const unit = size / font.unitsPerEm
  const glyphs = font.stringToGlyphs(text)
  let x = 0
  const parts: string[] = []
  glyphs.forEach((glyph, i) => {
    parts.push(glyph.getPath(x, 0, size).toPathData(2))
    x += (glyph.advanceWidth ?? 0) * unit + tracking * size
    if (i + 1 < glyphs.length) x += font.getKerningValue(glyph, glyphs[i + 1]) * unit
  })
  const width = glyphs.length === 0 ? 0 : x - tracking * size
  return { d: parts.join(''), width, capHeight: font.tables.os2.sCapHeight * unit }
}
