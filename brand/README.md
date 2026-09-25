# Peitho Studio brand assets

The mark is Peitho herself — the Greek goddess of persuasion the engine is
named after — in profile, the way Greek coins show her:

- **Hair hanging down.** Her hair runs over the crown and falls behind her
  neck, ending in a curl: the ball of twine she holds in vase painting, and
  an Ionic volute.
- **Expressionless.** A single dot for the eye, nothing else in the face.
- **No colour.** Ink `#111111` and paper `#ffffff`, the same two
  peitho.gosu.ke uses. The mark is the head plus the hair laid over it as a
  band, with a thin gap in the ground's colour between them — one
  silhouette with one line cut into it. On dark grounds the two colours
  swap.

Background on Peitho's attributes: [Theoi](https://www.theoi.com/Daimon/Peitho.html).

## Files

Everything here (and `public/favicon.svg`, and `src-tauri/icons/`) is
generated — edit `scripts/brand/mark.ts`, then run `bun run icons`.

| File | What it is |
| --- | --- |
| `logo-mark.svg` | Ink silhouette, paper gap and eye. For light backgrounds. |
| `logo-mark-inverse.svg` | Paper silhouette, ink gap and eye. For dark backgrounds. |
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
below the 2-unit gap around the hair and the eye would fall under a pixel,
so the small cut draws the gap at 3.5 units and the eye at radius 3.

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
itself — don't add colour to the mark, give her an expression, or set
the wordmark in a different face.
