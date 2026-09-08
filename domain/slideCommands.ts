import { type SelectionPlan } from './editorSession'

/** Every way the slide list itself can change shape. Adding a new kind of
 * slide operation means adding one variant here plus one `case` in each
 * of the four functions below — the open/closed seam `Studio.tsx`'s
 * `addSlide`/`deleteSlide`/`reorderSlides`/`pasteSlideAfter`/
 * `updateSlideConfig` used to lack, each hand-rolling its own splice and
 * its own guess at the resulting selection. */
export type SlideCommand =
  | { type: 'insert'; at: number; text: string }
  | { type: 'delete'; index: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'replace'; index: number; text: string }

export type Rejection =
  | { reason: 'last-slide' }
  | { reason: 'index-out-of-range' }

/** Applies a command to a slide-text list, returning a new array —
 * `texts` itself is never mutated. */
export function applyCommand(texts: readonly string[], cmd: SlideCommand): string[] {
  const next = [...texts]
  switch (cmd.type) {
    case 'insert':
      next.splice(cmd.at, 0, cmd.text)
      return next
    case 'delete':
      next.splice(cmd.index, 1)
      return next
    case 'move': {
      const [moved] = next.splice(cmd.from, 1)
      next.splice(cmd.to, 0, moved)
      return next
    }
    case 'replace':
      next[cmd.index] = cmd.text
      return next
    default: {
      const _exhaustive: never = cmd
      throw new Error(`Unhandled SlideCommand: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** Whether a command can change *which* sections exist or their times,
 * and so needs the frontmatter time total re-synced (`syncedSource`) —
 * true for everything except `move`, which only changes slide order,
 * never the set of sections or their durations. */
export function needsTimeResync(cmd: SlideCommand): boolean {
  return cmd.type !== 'move'
}

/** The `SelectionPlan` a command implies for the editor's selection —
 * insert/paste move it onto the new slide, delete clamps it to the
 * nearest remaining slide, move follows the dragged slide (or the
 * currently-open one, whichever `selectionAfter` is asked to resolve
 * against), and replace never moves it. */
export function selectionPlanFor(cmd: SlideCommand): SelectionPlan {
  switch (cmd.type) {
    case 'insert':
      return { kind: 'select', index: cmd.at }
    case 'delete':
      return { kind: 'clamp-after-delete', deleted: cmd.index }
    case 'move':
      return { kind: 'follow-move', from: cmd.from, to: cmd.to }
    case 'replace':
      return { kind: 'keep' }
    default: {
      const _exhaustive: never = cmd
      throw new Error(`Unhandled SlideCommand: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** Guards a command against the slide list it would apply to, returning
 * why it can't run or `null` if it's fine — replaces the ad-hoc early
 * `return`s each Studio.tsx call site used to write for itself
 * (`ranges.length <= 1`, out-of-range indices, ...). */
export function validate(texts: readonly string[], cmd: SlideCommand): Rejection | null {
  switch (cmd.type) {
    case 'insert':
      return cmd.at < 0 || cmd.at > texts.length ? { reason: 'index-out-of-range' } : null
    case 'delete':
      if (texts.length <= 1) return { reason: 'last-slide' }
      return cmd.index < 0 || cmd.index >= texts.length ? { reason: 'index-out-of-range' } : null
    case 'move':
      return cmd.from < 0 || cmd.from >= texts.length || cmd.to < 0 || cmd.to >= texts.length
        ? { reason: 'index-out-of-range' }
        : null
    case 'replace':
      return cmd.index < 0 || cmd.index >= texts.length ? { reason: 'index-out-of-range' } : null
    default: {
      const _exhaustive: never = cmd
      throw new Error(`Unhandled SlideCommand: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
