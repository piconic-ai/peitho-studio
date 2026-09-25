// A CodeMirror 6 editor for the slide body and the speaker notes: creating
// one, pushing a draft into it from outside, its own undo/redo (numbered
// per group for the app's timeline, `dom/textHistoryTracking.ts`), and vim
// mode.
//
// The editor is uncontrolled: typing reaches the app only through
// `onChange`, and the app writes back only after a *non-typing* change (a
// slide switch, a save response, an external-file merge) — see
// `syncEditorFields` in `components/Studio.tsx`.

import { Annotation, Compartment, EditorState, Transaction, type Extension, type StateEffect } from '@codemirror/state'
import { EditorView, ViewPlugin, drawSelection, keymap, placeholder as placeholderText } from '@codemirror/view'
import { defaultKeymap, history, insertTab, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { getCM, vim } from '@replit/codemirror-vim'
import { MAX_HISTORY_DEPTH } from '../domain/editorHistory'
import { editorTextChange, normalizeLineBreaks } from '../domain/editorText'
import { parseVimMode, type VimMode } from '../domain/vimMode'
import { canReplayTextGroup, carryTextHistory, trackTextHistory } from './textHistoryTracking'

export interface CodeEditorOptions {
  /** Called with the full text after every change the user makes. */
  onChange: (text: string) => void
  /** Called with its number when typing starts a new group in the undo
   * history (typing that joins the newest group doesn't). Undo and redo,
   * the app's or vim's, start none. */
  onHistoryGroup?: (seq: number) => void
  /** Shown while the editor is empty. */
  placeholder?: string
  /** `false` turns off the webview's spell checking (the body is Markdown). */
  spellcheck?: boolean
  /** Monospace for the body, the page font for the notes. */
  monospace?: boolean
  /** Starts with vim key bindings on (see `setCodeEditorVimMode`). */
  vimMode?: boolean
  /** Vim mode only: the editor entered `mode` (`<Esc>` back to normal,
   * `i` into insert, ...). */
  onVimModeChange?: (mode: VimMode) => void
  /** Vim mode only: the editor took keyboard focus while in `mode`. */
  onVimFocus?: (mode: VimMode) => void
  /** Vim mode only: a vim command finished (a yank, a delete, a motion, or
   * leaving insert mode). The unnamed register may have changed. */
  onVimCommandDone?: () => void
}

// Marks a transaction `setCodeEditorText` sends, so `onChange` reports only
// what the user typed, never the draft the app just pushed in.
const fromApp = Annotation.define<boolean>()

// Holds the vim extension, or nothing, so vim mode can be turned on and off
// without re-creating the editor (and losing its text, cursor and history).
const vimCompartment = new Compartment()

// What a view was created with, so `resetCodeEditorText` can build a fresh
// state from the same extensions, and whether vim mode is on in it now.
const optionsOf = new WeakMap<EditorView, CodeEditorOptions>()
const vimModeOf = new WeakMap<EditorView, boolean>()

// The placeholder sits in its own compartment so a UI language change can
// swap it (`setCodeEditorPlaceholder`); the text currently shown is kept
// per view so `resetCodeEditorText`'s fresh state starts from it too,
// rather than from the one the view was created with.
const placeholderSlot = new Compartment()
const placeholderOf = new WeakMap<EditorView, string>()

function placeholderExtension(text: string): Extension {
  return text === '' ? [] : placeholderText(text)
}

// One theme per font, made once: every `EditorView.theme()` call mounts a
// new style module that is never removed, and `resetCodeEditorText`
// rebuilds the extensions on each slide switch.
const themes = new Map<boolean, Extension>()

function editorTheme(monospace: boolean): Extension {
  let theme = themes.get(monospace)
  if (theme === undefined) {
    theme = createEditorTheme(monospace)
    themes.set(monospace, theme)
  }
  return theme
}

function createEditorTheme(monospace: boolean): Extension {
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
    // The vim status line (`--NORMAL--`, the `/` and `:` prompts), in the
    // app's colors rather than CodeMirror's fixed light-gray panel.
    '.cm-panels': { backgroundColor: 'var(--muted, #f5f5f5)', color: 'var(--muted-foreground, #666)' },
    '.cm-panels-bottom': { borderTop: '1px solid var(--border, #ddd)' },
    '.cm-vim-panel': { fontSize: '0.75rem', lineHeight: '1.5rem' },
    '.cm-vim-panel input': { color: 'var(--foreground, inherit)' },
  })
}

/** The vim mode `view` is in now. */
function currentVimMode(view: EditorView): VimMode {
  const state = getCM(view)?.state as { vim?: { insertMode?: boolean; visualMode?: boolean }; overwrite?: boolean } | undefined
  if (state?.vim?.insertMode) return state.overwrite ? 'replace' : 'insert'
  return state?.vim?.visualMode ? 'visual' : 'normal'
}

