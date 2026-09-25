# Peitho Studio brand assets

The mark is Peitho herself — the Greek goddess of persuasion the engine is
named after — in profile, the way Greek vases and coins show her:

- **Krobylos and fillet.** Her hair is tied back into a knot at the nape,
  with a fillet (*stephane*) across the crown. The spiral in the knot is
  the ball of twine she holds in vase painting, drawn as semicircles on one
  axis like an Ionic volute.
- **Kawaii, in proportion only.** A big round head, a short neck and an
  eye closed in a smile.
- **No colour.** Ink `#111111` and paper `#ffffff`, the same two
  peitho.gosu.ke uses. The mark is one silhouette with its lines cut out in
  the ground's colour; on dark grounds the two swap.

Background on Peitho's attributes: [Theoi](https://www.theoi.com/Daimon/Peitho.html).

## Files

Everything here (and `public/favicon.svg`, and `src-tauri/icons/`) is
generated — edit `scripts/brand/mark.ts`, then run `bun run icons`.

| File | What it is |
| --- | --- |
| `logo-mark.svg` | Ink silhouette, paper lines. For light backgrounds. |
| `logo-mark-inverse.svg` | Paper silhouette, ink lines. For dark backgrounds. |
| `logo-wordmark.svg` | Mark + "Peitho Studio" in Charis SIL, −0.03 em tracking, converted to paths. |
| `logo-wordmark-inverse.svg` | The wordmark for dark backgrounds. |
| `app-icon.svg` | The app icon: a paper-white Peitho on an ink tile — a continuous-corner squircle (superellipse, n = 5) on the macOS grid, an 824 px body on a 1024 px canvas, with a soft drop shadow. |
| `app-icon-small.svg` | The same icon with the small cut, used for every raster at 48 px and below. |
| `app-icon.png` | `app-icon.svg` at 1024 px, for previews. |

The wordmark's face is [Charis SIL](https://software.sil.org/charis/)
(SIL Open Font License 1.1), chosen because it descends from Bitstream
Charter — the fallback peitho.gosu.ke itself names after Iowan Old Style.
The outlines are embedded as paths, so no font ships with the SVG.

## Two cuts

Like a type family's optical sizes, the mark has a full cut and a small
cut (`markBody` / `markSmallBody` in `scripts/brand/mark.ts`). At 48 px and
below the spiral falls under a pixel, so the small cut drops it and draws the remaining lines — hairline, fillet, eye —
nearly twice as heavy.

`tauri icon` can't do this — it resizes one image into every size — so
`scripts/build-brand.ts` renders each size on its own and packs
`icon.icns` / `icon.ico` itself (`scripts/brand/iconContainers.ts`).

## Regenerating

```sh
bun run icons
```

Rasterizes with Playwright's Chromium: the system Chrome by default, or
`CHROME_BIN=/path/to/chromium bun run icons`.

## macOS 26 (Tahoe)

macOS 26 draws app icons that aren't a full squircle inside a grey
squircle. This icon is a full-bleed squircle on Apple's grid, but it is
still a classic `.icns`; whether Tahoe shows it unmodified has not been
checked on a real device yet, and the Liquid Glass treatment would need an
Icon Composer (`.icon`) source on top of this.

## Usage

The source code is MIT-licensed; the "Peitho Studio" name and these assets
are not (see the top-level README). Use them to refer to Peitho Studio
itself — don't add colour to the mark, redraw her face, or set the
wordmark in a different face.
