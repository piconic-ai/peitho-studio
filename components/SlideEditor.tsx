'use client'

// The slide body and speaker notes editors. Each is a CodeMirror 6 editor
// (`dom/codeEditor.ts`) that `Studio.tsx` creates inside the host `<div>`
// handed to it through `onBodyHost`/`onNoteHost`, and owns from then on:
// the editor reports typing itself, and `Studio.tsx`'s `syncEditorFields`
// pushes drafts back in only after a non-typing change (see there for why
// the editors are uncontrolled).
//
// Both hosts stay mounted even with no slide selected — only a `hidden`
// class toggles. A `ref` inside a conditional branch re-runs on every
// re-entry while the branch's cleanup never runs (CLAUDE.md, BarefootJS
// pitfalls), which would create a new editor per re-entry and leave the old
// one alive.
export interface SlideEditorProps {
  hasSelection: boolean
  onBodyHost: (el: HTMLElement) => void
  onNoteHost: (el: HTMLElement) => void
}

export function SlideEditor(props: SlideEditorProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={(props.hasSelection ? '' : 'hidden ') + 'flex-1 flex flex-col min-h-0'}>
        <div
          ref={el => props.onBodyHost(el)}
          data-editor="body"
          className="flex-1 min-h-0 bg-background text-foreground border-b border-border"
        />
        <div className="shrink-0 h-40 flex flex-col">
          <div className="h-6 shrink-0 flex items-center px-3 text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
            Speaker Notes
          </div>
          <div
            ref={el => props.onNoteHost(el)}
            data-editor="note"
            className="flex-1 min-h-0 bg-background text-foreground"
          />
        </div>
      </div>
      <p className={(props.hasSelection ? 'hidden ' : '') + 'p-3 text-sm text-muted-foreground'}>Select a slide to edit it.</p>
    </div>
  )
}