// Forwards the vim engine's own events to `options`. Listed after `vim()`,
// so the vim plugin (which attaches the engine to the view) is created
// first and `getCM` finds it.
function vimEvents(options: CodeEditorOptions): Extension {
  return [
    ViewPlugin.define(view => {
      const cm = getCM(view)
      if (cm === null) return {}
      const onModeChange = (event: { mode?: unknown }) => {
        const mode = parseVimMode(event.mode)
        if (mode !== null) options.onVimModeChange?.(mode)
      }
      // The engine signals `vim-command-done` as it starts running an
      // operator (clearing its pending keys), before the operator itself
      // runs — a yank's text reaches the register only after the signal.
      // So the hook waits for the rest of the keystroke's handling.
      const onCommandDone = () => { queueMicrotask(() => { options.onVimCommandDone?.() }) }
      cm.on('vim-mode-change', onModeChange)
      cm.on('vim-command-done', onCommandDone)
      return {
        destroy() {
          cm.off('vim-mode-change', onModeChange)
          cm.off('vim-command-done', onCommandDone)
        },
      }
    }),
    EditorView.domEventHandlers({
      focus: (_event, view) => { options.onVimFocus?.(currentVimMode(view)) },
    }),
  ]
}

// Tab under vim, as in Vim itself: a tab character in insert (and
// replace) mode, nothing in the other modes. CodeMirror leaves Tab unbound
// by default, so it would move focus out of the editor (to the notes)
// instead. With vim mode off, Tab still moves focus, as the old textarea
// did.
const vimTab = keymap.of([{
  key: 'Tab',
  run: view => {
    const mode = currentVimMode(view)
    return mode === 'insert' || mode === 'replace' ? insertTab(view) : true
  },
}])

function vimExtension(options: CodeEditorOptions, on: boolean): Extension {
  // `status` shows the mode (`--INSERT--`) and hosts the `/` and `:`
  // prompts; `drawSelection` draws visual mode's selection.
  return on ? [vim({ status: true }), drawSelection(), vimEvents(options), vimTab] : []
}

function editorExtensions(options: CodeEditorOptions, vimOn: boolean): Extension[] {
  return [
    // First, so vim's keys win over every other keymap below.
    vimCompartment.of(vimExtension(options, vimOn)),
    // No `historyKeymap`: Cmd+Z / Cmd+Shift+Z are the Edit menu's
    // accelerators (`src-tauri/src/edit_menu.rs`), which walk the app's
    // timeline and land in `replayCodeEditorGroup` below. Binding them here
    // too would undo twice for one press. Vim's own `u` / `Ctrl-R` use this
    // same history.
    //
    // At least as deep as the app's timeline, so a group it still points
    // at hasn't been dropped here.
    history({ minDepth: MAX_HISTORY_DEPTH }),
    keymap.of(defaultKeymap),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: options.spellcheck === false ? 'false' : 'true' }),
    editorTheme(options.monospace ?? false),
    placeholderSlot.of(placeholderExtension(options.placeholder ?? '')),
    EditorView.updateListener.of(update => {
      for (const tr of update.transactions) {
        const seq = trackTextHistory(tr)
        if (seq !== null) options.onHistoryGroup?.(seq)
      }
      if (!update.docChanged) return
      if (update.transactions.every(tr => tr.annotation(fromApp))) return
      options.onChange(update.state.doc.toString())
    }),
  ]
}

/** Creates an editor showing `text` inside `parent`. Call `view.destroy()`
 * when its element goes away. */
export function createCodeEditor(parent: HTMLElement, text: string, options: CodeEditorOptions): EditorView {
  const vimOn = options.vimMode ?? false
  const view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions: editorExtensions(options, vimOn) }) })
  optionsOf.set(view, options)
  vimModeOf.set(view, vimOn)
  placeholderOf.set(view, options.placeholder ?? '')
  return view
}

/** Shows `text` while the editor is empty (none for `''`), in place of the
 * placeholder it had. Leaves the text, cursor and undo history alone. */
export function setCodeEditorPlaceholder(view: EditorView, text: string): void {
  if (placeholderOf.get(view) === text) return
  placeholderOf.set(view, text)
  view.dispatch({ effects: placeholderSlot.reconfigure(placeholderExtension(text)) })
}

/** Turns vim key bindings on or off, keeping the text, cursor and undo
 * history. Off, the editor behaves exactly as without vim mode. */
