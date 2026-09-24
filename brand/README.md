# Peitho Studio brand assets

The mark is a single monoline "P" whose bowl is drawn as a slide frame: a
stem (the editor's caret, the thing you type at) holding up a rounded 4:3
rectangle (the slide it produces). One stroke, no fills, no second color —
the same neutral palette as the app's own UI tokens (`public/tokens.css`):
ink `#171717` (`--primary`) and paper `#fafafa` (`--primary-foreground`).

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
M17 53 V11 H41 A6 6 0 0 1 47 17 V29 A6 6 0 0 1 41 35 H17
```

Stem 42 tall, bowl 30 × 24, corner radius 6; the ink spans x 14–50 and
y 11–53, so the mark is centered in its box. Scale the box, don't redraw
the path, when placing the mark somewhere new: the stroke has to stay
9.4 % of the box or the "P" stops matching the rest.

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
