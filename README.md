# Peitho Studio

A desktop editor for [Peitho](https://github.com/mizzy/peitho) presentations. Write slides in Markdown, preview them live, and collaborate with your AI coding agent by commenting directly on slides.

[Website](https://peitho-studio.piconic.ai/) · [Download](https://github.com/piconic-ai/peitho-studio/releases/latest)

![Peitho Studio showing slide comments, an AI Agent reply, and the Send button](site/public/studio.webp)

## Features

- **Edit and preview together:** slide navigation, a Markdown editor, speaker notes and a live slide preview.
- **Review with your AI Agent:** click a slide element, leave a comment, send feedback to your connected coding agent and read its replies in Studio.
- **Keep your files:** decks remain plain Markdown and HTML. Changes made by another editor or agent reload automatically.
- **Present your deck:** launch Peitho's presenter from Studio with the `peitho` CLI installed.
- **Make it your workspace:** Vim editing mode, English and Japanese UI, and language variants of a deck.

## Install

For Apple Silicon Macs running macOS 13 (Ventura) or later:

```sh
brew install --cask piconic-ai/tap/peitho-studio
```

You can also download a macOS build from [GitHub Releases](https://github.com/piconic-ai/peitho-studio/releases/latest) and move Peitho Studio to Applications.

## Work with your AI Agent

1. Open a deck in Studio and follow **Connect your Coding Agent** in the comments panel.
2. Copy the prompt into your coding agent and let it start the review loop. Studio bundles the `crit` review tool.
3. Click an element in the slide preview, add your feedback, and choose **Send**.
4. Review the agent's replies and updated slides, then repeat as needed.

The agent runs in your own coding environment and edits the deck files. Studio displays its changes automatically.

For decks containing layout JavaScript, Studio asks you to trust the folder before running scripts. See [layout scripts and folder trust](docs/layout-scripts.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, checks, pull requests and release maintenance.

## License

Source code is licensed under the [MIT License](LICENSE). The Peitho Studio name and app icon remain reserved as project branding.
