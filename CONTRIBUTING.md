# Contributing to Peitho Studio

Bug reports, feature requests and pull requests are welcome. Please open a [GitHub issue](https://github.com/piconic-ai/peitho-studio/issues) with reproduction steps, your app version and macOS version. Discuss substantial changes in an issue before implementing them.

## Local development

Install [Bun](https://bun.sh), Rust and the platform prerequisites for [Tauri](https://v2.tauri.app/start/prerequisites/). The renderer uses the pinned `peitho-core` Git dependency in `src-tauri/Cargo.toml`; no local Peitho checkout is required. Install the matching `peitho` CLI on `PATH` to use Present (currently v1.34.0).

```sh
git clone https://github.com/piconic-ai/peitho-studio.git
cd peitho-studio
bun install
bun run crit:fetch
bunx tauri dev
```

`crit:fetch` downloads the pinned review tool into `src-tauri/binaries/`. It is bundled with the app and required for Rust builds.

## Making a pull request

Keep changes focused and explain the problem, resulting behavior and validation in your PR. Include screenshots for UI changes. Follow [the architecture guide](docs/architecture.md) and [project design rules](CLAUDE.md): keep pure domain logic separate from state, DOM and IPC code, and cover changed logic with typical and boundary cases.

Run the checks relevant to your change:

```sh
bun run typecheck
bun test
bun run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
```

The browser e2e suite uses a mocked Tauri bridge. Native verification is described in [the Tauri Playwright guide](docs/tauri-playwright-spike.md). For site changes, run `bun run typecheck`, `bun run test` and `bun run build` inside `site/`.

## Build

```sh
bunx tauri build
```

### Updating the bundled crit

The version lives only in `src-tauri/crit-release.json`, together with the SHA-256 of each macOS binary:

1. Set `version`, and copy the `crit-darwin-arm64` and `crit-darwin-amd64` lines of that release's `checksums.txt` into `sha256` (`aarch64-apple-darwin` and `x86_64-apple-darwin`).
2. Replace `src-tauri/licenses/crit/LICENSE` with the one at that tag if it changed.
3. `bun run crit:fetch`, then `cargo test --manifest-path src-tauri/Cargo.toml`. crit's HTTP API is the one its own web UI uses, not a published contract; the `crit::tests::round_trip` tests run an agent's whole round trip against the new binary, and the version is updated only if they pass.

## Release maintenance

After `release-build` successfully uploads the release artifacts, `homebrew-cask`
opens an update PR in [piconic-ai/homebrew-tap](https://github.com/piconic-ai/homebrew-tap).
It updates only the Cask's version and SHA-256, calculating the checksum from the
published DMG. This includes RC releases. Older versions are skipped, unchanged
releases create no PR, and retries update the existing open PR for that tag.
Tap PRs are merged manually.

Set the `HOMEBREW_TAP_TOKEN` Actions secret in this repository to a fine-grained
personal access token with access to **piconic-ai/homebrew-tap** and **Contents:
Read and write** and **Pull requests: Read and write** permissions. If the
organization requires approval for tokens, approve it before running the workflow.
The normal `GITHUB_TOKEN` cannot write to the separate tap repository. Without
this secret the Homebrew job fails with a setup message; already uploaded release
artifacts remain available.

To retry a tap update without rebuilding the app, run the `homebrew-cask` workflow
manually on `main`, with the published release tag as its `tag` input.

## Brand

The logo, wordmark and the app icon's source live under [`brand/`](brand/README.md), together with the geometry they share and how `src-tauri/icons/` is regenerated from them (`bun run icons`).

## Site

The landing page (the app, and a download button picked from the latest GitHub Release) lives in [`site/`](site/) as its own Bun project, deployed to Cloudflare Workers as static assets. See [site/README.md](site/README.md).

