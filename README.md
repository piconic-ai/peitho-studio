# Peitho Studio

An editor for [Peitho](https://github.com/mizzy/peitho) decks, built with [Tauri](https://tauri.app) and [BarefootJS](https://barefootjs.dev).

Peitho decks are plain Markdown. Peitho Studio adds a 3-column GUI (slide list / editor / live preview) on top of Peitho, while leaving the deck file editable by other tools at the same time (it watches the file on disk and reloads automatically). It currently ships as a desktop app.

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

## License

The source code is licensed under the [MIT License](LICENSE) — fork it, build it, ship it. The "Peitho Studio" name and app icon are not covered by that grant and remain reserved as trademarks/branding of this project.
