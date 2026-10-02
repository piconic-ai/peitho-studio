import { type SelectionPlan } from './editorSession'
import { readFrontmatterKey, setFrontmatterKey } from './frontmatter'
import { type PageConfig } from './pageConfig'
import { type SlideCommand, selectionPlanFor } from './slideCommands'
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
export type StructuralStep =
  | { kind: 'slides'; cmd: SlideCommand }
  | { kind: 'config'; index: number; patch: ConfigPatch }

/** Which of a slide's two text editors a `TextStep` points into. */
export type TextField = 'body' | 'note'

/** A marker for one group of typing in a slide's body or notes editor, so
 * Undo reaches text and slide operations in the order they happened.
 *
 * It holds only the group's number (`domain/textHistory.ts`); the text
 * itself stays in that editor's own CodeMirror history, which undoes it —
 * so the same marker serves both undo and redo. `index` is the slide's
 * position when the typing happened: by the time Undo reaches the marker,
 * every later operation has been undone, so the slides are back in that
 * same order. */
export interface TextStep {
  kind: 'text'
  index: number
  field: TextField
  seq: number
}

/** The deck's page-number setting and every slide's own `page_number`, set
 * together as one step — so turning page numbers off (which also has to
 * clear each slide's `page_number:false`, refused by peitho-core without a
 * deck setting) undoes in one press.
 *
 * `value` is the frontmatter `page_numbers` value to write, `null` for no
 * key at all. `hidden` lists the slides, by position, left carrying
 * `page_number:false`; every other slide is left with no `page_number`
 * field. It is the whole state rather than a change to it, so the step
 * that undoes it is simply the state before (`inversePageNumbersStep`). */
export interface PageNumbersStep {
  kind: 'page-numbers'
  value: string | null
  hidden: readonly number[]
}

export type HistoryStep = StructuralStep | PageNumbersStep | FrontmatterStep | LayoutPinsStep | TextStep

/** Undo and redo stacks, most recent last. Each entry is the step that
 * undoes (or redoes) one operation: a slide operation, or a marker for a
 * group of typing in one of the text editors. */
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
 * the undo stack without bound. Each group of typing takes an entry, so
 * this is well above what slide operations alone would need. The text
 * editors keep at least as many groups (`dom/codeEditor.ts`), so a marker
 * still here never points at a group they already dropped. */
export const MAX_HISTORY_DEPTH = 1000

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

/** Pops the most recent undo (or redo) step that can still run, dropping
 * the text markers above it that can't — typing vim's `u` / `Ctrl-R`
 * already took back or put back (`isLive` says which). Stops at the first
 * slide operation or live marker; `step` is `null` when none is left.
 * Either way, `history` no longer holds the dropped markers. */
