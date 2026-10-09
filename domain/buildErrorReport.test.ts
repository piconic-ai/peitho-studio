import { describe, expect, test } from 'bun:test'
import {
  BUILD_ERROR_INSTRUCTION, buildErrorComment, buildErrorIdentity, buildErrorLine, decideBuildErrorReport, diskBuildOf, isReportable,
  type BuildErrorReport, type BuildErrorReportEvent,
} from './buildErrorReport'
import type { RenderErrorPayload } from './render'

const SLIDE_TWO: RenderErrorPayload = {
  kind: 'Arity',
  line: 8,
  originFile: null,
  message: "slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  help: 'use a layout with a body slot or remove one paragraph',
  headline: "slide 2 ('two'), line 8: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1",
  slide: { number: 2, key: 'two' },
}

const FRONTMATTER: RenderErrorPayload = {
  kind: 'Parse',
  line: 2,
  originFile: null,
  message: 'invalid deck frontmatter: unknown field `fontss`',
  help: 'use only the supported deck frontmatter keys',
  headline: 'line 2: invalid deck frontmatter: unknown field `fontss`',
  slide: null,
}

const SLIDE_FOUR: RenderErrorPayload = { ...SLIDE_TWO, line: 20, headline: "slide 4, line 20: slot 'body' got 2 item(s), but layout 'title-slide' allows 0..1", slide: { number: 4, key: null } }

const OTHER: RenderErrorPayload = { kind: 'Other', line: null, originFile: null, message: 'layouts/cover.html: no <section>', help: '', headline: 'layouts/cover.html: no <section>', slide: null }

const SOURCE = '# One\n\n---\n\n<!-- {"key":"two"} -->\n# Two\n\nBROKEN\n\n---\n\n# Three\n'

const failed = (...errors: RenderErrorPayload[]): BuildErrorReportEvent => ({ type: 'disk-render-failed', errors, source: SOURCE })
const idle: BuildErrorReport = { kind: 'idle' }
const id = buildErrorIdentity

describe('isReportable', () => {
  test('spec: Given peitho-core\'s own errors, Then they are reportable; an Other failure around it is not', () => {
    expect(isReportable(SLIDE_TWO)).toBe(true)
    expect(isReportable(FRONTMATTER)).toBe(true)
    expect(isReportable(OTHER)).toBe(false)
  })
})

describe('diskBuildOf', () => {
  test('spec: Given no render of the disk was tried, Then nothing is known', () => {
    expect(diskBuildOf({ kind: 'none' })).toBeNull()
  })

  test('spec: Given the deck on disk built as written, Then it is ok', () => {
    expect(diskBuildOf({ kind: 'rendered', source: SOURCE, broken: new Map() })).toEqual({ kind: 'ok' })
  })

  test('spec: Given the deck itself was refused, Then its one error counts into the source that failed', () => {
    expect(diskBuildOf({ kind: 'failed', error: FRONTMATTER, source: '---\nfontss: x\n---\n' }))
      .toEqual({ kind: 'failed', errors: [FRONTMATTER], source: '---\nfontss: x\n---\n' })
  })

  test('spec: Given slides were isolated from the disk\'s render, Then their errors come in source order with the source rendered', () => {
    expect(diskBuildOf({ kind: 'rendered', source: SOURCE, broken: new Map([[3, SLIDE_FOUR], [1, SLIDE_TWO]]) }))
      .toEqual({ kind: 'failed', errors: [SLIDE_TWO, SLIDE_FOUR], source: SOURCE })
  })

  test('adversarial: Given only an Other failure, refused or isolated, Then the build is failed with nothing to report', () => {
    expect(diskBuildOf({ kind: 'failed', error: OTHER, source: 'x' })).toEqual({ kind: 'failed', errors: [], source: 'x' })
    expect(diskBuildOf({ kind: 'rendered', source: SOURCE, broken: new Map([[1, OTHER]]) })).toEqual({ kind: 'failed', errors: [], source: SOURCE })
  })

  test('adversarial: Given an empty source refused, Then the build is failed with that empty source', () => {
    expect(diskBuildOf({ kind: 'failed', error: FRONTMATTER, source: '' })).toEqual({ kind: 'failed', errors: [FRONTMATTER], source: '' })
  })
})

