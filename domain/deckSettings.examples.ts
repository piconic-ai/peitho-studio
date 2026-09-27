// Given-When-Then examples for the Deck menu's settings
// (`readDeckSettings` and `frontmatterValueOf`): which item each menu
// checks for a deck, and what picking an item writes. See
// docs/architecture.md's "Examples by Specification". Run by
// deckSettings.test.ts.
import { defineExamples } from './spec'
import type { DeckSettingPick, DeckSettingsReport } from './deckSettings'

export const readDeckSettingsExamples = defineExamples<string, 'deck-opened', DeckSettingsReport>(
  'deckSettingsReport(readDeckSettings(source))',
  [
    {
      id: 'no-frontmatter',
      given: 'a deck with no frontmatter at all',
      when: 'it is opened',
      then: 'every menu checks its default: Off, 16:9, line breaks off, English',
      state: '# Title\n',
      event: 'deck-opened',
      expect: { page_numbers: 'none', aspect_ratio: '16:9', breaks: 'false', lang: 'en' },
    },
    {
      id: 'every-key-set',
      given: 'a deck whose frontmatter sets page_numbers, aspect_ratio, breaks and lang',
      when: 'it is opened',
      then: 'each menu checks the value the deck holds',
      state: '---\npage_numbers: current_of_total\naspect_ratio: 4:3\nbreaks: true\nlang: ja\n---\n# Title\n',
      event: 'deck-opened',
      expect: { page_numbers: 'current_of_total', aspect_ratio: '4:3', breaks: 'true', lang: 'ja' },
    },
    {
      id: 'unknown-values',
      given: 'a deck with lang: fr and page_numbers: both (values the menus don\'t offer)',
      when: 'it is opened',
      then: 'those two menus check nothing, and the others still show their values',
      state: '---\nlang: fr\npage_numbers: both\naspect_ratio: 4:3\n---\n# Title\n',
      event: 'deck-opened',
      expect: { page_numbers: null, aspect_ratio: '4:3', breaks: 'false', lang: null },
      tags: ['boundary'],
    },
    {
      id: 'quoted-values',
      given: 'a deck with aspect_ratio: "4:3" and lang: \'ja\' (quoted YAML strings)',
      when: 'it is opened',
      then: 'the quotes are ignored',
      state: '---\naspect_ratio: "4:3"\nlang: \'ja\'\n---\n# Title\n',
      event: 'deck-opened',
      expect: { page_numbers: 'none', aspect_ratio: '4:3', breaks: 'false', lang: 'ja' },
      tags: ['boundary'],
    },
    {
      id: 'unclosed-block',
      given: 'a deck whose frontmatter block is never closed',
      when: 'it is opened',
      then: 'nothing is read from it, so every menu checks its default',
      state: '---\nlang: ja\n# Title\n',
      event: 'deck-opened',
      expect: { page_numbers: 'none', aspect_ratio: '16:9', breaks: 'false', lang: 'en' },
      tags: ['boundary'],
    },
  ],
)

export const writeDeckSettingExamples = defineExamples<null, DeckSettingPick, string | null>(
  'frontmatterValueOf',
  [
    {
      id: 'aspect-4-3',
      given: 'any deck',
      when: 'Aspect Ratio > 4:3 is picked',
      then: 'aspect_ratio: 4:3 is written',
      state: null,
      event: { key: 'aspect_ratio', choice: '4:3' },
      expect: '4:3',
    },
    {
      id: 'aspect-default',
      given: 'any deck',
      when: 'Aspect Ratio > 16:9 (peitho\'s default) is picked',
      then: 'the aspect_ratio key is removed',
      state: null,
      event: { key: 'aspect_ratio', choice: '16:9' },
      expect: null,
    },
    {
      id: 'breaks-on',
      given: 'any deck',
      when: 'line breaks are turned on',
      then: 'breaks: true is written',
      state: null,
      event: { key: 'breaks', choice: 'true' },
      expect: 'true',
    },
    {
      id: 'breaks-off',
      given: 'any deck',
      when: 'line breaks are turned off (peitho\'s default)',
      then: 'the breaks key is removed rather than written as false',
      state: null,
      event: { key: 'breaks', choice: 'false' },
      expect: null,
    },
    {
      id: 'lang-ja',
      given: 'any deck',
      when: 'Language > 日本語 is picked',
      then: 'lang: ja is written',
      state: null,
      event: { key: 'lang', choice: 'ja' },
      expect: 'ja',
    },
    {
      id: 'lang-default',
      given: 'any deck',
      when: 'Language > English (peitho\'s default) is picked',
      then: 'the lang key is removed',
      state: null,
      event: { key: 'lang', choice: 'en' },
      expect: null,
    },
    {
      id: 'page-numbers-off',
      given: 'any deck',
      when: 'Page Numbers > Off is picked',
      then: 'the page_numbers key is removed (peitho refuses page_numbers: false)',
      state: null,
      event: { key: 'page_numbers', choice: 'none' },
      expect: null,
    },
    {
      id: 'page-numbers-of-total',
      given: 'any deck',
      when: 'Page Numbers > 1/N is picked',
      then: 'page_numbers: current_of_total is written',
      state: null,
      event: { key: 'page_numbers', choice: 'current_of_total' },
      expect: 'current_of_total',
    },
  ],
)
