import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  INITIAL_CLIPBOARD_MIRROR,
  afterClipboardRead,
  afterVimCommand,
  clipboardReadToken,
  parseVimMode,
  registerTextFromClipboard,
  takesCommandKeys,
  type ClipboardMirror,
} from './vimMode'

describe('parseVimMode', () => {
  test('spec: Given each mode vim reports, when read, then it is that mode', () => {
    for (const mode of ['normal', 'insert', 'visual', 'replace'] as const) expect(parseVimMode(mode)).toBe(mode)
  })

  test('adversarial: Given anything else, when read, then there is no mode', () => {
    for (const raw of ['', 'NORMAL', 'visual line', ' insert', null, undefined, 0, {}, ['normal']]) {
      expect(parseVimMode(raw)).toBeNull()
    }
  })
})

describe('takesCommandKeys', () => {
  test('spec: Given normal or visual mode, when keys are typed, then they are commands, so the input source goes to ASCII', () => {
    expect(takesCommandKeys('normal')).toBe(true)
    expect(takesCommandKeys('visual')).toBe(true)
  })

  test('spec: Given insert or replace mode, when keys are typed, then they are text, so the input source is left alone', () => {
    expect(takesCommandKeys('insert')).toBe(false)
    expect(takesCommandKeys('replace')).toBe(false)
  })
})

describe('afterVimCommand', () => {
  test('spec: Given a line was just yanked, when the command finishes, then the yanked text is written to the OS clipboard', () => {
    const { mirror, write } = afterVimCommand(INITIAL_CLIPBOARD_MIRROR, 'line\n')
    expect(write).toBe('line\n')
    expect(mirror).toEqual({ lastSynced: 'line\n', writes: 1 })
  })

  test('spec: Given the register has not changed since the last write, when another command (a cursor move) finishes, then nothing is written', () => {
    const first = afterVimCommand(INITIAL_CLIPBOARD_MIRROR, 'word')
    const second = afterVimCommand(first.mirror, 'word')
    expect(second.write).toBeNull()
    expect(second.mirror).toBe(first.mirror)
  })

  test('spec: Given the register was loaded from the OS clipboard, when a command finishes, then the same text is not written back', () => {
    const read = afterClipboardRead(INITIAL_CLIPBOARD_MIRROR, 0, 'from another app')
    expect(afterVimCommand(read.mirror, 'from another app').write).toBeNull()
  })

  test('adversarial: Given nothing has been yanked yet (an empty register), when a command finishes, then the OS clipboard is left alone', () => {
    expect(afterVimCommand(INITIAL_CLIPBOARD_MIRROR, '')).toEqual({ mirror: INITIAL_CLIPBOARD_MIRROR, write: null })
  })

  test('adversarial: Given a register holding only whitespace or a line break, when a command finishes, then it is still written', () => {
    expect(afterVimCommand(INITIAL_CLIPBOARD_MIRROR, '\n').write).toBe('\n')
    expect(afterVimCommand(INITIAL_CLIPBOARD_MIRROR, ' ').write).toBe(' ')
  })
})

describe('registerTextFromClipboard', () => {
  test('spec: Given clipboard text ending with a line break, when put, then it goes in as whole lines', () => {
    expect(registerTextFromClipboard('one\ntwo\n')).toEqual({ text: 'one\ntwo\n', linewise: true })
    expect(registerTextFromClipboard('windows\r\n')).toEqual({ text: 'windows\r\n', linewise: true })
  })

  test('spec: Given clipboard text without a trailing line break, when put, then it goes in inside the line', () => {
    expect(registerTextFromClipboard('word')).toEqual({ text: 'word', linewise: false })
    expect(registerTextFromClipboard('one\ntwo')).toEqual({ text: 'one\ntwo', linewise: false })
  })

  test('adversarial: Given an empty string or a lone line break, when put, then only the line break is linewise', () => {
    expect(registerTextFromClipboard('')).toEqual({ text: '', linewise: false })
    expect(registerTextFromClipboard('\n')).toEqual({ text: '\n', linewise: true })
  })
})

describe('afterClipboardRead', () => {
  test('spec: Given text copied in another app, when the clipboard is read, then it is loaded into the register for p', () => {
    const token = clipboardReadToken(INITIAL_CLIPBOARD_MIRROR)
    const { mirror, load } = afterClipboardRead(INITIAL_CLIPBOARD_MIRROR, token, 'copied elsewhere')
    expect(load).toEqual({ text: 'copied elsewhere', linewise: false })
    expect(mirror.lastSynced).toBe('copied elsewhere')
  })

  test('spec: Given the clipboard still holds what vim last yanked, when read, then the register is left alone (keeping its own linewise/blockwise shape)', () => {
    const yanked = afterVimCommand(INITIAL_CLIPBOARD_MIRROR, 'yanked')
    const read = afterClipboardRead(yanked.mirror, clipboardReadToken(yanked.mirror), 'yanked')
    expect(read.load).toBeNull()
    expect(read.mirror).toBe(yanked.mirror)
  })

  test('adversarial: Given a read started before a yank, when it answers with the older clipboard text, then the yank is kept', () => {
    // Focus comes back (a read starts), then `yy` runs before the read
    // answers: the answer is the clipboard from before the yank.
    const token = clipboardReadToken(INITIAL_CLIPBOARD_MIRROR)
    const yanked = afterVimCommand(INITIAL_CLIPBOARD_MIRROR, 'new yank\n')
    const read = afterClipboardRead(yanked.mirror, token, 'older clipboard')
    expect(read.load).toBeNull()
    expect(read.mirror).toBe(yanked.mirror)
  })

  test('adversarial: Given an empty clipboard or one holding no text (an image), when read, then the register is left alone', () => {
    for (const text of ['', null]) {
      expect(afterClipboardRead(INITIAL_CLIPBOARD_MIRROR, 0, text)).toEqual({ mirror: INITIAL_CLIPBOARD_MIRROR, load: null })
    }
  })

  test('adversarial: Given the same new clipboard text answered twice (focus then copy), when read, then it is loaded only once', () => {
    const first = afterClipboardRead(INITIAL_CLIPBOARD_MIRROR, 0, 'twice')
    const second = afterClipboardRead(first.mirror, 0, 'twice')
    expect(first.load).not.toBeNull()
    expect(second.load).toBeNull()
  })

  test('property: after any sequence of yanks and reads, the register and clipboard agree on the last text either side produced', () => {
    type Step = { kind: 'yank'; text: string } | { kind: 'read'; text: string | null }
    const step = fc.oneof(
      fc.record({ kind: fc.constant('yank' as const), text: fc.string() }),
      fc.record({ kind: fc.constant('read' as const), text: fc.option(fc.string(), { nil: null }) }),
    )
    fc.assert(fc.property(fc.array(step), steps => {
      let mirror: ClipboardMirror = INITIAL_CLIPBOARD_MIRROR
      let lastNonEmpty: string | null = null
      for (const s of steps) {
        if (s.kind === 'yank') {
          mirror = afterVimCommand(mirror, s.text).mirror
          if (s.text !== '') lastNonEmpty = s.text
        } else {
          mirror = afterClipboardRead(mirror, clipboardReadToken(mirror), s.text).mirror
          if (s.text !== null && s.text !== '') lastNonEmpty = s.text
        }
      }
      return mirror.lastSynced === lastNonEmpty
    }))
  })
})
