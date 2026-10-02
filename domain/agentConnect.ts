// What the comments column's "Connect your Coding Agent" card hands the user
// to copy (todo/archive/review-comment-ui.md): the command that makes an agent wait
// for this deck's review, and a prompt asking an agent to run it and keep
// the review loop going. Both name the crit bundled with Studio by its full
// path, so nothing has to be installed first — and crit's own instructions,
// which say plain `crit`, are pointed at it too.
import type { Language } from './language'
import type { CritDeckSession } from './critReview'
import type { SendAvailability } from './reviewComment'

/** `value` as one POSIX shell word: as is when it's plainly safe, else in
 * single quotes (a `'` inside becomes `'\''`). */
export function shellQuote(value: string): string {
  if (/^[\w./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** `deckPath` split into its folder and file name. A bare name has `.` as
 * its folder; a missing or empty path falls back to `deck.md` there. */
export function deckLocation(deckPath: string | null): { dir: string; file: string } {
  const path = deckPath ?? ''
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const file = path.slice(cut + 1) || 'deck.md'
  const dir = cut > 0 ? path.slice(0, cut) : cut === 0 ? '/' : '.'
  return { dir, file }
}

/** Which crit session the agent's `crit` waits in: the deck's running
 * session, joined by its id, or — with none yet — the one `crit` starts
 * on the deck file and the layout folders it has (`layouts`, `css` —
 * `critIpc.sessionDirs`), named exactly as Studio starts its own
 * (`engine::crit::session_args`). crit tells sessions apart by their
 * arguments, so a running session is joined by id: the deck's folders
 * may have changed since it started (a first layout created), and naming
 * them would start a second session on the deck. */
export type ConnectTarget = { kind: 'session'; id: string } | { kind: 'new'; dirs: readonly string[] }

/** The target for the session Studio last found on the deck (`null`: not
 * asked yet). Several sessions can't be told apart, so none is joined. */
export function connectTargetOf(session: CritDeckSession | null, dirs: readonly string[]): ConnectTarget {
  return session?.kind === 'found' ? { kind: 'session', id: session.id } : { kind: 'new', dirs }
}

/** The command that makes an agent wait for the deck's review, in
 * `target`'s session. */
export function agentConnectCommand(deckPath: string | null, critPath: string, target: ConnectTarget = { kind: 'new', dirs: [] }): string {
  const { dir, file } = deckLocation(deckPath)
  const args = target.kind === 'session' ? ['--session', target.id] : [file, ...target.dirs]
  return `cd ${shellQuote(dir)} && ${[critPath, '--no-open', ...args].map(shellQuote).join(' ')}`
}

/** The language the agent is asked to reply in, by the UI language. */
const REPLY_LANGUAGE: Record<Language, string> = { en: 'English', ja: 'Japanese' }

/** The prompt asking a Coding Agent to run `agentConnectCommand` and keep
 * answering review rounds, replying in `language` (the UI language: the
 * replies are read in the comments column). The prompt itself is English
 * whatever the UI language: it's an instruction to the agent. */
export function agentConnectPrompt(deckPath: string | null, critPath: string, language: Language, target: ConnectTarget = { kind: 'new', dirs: [] }): string {
  const crit = shellQuote(critPath)
  return [
    'Start a review loop for my Peitho deck.',
    '',
    `1. Run: ${agentConnectCommand(deckPath, critPath, target)}`,
    '   It waits until I send review comments from Peitho Studio.',
    '2. When it returns, follow the instructions it prints: address each comment',
    '   in the deck — or, for a comment on a layout, in the layout files it names',
    `   (layouts/, css/) — reply to each one with ${crit} comment --reply-to …, then run`,
    '   the command it prints to wait for my next round.',
    `3. Wherever those instructions say \`crit\`, use ${crit} instead.`,
    '4. Repeat until the review is approved.',
    `5. Write your replies in ${REPLY_LANGUAGE[language]}.`,
  ].join('\n')
}

/** Whether the comments column shows the card: until an agent is seen
 * waiting (with no session yet, an agent's own `crit` can start one).
 * `agentSeen`: one has been seen waiting in this session — not waiting now,
 * it is at work on what it was sent, not missing. */
export function showsConnectGuide(availability: SendAvailability, agentSeen: boolean): boolean {
  return availability.kind === 'no-session' || (availability.kind === 'agent-not-waiting' && !agentSeen)
}

/** How long an agent at work may stay silent before it's taken as gone:
 * crit can't tell a busy agent from one whose session was closed, so a
 * long silence brings the connect card back. */
export const AGENT_IDLE_MS = 3 * 60 * 1000

/** Whether an agent at work, last heard from at `lastActivityAt` (a reply,
 * a comment change, an edit to the deck), has been silent for `idleMs` by
 * `now`. */
export function agentGoneQuiet(lastActivityAt: number, now: number, idleMs: number = AGENT_IDLE_MS): boolean {
  return now - lastActivityAt >= idleMs
}
