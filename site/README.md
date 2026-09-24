# Peitho Studio site

The landing page for Peitho Studio: what it does, and a download button that
picks the right build from the latest GitHub Release. A separate Bun project
from the app (its own `package.json` and lockfile), living in `site/`.

## Stack

- One static `index.html`, styled by `public/site.css`. It reads fully
  without JavaScript (features, links, build instructions, a plain link to
  the latest release).
- Two [BarefootJS](https://barefootjs.dev) islands (CSR adapter, compiled by
  `@barefootjs/vite`), mounted from `src/main.ts` into placeholders in the
  HTML:
  - `src/components/DownloadPanel.tsx` fetches
    `https://api.github.com/repos/piconic-ai/peitho-studio/releases/latest`,
    detects the visitor's platform (and, on Chromium, the CPU architecture
    via UA Client Hints), and shows the matching asset on the big button,
    with every other asset behind a toggle. When there is no release, the
    release has no assets, or the API can't be reached, it falls back to the
    Releases page and the build-from-source section.
  - `src/components/FeatureTour.tsx` is a schematic of the Studio window
    that lights up the pane each tour step talks about; the phone-viewport
    and section-collapse toggles inside it are live controls.
- `src/domain/*.ts` holds the pure rules (asset classification, platform
  detection, the tour's steps and navigation) and their `bun test` specs,
  following the app's `.ts` = pure / `.tsx` = stateful convention.
- Deployed as [Cloudflare Workers static
  assets](https://developers.cloudflare.com/workers/static-assets/): no
  Worker script runs, `wrangler.jsonc` only points `assets.directory` at
  `dist/`.

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
