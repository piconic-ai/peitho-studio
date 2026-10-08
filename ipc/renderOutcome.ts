// How a `RenderOutcome` (peitho.rs's answer to `open_deck`/`render_draft`)
// crosses the IPC boundary: a `failed` outcome is thrown as a
// `RenderFailure`, so `DeckIpc.renderDraft` keeps resolving with a
// `RenderPayload` and every caller that already `catch`es and shows
// `String(err)` reads what the command's string rejection used to say.
// A caller that needs the structure (the preview pane, the broken-slide
// selection) takes it from `err.error` after `instanceof RenderFailure`.
// Apart from `ipc/deckIpc.ts` (its `@tauri-apps` imports don't load under
// `bun test`), so the conversion is unit-testable.
import { renderFailureMessage, type RenderErrorPayload, type RenderOutcome, type RenderPayload } from '../domain/render'

export class RenderFailure extends Error {
  readonly error: RenderErrorPayload

  constructor(error: RenderErrorPayload) {
    super(renderFailureMessage(error))
    this.name = 'RenderFailure'
    this.error = error
  }

  /** The message alone — `String(err)` on an `Error` would prefix its
   * `name`, which the error bar never showed for a string rejection. */
  override toString(): string {
    return this.message
  }
}

/** The payload of a rendered outcome; throws the failure of a failed one. */
export function unwrapRenderOutcome(outcome: RenderOutcome): RenderPayload {
  if (outcome.kind === 'failed') throw new RenderFailure(outcome.error)
  return outcome
}
