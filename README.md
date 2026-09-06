# Peitho Studio

A desktop GUI wrapper around the [Peitho](https://github.com/mizzy/peitho) presentation engine, built with Tauri and [BarefootJS](https://barefootjs.dev) (CSR adapter).

Peitho decks are plain Markdown, but hand-editing the per-slide JSON config and keeping speaker notes visually separate from that config are rough by hand. Peitho Studio adds a 3-column GUI (slide list / editor / live preview) on top of Peitho to make that easier, without reimplementing anything Peitho already does well (layouts, section/time planning, rehearsal recording, presentation mode). Co-editing with another tool (vim, an AI agent, `git checkout`, …) is a first-class case, not an afterthought: deck.md is watched on disk and the editor/preview reload automatically when it changes outside the app.

`peitho-core` (Peitho's rendering engine) is linked directly into the Tauri backend and rendered in-process (`src-tauri/src/engine/`) — there is no `peitho preview` subprocess and no HTTP round trip on the editing path. This is a deliberate departure from treating `manifest.json`/notes.json as an external-process contract: peitho-core has no semver guarantee (it's Peitho CLI's internal engine, not a published crate), so the dependency is pinned to a local path checkout of the [peitho](https://github.com/mizzy/peitho) repo and confined to the `engine/` module — see the comments at the top of `engine/mod.rs` for the full rationale, and the project plan for the architecture investigation that led here (the fixed ~250-300ms-per-render floor turned out to be `Highlighter::defaults()` re-linking syntect's syntax set on every process launch — paid once now, not per edit; a warm render is ~2ms). External code images (Graphviz/Mermaid via shell-out), embeds, and oEmbed are not yet supported by the embedded engine (they return an explicit "unsupported" error) — `peitho build`/`peitho present` (real CLI, full feature set) remain unaffected and are still used for Present.

## Getting started

Requires the `peitho` CLI on `PATH` (`brew install` or build from the [peitho](https://github.com/mizzy/peitho) repo) — used only for `Present`. Also requires a local checkout of the [peitho](https://github.com/mizzy/peitho) repo for the `peitho-core` path dependency (see `src-tauri/Cargo.toml`).

```sh
bun install
bunx tauri dev
```

`bun run dev` alone also works for iterating on the frontend in a regular browser (`http://localhost:3003`), but folder-open/preview/present all require the Tauri shell since they call into the Rust backend.

### Self-verifying without the folder picker

Set `PEITHO_STUDIO_DEV_DECK` to a deck folder (or `deck.md` path) before launching, and the app opens it automatically on startup instead of waiting for "Open Deck…" — useful for scripted verification (screenshots, agents) with no native dialog interaction required:

```sh
PEITHO_STUDIO_DEV_DECK=/path/to/a/peitho/deck bunx tauri dev
```

## Build

```sh
bunx tauri build
```

## Status

- Open a deck folder, browse its slides as rendered thumbnails grouped by section (with each section's name/time inline-editable, and drag-and-drop / arrow-key reordering-and-navigation).
- Edit a slide's Markdown body and speaker notes (kept as separate fields, not mixed HTML comments) and save.
- See the live Peitho preview of the slide you're editing.
- Launch `peitho present` (optionally with `--rehearsal`).
- The deck file is watched on disk: edits made in another editor (or by an AI agent working on the same file) are picked up automatically, merging around any unsaved in-app edit rather than clobbering it.
- No agent chat panel — editing the file directly in another tool is the intended workflow for that, and the file-watch above is what makes it safe.

Not yet built: a structured form for the rest of each slide's PageComment (`layout`, `key`, `draft`/`skip`/`page_number`) — those still need to be hand-edited as the raw JSON comment in the editor.

Not yet supported by the embedded renderer (falls back to peitho CLI for these — Present is unaffected): decks that use external code-image commands (Graphviz `dot`, etc.), card/screenshot embeds, or oEmbed. Frontmatter-explicit asset path overrides also aren't implemented yet (only the deck-adjacent `layouts/`/`css/`/`syntaxes/`/`fonts/` convention and the built-in fallback).