describe('buildErrorIdentity', () => {
  test('spec: Given the same error reported from another line (the lines above it changed), Then it is the same error', () => {
    const moved = { ...SLIDE_TWO, line: 12, headline: "slide 2 ('two'), line 12: ..." }
    expect(id(moved)).toBe(id(SLIDE_TWO))
  })

  test('spec: Given a keyed slide that moved to another position, Then it is the same error', () => {
    expect(id({ ...SLIDE_TWO, slide: { number: 3, key: 'two' } })).toBe(id(SLIDE_TWO))
  })

  test('spec: Given another message, another slide, or another file, Then it is another error', () => {
    expect(id({ ...SLIDE_TWO, message: 'other' })).not.toBe(id(SLIDE_TWO))
    expect(id({ ...SLIDE_TWO, slide: { number: 2, key: 'three' } })).not.toBe(id(SLIDE_TWO))
    expect(id({ ...SLIDE_TWO, originFile: 'parts/a.md' })).not.toBe(id(SLIDE_TWO))
    expect(id({ ...SLIDE_TWO, kind: 'Parse' })).not.toBe(id(SLIDE_TWO))
  })

  test('adversarial: Given a slide with no key, Then its position tells it from another keyless slide with the same message, and a key never reads as a position', () => {
    expect(id({ ...SLIDE_FOUR, slide: { number: 5, key: null } })).not.toBe(id(SLIDE_FOUR))
    expect(id({ ...SLIDE_FOUR, slide: { number: 4, key: '4' } })).not.toBe(id(SLIDE_FOUR))
    expect(id({ ...SLIDE_FOUR, slide: null })).not.toBe(id(SLIDE_FOUR))
  })
})

