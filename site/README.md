# Peitho Studio site

The landing page for Peitho Studio: what it does, Homebrew installation and downloads from GitHub Releases. A separate Bun project
from the app (its own `package.json` and lockfile), living in `site/`.

## Stack

- One static `index.html`, styled by `public/site.css` (light only):
  - a hero with the app icon, "Peitho Studio", "Write slides with Peitho."
    ("Edit Markdown. Preview slides. Bring your AI Agent.") above a recording of the real Studio UI demonstrating Markdown editing and an Agent-assisted HTML layout change;
  - a "Built on Peitho" card: Peitho's one-line description and a small
    Markdown-to-slide illustration, linking to
    [peitho.gosu.ke](https://peitho.gosu.ke);
  - a Download section with a Homebrew installation command and every build listed as an accordion.
  It reads without JavaScript, with plain links to GitHub Releases.
- [BarefootJS](https://barefootjs.dev) (CSR adapter, compiled by
  `@barefootjs/vite`): `src/components/DownloadPanel.tsx`, mounted in the Download section
  from `src/main.ts`.
  - Shows one native `<details>` per platform, the visitor's own platform open.
  - Fetches release metadata from GitHub's latest-release API. Failed requests explain that release downloads could not be loaded; releases with no downloadable files explain that those files are not listed. Both link to GitHub Releases and keep the Homebrew instructions available.
- `src/domain/releases.ts` holds the pure rules (asset classification,
  platform detection) and their `bun test` specs, following the app's
  `.ts` = pure / `.tsx` = stateful convention.
- Deployed as [Cloudflare Workers static
  assets](https://developers.cloudflare.com/workers/static-assets/) at
  [peitho-studio.piconic.ai](https://peitho-studio.piconic.ai/): no Worker
  script runs, `wrangler.jsonc` points `assets.directory` at `dist/` and
  names the host. `public/_headers` sets a strict Content-Security-Policy (scripts,
  styles and images from the site itself, `fetch` only to `api.github.com`)
  and long-lived caching for Vite's hashed `/assets/*`; `public/404.html` is
  served for unknown paths (`not_found_handling: "404-page"`).

## Hero demo

The hero embeds `public/studio-demo.mp4`, recorded from the **unchanged Studio frontend**, with its real editor, preview, panel controls and comments UI. The sample deck introduces Peitho Studio itself: write in Markdown, see changes instantly, and refine with an AI Agent.

1. The editor and preview show a simple introductory slide. Typing a new Markdown title changes the preview.
2. The comments panel opens and a comment names **Swiss Style** as its reference, and asks for bold typography, an asymmetric grid and a strong color accent. The wording must stay, but the layout is free to move beyond a bullet list. No color codes, font names or pixel measurements are needed.
   The [Swiss Style reference](https://www.aboutswitzerland.eda.admin.ch/en/swiss-style-forever-the-story-of-a-graphic-design-tradition) describes its restrained use of color, sans-serif type and asymmetric layouts.
3. The editor is folded using Studio's own panel control. The Agent's example result changes the slide to a Swiss-style HTML layout: a large two-line title, three feature statements aligned on a grid, and a red color field behind the last statement. The words are unchanged; JavaScript animates their reveal.

`site/scripts/demo-deck.ts` supplies the sample Markdown and before/after slide fragments. Only the slide's layout metadata changes in the simulated Agent result; an assertion checks that the Markdown content remains unchanged. The e2e Tauri IPC mock and fake crit session provide backend responses; the Studio UI itself is not recreated or restyled. No live agent runs during capture.

Regenerate the MP4 and WebP posters from the repository root, with Chrome and ffmpeg installed:

```sh
bun run build
PORT=3013 bun server.ts
# In another terminal:
bun site/scripts/capture-hero.ts
```

Capture asserts the edited preview, sent comment, light background, unchanged feature text, grid layout without bullet markers, contrasting accent-panel text, running slide animation and Agent reply, and fails on page errors. The site uses native video controls without autoplay.

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

## Hostname

The site lives at <https://peitho-studio.piconic.ai/>. `wrangler.jsonc`
declares it as a `custom_domain` route, so `wrangler deploy` creates the DNS
record and certificate on the `piconic.ai` zone itself; `workers_dev` and
`preview_urls` are off so this is the page's only host. `index.html` spells
the host out in `<link rel="canonical">`, `og:url` and `og:image` (most link
previewers ignore a relative `og:image`), so changing the hostname means
updating both files.

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
bun run deploy:preview # build, then upload a version without deploying to production
```

## Deploying

[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
is connected to this repository and deploys `main`; nothing runs from a
GitHub Actions workflow. Its settings, for reference:

- Path (root directory): `/site` — everything below runs in this
  directory, so `site/bun.lock` picks bun for the install.
- Build command: `bun run build`
- Deploy command: `bunx wrangler deploy`
- Preview (non-production branch) command: `bun run deploy:preview`. It runs on
  pull requests as a build check only: `preview_urls` is off in
  `wrangler.jsonc`, so the uploaded version gets no URL, and the page has
  no `workers.dev` host at all.
- Build watch paths, include: `site/*`, `brand/*`, `src-tauri/icons/*` —
  the page pulls its icons from the other two, and any other commit to the
  app doesn't need a build.

`bun run deploy` from a logged-in machine still works as a manual fallback.

`deploy:preview` temporarily unsets `WRANGLER_CI_MATCH_TAG` to work around
[Workers Builds issue #15682](https://github.com/cloudflare/workers-sdk/issues/15682).
Debug logs confirmed that CI supplied a different tag from the existing Worker's
tag even though its name matched and the API lookup succeeded. This skips the
CI identity check, so the command explicitly pins the account ID and Worker name.
It only uploads a version; production deployment keeps the normal identity check.
Remove the workaround after Cloudflare fixes the preview build trigger.

## Release assets

The download panel classifies assets by file extension, matching what
Tauri's bundler emits: `.dmg` / `.app.tar.gz` (macOS), `.msi` / `.exe`
(Windows), `.AppImage` / `.deb` / `.rpm` (Linux), and `aarch64`/`arm64`,
`x64`/`x86_64`/`amd64` or `universal` in the name for the architecture.
`.sig` files and `latest.json` are ignored. Nothing on the site needs to
change when a release is published; it only needs the assets to exist on
the GitHub Release (see `src/domain/releases.test.ts` for the exact names it
was tested against).
