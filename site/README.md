# Peitho Studio site

The landing page for Peitho Studio: what it does, and a download button that
picks the right build from the latest GitHub Release. A separate Bun project
from the app (its own `package.json` and lockfile), living in `site/`.

## Stack

- One static `index.html`, styled by `public/site.css` (light only):
  - a hero with the app icon, "Peitho Studio", "Write slides with Peitho."
    ("Plain Markdown and HTML, so AI can help too.") and
    the download button, above a screenshot of Studio with a deck open,
    framed as a window (`public/studio.webp`, `studio@2x.webp`);
  - a "Built on Peitho" card: Peitho's one-line description and a small
    Markdown-to-slide illustration, linking to
    [peitho.gosu.ke](https://peitho.gosu.ke);
  - a Download section listing every build as an accordion.
  It reads without JavaScript, with plain links to GitHub Releases.
- [BarefootJS](https://barefootjs.dev) (CSR adapter, compiled by
  `@barefootjs/vite`): `src/components/DownloadPanel.tsx`, mounted twice
  from `src/main.ts`.
  - `part: 'button'` (the hero) detects the visitor's platform (and, on
    Chromium, the CPU architecture via UA Client Hints) and puts the
    matching build on the button. On an unrecognised platform (a phone) the
    button points at the Download section instead.
  - `part: 'list'` shows one native `<details>` per platform, the visitor's
    own platform open.
  - Both share one request to
    `https://api.github.com/repos/piconic-ai/peitho-studio/releases/latest`
    (`src/lib/latestRelease.ts`), show button-/row-sized placeholders while
    it loads, and link GitHub Releases when there is no release, no
    assets, or the API can't be reached.
- `src/domain/releases.ts` holds the pure rules (asset classification,
  platform detection) and their `bun test` specs, following the app's
  `.ts` = pure / `.tsx` = stateful convention.
- Deployed as [Cloudflare Workers static
  assets](https://developers.cloudflare.com/workers/static-assets/): no
  Worker script runs, `wrangler.jsonc` only points `assets.directory` at
  `dist/`. `public/_headers` sets a strict Content-Security-Policy (scripts,
  styles and images from the site itself, `fetch` only to `api.github.com`)
  and long-lived caching for Vite's hashed `/assets/*`; `public/404.html` is
  served for unknown paths (`not_found_handling: "404-page"`).

## Hero screenshot

`public/studio.webp` (1280×800) and `studio@2x.webp` are the real Studio
frontend with a sample deck, opened through the e2e suite's Tauri IPC mock
(`e2e/helpers/mockTauri.ts`) — not a mock-up. Regenerate them after UI
changes, from the repository root:

```sh
bun install && bun run build
PORT=3013 bun run start &
bun site/scripts/capture-hero.ts   # CHROME_PATH=/path/to/chrome if Chrome isn't installed
```

## Brand

The logo and icons are the app's own, from [`brand/`](../brand/README.md)
(generated at the repository root by `bun run icons`):

- `index.html` references `../brand/logo-wordmark.svg` (nav),
  `../brand/app-icon.svg` (hero), `../brand/app-icon-small.svg` (favicon) and
  `../src-tauri/icons/32x32.png` (PNG favicon) directly; Vite copies them
  into the build with hashed names, so a brand change reaches the site on
  the next build. The dev server can't serve paths outside the site root
  on its own (`/brand/x.svg` would fall through to index.html), so
  `vite/outOfRootAssets.ts` rewrites those references to Vite's `/@fs/`
  endpoint in dev only.
- Headings use Charis SIL, the wordmark's face (`@fontsource/charis-sil`,
  pinned to the same version as the app, SIL Open Font License).
- The rasters that can't be SVG — `public/apple-touch-icon.png`,
  `public/og.png` and `public/favicon-32.png` (for `404.html`) — are
  rendered from `brand/` by a script; rerun it after a brand change:

```sh
bun site/scripts/build-brand-assets.ts   # from the repository root
```

## Before going live

- Set the production hostname in `wrangler.jsonc` (`routes`), and make
  `og:image` in `index.html` an absolute URL on that host — most link
  previewers ignore a relative one.

## Commands

```sh
cd site
bun install
bun run dev        # vite dev server
bun run test       # bun test (domain rules)
bun run typecheck  # tsc --noEmit
bun run build      # dist/
bun run preview    # build, then serve dist/ through wrangler exactly as production would
bun run deploy     # build, then wrangler deploy (needs a Cloudflare login)
```

## Deploying

Intended for Cloudflare Workers Builds (the dashboard's *Connect to a
repository*), watching `main`, with the project's root set to `site/`:

- Build command: `bun run build`
- Deploy command: `bunx wrangler deploy`

Add the production hostname to `wrangler.jsonc`'s `routes` once it is
decided (the commented example shows the shape).

## Release assets

The download panel classifies assets by file extension, matching what
Tauri's bundler emits: `.dmg` / `.app.tar.gz` (macOS), `.msi` / `.exe`
(Windows), `.AppImage` / `.deb` / `.rpm` (Linux), and `aarch64`/`arm64`,
`x64`/`x86_64`/`amd64` or `universal` in the name for the architecture.
`.sig` files and `latest.json` are ignored. Nothing on the site needs to
change when a release is published; it only needs the assets to exist on
the GitHub Release (see `src/domain/releases.test.ts` for the exact names it
was tested against).