describe('decideBuildErrorReport', () => {
  describe('the deck on disk fails to build', () => {
    test('spec: Given an agent waiting, When the deck fails, Then its errors are sent at once', () => {
      expect(decideBuildErrorReport(idle, failed(SLIDE_TWO), true)).toEqual({
        next: { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] },
        effect: { kind: 'send', errors: [SLIDE_TWO], source: SOURCE },
      })
    })

    test('spec: Given no agent waiting (at work on its last round), When the deck fails, Then the errors wait for one', () => {
      expect(decideBuildErrorReport(idle, failed(SLIDE_TWO, SLIDE_FOUR), false)).toEqual({
        next: { kind: 'waiting-for-agent', errors: [SLIDE_TWO, SLIDE_FOUR], source: SOURCE, reported: [] },
      })
    })

    test('spec: Given errors waiting, When the agent comes to wait, Then they are sent', () => {
      const waiting: BuildErrorReport = { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(waiting, { type: 'agent-waiting' }, true)).toEqual({
        next: waiting,
        effect: { kind: 'send', errors: [SLIDE_TWO], source: SOURCE },
      })
    })

    test('spec: Given errors waiting, When the deck builds before an agent waits, Then nothing is sent', () => {
      const waiting: BuildErrorReport = { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(waiting, { type: 'disk-render-ok' }, false)).toEqual({ next: idle })
      expect(decideBuildErrorReport(idle, { type: 'agent-waiting' }, true)).toEqual({ next: idle })
    })

    test('spec: Given an error waiting, When the deck changes under it and the error moves (its line, headline, source), Then what waits is the error where it is now, and goes there when the agent comes', () => {
      const waiting: BuildErrorReport = { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      const moved = { ...SLIDE_TWO, line: 10, headline: "slide 2 ('two'), line 10: ..." }
      const movedSource = SOURCE.replace('# One\n', '# One\n\nAn intro line\n')
      const refreshed = decideBuildErrorReport(waiting, { type: 'disk-render-failed', errors: [moved], source: movedSource }, false)
      expect(refreshed).toEqual({ next: { kind: 'waiting-for-agent', errors: [moved], source: movedSource, reported: [] } })
      expect(decideBuildErrorReport(refreshed.next, { type: 'agent-waiting' }, true).effect).toEqual({ kind: 'send', errors: [moved], source: movedSource })
    })

    test('adversarial: Given an error waiting, When the disk renders again with it unchanged, Then what waits is the same (nothing sent, nothing lost)', () => {
      const waiting: BuildErrorReport = { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(waiting, failed(SLIDE_TWO), false)).toEqual({ next: waiting })
    })

    test('adversarial: Given errors waiting, When the agent waits but a send is in flight, Then nothing is sent yet and nothing is lost', () => {
      const waiting: BuildErrorReport = { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(waiting, { type: 'agent-waiting' }, false)).toEqual({ next: waiting })
    })

    test('adversarial: Given the same error twice in one render, Then it is sent once', () => {
      const twice = failed(SLIDE_TWO, { ...SLIDE_TWO, line: 9 })
      expect(decideBuildErrorReport(idle, twice, true).effect).toEqual({ kind: 'send', errors: [SLIDE_TWO], source: SOURCE })
    })

    test('adversarial: Given a failure with nothing reportable (an Other error only), Then nothing waits and an agent coming sends nothing', () => {
      expect(decideBuildErrorReport(idle, failed(), true)).toEqual({ next: idle })
    })
  })

  describe('after a send', () => {
    const waiting: BuildErrorReport = { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] }

    test('spec: Given the errors reached crit, Then they are recorded as sent', () => {
      expect(decideBuildErrorReport(waiting, { type: 'sent', identities: [id(SLIDE_TWO)] }, false)).toEqual({ next: { kind: 'sent', reported: [id(SLIDE_TWO)] } })
    })

    test('spec: Given an error was sent, When the same error is still there after the next edit (its line moved), Then it is not sent again', () => {
      const sent: BuildErrorReport = { kind: 'sent', reported: [id(SLIDE_TWO)] }
      const moved = { ...SLIDE_TWO, line: 12, headline: "slide 2 ('two'), line 12: ..." }
      expect(decideBuildErrorReport(sent, failed(moved), true)).toEqual({ next: sent })
    })

    test('spec: Given an error was sent, When another error appears, Then only the new one is sent', () => {
      const sent: BuildErrorReport = { kind: 'sent', reported: [id(SLIDE_TWO)] }
      expect(decideBuildErrorReport(sent, failed(SLIDE_TWO, SLIDE_FOUR), true)).toEqual({
        next: { kind: 'waiting-for-agent', errors: [SLIDE_FOUR], source: SOURCE, reported: [id(SLIDE_TWO)] },
        effect: { kind: 'send', errors: [SLIDE_FOUR], source: SOURCE },
      })
    })

    test('spec: Given an error was sent, When the deck builds and then breaks the same way again, Then it is sent again', () => {
      const sent: BuildErrorReport = { kind: 'sent', reported: [id(SLIDE_TWO)] }
      const built = decideBuildErrorReport(sent, { type: 'disk-render-ok' }, false)
      expect(built).toEqual({ next: idle })
      expect(decideBuildErrorReport(built.next, failed(SLIDE_TWO), true).effect).toEqual({ kind: 'send', errors: [SLIDE_TWO], source: SOURCE })
    })

    test('spec: Given the send failed, Then its errors are held, and the agent waiting on (the send ending) retries nothing', () => {
      const held: BuildErrorReport = { kind: 'send-failed', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(waiting, { type: 'send-failed' }, true)).toEqual({ next: held })
      expect(decideBuildErrorReport(held, { type: 'agent-waiting' }, true)).toEqual({ next: held })
    })

    test('spec: Given a send failed, When the deck renders on disk again with the same error (its line moved or not), Then it is sent again, where it is now', () => {
      const held: BuildErrorReport = { kind: 'send-failed', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(held, failed(SLIDE_TWO), true)).toEqual({
        next: { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] },
        effect: { kind: 'send', errors: [SLIDE_TWO], source: SOURCE },
      })
      const moved = { ...SLIDE_TWO, line: 10, headline: "slide 2 ('two'), line 10: ..." }
      expect(decideBuildErrorReport(held, { type: 'disk-render-failed', errors: [moved], source: 'moved' }, true).effect).toEqual({ kind: 'send', errors: [moved], source: 'moved' })
    })

    test('spec: Given a send failed, When the agent comes to wait again (its next round), Then the held errors are sent — or wait, with a send in flight', () => {
      const held: BuildErrorReport = { kind: 'send-failed', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(held, { type: 'agent-arrived' }, true)).toEqual({
        next: { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] },
        effect: { kind: 'send', errors: [SLIDE_TWO], source: SOURCE },
      })
      const busy = decideBuildErrorReport(held, { type: 'agent-arrived' }, false)
      expect(busy).toEqual({ next: { kind: 'waiting-for-agent', errors: [SLIDE_TWO], source: SOURCE, reported: [] } })
      expect(decideBuildErrorReport(busy.next, { type: 'agent-waiting' }, true).effect).toEqual({ kind: 'send', errors: [SLIDE_TWO], source: SOURCE })
    })

    test('spec: Given a send failed, When the deck builds on disk, Then the held errors are forgotten', () => {
      const held: BuildErrorReport = { kind: 'send-failed', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(held, { type: 'disk-render-ok' }, true)).toEqual({ next: idle })
    })

    test('adversarial: Given a send failed after an earlier one succeeded, Then what was sent stays known and only what failed is sent next time', () => {
      const partly: BuildErrorReport = { kind: 'waiting-for-agent', errors: [SLIDE_FOUR], source: SOURCE, reported: [id(SLIDE_TWO)] }
      const held = decideBuildErrorReport(partly, { type: 'send-failed' }, true)
      expect(held).toEqual({ next: { kind: 'send-failed', errors: [SLIDE_FOUR], source: SOURCE, reported: [id(SLIDE_TWO)] } })
      expect(decideBuildErrorReport(held.next, failed(SLIDE_TWO, SLIDE_FOUR), true).effect).toEqual({ kind: 'send', errors: [SLIDE_FOUR], source: SOURCE })
      expect(decideBuildErrorReport(held.next, { type: 'agent-arrived' }, true).effect).toEqual({ kind: 'send', errors: [SLIDE_FOUR], source: SOURCE })
    })

    test('adversarial: Given a send failed, When the deck renders on disk with that error fixed and another broken, Then only the other is sent and the held one is forgotten', () => {
      const held: BuildErrorReport = { kind: 'send-failed', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(held, failed(SLIDE_FOUR), true)).toEqual({
        next: { kind: 'waiting-for-agent', errors: [SLIDE_FOUR], source: SOURCE, reported: [] },
        effect: { kind: 'send', errors: [SLIDE_FOUR], source: SOURCE },
      })
    })

    test('adversarial: Given the agent arrives in idle, waiting-for-agent or sent, Then nothing changes (agent-waiting is what sends)', () => {
      const sent: BuildErrorReport = { kind: 'sent', reported: [id(SLIDE_TWO)] }
      expect(decideBuildErrorReport(idle, { type: 'agent-arrived' }, true)).toEqual({ next: idle })
      expect(decideBuildErrorReport(waiting, { type: 'agent-arrived' }, true)).toEqual({ next: waiting })
      expect(decideBuildErrorReport(sent, { type: 'agent-arrived' }, true)).toEqual({ next: sent })
    })

    test('adversarial: Given a send failed twice over, Then the held errors are held still, and a sent event for them settles as sent', () => {
      const held: BuildErrorReport = { kind: 'send-failed', errors: [SLIDE_TWO], source: SOURCE, reported: [] }
      expect(decideBuildErrorReport(held, { type: 'send-failed' }, true)).toEqual({ next: held })
      expect(decideBuildErrorReport(held, { type: 'sent', identities: [id(SLIDE_TWO)] }, false)).toEqual({ next: { kind: 'sent', reported: [id(SLIDE_TWO)] } })
    })

    test('adversarial: Given the deck changed while the send ran, Then what it added waits to be sent and what it fixed is forgotten', () => {
      const changed = decideBuildErrorReport(waiting, failed(SLIDE_TWO, SLIDE_FOUR), false).next
      expect(decideBuildErrorReport(changed, { type: 'sent', identities: [id(SLIDE_TWO)] }, false)).toEqual({
        next: { kind: 'waiting-for-agent', errors: [SLIDE_FOUR], source: SOURCE, reported: [id(SLIDE_TWO)] },
      })
      const fixed = decideBuildErrorReport(waiting, { type: 'disk-render-ok' }, false).next
      expect(decideBuildErrorReport(fixed, { type: 'sent', identities: [id(SLIDE_TWO)] }, false)).toEqual({ next: idle })
    })

    test('adversarial: Given errors were sent, When the deck fails with other errors while waiting and those get fixed too, Then the state settles on what was sent', () => {
      const sent: BuildErrorReport = { kind: 'sent', reported: [id(SLIDE_TWO)] }
      const more = decideBuildErrorReport(sent, failed(SLIDE_TWO, SLIDE_FOUR), false).next
      expect(more.kind).toBe('waiting-for-agent')
      expect(decideBuildErrorReport(more, failed(SLIDE_TWO), false)).toEqual({ next: sent })
    })

    test('adversarial: Given a sent event arrives in sent or idle, Then sent gathers the identities and idle stays idle', () => {
      const sent: BuildErrorReport = { kind: 'sent', reported: [id(SLIDE_TWO)] }
      expect(decideBuildErrorReport(sent, { type: 'sent', identities: [id(SLIDE_FOUR), id(SLIDE_TWO)] }, false)).toEqual({ next: { kind: 'sent', reported: [id(SLIDE_TWO), id(SLIDE_FOUR)] } })
      expect(decideBuildErrorReport(idle, { type: 'sent', identities: [id(SLIDE_TWO)] }, false)).toEqual({ next: idle })
      expect(decideBuildErrorReport(sent, { type: 'send-failed' }, false)).toEqual({ next: sent })
    })
  })
})

