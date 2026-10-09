'use client'

import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
// The slide body and speaker notes editors. Each is a CodeMirror 6 editor
// (`dom/codeEditor.ts`) that `Studio.tsx` creates inside the host `<div>`
// handed to it through `onBodyHost`/`onNoteHost`, and owns from then on:
// the editor reports typing itself, and `Studio.tsx`'s `syncEditorFields`
// pushes drafts back in only after a non-typing change (see there for why
// the editors are uncontrolled).
//
// A third editor, the whole-deck source (`onSourceHost`), takes the pane
// over while `sourceOpen` — the repair path for a deck that doesn't build
// because of text no slide's body shows (`domain/sourceEditing.ts`). Its
// toggle row is offered only while `sourceOffered`.
//
// Every host stays mounted even with no slide selected or the source
// editor open — only a `hidden` class toggles. A `ref` inside a
// conditional branch re-runs on every re-entry while the branch's cleanup
// never runs (CLAUDE.md, BarefootJS pitfalls), which would create a new
// editor per re-entry and leave the old one alive.
export interface SlideEditorProps {
  /** The UI language every label here is shown in. */
  language: Language
  hasSelection: boolean
  onBodyHost: (el: HTMLElement) => void
  onNoteHost: (el: HTMLElement) => void
  /** Whether the toggle to the whole-deck source editor is shown at all. */
  sourceOffered: boolean
  /** Whether the whole-deck source editor is what the pane shows. */
  sourceOpen: boolean
  onToggleSource: () => void
  onSourceHost: (el: HTMLElement) => void
}

export function SlideEditor(props: SlideEditorProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={(props.sourceOffered ? '' : 'hidden ') + 'shrink-0 flex items-start gap-3 px-3 py-2 text-xs border-b border-border bg-muted/30'}>
        <span className="flex-1 text-muted-foreground">{messagesFor(props.language).deckSourceHint}</span>
        {/* One expression picks the label: a `? :` text child in a component
            mounted inside a branch can leave that branch half-entered
            (CLAUDE.md, BarefootJS pitfalls). */}
        <button
          type="button"
          data-source-toggle
          onClick={() => props.onToggleSource()}
          className="shrink-0 px-2 py-0.5 rounded border border-border bg-background hover:bg-muted"
        >
          {messagesFor(props.language)[props.sourceOpen ? 'backToSlide' : 'editDeckSource']}
        </button>
      </div>
      <div
        ref={el => props.onSourceHost(el)}
        data-editor="source"
        className={(props.sourceOpen ? '' : 'hidden ') + 'flex-1 min-h-0 bg-background text-foreground'}
      />
      <div className={(props.hasSelection && !props.sourceOpen ? '' : 'hidden ') + 'flex-1 flex flex-col min-h-0'}>
        <div
          ref={el => props.onBodyHost(el)}
          data-editor="body"
          className="flex-1 min-h-0 bg-background text-foreground border-b border-border"
        />
        <div className="shrink-0 h-40 flex flex-col">
          <div className="h-6 shrink-0 flex items-center px-3 text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
            {messagesFor(props.language).speakerNotes}
          </div>
          <div
            ref={el => props.onNoteHost(el)}
            data-editor="note"
            className="flex-1 min-h-0 bg-background text-foreground"
          />
        </div>
      </div>
      <p className={(props.hasSelection || props.sourceOpen ? 'hidden ' : '') + 'p-3 text-sm text-muted-foreground'}>{messagesFor(props.language).selectSlideToEdit}</p>
    </div>
  )
}
