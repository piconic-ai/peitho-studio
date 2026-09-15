// Given-When-Then examples for the deck header's variant switcher (see
// docs/architecture.md's "Examples by Specification"). Run by
// deckVariants.test.ts; the end-to-end click path is covered by
// e2e/deck-variants.e2e.ts.
import { defineExamples } from './spec'
import type { DeckVariant, VariantSwitcher } from './deckVariants'

const deck = (fileName: string, suffix: string | null, isCurrent = false): DeckVariant => ({
  path: `/talks/${fileName}`, fileName, suffix, isCurrent,
})

export const variantSwitcherExamples = defineExamples<readonly DeckVariant[], 'header-shown', VariantSwitcher>(
  'deck header variant switcher',
  [
    {
      id: 'translations-offered',
      given: 'a folder with deck.md (open), deck.en.md and deck.ja.md',
      when: 'the deck header is shown',
      then: 'the switcher shows "deck.md" as current and offers all three, labeled by their suffix',
      state: [deck('deck.md', null, true), deck('deck.en.md', 'en'), deck('deck.ja.md', 'ja')],
      event: 'header-shown',
      expect: {
        kind: 'shown',
        currentLabel: 'deck.md',
        options: [
          { path: '/talks/deck.md', label: 'deck.md', detail: null, isCurrent: true },
          { path: '/talks/deck.en.md', label: 'en', detail: 'deck.en.md', isCurrent: false },
          { path: '/talks/deck.ja.md', label: 'ja', detail: 'deck.ja.md', isCurrent: false },
        ],
      },
    },
    {
      id: 'suffixed-deck-open',
      given: 'deck.ja.md is the open deck, next to deck.md',
      when: 'the deck header is shown',
      then: 'the switcher shows "ja" as current and offers deck.md to go back to',
      state: [deck('deck.md', null), deck('deck.ja.md', 'ja', true)],
      event: 'header-shown',
      expect: {
        kind: 'shown',
        currentLabel: 'ja',
        options: [
          { path: '/talks/deck.md', label: 'deck.md', detail: null, isCurrent: false },
          { path: '/talks/deck.ja.md', label: 'ja', detail: 'deck.ja.md', isCurrent: true },
        ],
      },
    },
    {
      id: 'lone-deck-hidden',
      given: 'the open deck has no other same-name decks next to it',
      when: 'the deck header is shown',
      then: 'no switcher is shown',
      state: [deck('deck.md', null, true)],
      event: 'header-shown',
      expect: { kind: 'hidden' },
      tags: ['boundary'],
    },
    {
      id: 'listing-unavailable-hidden',
      given: 'the variant list is empty (not loaded yet, or listing the folder failed)',
      when: 'the deck header is shown',
      then: 'no switcher is shown',
      state: [],
      event: 'header-shown',
      expect: { kind: 'hidden' },
      tags: ['boundary'],
    },
    {
      id: 'opens-in-new-window-on-device',
      given: 'deck.md is open in a real Peitho Studio window, next to deck.ja.md',
      when: 'the user picks "ja" from the switcher',
      then: 'deck.ja.md opens in a new window and the original window keeps showing deck.md',
      state: [deck('deck.md', null, true), deck('deck.ja.md', 'ja')],
      event: 'header-shown',
      expect: {
        kind: 'shown',
        currentLabel: 'deck.md',
        options: [
          { path: '/talks/deck.md', label: 'deck.md', detail: null, isCurrent: true },
          { path: '/talks/deck.ja.md', label: 'ja', detail: 'deck.ja.md', isCurrent: false },
        ],
      },
      manual: { reason: 'Opening a second native window (open_deck_window -> take_pending_deck -> open_deck) and how the dropdown paints on WKWebView need a real Tauri window; e2e/deck-variants.e2e.ts only checks that open_deck_window is invoked with the right path.' },
    },
  ],
)