export function setCodeEditorVimMode(view: EditorView, on: boolean): void {
  const options = optionsOf.get(view)
  if (options === undefined || (vimModeOf.get(view) ?? false) === on) return
  vimModeOf.set(view, on)
  view.dispatch({ effects: vimCompartment.reconfigure(vimExtension(options, on)) })
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
 * Undo can't bring back another slide's text. For a switch to a slide with
 * no kept state (`restoreCodeEditor`) or a deck read fresh from disk. In
 * vim mode, the editor is back in normal mode.
 *
 * Does nothing while an IME composition is in progress, like
 * `setCodeEditorText`. */
export function resetCodeEditorText(view: EditorView, text: string): void {
  if (view.composing) return
  const unchanged = view.state.doc.toString() === normalizeLineBreaks(text)
  if (unchanged && undoDepth(view.state) === 0 && redoDepth(view.state) === 0) return
  const options = optionsOf.get(view)
  if (options === undefined) return
  // `options` carry the creation-time placeholder; the fresh state gets
  // the current one before the view ever shows it.
  const fresh = EditorState.create({ doc: text, extensions: editorExtensions(options, vimModeOf.get(view) ?? false) })
  view.setState(fresh.update({ effects: placeholderSlot.reconfigure(placeholderExtension(placeholderOf.get(view) ?? '')) }).state)
}

/** An editor's state as the user left it on one slide (text, cursor,
 * undo history), with the settings it was built under, so
 * `restoreCodeEditor` can put it back on the same editor later. */
export interface CodeEditorSnapshot {
  state: EditorState
  vimOn: boolean
  placeholder: string
}

/** The editor's state now, for `restoreCodeEditor`. */
export function snapshotCodeEditor(view: EditorView): CodeEditorSnapshot {
  return { state: view.state, vimOn: vimModeOf.get(view) ?? false, placeholder: placeholderOf.get(view) ?? '' }
}

/** Shows `text` by putting back `snapshot` — a state `snapshotCodeEditor`
 * took from this same editor — so the slide's cursor and undo history
 * come back with it. Vim mode and the placeholder follow the current
 * settings, even when they changed since the snapshot. Without a
 * snapshot, or with one whose text is no longer the slide's (the slide
 * was edited elsewhere since), falls back to `resetCodeEditorText`.
 *
 * Does nothing while an IME composition is in progress, like
 * `setCodeEditorText`. */
export function restoreCodeEditor(view: EditorView, text: string, snapshot: CodeEditorSnapshot | undefined): void {
  if (view.composing) return
  const options = optionsOf.get(view)
  if (snapshot === undefined || options === undefined || snapshot.state.doc.toString() !== normalizeLineBreaks(text)) {
    resetCodeEditorText(view, text)
    return
  }
  const vimOn = vimModeOf.get(view) ?? false
  const placeholder = placeholderOf.get(view) ?? ''
  const effects: StateEffect<unknown>[] = []
  if (snapshot.vimOn !== vimOn) effects.push(vimCompartment.reconfigure(vimExtension(options, vimOn)))
  if (snapshot.placeholder !== placeholder) effects.push(placeholderSlot.reconfigure(placeholderExtension(placeholder)))
  // Adds nothing to the undo history, only keeps typing from here on out
  // of the last group typed before the user left: other steps may have
  // joined the timeline since (see `isolateCodeEditorHistory`).
  const restored = snapshot.state.update({ effects, annotations: isolateHistory.of('full') }).state
  carryTextHistory(snapshot.state, restored)
  view.setState(restored)
}

/** Ends the newest group in the editor's undo history, so the next typing
 * starts a new one however soon it comes. For when another step joins the
 * app's timeline: typing on both sides of it must not merge into one group
 * that Undo would then reach only after the step. */
export function isolateCodeEditorHistory(view: EditorView): void {
  view.dispatch({ annotations: isolateHistory.of('full') })
}

/** Whether the group numbered `seq` is the next one the editor state in
 * `snapshot` would undo (`'undo'`) or redo (`'redo'`) — false once vim's
 * `u` / `Ctrl-R` has already moved past it. */
export function canReplayCodeEditorGroup(snapshot: CodeEditorSnapshot, direction: 'undo' | 'redo', seq: number): boolean {
  return canReplayTextGroup(snapshot.state, direction, seq)
}

/** Undoes (or redoes) the group numbered `seq` in the editor, if it is the
 * next one there, and returns whether it did. The change reaches the app
 * through `onChange`, like any undo in the editor. */
export function replayCodeEditorGroup(view: EditorView, direction: 'undo' | 'redo', seq: number): boolean {
  if (!canReplayTextGroup(view.state, direction, seq)) return false
  return direction === 'undo' ? undo(view) : redo(view)
}

/** The editor that has keyboard focus, or `null`. */
function focusedCodeEditor(): EditorView | null {
  const active = document.activeElement
  const host = active instanceof HTMLElement ? active.closest<HTMLElement>('.cm-editor') : null
  return host ? EditorView.findFromDOM(host) : null
}

/** Runs the focused editor's own undo/redo, as vim's `u` / `Ctrl-R` would,
 * and returns whether an editor had focus (even when there was nothing to
 * undo). Only for while the app's timeline waits (the phone shape menu is
 * open); the markers of what this undoes are skipped later. */
export function replayFocusedCodeEditorHistory(direction: 'undo' | 'redo'): boolean {
  const view = focusedCodeEditor()
  if (view === null) return false
  if (direction === 'undo') undo(view)
  else redo(view)
  return true
}
