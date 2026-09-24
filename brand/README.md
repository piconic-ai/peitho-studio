# Peitho Studio brand assets

The mark is a single monoline stroke that reads three ways at once:

- **Π** — the initial of Πειθώ, the goddess the engine is named after. The
  stem and the lintel are the left leg and top bar of a Π.
- **A volute** — the lintel curls into the spiral of an Ionic capital, the
  Greek temple's own ornament, and at the same time into Peitho's attribute
  in vase painting: the ball of twine she holds (words that bind), see
  [Theoi](https://www.theoi.com/Daimon/Peitho.html).
- **P** — the Latin initial the product name is written with, so the mark
  sits next to "Peitho Studio" without a second letter fighting it.

No fills, no second color — the same neutral palette as the app's own UI
tokens (`public/tokens.css`): ink `#171717` (`--primary`) and paper
`#fafafa` (`--primary-foreground`).

| File | What it is |
| --- | --- |
| `logo-mark.svg` | The mark alone, ink on transparent (64×64 viewBox). For light backgrounds. |
| `logo-mark-inverse.svg` | Same mark in paper, for dark backgrounds. |
| `logo-wordmark.svg` | Mark + "Peitho Studio" (Inter SemiBold, −0.02 em tracking, converted to paths so no font is needed). |
| `logo-wordmark-inverse.svg` | The wordmark in paper. |
| `app-icon.svg` | The app icon's source: a 1024×1024 canvas with an 824 px rounded square (radius 185, macOS style) in ink and the mark in paper. |
| `app-icon.png` | `app-icon.svg` rasterized by `scripts/render-app-icon.ts`; the input `tauri icon` resizes into `src-tauri/icons/`. |

`public/favicon.svg` is the same construction as `app-icon.svg` on a 32 px
canvas, and `components/WelcomeScreen.tsx` inlines the mark with
`stroke="currentColor"` so it follows the theme.

## Geometry

Everything derives from one path in a 64-unit box, stroke width 6, round
joins, flat (butt) terminals:

```
M16 52 V13 H36 A13 13 0 0 1 36 39 A7 7 0 0 1 36 25
```

Stem 39 tall at x 16, lintel 20 wide at y 13, then a half-turn of radius 13
bulging right and a half-turn of radius 7 bulging left — the two arcs share
the x 36 axis, so the volute is two semicircles, not a freehand spiral. The
ink spans x 13–52 and y 10–55, so the mark is centered in its box. Scale
the box, don't redraw the path, when placing the mark somewhere new: the
stroke has to stay 9.4 % of the box or the volute's counter closes up.

## Regenerating the platform icons

```sh
bun run icons
```

That renders `app-icon.svg` → `app-icon.png` with Playwright's Chromium
(`CHROME_BIN=/path/to/chromium` if there is no system Chrome), then runs
`tauri icon` into `src-tauri/icons/`, and finally removes the `android/`
and `ios/` sets `tauri icon` also emits — this app only ships for desktop
today; drop that last step when a mobile target appears.

## Usage

The source code is MIT-licensed; the "Peitho Studio" name and these assets
are not (see the top-level README). Use them to refer to Peitho Studio
itself — don't recolor the mark, add effects, or set the wordmark in a
different face.
