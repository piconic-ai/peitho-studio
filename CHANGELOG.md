# Changelog

## [v0.1.11](https://github.com/piconic-ai/peitho-studio/compare/v0.1.10...v0.1.11) - 2026-11-04

- chore: remove todos migrated to GitHub Issues by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/237
- docs: migrate project instructions to AGENTS.md by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/239
- chore(barefootjs): update to 0.40.2 and retire obsolete constraints by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/240

## [v0.1.10](https://github.com/piconic-ai/peitho-studio/compare/v0.1.9...v0.1.10) - 2026-11-03

- chore(maintenance): track complexity and schedule bundled dependency updates by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/196
- refactor(review): separate build error report transitions by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/198
- refactor(canvas): separate list edits and slot content formatting by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/199
- refactor(preview): flatten font family parsing by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/201
- refactor(studio): separate modal keyboard handling by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/202
- refactor(studio): separate slide keyboard commands by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/203
- refactor(dom): separate list keyboard handling by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/204
- refactor(dom): separate Markdown serialization helpers by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/205
- refactor(dom): separate edit target resolution by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/206
- refactor(dom): separate editing field mechanics by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/207
- refactor(dom): separate edit marker policies by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/208
- refactor(dom): separate object keyboard policies by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/209
- refactor(studio): extract editor column shell by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/210
- refactor(studio): extract shared review column shell by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/211
- refactor: simplify updater startup recovery by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/212
- refactor: simplify Markdown source maintenance by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/213
- refactor: simplify preview editing and paste guards by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/214
- refactor: extract update metadata validation policies by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/215
- refactor: separate canvas edit policies by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/216
- refactor: reuse menu checked indicators by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/217
- refactor: isolate the layout editor column by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/218
- refactor: separate Studio workspace chrome by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/219
- refactor: separate review send feedback by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/220
- refactor: separate preview font and asset responses by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/221
- refactor: separate native menu resource actions by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/222
- refactor: separate review thread row presentation by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/223
- refactor: separate slide section header controls by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/224
- refactor: isolate slide row appearance and status overlays by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/225
- refactor: separate edit actions and commit bookkeeping by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/226
- ci: gate complexity on cognitive scores only by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/227
- ci: replace the Python baseline checker with JavaScript by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/228

## [v0.1.9](https://github.com/piconic-ai/peitho-studio/compare/v0.1.8...v0.1.9) - 2026-10-14

- Attest release builds and keep signing secrets out of the publish job by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/194

## [v0.1.8](https://github.com/piconic-ai/peitho-studio/compare/v0.1.7...v0.1.8) - 2026-10-10

- Let a slide take a layout it doesn't fit yet by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/191
- Keep the slide list inside its panel so it scrolls by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/193

## [v0.1.7](https://github.com/piconic-ai/peitho-studio/compare/v0.1.6...v0.1.7) - 2026-10-09

- Open a deck that doesn't build, with peitho-core's error in view by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/185
- Render a deck without the slides that don't build by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/186
- Comment the deck's build errors to the agent waiting in crit by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/187
- Send a build error to the agent from the error bar, and keep it shown by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/190

## [v0.1.6](https://github.com/piconic-ai/peitho-studio/compare/v0.1.5...v0.1.6) - 2026-10-07

- Upload the updater archive under a name GitHub keeps as-is by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/181
- Stop the heading line-break e2e racing its own commit render by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/183
- Publish the GitHub Release only after its assets are uploaded by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/180
- Quit through the app's own menu item so a prepared update installs by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/184

## [v0.1.5](https://github.com/piconic-ai/peitho-studio/compare/v0.1.4...v0.1.5) - 2026-10-07

- Keep line breaks typed into a heading inside that heading by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/173
- Remove a cleared canvas paragraph instead of leaving an NBSP by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/175
- Fix canvas edits that left a slide uneditable, and check them against the real engine by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/176
- Add the bug-sweep workflow for reported bugs by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/177
- Let a cleared footnote be written again from the canvas by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/178
- Keep the preview on the undone text when Undo beats a render by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/179

## [v0.1.4](https://github.com/piconic-ai/peitho-studio/compare/v0.1.3...v0.1.4) - 2026-10-06

- Move Check for Updates to the app menu and its own window by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/169
- Add in-place slide editing with live Markdown sync by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/170
- Fix title re-entry after clearing canvas text by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/171
- Fix in-place list editing and bullet keyboard behavior by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/172

## [v0.1.3](https://github.com/piconic-ai/peitho-studio/compare/v0.1.2...v0.1.3) - 2026-10-05

- Build new decks with eleven standard layouts and name a layout on every new slide by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/155
- Fix the flaky review-edit e2e tests: don't collapse a selection the user already made by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/156
- Veil the demo poster's red accent until the video plays by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/158
- Show the app icon at the top of the README by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/159
- Enable per-version preview URLs by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/160
- Add a layout screen: list, apply, create, duplicate, delete and edit layouts by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/157
- Comment on layouts from the layout screen and let the agent change them by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/162
- Rearrange the layout screen: editor left, live list, PC / Phone switch by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/163
- Autosave the layout editor and reflect agent edits to layout files by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/164
- Pick a device preset for phone display: small phone, phone, large phone, tablet by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/165
- Layout screen: files | editor | layout list, English names, and comments from the editor by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/166
- Suppress the native context menu where the app has none by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/167

## [v0.1.2](https://github.com/piconic-ai/peitho-studio/compare/v0.1.1...v0.1.2) - 2026-10-02

- fix: 更新確認時のTLS初期化不足による停止を修正 by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/152

## [v0.1.1](https://github.com/piconic-ai/peitho-studio/compare/v0.1.0...v0.1.1) - 2026-10-02

- Fix RC-to-stable release version synchronization by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/150

## [v0.1.0](https://github.com/piconic-ai/peitho-studio/compare/v0.1.0-rc.7...v0.1.0) - 2026-10-02

- Automate Homebrew cask update PRs after releases by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/144
- Add preview deployment script and work around CI identity mismatch by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/145
- Refresh README and demonstrate slide comments with a hero video by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/146
- Add Homebrew install and a real Studio UI demo by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/147
- Use Swiss Style with expressive layout and color in the hero demo by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/148
- Prevent stale Workers Builds preview commands from hanging CI by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/149

## [v0.1.0-rc.5](https://github.com/piconic-ai/peitho-studio/compare/v0.1.0-rc.4...v0.1.0-rc.5) - 2026-09-28

- Check off release-build's signing verification item by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/107
- Archive release-build-workflow by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/108
- Fix an extra empty line after dd then p on the last line in vim mode by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/109
- Archive release-ci-tests: not making the checks required for now by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/110
- Stop deck layout scripts from reaching files outside the open deck by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/111
- Toggle page numbers from the deck header and the slide context menu by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/112
- Plan the deck settings UI: native Deck menu, New Deck choices, PDF export by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/113
- Plan the script trust prompt and About window, add SECURITY.md by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/119
- Add deck-wide settings to the Edit menu, showing their current values (Rust side) by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/114
- Read the Deck menu's settings from a deck's frontmatter by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/115
- Write Deck menu picks into the frontmatter as undoable steps by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/116
- Drop the header's page-number control for the Edit menu's setting by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/117
- Pick the aspect ratio and language when creating a deck by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/122
- Ask before running an untrusted deck's scripts by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/121
- Replace the native About panel with an About window of our own by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/120
- Fix review leftovers in script trust and About, archive the deck script todos by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/124
- Open Finder-launched .md files as decks by @kfly8 in https://github.com/piconic-ai/peitho-studio/pull/125