export function takeLive(
  history: EditorHistory,
  direction: 'undo' | 'redo',
  isLive: (step: TextStep) => boolean,
): { step: HistoryStep | null; history: EditorHistory } {
  const take = direction === 'undo' ? takeUndo : takeRedo
  let rest = history
  for (let taken = take(rest); taken !== null; taken = take(rest)) {
    rest = taken.history
    if (taken.step.kind !== 'text' || isLive(taken.step)) return { step: taken.step, history: rest }
  }
  return { step: null, history: rest }
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
 * applied to. A text marker is its own inverse: the editor's history
 * undoes or redoes the same group. */
export function inverseStep(before: readonly string[], step: StructuralStep): StructuralStep
export function inverseStep(before: readonly string[], step: StructuralStep | TextStep): StructuralStep | TextStep
export function inverseStep(before: readonly string[], step: StructuralStep | TextStep): StructuralStep | TextStep {
  switch (step.kind) {
    case 'text':
      return step
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
export function commandForStep(texts: readonly string[], step: StructuralStep): SlideCommand {
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

/** Which slide to open after undoing or redoing `step` (whose command is
 * `cmd`), so the user sees what changed: the slide whose config changed,
 * or the slide that moved. An insert or a delete opens the same slide as
 * the operation itself would. `current` is the slide open now; when it is
 * the one affected, it stays open as it is (`keep` / `follow-move`), with
 * its text history in place. Opening a slide this way is not itself a
 * step to undo. */
export function selectionForReplay(step: StructuralStep, cmd: SlideCommand, current: number | null): SelectionPlan {
  switch (step.kind) {
    case 'config':
      return step.index === current ? { kind: 'keep' } : { kind: 'select', index: step.index }
    case 'slides':
      if (cmd.type === 'move' && cmd.from !== current) return { kind: 'select', index: cmd.to }
      return selectionPlanFor(cmd)
    default: {
      const _exhaustive: never = step
      throw new Error(`Unhandled StructuralStep: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** The positions of the slides that hide their page number
 * (`page_number:false`). A slide whose PageComment isn't valid JSON counts
 * as not hiding it. */
export function hiddenPageNumberSlides(texts: readonly string[]): number[] {
  const hidden: number[] = []
  texts.forEach((text, i) => {
    if (slideConfigOfText(text).page_number === false) hidden.push(i)
  })
  return hidden
}

/** The step that sets the deck's `page_numbers` to `value` (`null`: remove
 * it). Turning page numbers on, or switching between the two formats,
 * keeps whichever slides already hide their number. Turning them off
 * clears every slide's `page_number:false` too, since peitho-core refuses
 * it without a deck setting. */
export function pageNumbersStepFor(texts: readonly string[], value: string | null): PageNumbersStep {
  return { kind: 'page-numbers', value, hidden: value === null ? [] : hiddenPageNumberSlides(texts) }
}

/** The step that puts back the page-number state `texts` and the deck's
 * current `page_numbers` value (`currentValue`) hold now. */
export function inversePageNumbersStep(texts: readonly string[], currentValue: string | null): PageNumbersStep {
  return { kind: 'page-numbers', value: currentValue, hidden: hiddenPageNumberSlides(texts) }
}

/** `texts` with `page_number:false` on exactly the slides `step.hidden`
 * names, and no `page_number` field on any other. Only a slide whose field
 * has to change is rewritten, so every other slide's text stays byte for
 * byte as it was. A position past the end, negative, or not an integer
 * names no slide and is ignored; a repeated one counts once. */
export function applyPageNumbersStep(texts: readonly string[], step: PageNumbersStep): string[] {
  const hidden = new Set(step.hidden)
  return texts.map((text, i) => {
    const wanted = hidden.has(i) ? false : undefined
    if (slideConfigOfText(text).page_number === wanted) return text
    return updatePageComment(text, { page_number: wanted }).trim()
  })
}

/** One top-level frontmatter key set to `value` (`null`: removed) — a deck
 * setting that touches nothing but its own line, such as the Edit menu's
 * aspect ratio, line breaks, or language. `page_numbers` has its own
 * `PageNumbersStep`, since turning it off also rewrites slides. Like that
 * step, it holds the key's whole state, so the step that undoes it is
 * simply the value before (`inverseFrontmatterStep`). */
export interface FrontmatterStep {
  kind: 'frontmatter'
  key: string
  value: string | null
}

/** The step that puts back the value `step.key` has in `source` now —
 * `null` when the key is absent, so undoing an added key removes it again. */
export function inverseFrontmatterStep(source: string, step: FrontmatterStep): FrontmatterStep {
  return { kind: 'frontmatter', key: step.key, value: readFrontmatterKey(source, step.key) }
}

/** `source` with `step` applied (`setFrontmatterKey`). A key put back after
 * being removed lands at the end of the block rather than where it was,
 * and without any trailing comment it had; its value is the same. */
export function applyFrontmatterStep(source: string, step: FrontmatterStep): string {
  return setFrontmatterKey(source, step.key, step.value)
}

/** Several slides' `"layout"` set at once, as one step — the layout
 * screen moving every slide off a layout it deletes, which Undo should put
 * back in one press. Each pin names a slide by position and the layout to
 * write (`undefined`: no `"layout"` field). Like `PageNumbersStep`, it
 * holds the pinned values themselves rather than a change, so the step
 * that undoes it is the slides' values before (`inverseLayoutPinsStep`). */
export interface LayoutPinsStep {
  kind: 'layout-pins'
  pins: readonly { index: number; layout: string | undefined }[]
}

/** The step that pins every slide at `indices` to `layout`. */
export function layoutPinsStepFor(indices: readonly number[], layout: string): LayoutPinsStep {
  return { kind: 'layout-pins', pins: indices.map(index => ({ index, layout })) }
}

/** The step that puts back the `"layout"` each slide `step` pins has in
 * `texts` now. A pin naming no slide is left out. */
export function inverseLayoutPinsStep(texts: readonly string[], step: LayoutPinsStep): LayoutPinsStep {
  return {
    kind: 'layout-pins',
    pins: step.pins
      .filter(pin => Number.isInteger(pin.index) && pin.index >= 0 && pin.index < texts.length)
      .map(pin => ({ index: pin.index, layout: slideConfigOfText(texts[pin.index]).layout })),
  }
}

/** `texts` with each pin of `step` written. Only a slide whose `"layout"`
 * has to change is rewritten, so every other slide's text stays byte for
 * byte as it was. A position past the end, negative, or not an integer
 * names no slide and is ignored; for a repeated one, the last pin wins. */
export function applyLayoutPinsStep(texts: readonly string[], step: LayoutPinsStep): string[] {
  const wanted = new Map<number, string | undefined>()
  for (const pin of step.pins) wanted.set(pin.index, pin.layout)
  return texts.map((text, i) => {
    if (!wanted.has(i)) return text
    const layout = wanted.get(i)
    if (slideConfigOfText(text).layout === layout) return text
    return updatePageComment(text, { layout }).trim()
  })
}
