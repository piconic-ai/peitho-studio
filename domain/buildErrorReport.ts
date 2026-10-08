// Reporting the deck's build errors to the agent waiting in crit
// (todo/auto-report-build-error.md): when the deck on disk doesn't build —
// opened broken, or broken by an edit from outside Studio (the agent's
// own, most often) — each error goes to the agent as a comment on its
// line and the round is finished, with nothing for the user to write. This
// module holds every decision of that: which errors the render state
// reports, whether to send now or wait for the agent, what was sent
// already and so isn't sent again, and the comment each error becomes.
// Talking to crit (`ipc/critIpc.ts`) is `components/Studio.tsx`'s, which
// only runs the `effect` a decision names, like `deckLifecycle.ts`'s.
import type { NewReviewComment } from './critReview'
import type { DiskRenderState, RenderErrorPayload } from './render'
import { REVIEW_AUTHOR, agentCommentBody } from './reviewComment'

/** The label in front of a reported error's comment (`agentCommentBody`). */
export const BUILD_ERROR_LABEL = 'Build error'

/** What the comment asks of the agent, after the error itself. */
export const BUILD_ERROR_INSTRUCTION = 'Fix the deck so `peitho build` passes, then reply.'

/** What the deck on disk builds to, as the disk's render state says:
 * every error — the deck's own refusal, or the slides its render isolated
 * (`domain/brokenSlides.ts`) — with the source they count lines into, or
 * `ok` for a deck that built as written. */
export type DiskBuild =
  | { kind: 'ok' }
  | { kind: 'failed'; errors: readonly RenderErrorPayload[]; source: string }

/** An error the agent can act on: one from peitho-core (`kind` names its
 * category). An `Other` failure — a layout file that doesn't parse, an IO
 * error — has no line and no help to send, and is left to the error bar. */
export function isReportable(error: RenderErrorPayload): boolean {
  return error.kind !== 'Other'
}

/** The deck on disk's build as its render state (`state/renderStore.ts`'s
 * `diskRender`, never a draft's) describes it, or `null` before any render
 * of the disk was tried. A rendered deck is `ok` unless slides were
 * isolated from it; their errors come in source order. */
export function diskBuildOf(disk: DiskRenderState): DiskBuild | null {
  if (disk.kind === 'none') return null
  if (disk.kind === 'failed') return { kind: 'failed', errors: [disk.error].filter(isReportable), source: disk.source }
  if (disk.broken.size === 0) return { kind: 'ok' }
  const errors = [...disk.broken.entries()].sort(([a], [b]) => a - b).map(([, error]) => error).filter(isReportable)
  return { kind: 'failed', errors, source: disk.source }
}

/** What makes two build errors the same error, for not reporting one
 * twice: its category and message on the same slide (by key when it has
 * one, else by position) or in the same included file — not its line,
 * which moves with every edit above it (the agent fixing one slide shifts
 * the lines of the next broken one), nor its headline, which carries the
 * line. */
export function buildErrorIdentity(error: RenderErrorPayload): string {
  // A key can't contain `#` (`domain/reviewComment.ts`'s SLIDE_KEY), so a
  // position never reads as a key.
  const where = error.slide === null ? '' : error.slide.key ?? `#${String(error.slide.number)}`
  return [error.kind, error.originFile ?? '', where, error.message].join('\u0000')
}

/** Where the report stands since the deck on disk last built: nothing to
 * report (`idle`); errors to send once an agent waits and no other send is
 * in flight (`waiting-for-agent`); errors whose send failed, kept for the
 * deck's next render on disk or the agent's next round — not for the
 * failed send merely ending, which would retry at once, forever
 * (`send-failed`); or every error known sent (`sent`). `reported` lists
 * the identities (`buildErrorIdentity`) sent since the deck last built, so
 * an error still there after the agent's next edit — or after it fixed
 * another one — isn't sent again. */
export type BuildErrorReport =
  | { kind: 'idle' }
  | { kind: 'waiting-for-agent'; errors: readonly RenderErrorPayload[]; source: string; reported: readonly string[] }
  | { kind: 'send-failed'; errors: readonly RenderErrorPayload[]; source: string; reported: readonly string[] }
  | { kind: 'sent'; reported: readonly string[] }

export type BuildErrorReportEvent =
  /** The deck on disk doesn't build: these are its errors (every one, not
   * only the new ones), counting lines into `source`. */
  | { type: 'disk-render-failed'; errors: readonly RenderErrorPayload[]; source: string }
  /** The deck on disk built. */
  | { type: 'disk-render-ok' }
  /** An agent waits in the session and nothing else is being sent —
   * because one came, or because the send in the way ended. */
  | { type: 'agent-waiting' }
  /** An agent came to wait that wasn't waiting before: its next round, or
   * its first. Not raised by a send ending. */
  | { type: 'agent-arrived' }
  /** The errors with these identities reached crit and the round was finished. */
  | { type: 'sent'; identities: readonly string[] }
  /** The send failed: its errors are kept, and retried on the deck's next
   * render on disk or the agent's next round — never at once. */
  | { type: 'send-failed' }

