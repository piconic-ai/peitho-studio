# Security Policy

## Reporting a vulnerability

Please don't open a public issue for a security problem. Report it privately instead: on this repository's **Security** tab, choose **Report a vulnerability**. GitHub then shares the report only with the maintainers.

Include what you can of:

- what an attacker could do, and what they need to have or control first (for example, a deck the user opens),
- steps or a minimal deck that reproduces it,
- the Peitho Studio version, shown under Peitho Studio > About Peitho Studio.

We'll reply as soon as we can and keep you updated until a fix is released.

## Supported versions

Fixes go into the latest release only. Please update to it before reporting.

## Decks and layout scripts

A deck's layout HTML can contain `<script>`, and Peitho Studio runs it once the user trusts the deck's folder. What such a script can and can't do is described under [Layout scripts](README.md#layout-scripts) in the README. A report that a script can do something listed there as allowed isn't a vulnerability. A way around the limits described there is one.

Peitho Studio is provided "as is", without warranty of any kind; see [LICENSE](LICENSE).