describe('buildErrorLine', () => {
  test('spec: Given an error on a line of the deck, Then the comment goes on that line', () => {
    expect(buildErrorLine(SLIDE_TWO, SOURCE)).toBe(8)
  })

  test('adversarial: Given no line, line 0, a line past the end, a fraction, or an error in an included file, Then the comment goes on line 1', () => {
    expect(buildErrorLine({ ...SLIDE_TWO, line: null }, SOURCE)).toBe(1)
    expect(buildErrorLine({ ...SLIDE_TWO, line: 0 }, SOURCE)).toBe(1)
    expect(buildErrorLine({ ...SLIDE_TWO, line: 99 }, SOURCE)).toBe(1)
    expect(buildErrorLine({ ...SLIDE_TWO, line: 2.5 }, SOURCE)).toBe(1)
    expect(buildErrorLine({ ...SLIDE_TWO, line: 3, originFile: 'parts/intro.md' }, SOURCE)).toBe(1)
    expect(buildErrorLine({ ...SLIDE_TWO, line: 1 }, '')).toBe(1)
  })

  test('adversarial: Given the last line (no newline after it), Then it still counts', () => {
    expect(buildErrorLine({ ...SLIDE_TWO, line: 3 }, 'a\nb\nc')).toBe(3)
    expect(buildErrorLine({ ...SLIDE_TWO, line: 4 }, 'a\nb\nc')).toBe(1)
  })
})

