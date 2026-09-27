// `dd` on the last line of a text without a trailing newline, in vim mode
// (`dom/codeEditor.ts`). The slide body and the notes usually end that way.
//
// `@replit/codemirror-vim` deletes the newline before the line too, and
// stores the register as `"\nline\n"`, so `p` puts an empty line along with
// the line. Vim stores `"line\n"`. The fix rewrites that register entry,
// through the public `Vim.getRegisterController()` rather than a patch to
// the package.

import type { ChangeSet, EditorState, Extension } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'
import { Vim } from '@replit/codemirror-vim'

/** Whether `changes`, applied to `state`, is `dd` of the last line together
 * with the newline before it — told apart from a delete that really starts
 * on an empty line (`3dd` or `dG` from one, which removes the same text) by
 * the selection: the vim engine selects the lines an operator covers before
 * it runs. */
export function deletesLastLine(state: EditorState, changes: ChangeSet): boolean {
  const { doc, selection } = state
  const last = doc.lines
  const { from, to } = selection.main
  if (last < 2 || from !== doc.line(last).from || to !== doc.length) return false
  // The newline before the line through the end, and nothing else.
  let count = 0
  let matches = false
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count++
    matches = fromA === doc.line(last - 1).to && toA === doc.length && inserted.length === 0
  })
  return count === 1 && matches
}

/** Whether the latest edit in any editor was such a `dd`. The register is
 * global to the page, so this is too. */
let lastLineDeleted = false

const patchedControllers = new WeakSet<object>()

/** Stores the line `dd` took off the end as a plain line. Patched on the
 * register controller's prototype, so it survives the controller being
 * recreated. Safe to call more than once. */
function patchRegisterController(): void {
  const proto: ReturnType<typeof Vim.getRegisterController> = Object.getPrototypeOf(Vim.getRegisterController())
  if (patchedControllers.has(proto)) return
  patchedControllers.add(proto)
  const pushText = proto.pushText
  proto.pushText = function (registerName, operator, text, linewise, blockwise) {
    const lastLine = operator === 'delete' && linewise === true && lastLineDeleted && text.startsWith('\n')
    lastLineDeleted = false
    pushText.call(this, registerName, operator, lastLine ? `${text.slice(1)}\n` : text, linewise, blockwise)
  }
}

const watchLastLineDelete = ViewPlugin.define(() => ({
  update(update) {
    if (update.docChanged) lastLineDeleted = deletesLastLine(update.startState, update.changes)
  },
}))

/** For the vim extension: records whether each edit was that `dd`, and
 * patches the register controller to act on it. */
export function vimLastLineDelete(): Extension {
  patchRegisterController()
  return watchLastLineDelete
}
