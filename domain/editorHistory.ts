import { type PageConfig } from './pageConfig'
import { type SlideCommand } from './slideCommands'
import { extractNote, extractPageComment, updatePageComment } from './slides'

/** A set of PageComment fields to write onto one slide. A key present with
 * an `undefined` value removes that field (`updatePageComment` serializes
 * through `JSON.stringify`, which drops it). */
export type ConfigPatch = Partial<PageConfig>

/** One undoable operation on the slide list, stored as the step that
 * performs it.
 *
 * `slides` is a plain `SlideCommand` (insert/delete/move/replace).
 * `config` exists because a PageComment change (layout, draft, skip,
 * section) stored as a whole-text `replace` would, when undone, also revert
 * any text typed into that slide after the change. A patch touches only the
 * fields it names, so undoing a layout change keeps the body as it is now. */
export type HistoryStep =
  | { kind: 'slides'; cmd: SlideCommand }
  | { kind: 'config'; index: number; patch: ConfigPatch }

/** Undo and redo stacks, most recent last. Each entry is the step that
 * undoes (or redoes) one operation. Only structural operations are
 * recorded here; text typed in the editor's textareas keeps the textarea's
 * own native undo. */
export interface EditorHistory {
  readonly undo: readonly HistoryStep[]
  readonly redo: readonly HistoryStep[]
}

export const EMPTY_HISTORY: EditorHistory = { undo: [], redo: [] }

/** How running one step against the deck ended. */
export type StepOutcome =
  // It ran; `inverse` undoes it.
  | { kind: 'done'; inverse: HistoryStep }
  // It no longer fits the deck (e.g. its slide is gone), so nothing ran.
  | { kind: 'rejected' }
  // It ran and the commit failed; the error is already shown.
  | { kind: 'failed' }

/** Oldest entries past this many are dropped, so a long session can't grow
 * the undo stack without bound. */
export const MAX_HISTORY_DEPTH = 100

/** Records a new operation's undo step. Any redo history is discarded: once
 * a new operation lands, the undone ones no longer apply to the deck as it
 * is. */
export function record(history: EditorHistory, undoStep: HistoryStep): EditorHistory {
  return { undo: capped([...history.undo, undoStep]), redo: [] }
}

/** Pops the most recent undo step, or `null` when there is nothing to undo. */
export function takeUndo(history: EditorHistory): { step: HistoryStep; history: EditorHistory } | null {
  const step = history.undo[history.undo.length - 1]
  if (step === undefined) return null
  return { step, history: { undo: history.undo.slice(0, -1), redo: history.redo } }
}

/** Pops the most recent redo step, or `null` when there is nothing to redo. */
export function takeRedo(history: EditorHistory): { step: HistoryStep; history: EditorHistory } | null {
  const step = history.redo[history.redo.length - 1]
  if (step === undefined) return null
  return { step, history: { undo: history.undo, redo: history.redo.slice(0, -1) } }
}

/** Pushes onto the undo stack without touching redo — for a redo that just
 * ran, or an undo step put back after its commit failed. */
export function pushUndo(history: EditorHistory, step: HistoryStep): EditorHistory {
  return { undo: capped([...history.undo, step]), redo: history.redo }
}

/** Pushes onto the redo stack — for an undo that just ran, or a redo step
 * put back after its commit failed. */
export function pushRedo(history: EditorHistory, step: HistoryStep): EditorHistory {
  return { undo: history.undo, redo: capped([...history.redo, step]) }
}

function capped(steps: HistoryStep[]): HistoryStep[] {
  return steps.length > MAX_HISTORY_DEPTH ? steps.slice(steps.length - MAX_HISTORY_DEPTH) : steps
}

/** The command that turns `applyCommand(before, cmd)` back into `before`.
 * `before` must be the list `cmd` is about to be applied to: a delete or a
 * replace reads the text it is about to lose from it. */
export function inverseCommand(before: readonly string[], cmd: SlideCommand): SlideCommand {
  switch (cmd.type) {
    case 'insert':
      return { type: 'delete', index: cmd.at }
    case 'delete':
      return { type: 'insert', at: cmd.index, text: before[cmd.index] ?? '' }
    case 'move':
      return { type: 'move', from: cmd.to, to: cmd.from }
    case 'replace':
      return { type: 'replace', index: cmd.index, text: before[cmd.index] ?? '' }
    default: {
      const _exhaustive: never = cmd
      throw new Error(`Unhandled SlideCommand: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** The patch that restores, for every field `patch` names, the value
 * `before` had — `undefined` for a field `before` didn't set, so undoing
 * removes it again. Fields `patch` doesn't name are left out. */
export function inverseConfigPatch(before: PageConfig, patch: ConfigPatch): ConfigPatch {
  const inverse: ConfigPatch = {}
  for (const key of Object.keys(patch) as (keyof PageConfig)[]) {
    ;(inverse as Record<string, unknown>)[key] = before[key]
  }
  return inverse
}

/** A slide text's PageComment config (`{}` when it has none, or when the
 * comment isn't valid JSON). */
export function slideConfigOfText(text: string): PageConfig {
  return extractPageComment(extractNote(text).rest).config
}

/** The step that undoes `step`, given the slide list `step` is about to be
 * applied to. */
export function inverseStep(before: readonly string[], step: HistoryStep): HistoryStep {
  switch (step.kind) {
    case 'slides':
      return { kind: 'slides', cmd: inverseCommand(before, step.cmd) }
    case 'config':
      return { kind: 'config', index: step.index, patch: inverseConfigPatch(slideConfigOfText(before[step.index] ?? ''), step.patch) }
    default: {
      const _exhaustive: never = step
      throw new Error(`Unhandled HistoryStep: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** The `SlideCommand` that performs `step` on `texts`, so every step runs
 * through the same `validate`/`applyCommand` path as a direct operation. A
 * `config` step becomes a `replace` of that slide's current text with the
 * patch merged in; an index past the end yields a `replace` that
 * `validate` rejects. */
export function commandForStep(texts: readonly string[], step: HistoryStep): SlideCommand {
  switch (step.kind) {
    case 'slides':
      return step.cmd
    case 'config': {
      const current = texts[step.index]
      const text = current === undefined ? '' : updatePageComment(current, step.patch).trim()
      return { type: 'replace', index: step.index, text }
    }
    default: {
      const _exhaustive: never = step
      throw new Error(`Unhandled HistoryStep: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
