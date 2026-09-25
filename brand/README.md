# Peitho Studio brand assets

The mark is Peitho herself — the Greek goddess of persuasion the engine is
named after — in profile, the way Greek vases and coins show her:

- **Krobylos.** Her hair is tied back into a plain round knot at the nape.
- **Kawaii, in proportion.** A big round head and a short neck.
- **Expressions.** The same head can wear two faces — only the eye
  changes: `neutral` (an open dot, no expression; the default and the app
  icon's) and `calm` (the eye closed, at rest).
- **No colour.** Ink `#111111` and paper `#ffffff`, the same two
  peitho.gosu.ke uses. The mark is one silhouette with its lines cut out in
  the ground's colour; on dark grounds the two swap.

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
| `expressions/<name>.svg` | The mark wearing each expression — `neutral` and `calm` — plus a `-inverse` of each for dark backgrounds. |

The wordmark's face is [Charis SIL](https://software.sil.org/charis/)
(SIL Open Font License 1.1), chosen because it descends from Bitstream
Charter — the fallback peitho.gosu.ke itself names after Iowan Old Style.
The outlines are embedded as paths, so no font ships with the SVG.

## Two cuts

Like a type family's optical sizes, the mark has a full cut and a small
cut (`markBody` / `markSmallBody` in `scripts/brand/mark.ts`). At 48 px and
below the 2-unit hairline and the eye fall under a pixel, so the small
cut draws both heavier.

## Expressions

`EXPRESSIONS` in `scripts/brand/mark.ts` holds her faces; pass one as
`markBody({ expression })`. Each draws only the eye, in the line colour, so every expression keeps the same silhouette and the same
two colours (both are checked by tests). To add one, add an entry there and
run `bun run icons`.

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
itself — don't add colour to the mark, draw her a face outside
`EXPRESSIONS`, or set the wordmark in a different face.
