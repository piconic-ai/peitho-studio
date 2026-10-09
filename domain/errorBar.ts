// What the error bar offers next to the error it shows
// (todo/send-build-error-from-error-bar.md): a build error goes to the AI
// in crit, or is already with it; any other error is copied.
import type { BuildErrorReport } from './buildErrorReport'

/** The error the bar shows: a transient one that is a build error of the
 * text being edited, any other transient one (a failed present, the
 * clipboard), or — with no transient error in front — the deck on disk's
 * (its refusal, or the slides isolated from it). */
export type ShownError = 'transient-build' | 'transient-other' | 'deck-build'

/** The agent's `crit` on the deck: waiting for the next round, at work on
 * the last one, or not there at all. */
export type AgentState = 'waiting' | 'working' | 'none'

/** `send`: a button handing the build error to the AI. `fixing`: the
 * deck on disk's errors were sent and the AI is at work on them — no
 * button, just that word, until the deck builds (the bar goes) or the AI
 * comes back to wait with the error still there (the button is back, to
 * send again). `copy`: the error is not a build error. A build error of
 * the text being edited is always `send`: it isn't on disk yet, so nothing
 * of it was sent. */
export function errorBarAction(shown: ShownError, report: BuildErrorReport['kind'], agent: AgentState): 'copy' | 'send' | 'fixing' {
  if (shown === 'transient-other') return 'copy'
  if (shown === 'deck-build' && report === 'sent' && agent === 'working') return 'fixing'
  return 'send'
}
