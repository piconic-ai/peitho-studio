# Peitho Studio

An editor for [Peitho](https://github.com/mizzy/peitho) decks, built with [Tauri](https://tauri.app) and [BarefootJS](https://barefootjs.dev).

Peitho decks are plain Markdown. Peitho Studio adds a 3-column GUI (slide list / editor / live preview) on top of Peitho, while leaving the deck file editable by other tools at the same time (it watches the file on disk and reloads automatically). It currently ships as a desktop app.

## Layout scripts

A deck's layout HTML can include `<script>`, and `peitho present` and `peitho build` run it. Peitho Studio runs it only once you trust the deck's folder.

A deck from a folder you haven't trusted opens with its scripts turned off: its slides are shown without any `<script>`, HTML event handler (`onerror`, `onclick`, ...), `javascript:` link or embedded frame, and styling is left as is. If the deck had any of those, a banner at the top says so. **Trust and Run** there trusts the folder, and the slides are redrawn with their scripts running. The folder stays trusted after a restart, for every deck in it (`deck.md`, `deck.ja.md`, ...). A deck made with New Deck starts out trusted. Only trust decks whose authors you trust.

Turning scripts off doesn't stop an untrusted deck's images and CSS (`url(...)`, `@font-face`) from loading over the network, as they would on any web page.

A trusted deck's scripts run inside the app itself, so beyond what they could do on a web page they can also:

- rewrite the open deck's own `deck.md`,
- change Studio's settings (vim mode, UI language),
- read and write the clipboard,
- create a new starter deck folder in any directory (it never overwrites an existing one),
- start Present for the open deck,
- show a folder-picker dialog.

They can't read or overwrite other existing files: a window never switches to another deck once one is open, and the only new window a script can open is a language variant next to the open deck (`deck.ja.md` next to `deck.md`).

## Development

Requires the `peitho` CLI on `PATH` (used only for Present), and a local checkout of the [peitho](https://github.com/mizzy/peitho) repo for the `peitho-core` path dependency (see `src-tauri/Cargo.toml`).

```sh
bun install
bunx tauri dev
```

## Build

```sh
bunx tauri build
```

## Brand

The logo, wordmark and the app icon's source live under [`brand/`](brand/README.md), together with the geometry they share and how `src-tauri/icons/` is regenerated from them (`bun run icons`).

## Site

The landing page (the app, and a download button picked from the latest GitHub Release) lives in [`site/`](site/) as its own Bun project, deployed to Cloudflare Workers as static assets. See [site/README.md](site/README.md).

## License

The source code is licensed under the [MIT License](LICENSE) — fork it, build it, ship it. The "Peitho Studio" name and app icon are not covered by that grant and remain reserved as trademarks/branding of this project.