describe('buildErrorComment', () => {
  test('spec: Given a slide\'s slot error, Then the comment is on its line, quotes that line, and carries the headline, the help and what to do', () => {
    expect(buildErrorComment(SLIDE_TWO, SOURCE)).toEqual({
      startLine: 8,
      endLine: 8,
      quote: 'BROKEN',
      body: `[Build error] ${SLIDE_TWO.headline}\n= help: ${SLIDE_TWO.help}\n${BUILD_ERROR_INSTRUCTION}`,
      author: 'Peitho Studio',
    })
  })

  test('spec: Given a frontmatter error, Then the comment is on its line of the frontmatter', () => {
    const comment = buildErrorComment(FRONTMATTER, '---\nfontss: x\n---\n\n# Hi\n')
    expect([comment.startLine, comment.endLine, comment.quote]).toEqual([2, 2, 'fontss: x'])
    expect(comment.body.startsWith('[Build error] line 2: invalid deck frontmatter')).toBe(true)
  })

  test('spec: Given an error in an included file, Then the comment goes on line 1 and names the file', () => {
    const comment = buildErrorComment({ ...SLIDE_TWO, line: 3, originFile: 'parts/intro.md', headline: "parts/intro.md:3, slide 2 ('two'): ..." }, SOURCE)
    expect([comment.startLine, comment.endLine, comment.quote]).toEqual([1, 1, '# One'])
    expect(comment.body).toContain('The error is in parts/intro.md, which the deck includes.')
  })

  test('adversarial: Given no help, Then there is no help line', () => {
    const comment = buildErrorComment({ ...SLIDE_TWO, help: '' }, SOURCE)
    expect(comment.body).toBe(`[Build error] ${SLIDE_TWO.headline}\n${BUILD_ERROR_INSTRUCTION}`)
  })

  test('adversarial: Given an empty source, no line, or a line that is blank, Then the comment is on line 1 with an empty quote', () => {
    expect(buildErrorComment(SLIDE_TWO, '')).toMatchObject({ startLine: 1, endLine: 1, quote: '' })
    expect(buildErrorComment({ ...SLIDE_TWO, line: null }, SOURCE)).toMatchObject({ startLine: 1, endLine: 1, quote: '# One' })
    expect(buildErrorComment({ ...SLIDE_TWO, line: 2 }, SOURCE)).toMatchObject({ startLine: 2, endLine: 2, quote: '' })
  })

  test('adversarial: Given a CRLF source, Then the quote has no CR', () => {
    expect(buildErrorComment({ ...SLIDE_TWO, line: 2 }, '# One\r\nBROKEN\r\n').quote).toBe('BROKEN')
  })
})