export interface BuildErrorReportDecision {
  next: BuildErrorReport
  /** Send these errors as comments and finish the round. */
  effect?: { kind: 'send'; errors: readonly RenderErrorPayload[]; source: string }
}

function reportedOf(state: BuildErrorReport): readonly string[] {
  return state.kind === 'idle' ? [] : state.reported
}

/** The errors of `errors` not in `reported`, one per identity. */
function unreported(errors: readonly RenderErrorPayload[], reported: readonly string[]): RenderErrorPayload[] {
  const seen = new Set(reported)
  const fresh: RenderErrorPayload[] = []
  for (const error of errors) {
    const identity = buildErrorIdentity(error)
    if (seen.has(identity)) continue
    seen.add(identity)
    fresh.push(error)
  }
  return fresh
}

/** The state with nothing left to send: `sent` while something was
 * reported since the deck last built, else `idle`. */
function settled(reported: readonly string[]): BuildErrorReport {
  return reported.length > 0 ? { kind: 'sent', reported } : { kind: 'idle' }
}

/** The one transition table for reporting build errors. `agentReady`: an
 * agent waits in the session and no send is in flight — only then does a
 * decision ask to send. Every caller goes through this and runs the
 * effect it names; none decides `next` for itself. */
export function decideBuildErrorReport(state: BuildErrorReport, event: BuildErrorReportEvent, agentReady: boolean): BuildErrorReportDecision {
  switch (event.type) {
    case 'disk-render-failed': {
      const reported = reportedOf(state)
      const errors = unreported(event.errors, reported)
      // Nothing new: the errors still there were sent, and any waiting to
      // be sent are gone (fixed before an agent came).
      if (errors.length === 0) return { next: settled(reported) }
      const next: BuildErrorReport = { kind: 'waiting-for-agent', errors, source: event.source, reported }
      return agentReady ? { next, effect: { kind: 'send', errors, source: event.source } } : { next }
    }
    case 'disk-render-ok':
      // Built once: whatever breaks it next is news again.
      return { next: { kind: 'idle' } }
    case 'agent-waiting':
      // A failed send's errors stay held: this is raised by that send
      // ending too, and would retry it at once.
      if (state.kind !== 'waiting-for-agent' || !agentReady) return { next: state }
      return { next: state, effect: { kind: 'send', errors: state.errors, source: state.source } }
    case 'agent-arrived': {
      // The agent's next round: what a failed send held goes again.
      if (state.kind !== 'send-failed') return { next: state }
      const next: BuildErrorReport = { kind: 'waiting-for-agent', errors: state.errors, source: state.source, reported: state.reported }
      return agentReady ? { next, effect: { kind: 'send', errors: state.errors, source: state.source } } : { next }
    }
    case 'sent': {
      if (state.kind === 'idle') return { next: state }
      const reported = [...new Set([...state.reported, ...event.identities])]
      if (state.kind === 'sent') return { next: { kind: 'sent', reported } }
      // The deck changed under the send: what it added stays to be sent.
      const errors = unreported(state.errors, reported)
      return { next: errors.length === 0 ? { kind: 'sent', reported } : { ...state, kind: 'waiting-for-agent', errors, reported } }
    }
    case 'send-failed':
      // Kept, not dropped and not retried on a timer: the deck's next
      // render on disk (`disk-render-failed`, with the errors as they are
      // then) or the agent's next round (`agent-arrived`) sends them.
      return { next: state.kind === 'waiting-for-agent' ? { ...state, kind: 'send-failed' } : state }
    default: {
      const _exhaustive: never = event
      throw new Error(`Unhandled BuildErrorReportEvent: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** The line of `source` the comment goes on: the error's, when it has one
 * in the deck file itself and `source` has that many lines; else line 1 —
 * for an error in an included file (`originFile`), whose line is that
 * file's, and for one with no line or a line past the end. */
export function buildErrorLine(error: RenderErrorPayload, source: string): number {
  if (error.originFile !== null || error.line === null) return 1
  const lineCount = source.split('\n').length
  return Number.isInteger(error.line) && error.line >= 1 && error.line <= lineCount ? error.line : 1
}

/** `error` as the comment the agent reads: on its line of `source`
 * (`buildErrorLine`), quoting that line as written (without a CR), labelled
 * `[Build error]`, with peitho-core's own headline and help and what to do
 * about it. An error in an included file says which file. */
export function buildErrorComment(error: RenderErrorPayload, source: string): NewReviewComment {
  const line = buildErrorLine(error, source)
  const quote = (source.split('\n')[line - 1] ?? '').replace(/\r$/, '')
  const body = [
    error.headline,
    ...(error.help === '' ? [] : [`= help: ${error.help}`]),
    ...(error.originFile === null ? [] : [`The error is in ${error.originFile}, which the deck includes.`]),
    BUILD_ERROR_INSTRUCTION,
  ].join('\n')
  return { startLine: line, endLine: line, body: agentCommentBody(BUILD_ERROR_LABEL, body), quote, author: REVIEW_AUTHOR }
}
