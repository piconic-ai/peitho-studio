'use client'

// No `bodyDraft`/`noteDraft` value props here on purpose. The two textareas
// are deliberately uncontrolled (no reactive `value={...}` binding — see
// `Studio.tsx`'s comment above `syncEditorFields` for why: reassigning
// `.value` on every keystroke, even to the same value the input handler just
// produced, can desync WebKit's in-progress IME composition buffer). Studio.tsx
// still owns the plain (non-reactive) `bodyTextareaEl`/`noteTextareaEl`
// handles and the composition-tracking flags `syncEditorFields` reads from
// other call sites (slide switches, saves, external-file merges) — this
// component only forwards the raw `ref` callbacks so that ownership stays in
// one place, and reports input as it happens via the two callback props.
export interface SlideEditorProps {
  hasSelection: boolean
  onBodyRef: (el: HTMLTextAreaElement) => void
  onNoteRef: (el: HTMLTextAreaElement) => void
  onBodyInput: (value: string) => void
  onNoteInput: (value: string) => void
}

export function SlideEditor(props: SlideEditorProps) {
  return props.hasSelection ? (
    <div className="flex-1 flex flex-col min-h-0">
      <textarea
        ref={el => props.onBodyRef(el)}
        onInput={e => props.onBodyInput(e.target.value)}
        spellcheck={false}
        className="flex-1 resize-none p-3 font-mono text-sm bg-background text-foreground outline-none border-b border-border"
      />
      <div className="shrink-0 h-40 flex flex-col">
        <div className="h-6 shrink-0 flex items-center px-3 text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
          Speaker Notes
        </div>
        <textarea
          ref={el => props.onNoteRef(el)}
          onInput={e => props.onNoteInput(e.target.value)}
          placeholder="Notes for the presenter — not shown to the audience."
          className="flex-1 resize-none p-3 text-sm bg-background text-foreground outline-none"
        />
      </div>
    </div>
  ) : (
    <p className="p-3 text-sm text-muted-foreground">Select a slide to edit it.</p>
  )
}
