# Peitho Studio site

The landing page for Peitho Studio: what it does, and a download button that
picks the right build from the latest GitHub Release. A separate Bun project
from the app (its own `package.json` and lockfile), living in `site/`.

## Stack

- One static `index.html`, styled by `public/site.css` (light only): a hero
  with the app icon, "Peitho Studio", "Desktop app for Peitho" and the
  download button, then a short card on what Peitho is (linking to
  [peitho.gosu.ke](https://peitho.gosu.ke)). It reads without JavaScript,
  with a plain link to the latest release.
- One [BarefootJS](https://barefootjs.dev) island (CSR adapter, compiled by
  `@barefootjs/vite`), mounted from `src/main.ts`:
  `src/components/DownloadPanel.tsx` fetches
  `https://api.github.com/repos/piconic-ai/peitho-studio/releases/latest`,
  detects the visitor's platform (and, on Chromium, the CPU architecture via
  UA Client Hints), and shows the matching asset on the download button,
  with every other asset behind a toggle. On an unrecognised platform (a
  phone) it opens the full list instead. While the release loads it shows a
  button-sized placeholder so the page doesn't jump. When there is no
  release, no assets, or the API can't be reached, it links the Releases
  page.
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

## Icon (provisional)

`public/icon-256.png`, `apple-touch-icon.png`, `favicon-32.png`,
`favicon-16.png` and the share image `og.png` (1200×630) were cut from a
provisional 286px PNG of the icon. Replace them once the final artwork
exists — ideally from an SVG or a 1024px source, so the hero icon stays sharp
on high-density screens.

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
