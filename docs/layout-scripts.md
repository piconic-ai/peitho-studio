# Layout scripts and folder trust

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

