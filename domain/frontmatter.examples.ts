// Given-When-Then examples for the deck-level page-number setting's
// frontmatter handling (`readFrontmatterKey` + `parsePageNumbersMode`, and
// `setFrontmatterKey`). The human-readable source of truth for "what the
// page-number control shows, and what choosing an option writes" — see
// docs/architecture.md's "Examples by Specification". Run by
// frontmatter.test.ts.
import { defineExamples } from './spec'
import type { PageNumbersChoice, PageNumbersMode } from './frontmatter'

export const readPageNumbersExamples = defineExamples<string, 'deck-opened', PageNumbersMode>(
  'readFrontmatterKey + parsePageNumbersMode',
  [
    {
      id: 'no-frontmatter',
      given: 'a deck with no frontmatter at all',
      when: 'it is opened',
      then: 'the page-number control shows "none"',
      state: '# Title\n',
      event: 'deck-opened',
      expect: { kind: 'none' },
    },
    {
      id: 'frontmatter-without-key',
      given: 'a deck whose frontmatter has no page_numbers key',
      when: 'it is opened',
      then: 'the page-number control shows "none"',
      state: '---\ntime: 1m\n---\n# Title\n',
      event: 'deck-opened',
      expect: { kind: 'none' },
    },
    {
      id: 'current',
      given: 'a deck with page_numbers: current',
      when: 'it is opened',
      then: 'the page-number control shows "number only"',
      state: '---\npage_numbers: current\n---\n# Title\n',
      event: 'deck-opened',
      expect: { kind: 'current' },
    },
    {
      id: 'current-of-total',
      given: 'a deck with page_numbers: current_of_total',
      when: 'it is opened',
      then: 'the page-number control shows "number / total"',
      state: '---\npage_numbers: current_of_total\n---\n# Title\n',
      event: 'deck-opened',
      expect: { kind: 'current_of_total' },
    },
    {
      id: 'unknown-value',
      given: 'a deck with page_numbers: both (a value peitho does not accept)',
      when: 'it is opened',
      then: 'the page-number control shows the value as unknown instead of failing',
      state: '---\npage_numbers: both\n---\n# Title\n',
      event: 'deck-opened',
      expect: { kind: 'unknown', raw: 'both' },
      tags: ['boundary'],
    },
    {
      id: 'quoted-value',
      given: 'a deck with page_numbers: "current" (quoted YAML string)',
      when: 'it is opened',
      then: 'the quotes are ignored and the control shows "number only"',
      state: '---\npage_numbers: "current"\n---\n# Title\n',
      event: 'deck-opened',
      expect: { kind: 'current' },
      tags: ['boundary'],
    },
  ],
)

export const writePageNumbersExamples = defineExamples<string, PageNumbersChoice, string>(
  'setFrontmatterKey(page_numbers)',
  [
    {
      id: 'turn-on-without-frontmatter',
      given: 'a deck with no frontmatter',
      when: 'the user picks "number only"',
      then: 'a frontmatter block holding page_numbers: current is added at the top',
      state: '# Title\n',
      event: 'current',
      expect: '---\npage_numbers: current\n---\n# Title\n',
    },
    {
      id: 'turn-on-next-to-other-keys',
      given: 'a deck whose frontmatter already holds time: 1m',
      when: 'the user picks "number / total"',
      then: 'page_numbers: current_of_total is added and time: 1m is kept',
      state: '---\ntime: 1m\n---\n# Title\n',
      event: 'current_of_total',
      expect: '---\ntime: 1m\npage_numbers: current_of_total\n---\n# Title\n',
    },
    {
      id: 'switch-mode',
      given: 'a deck with page_numbers: current',
      when: 'the user picks "number / total"',
      then: 'the same line is rewritten to current_of_total',
      state: '---\npage_numbers: current\ntime: 1m\n---\n# Title\n',
      event: 'current_of_total',
      expect: '---\npage_numbers: current_of_total\ntime: 1m\n---\n# Title\n',
    },
    {
      id: 'turn-off-keeps-other-keys',
      given: 'a deck with page_numbers: current and time: 1m',
      when: 'the user picks "none"',
      then: 'only the page_numbers line is removed (peitho refuses page_numbers: false)',
      state: '---\npage_numbers: current\ntime: 1m\n---\n# Title\n',
      event: 'none',
      expect: '---\ntime: 1m\n---\n# Title\n',
    },
    {
      id: 'turn-off-last-key',
      given: 'a deck whose frontmatter holds nothing but page_numbers: current',
      when: 'the user picks "none"',
      then: 'the whole frontmatter block is removed, since peitho refuses an empty ---/--- block',
      state: '---\npage_numbers: current\n---\n# Title\n',
      event: 'none',
      expect: '# Title\n',
      tags: ['boundary'],
    },
  ],
)
