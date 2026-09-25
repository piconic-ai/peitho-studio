# Peitho Studio brand assets

The mark is Peitho herself — the Greek goddess of persuasion the engine is
named after — drawn front-on in a Japanese *kawaii* register:

- **Odango bun with a spiral.** Greek statues tie the hair into a
  *krobylos* at the back of the head; here it moves up into an odango bun.
  The spiral inside it is the ball of twine Peitho holds in vase painting,
  drawn as two semicircles on one axis (the same construction as an Ionic
  volute).
- **Stephane.** The diadem she wears in vase painting, as a small tiara
  with a single gem.
- **Centre-parted fringe, closed smiling eyes, sakura blush.** The kawaii
  part: a round mochi face, eyes closed in a smile, a tiny mouth, and the
  only colour in the mark on her cheeks.

Background on Peitho's attributes: [Theoi](https://www.theoi.com/Daimon/Peitho.html).

## Palette

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#111111` | hair, eyes, mouth, wordmark — the same ink as peitho.gosu.ke |
| Paper | `#ffffff` | face, tiara, bun spiral |
| Blush | `#F4A6B8` | cheeks only |
| Tile | `#FDF0F3` → `#F8D9E1` | the app icon's vertical gradient |

## Files

Everything here (and `public/favicon.svg`, and `src-tauri/icons/`) is
generated — edit `scripts/brand/mark.ts`, then run `bun run icons`.

| File | What it is |
| --- | --- |
| `logo-mark.svg` | The mark, full colour, transparent background. |
| `logo-mark-mono.svg` | The mark without the blush, for one-colour use. |
| `logo-mark-inverse.svg` | The mark with a white keyline, for dark backgrounds (the hair would otherwise vanish into them). |
| `logo-wordmark.svg` | Mark + "Peitho Studio" in Charis SIL, −0.03 em tracking, converted to paths. |
| `logo-wordmark-inverse.svg` | The wordmark for dark backgrounds. |
| `app-icon.svg` | The app icon: a continuous-corner tile (superellipse, n = 5) on the macOS grid — an 824 px body on a 1024 px canvas — with a soft drop shadow. |
| `app-icon-small.svg` | The same icon with the small cut, used for every raster at 48 px and below. |
| `app-icon.png` | `app-icon.svg` at 1024 px, for previews. |

The wordmark's face is [Charis SIL](https://software.sil.org/charis/)
(SIL Open Font License 1.1), chosen because it descends from Bitstream
Charter — the fallback peitho.gosu.ke itself names after Iowan Old Style.
The outlines are embedded as paths, so no font ships with the SVG.

## Two cuts

Like a type family's optical sizes, the mark has a full cut and a small
cut (`markBody` / `markSmallBody` in `scripts/brand/mark.ts`). Below 64 px
the spiral, the tiara's gem and the mouth turn to noise and the 2.3-unit
eye strokes fall under a pixel, so at 48 px and below the small cut drops
them, draws the eyes as solid ovals, thickens the tiara and enlarges the
blush.

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
itself — don't recolour the mark, redraw her face, or set the wordmark in
a different face.
