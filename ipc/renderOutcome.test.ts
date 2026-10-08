import { describe, expect, test } from 'bun:test'
import { RenderFailure, unwrapRenderOutcome } from './renderOutcome'
import type { RenderErrorPayload, RenderOutcome, RenderPayload } from '../domain/render'

const payload: RenderPayload = {
  manifest: { title: 'Deck', slideCount: 0, canvasWidth: 1280, canvasHeight: 720, sections: [], slides: [] },
  fragments: {},
  slideLayouts: {},
  headingLayouts: [],
  assetBaseUrl: 'http://127.0.0.1:1/',
  css: '',
}

const error: RenderErrorPayload = {
  kind: 'Arity',
  line: 12,
  originFile: null,
  message: "slot 'code' got 2 item(s)",
  help: 'remove one code block',
  headline: "slide 2 ('arch'), line 12: slot 'code' got 2 item(s)",
  slide: { number: 2, key: 'arch' },
}

describe('unwrapRenderOutcome', () => {
  test('spec: given a rendered outcome, the payload comes back with its fields intact', () => {
    const outcome: RenderOutcome = { kind: 'rendered', ...payload }
    const unwrapped = unwrapRenderOutcome(outcome)
    expect(unwrapped.manifest.title).toBe('Deck')
    expect(unwrapped.assetBaseUrl).toBe('http://127.0.0.1:1/')
  })

  test('spec: given a failed outcome, it throws a RenderFailure carrying the structured error', () => {
    let thrown: unknown = null
    try {
      unwrapRenderOutcome({ kind: 'failed', error })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(RenderFailure)
    expect((thrown as RenderFailure).error).toEqual(error)
  })

  test('spec: the failure\'s message is the headline and the help, as the command used to reject', () => {
    const failure = new RenderFailure(error)
    expect(failure.message).toBe("slide 2 ('arch'), line 12: slot 'code' got 2 item(s)\n  = help: remove one code block")
  })

  test('spec: String(err) — what every existing catch shows in the error bar — is the message alone, with no "Error:" prefix', () => {
    const failure = new RenderFailure(error)
    expect(String(failure)).toBe(failure.message)
    expect(`${failure}`).toBe(failure.message)
  })

  test('adversarial: an error with no help has a one-line message', () => {
    const failure = new RenderFailure({ ...error, help: '', slide: null, headline: 'layouts/x.html: broken' })
    expect(String(failure)).toBe('layouts/x.html: broken')
  })

  test('adversarial: the failure is a real Error (stack, instanceof) so an unguarded rejection still surfaces as one', () => {
    const failure = new RenderFailure(error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.name).toBe('RenderFailure')
  })
})
