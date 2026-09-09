import { indexAfterMove, extractNote, extractPageComment, type SlideRange } from './slides'
import { type PageConfig } from './pageConfig'

// This file started as just the SelectionPlan slice of §2.1's design in
// todo/studio-tsx-refactoring.md (Step 6 needed it to give
// `commitChange`'s selection-follow behavior a typed shape before the
// full EditorSession ADT + reconcileAfterCommit existed) and now has the
// rest of §2.1 (Step 9).

export interface SlideFields {
  body: string
  note: string
  config: PageConfig
}

/** Whether `a`/`b` differ in a way that should count as "unsaved edits" —
 * deliberately ignores `config`, matching the original `isDirty` memo's
 * `bodyDraft() !== originalBody() || noteDraft() !== originalNote()`
 * (no `pageConfig()` comparison): config changes go through
 * `updateSlideConfig`'s own save path, not the body/note draft one, so
 * they were never part of this dirty check and shouldn't become one now. */
function fieldsEqual(a: SlideFields, b: SlideFields): boolean {
  return a.body === b.body && a.note === b.note
}

/** The editor pane's own state — `none` when no slide is selected,
 * `editing` while one is, holding both the last-saved fields and the
 * live draft so `isDirty` and autosave can compare them without a
 * separate `originalBody`/`originalNote` pair of signals. */
export type EditorSession =
  | { kind: 'none' }
  | { kind: 'editing'; index: number; saved: SlideFields; draft: SlideFields }

export function isDirty(session: EditorSession): boolean {
  return session.kind === 'editing' && !fieldsEqual(session.saved, session.draft)
}

/** Updates just the `saved` half of an `editing` session, leaving the
 * live `draft` untouched — for when an external file change needs
 * `saved` to reflect the new on-disk text without discarding in-progress
 * edits (see `handleExternalChange`'s "keep editing" path). No-op on
 * `none`. */
export function withRefreshedSaved(session: EditorSession, saved: SlideFields): EditorSession {
  return session.kind === 'editing' ? { ...session, saved } : session
}

/** Updates the live draft's body/note as the user types — a no-op on
 * `none` (nothing to type into, since there's no textarea bound to it
 * either). */
export function withDraftBody(session: EditorSession, body: string): EditorSession {
  return session.kind === 'editing' ? { ...session, draft: { ...session.draft, body } } : session
}

export function withDraftNote(session: EditorSession, note: string): EditorSession {
  return session.kind === 'editing' ? { ...session, draft: { ...session.draft, note } } : session
}

/** How a change to the slide list should move the editor's selection,
 * named by the caller's *intent* rather than expressed as a raw target
 * index — so a reorder can't accidentally be confused for a delete, and
 * the index math for each case lives in one place instead of being
 * re-derived at every `commitChange` call site. */
export type SelectionPlan =
  | { kind: 'keep' }
  | { kind: 'follow-move'; from: number; to: number }
  | { kind: 'select'; index: number }
  | { kind: 'clamp-after-delete'; deleted: number }

/** Resolves a `SelectionPlan` against the *current* selection and the
 * slide count *after* the change. Each plan clamps differently on
 * out-of-range input, matching what its call site actually needs:
 * `keep`/`follow-move` fall back to the *first* slide (the selection was
 * never meant to move, so there's no better guess than the top of the
 * list), while `select`/`clamp-after-delete` clamp to the *last* slide
 * (they name a specific target index that can only overshoot when it was
 * the list's own last position, e.g. deleting the final slide) — the two
 * aren't interchangeable, so don't collapse them into one helper. */
export function selectionAfter(plan: SelectionPlan, current: number | null, count: number): number | null {
  switch (plan.kind) {
    case 'keep':
      return current !== null && current < count ? current : firstOrNull(count)
    case 'follow-move':
      return current === null ? plan.to : indexAfterMove(current, plan.from, plan.to)
    case 'select':
      return count > 0 ? Math.min(plan.index, count - 1) : null
    case 'clamp-after-delete':
      return count > 0 ? Math.min(plan.deleted, count - 1) : null
    default: {
      const _exhaustive: never = plan
      throw new Error(`Unhandled SelectionPlan: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

function firstOrNull(count: number): number | null {
  return count > 0 ? 0 : null
}

/** Purifies `commitChange`'s "don't clobber in-flight edits" rule: given
 * the session *before* an async save started (`before`) and the *live*
 * session read back once it resolved (`now` — may differ from `before`
 * if the user navigated or kept typing during the gap), decides the
 * session to use after applying `plan` against the post-save slide list
 * (`ranges`).
 *
 * If the user's selection differs from `before`'s by the time this
 * runs, `now` is returned untouched — the save's own plan/`expected`
 * draft never overwrite a selection the user has since moved away from.
 * (This is slightly stricter than the closure this replaced, which kept
 * updating `saved` whenever the *current* index happened to equal
 * `plan`'s resolved target — even after the user had navigated away and
 * back. Requiring the selection to have never moved during the gap is
 * simpler to reason about and the two are indistinguishable in
 * practice.) Otherwise the selection follows `plan`, `saved` is
 * refreshed from `ranges` (or `expected`, when the caller already knows
 * the exact bytes it just wrote — see `commitChange`'s own comment on
 * why that matters for continuous typing), and the live `draft` syncs to
 * the new `saved` only if it still matches what was in flight at
 * `before` — otherwise the user's newer draft is left alone, and
 * `isDirty` staying true against the fresh `saved` is what makes the
 * next autosave pick it up. */
export function reconcileAfterCommit(
  before: EditorSession,
  now: EditorSession,
  ranges: readonly SlideRange[],
  plan: SelectionPlan,
  expected?: Pick<SlideFields, 'body' | 'note'>,
): EditorSession {
  const beforeIndex = before.kind === 'editing' ? before.index : null
  const nowIndex = now.kind === 'editing' ? now.index : null
  if (nowIndex !== beforeIndex) return now

  const nextIndex = selectionAfter(plan, beforeIndex, ranges.length)
  if (nextIndex === null) return { kind: 'none' }

  const rawText = ranges[nextIndex]?.text ?? ''
  const { rest: withoutNote, note: extractedNote } = extractNote(rawText)
  const { rest: extractedBody, config } = extractPageComment(withoutNote)
  const saved: SlideFields = expected
    ? { body: expected.body, note: expected.note, config }
    : { body: extractedBody, note: extractedNote, config }

  const beforeDraft = before.kind === 'editing' ? before.draft : saved
  const nowDraft = now.kind === 'editing' ? now.draft : saved
  const draftUnchangedSinceBefore = nowDraft.body === beforeDraft.body && nowDraft.note === beforeDraft.note
  const draft = draftUnchangedSinceBefore ? saved : nowDraft

  return { kind: 'editing', index: nextIndex, saved, draft }
}
