import { describe, expect, test } from 'bun:test'
import { agentConnectCommand, agentConnectPrompt, deckLocation, shellQuote, showsConnectGuide } from './agentConnect'

const CRIT = '/Applications/Peitho Studio.app/Contents/MacOS/crit'

describe('shellQuote', () => {
  test('spec: Given a plain path, Then it stays as is', () => {
    expect(shellQuote('/Users/me/talk/deck.md')).toBe('/Users/me/talk/deck.md')
  })

  test('spec: Given a path with a space, Then it is single-quoted', () => {
    expect(shellQuote(CRIT)).toBe(`'${CRIT}'`)
  })

  test('adversarial: Given a quote, $, backticks, Japanese or an empty string, Then the shell reads it back unchanged', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(shellQuote('$HOME`x`')).toBe(`'$HOME\`x\`'`)
    expect(shellQuote('/Users/me/スライド')).toBe(`'/Users/me/スライド'`)
    expect(shellQuote('')).toBe(`''`)
  })
})

describe('deckLocation', () => {
  test('spec: Given a deck path, Then its folder and file name', () => {
    expect(deckLocation('/Users/me/Desktop/test/deck.md')).toEqual({ dir: '/Users/me/Desktop/test', file: 'deck.md' })
  })

  test('adversarial: Given no path, a bare name, a root file or a trailing slash, Then a usable folder and file', () => {
    expect(deckLocation(null)).toEqual({ dir: '.', file: 'deck.md' })
    expect(deckLocation('')).toEqual({ dir: '.', file: 'deck.md' })
    expect(deckLocation('talk.md')).toEqual({ dir: '.', file: 'talk.md' })
    expect(deckLocation('/deck.md')).toEqual({ dir: '/', file: 'deck.md' })
    expect(deckLocation('/d/')).toEqual({ dir: '/d', file: 'deck.md' })
  })
})

describe('agentConnectCommand', () => {
  test('spec: Given the deck and the bundled crit, Then it changes to the deck\'s folder and waits there', () => {
    expect(agentConnectCommand('/Users/me/Desktop/test/deck.md', CRIT))
      .toBe(`cd /Users/me/Desktop/test && '${CRIT}' --no-open deck.md`)
  })

  test('adversarial: Given a folder and file name that need quoting, Then each is quoted on its own', () => {
    expect(agentConnectCommand("/Users/me/My Talks/it's.md", '/opt/crit'))
      .toBe(`cd '/Users/me/My Talks' && /opt/crit --no-open 'it'\\''s.md'`)
  })
})

describe('agentConnectPrompt', () => {
  test('spec: Given the deck and the bundled crit, Then it has the agent run the command and use that crit throughout', () => {
    const prompt = agentConnectPrompt('/Users/me/Desktop/test/deck.md', CRIT)
    expect(prompt).toContain(`1. Run: cd /Users/me/Desktop/test && '${CRIT}' --no-open deck.md`)
    expect(prompt).toContain(`reply to each one with '${CRIT}' comment --reply-to`)
    expect(prompt).toContain(`say \`crit\`, use '${CRIT}' instead.`)
    expect(prompt).toContain('Repeat until the review is approved.')
  })

  test('adversarial: Given no deck path, Then the prompt still names deck.md in the current folder', () => {
    expect(agentConnectPrompt(null, 'crit')).toContain('1. Run: cd . && crit --no-open deck.md')
  })
})

describe('showsConnectGuide', () => {
  test('spec: Given no agent waiting, with or without a session, Then the card shows', () => {
    expect(showsConnectGuide({ kind: 'agent-not-waiting' })).toBe(true)
    expect(showsConnectGuide({ kind: 'no-session' })).toBe(true)
  })

  test('adversarial: Given an agent waiting, a send running or several sessions, Then it does not', () => {
    for (const kind of ['ready', 'nothing-to-send', 'sending', 'several-sessions'] as const) {
      expect(showsConnectGuide({ kind })).toBe(false)
    }
  })
})
