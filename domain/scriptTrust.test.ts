import { describe, expect, test } from 'bun:test'
import { isExecutableRemoval, nextScriptTrust, scriptTrustOnOpen, trustBannerShown, type ScriptTrust, type ScriptTrustEvent } from './scriptTrust'

describe('isExecutableRemoval', () => {
  test('spec: Given a removed <script>, <iframe>, <object> or <embed>, then it counts as blocked script', () => {
    for (const tag of ['script', 'iframe', 'frame', 'object', 'embed']) {
      expect({ tag, executable: isExecutableRemoval({ kind: 'element', tag }) }).toEqual({ tag, executable: true })
    }
  })

  test('spec: Given a removed event handler attribute, then it counts as blocked script', () => {
    expect(isExecutableRemoval({ kind: 'attribute', name: 'onerror', value: 'alert(1)' })).toBe(true)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'onclick', value: '' })).toBe(true)
  })

  test('spec: Given a removed srcdoc or javascript: URL, then it counts as blocked script', () => {
    expect(isExecutableRemoval({ kind: 'attribute', name: 'srcdoc', value: '<p>hi</p>' })).toBe(true)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'href', value: 'javascript:alert(1)' })).toBe(true)
  })

  test('spec: Given removed markup that never runs code, then it does not count', () => {
    expect(isExecutableRemoval({ kind: 'element', tag: 'meta' })).toBe(false)
    expect(isExecutableRemoval({ kind: 'element', tag: 'my-widget' })).toBe(false)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'href', value: 'https://example.com/' })).toBe(false)
  })

  test('adversarial: Given upper-case tag or attribute names, then they are recognized the same', () => {
    expect(isExecutableRemoval({ kind: 'element', tag: 'SCRIPT' })).toBe(true)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'OnLoad', value: '' })).toBe(true)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'SRCDOC', value: '' })).toBe(true)
  })

  test('adversarial: Given a javascript: URL disguised with case, spaces or control characters, then it still counts', () => {
    for (const value of ['JavaScript:alert(1)', '  javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', '\u0000javascript:x', 'vbscript:msgbox']) {
      expect({ value, executable: isExecutableRemoval({ kind: 'attribute', name: 'href', value }) }).toEqual({ value, executable: true })
    }
  })

  test('adversarial: Given empty names and values, or a bare "on", then nothing counts', () => {
    expect(isExecutableRemoval({ kind: 'element', tag: '' })).toBe(false)
    expect(isExecutableRemoval({ kind: 'attribute', name: '', value: '' })).toBe(false)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'on', value: '' })).toBe(false)
  })

  test('adversarial: Given a URL that merely mentions javascript later on, then it does not count', () => {
    expect(isExecutableRemoval({ kind: 'attribute', name: 'href', value: 'https://example.com/?q=javascript:' })).toBe(false)
  })

  test('adversarial: Given a removed link or source with any scheme outside the safe list (data:, a made-up one), then it counts', () => {
    expect(isExecutableRemoval({ kind: 'attribute', name: 'href', value: 'data:text/html,<script>alert(1)</script>' })).toBe(true)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'xlink:href', value: 'data:image/svg+xml,<svg onload=x>' })).toBe(true)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'action', value: 'made-up-scheme:run' })).toBe(true)
  })

  test('adversarial: Given a removed URL attribute with a safe or no scheme, or a colon in a non-URL attribute, then it does not count', () => {
    expect(isExecutableRemoval({ kind: 'attribute', name: 'href', value: 'mailto:someone@example.com' })).toBe(false)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'src', value: 'assets/logo.png' })).toBe(false)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'src', value: '' })).toBe(false)
    expect(isExecutableRemoval({ kind: 'attribute', name: 'title', value: 'note: data:' })).toBe(false)
  })
})

describe('script trust', () => {
  const events: ScriptTrustEvent[] = ['blocked', 'trust-requested', 'trust-succeeded', 'trust-failed']

  test('spec: Given a trusted deck, when it is opened, then no banner is shown', () => {
    expect(trustBannerShown(scriptTrustOnOpen(true))).toBe(false)
  })

  test('spec: Given an untrusted deck with no scripts, when it is opened, then no banner is shown', () => {
    expect(trustBannerShown(scriptTrustOnOpen(false))).toBe(false)
  })

  test('spec: Given an untrusted deck, when a script is blocked, then the banner is shown', () => {
    expect(trustBannerShown(nextScriptTrust(scriptTrustOnOpen(false), 'blocked'))).toBe(true)
  })

  test('spec: Given the banner, when the user trusts the deck and it is saved, then the deck is trusted and the banner goes away', () => {
    const blocked = nextScriptTrust(scriptTrustOnOpen(false), 'blocked')
    const trusting = nextScriptTrust(blocked, 'trust-requested')
    expect(trusting).toEqual({ kind: 'trusting' })
    expect(trustBannerShown(trusting)).toBe(true)
    const trusted = nextScriptTrust(trusting, 'trust-succeeded')
    expect(trusted).toEqual({ kind: 'trusted' })
    expect(trustBannerShown(trusted)).toBe(false)
  })

  test('spec: Given the user trusts the deck, when saving the trust fails, then the banner stays so they can try again', () => {
    const trusting: ScriptTrust = { kind: 'trusting' }
    const failed = nextScriptTrust(trusting, 'trust-failed')
    expect(failed).toEqual({ kind: 'untrusted', blocked: true })
    expect(trustBannerShown(failed)).toBe(true)
  })

  test('adversarial: Given a trusted deck, when any event arrives, then it stays trusted (the same object)', () => {
    const trusted = scriptTrustOnOpen(true)
    for (const event of events) expect(nextScriptTrust(trusted, event)).toBe(trusted)
  })

  test('adversarial: Given an already-blocked deck, when more scripts are blocked, then the state is the same object', () => {
    const blocked = nextScriptTrust(scriptTrustOnOpen(false), 'blocked')
    expect(nextScriptTrust(blocked, 'blocked')).toBe(blocked)
  })

  test('adversarial: Given a trust request in flight, when slides mount and block scripts or the button is pressed again, then nothing changes', () => {
    const trusting: ScriptTrust = { kind: 'trusting' }
    expect(nextScriptTrust(trusting, 'blocked')).toBe(trusting)
    expect(nextScriptTrust(trusting, 'trust-requested')).toBe(trusting)
  })

  test('adversarial: Given no trust request, when a stray success or failure arrives, then the untrusted state is unchanged', () => {
    const untrusted = scriptTrustOnOpen(false)
    expect(nextScriptTrust(untrusted, 'trust-succeeded')).toBe(untrusted)
    expect(nextScriptTrust(untrusted, 'trust-failed')).toBe(untrusted)
  })
})
