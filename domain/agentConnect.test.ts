import { describe, expect, test } from 'bun:test'
import { AGENT_IDLE_MS, agentConnectCommand, agentConnectPrompt, agentGoneQuiet, deckLocation, shellQuote, showsConnectGuide } from './agentConnect'

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

  test('spec: Given a deck with layout folders, Then the agent names them too, as Studio\'s session does', () => {
    expect(agentConnectCommand('/d/deck.md', 'crit', ['layouts', 'css'])).toBe('cd /d && crit --no-open deck.md layouts css')
    expect(agentConnectCommand('/d/deck.md', 'crit', ['css'])).toBe('cd /d && crit --no-open deck.md css')
    expect(agentConnectCommand('/d/deck.md', 'crit', [])).toBe('cd /d && crit --no-open deck.md')
  })

  test('adversarial: Given a folder name that needs quoting, Then it is quoted on its own', () => {
    expect(agentConnectCommand('/d/deck.md', 'crit', ["it's dir"])).toBe(`cd /d && crit --no-open deck.md 'it'\\''s dir'`)
  })

  test('adversarial: Given a folder and file name that need quoting, Then each is quoted on its own', () => {
    expect(agentConnectCommand("/Users/me/My Talks/it's.md", '/opt/crit'))
      .toBe(`cd '/Users/me/My Talks' && /opt/crit --no-open 'it'\\''s.md'`)
  })
})

describe('agentConnectPrompt', () => {
  test('spec: Given the deck and the bundled crit, Then it has the agent run the command and use that crit throughout', () => {
    const prompt = agentConnectPrompt('/Users/me/Desktop/test/deck.md', CRIT, 'en')
    expect(prompt).toContain(`1. Run: cd /Users/me/Desktop/test && '${CRIT}' --no-open deck.md`)
    expect(prompt).toContain(`reply to each one with '${CRIT}' comment --reply-to`)
    expect(prompt).toContain(`say \`crit\`, use '${CRIT}' instead.`)
    expect(prompt).toContain('Repeat until the review is approved.')
  })

  test('spec: Given the UI in Japanese or English, Then the agent is asked to reply in that language', () => {
    expect(agentConnectPrompt('/d/deck.md', 'crit', 'ja')).toContain('5. Write your replies in Japanese.')
    expect(agentConnectPrompt('/d/deck.md', 'crit', 'en')).toContain('5. Write your replies in English.')
  })

  test('spec: Given layout folders, Then the prompt\'s command names them and layout comments are pointed at them', () => {
    const prompt = agentConnectPrompt('/d/deck.md', 'crit', 'en', ['layouts', 'css'])
    expect(prompt).toContain('1. Run: cd /d && crit --no-open deck.md layouts css')
    expect(prompt).toContain('for a comment on a layout, in the layout files it names')
  })

  test('adversarial: Given no deck path, Then the prompt still names deck.md in the current folder', () => {
    expect(agentConnectPrompt(null, 'crit', 'en')).toContain('1. Run: cd . && crit --no-open deck.md')
  })
})

describe('showsConnectGuide', () => {
  test('spec: Given no session, or a session no agent was ever seen waiting in, Then the card shows', () => {
    expect(showsConnectGuide({ kind: 'no-session' }, false)).toBe(true)
    expect(showsConnectGuide({ kind: 'agent-not-waiting' }, false)).toBe(true)
  })

  test('spec: Given an agent seen waiting that is now at work on a sent round, Then no card', () => {
    expect(showsConnectGuide({ kind: 'agent-not-waiting' }, true)).toBe(false)
  })

  test('adversarial: Given an agent waiting, a send running or several sessions, Then no card, seen or not', () => {
    for (const kind of ['ready', 'nothing-to-send', 'sending', 'several-sessions'] as const) {
      expect(showsConnectGuide({ kind }, false)).toBe(false)
      expect(showsConnectGuide({ kind }, true)).toBe(false)
    }
  })
})

describe('agentGoneQuiet', () => {
  test('spec: Given an agent heard from a moment ago, Then it is still taken to be at work; silent past the limit, it is gone', () => {
    expect(agentGoneQuiet(1_000, 1_000 + 30_000)).toBe(false)
    expect(agentGoneQuiet(1_000, 1_000 + AGENT_IDLE_MS)).toBe(true)
  })

  test('adversarial: Given a clock that went backwards, a zero limit, or the limit exactly, Then the edges hold', () => {
    expect(agentGoneQuiet(5_000, 1_000)).toBe(false)
    expect(agentGoneQuiet(5_000, 5_000, 0)).toBe(true)
    expect(agentGoneQuiet(0, 99, 100)).toBe(false)
  })
})
