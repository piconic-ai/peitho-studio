// A CodeMirror 6 editor for the slide body and the speaker notes: creating
// one, pushing a draft into it from outside, and its own undo/redo.
//
// The editor is uncontrolled: typing reaches the app only through
// `onChange`, and the app writes back only after a *non-typing* change (a
// slide switch, a save response, an external-file merge) — see
// `syncEditorFields` in `components/Studio.tsx`.

import { Annotation, EditorState, Transaction, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view'
import { defaultKeymap, history, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { editorTextChange } from '../domain/editorText'

export interface CodeEditorOptions {
  /** Called with the full text after every change the user makes. */
  onChange: (text: string) => void
  /** Shown while the editor is empty. */
  placeholder?: string
  /** `false` turns off the webview's spell checking (the body is Markdown). */
  spellcheck?: boolean
  /** Monospace for the body, the page font for the notes. */
  monospace?: boolean
}

// Marks a transaction `setCodeEditorText` sends, so `onChange` reports only
// what the user typed, never the draft the app just pushed in.
const fromApp = Annotation.define<boolean>()

// The extensions a view was created with, so `resetCodeEditorText` can
// build a fresh state from the same ones.
const extensionsOf = new WeakMap<EditorView, Extension[]>()

function editorTheme(monospace: boolean): Extension {
  return EditorView.theme({
    '&': { height: '100%', fontSize: '0.875rem' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: monospace ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : 'inherit',
      lineHeight: '1.5',
    },
    '.cm-content': { padding: '0.75rem', caretColor: 'currentColor' },
    '.cm-line': { padding: '0' },
    '.cm-placeholder': { color: 'var(--color-muted-foreground, #888)' },
  })
}

function editorExtensions(options: CodeEditorOptions): Extension[] {
  return [
    // No `historyKeymap`: Cmd+Z / Cmd+Shift+Z are the Edit menu's
    // accelerators (`src-tauri/src/edit_menu.rs`), which reach
    // `replayFocusedCodeEditorHistory` below. Binding them here too would
    // undo twice for one press.
    history(),
    keymap.of(defaultKeymap),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: options.spellcheck === false ? 'false' : 'true' }),
    editorTheme(options.monospace ?? false),
    ...(options.placeholder ? [placeholderText(options.placeholder)] : []),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return
      if (update.transactions.every(tr => tr.annotation(fromApp))) return
      options.onChange(update.state.doc.toString())
    }),
  ]
}

/** Creates an editor showing `text` inside `parent`. Call `view.destroy()`
 * when its element goes away. */
export function createCodeEditor(parent: HTMLElement, text: string, options: CodeEditorOptions): EditorView {
  const extensions = editorExtensions(options)
  const view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions }) })
  extensionsOf.set(view, extensions)
  return view
}

/** Replaces the editor's text with `text`, as an edit Undo skips, touching
 * only the part that differs so the cursor stays put. For a save response
 * on the slide the user is still in.
 *
 * Does nothing while an IME composition is in progress: rewriting the text
 * under an in-progress conversion can drop keystrokes on WebKit. */
export function setCodeEditorText(view: EditorView, text: string): void {
  if (view.composing) return
  const change = editorTextChange(view.state.doc.toString(), text)
  if (change === null) return
  view.dispatch({
    changes: change,
    annotations: [fromApp.of(true), Transaction.addToHistory.of(false)],
  })
}

/** Replaces the editor's text with `text` and forgets its undo history, so
 * Undo can't bring back another slide's text. For a slide switch or a deck
 * read fresh from disk.
 *
 * Does nothing while an IME composition is in progress, like
 * `setCodeEditorText`. */
export function resetCodeEditorText(view: EditorView, text: string): void {
  if (view.composing) return
  const unchanged = editorTextChange(view.state.doc.toString(), text) === null
  if (unchanged && undoDepth(view.state) === 0 && redoDepth(view.state) === 0) return
  const extensions = extensionsOf.get(view) ?? []
  view.setState(EditorState.create({ doc: text, extensions }))
}

/** The editor that has keyboard focus, or `null`. */
export function focusedCodeEditor(): EditorView | null {
  const active = document.activeElement
  const host = active instanceof HTMLElement ? active.closest<HTMLElement>('.cm-editor') : null
  return host ? EditorView.findFromDOM(host) : null
}

/** Runs the focused editor's own undo/redo, and returns whether an editor
 * had focus (even when there was nothing to undo). */
export function replayFocusedCodeEditorHistory(direction: 'undo' | 'redo'): boolean {
  const view = focusedCodeEditor()
  if (view === null) return false
  if (direction === 'undo') undo(view)
  else redo(view)
  return true
}
