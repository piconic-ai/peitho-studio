import { describe, expect, test } from 'bun:test'
import {
  LAYOUT_AUTOSAVE_DELAY_MS, NO_LAYOUT_EDITOR, editorDraft, editorLayoutName, isEditorDirty, keptDraft, layoutTextsOf, leaveBlocker, loadedEditor,
  LAYOUT_CHANGED_ON_DISK, isLayoutChangedOnDisk, saveFailedEditor, saveInterruptedEditor, savedEditor, savingEditor, shouldAutosave, withExternalChange, withExternalLoaded, withTyped,
  type LayoutEditor, type LayoutTexts,
} from './layoutEditor'

const FILES = { html: '<section></section>', css: '.x {}' }

describe('editing a layout\'s HTML/CSS', () => {
  test('spec: Given a layout\'s files are read, Then the editor shows them, with nothing unsaved', () => {
    const editor = loadedEditor('quote', FILES)
    expect(editorDraft(editor)).toEqual(FILES)
    expect(isEditorDirty(editor)).toBe(false)
    expect(editorLayoutName(editor)).toBe('quote')
  })

  test('spec: Given a layout with no CSS file, Then its CSS shows blank', () => {
    expect(editorDraft(loadedEditor('quote', { html: 'h', css: null }))).toEqual({ html: 'h', css: '' })
  })

  test('spec: Given typing in the HTML, Then the editor has unsaved changes and the CSS is untouched', () => {
    const typed = withTyped(loadedEditor('quote', FILES), 'html', '<section>!</section>')
    expect(isEditorDirty(typed)).toBe(true)
    expect(editorDraft(typed).css).toBe(FILES.css)
  })

  test('spec: Given a save that goes through, Then what was sent is the new saved text', () => {
    const typed = withTyped(loadedEditor('quote', FILES), 'css', '.y {}')
    const saving = savingEditor(typed)
    expect(saving.kind === 'ready' && saving.saving).toBe(true)
    const saved = savedEditor(saving, 'quote', editorDraft(typed))
    expect(isEditorDirty(saved)).toBe(false)
    expect(saved.kind === 'ready' && saved.saving).toBe(false)
  })

  test('spec: Given typing during a save, When the save lands, Then that typing stays unsaved', () => {
    const typed = withTyped(loadedEditor('quote', FILES), 'css', '.y {}')
    const sent = editorDraft(typed)
    const more = withTyped(savingEditor(typed), 'css', '.z {}')
    const landed = savedEditor(more, 'quote', sent)
    expect(editorDraft(landed).css).toBe('.z {}')
    expect(isEditorDirty(landed)).toBe(true)
  })

  test('spec: Given a save refused (HTML that doesn\'t parse), Then the reason shows, the typing stays, and the next edit clears the reason', () => {
    const typed = withTyped(loadedEditor('quote', FILES), 'html', '<div>')
    const failed = saveFailedEditor(savingEditor(typed), 'quote', 'no <section>', editorDraft(typed))
    expect(failed.kind === 'ready' && failed.error).toBe('no <section>')
    expect(editorDraft(failed).html).toBe('<div>')
    const edited = withTyped(failed, 'html', '<div>!')
    expect(edited.kind === 'ready' && edited.error).toBeNull()
  })

  test('adversarial: Given a save result for another layout (the selection moved on), Then the editor is left as it is', () => {
    const other = withTyped(loadedEditor('other', FILES), 'html', 'x')
    expect(savedEditor(other, 'quote', FILES)).toBe(other)
    expect(saveFailedEditor(other, 'quote', 'why', FILES)).toBe(other)
    expect(saveInterruptedEditor(other, 'quote')).toBe(other)
  })

  test('adversarial: Given an editor that isn\'t ready (none, loading, unavailable), Then typing and saving change nothing and it is never dirty', () => {
    const editors: LayoutEditor[] = [NO_LAYOUT_EDITOR, { kind: 'loading', name: 'q' }, { kind: 'unavailable', name: 'q', message: 'built-in' }]
    for (const editor of editors) {
      expect(withTyped(editor, 'html', 'x')).toBe(editor)
      expect(keptDraft(editor)).toBe(editor)
      expect(shouldAutosave(editor)).toBe(false)
      expect(leaveBlocker(editor)).toBeNull()
      expect(withExternalChange(editor, 'q', FILES)).toEqual({ editor, outcome: 'ignored' })
      expect(withExternalLoaded(editor, 'q', FILES)).toBe(editor)
      expect(savingEditor(editor)).toBe(editor)
      expect(savedEditor(editor, 'q', FILES)).toBe(editor)
      expect(isEditorDirty(editor)).toBe(false)
      expect(editorDraft(editor)).toEqual({ html: '', css: '' })
    }
    expect(editorLayoutName(NO_LAYOUT_EDITOR)).toBeNull()
  })

  test('adversarial: Given typing that changes nothing, or empty text, Then only a real change counts', () => {
    const editor = loadedEditor('quote', FILES)
    expect(withTyped(editor, 'html', FILES.html)).toBe(editor)
    const emptied = withTyped(editor, 'css', '')
    expect(isEditorDirty(emptied)).toBe(true)
    expect(isEditorDirty(withTyped(emptied, 'css', FILES.css))).toBe(false)
  })
})

/** The editor on `quote` with `typed` in the HTML, not saved yet. */
function typedEditor(typed = '<section>mine</section>'): LayoutEditor {
  return withTyped(loadedEditor('quote', FILES), 'html', typed)
}

const AGENT: LayoutTexts = { html: '<section>agent</section>', css: '.agent {}' }

describe('saving the draft on its own (autosave)', () => {
  test('spec: Given typing not saved yet, When typing pauses, Then the draft is saved', () => {
    expect(shouldAutosave(typedEditor())).toBe(true)
  })

  test('spec: Given nothing typed since the files were read or saved, Then nothing is saved', () => {
    const typed = typedEditor()
    expect(shouldAutosave(loadedEditor('quote', FILES))).toBe(false)
    expect(shouldAutosave(savedEditor(savingEditor(typed), 'quote', editorDraft(typed)))).toBe(false)
  })

  test('spec: Given a save still running, When typing pauses again, Then no second save starts beside it — and once it lands, the newer typing is saved next', () => {
    const typed = typedEditor('<section>one</section>')
    const running = withTyped(savingEditor(typed), 'html', '<section>two</section>')
    expect(shouldAutosave(running)).toBe(false)
    const landed = savedEditor(running, 'quote', editorDraft(typed))
    expect(editorDraft(landed).html).toBe('<section>two</section>')
    expect(shouldAutosave(landed)).toBe(true)
  })

  test('spec: Given a save the build check refused, Then the draft stays unsaved and is not tried again until the next edit', () => {
    const refused = saveFailedEditor(savingEditor(typedEditor('<div>')), 'quote', 'a layout needs a <section> element', editorDraft(typedEditor('<div>')))
    expect(editorDraft(refused).html).toBe('<div>')
    expect(isEditorDirty(refused)).toBe(true)
    expect(shouldAutosave(refused)).toBe(false)
    expect(shouldAutosave(withTyped(refused, 'html', '<section>fixed</section>'))).toBe(true)
  })

  test('spec: Given the files changed on disk under the draft, Then the draft is not saved over them until the user chooses', () => {
    const conflict = withExternalChange(typedEditor(), 'quote', AGENT).editor
    expect(shouldAutosave(conflict)).toBe(false)
    expect(shouldAutosave(keptDraft(conflict))).toBe(true)
  })

  test('non-functional: the autosave waits longer than the live preview\'s 250ms, and at most a couple of seconds', () => {
    expect(LAYOUT_AUTOSAVE_DELAY_MS).toBeGreaterThan(250)
    expect(LAYOUT_AUTOSAVE_DELAY_MS).toBeLessThanOrEqual(2000)
  })
})

describe('the files changing on disk (the agent editing the layout)', () => {
  test('spec: Given no unsaved typing, When the agent rewrites the files, Then the editor takes the new text', () => {
    const { editor, outcome } = withExternalChange(loadedEditor('quote', FILES), 'quote', AGENT)
    expect(outcome).toBe('replaced')
    expect(editorDraft(editor)).toEqual(AGENT)
    expect(isEditorDirty(editor)).toBe(false)
  })

  test('spec: Given unsaved typing, When the agent rewrites the files, Then the typing is kept and the agent\'s text waits beside it', () => {
    const { editor, outcome } = withExternalChange(typedEditor(), 'quote', AGENT)
    expect(outcome).toBe('conflict')
    expect(editorDraft(editor).html).toBe('<section>mine</section>')
    expect(editor.kind === 'ready' && editor.external).toEqual(AGENT)
    expect(leaveBlocker(editor)).toBe('conflict')
  })

  test('spec: Given a draft the build check refused, When the agent rewrites the files, Then it is a conflict too, not a silent replace', () => {
    const refused = saveFailedEditor(savingEditor(typedEditor('<div>')), 'quote', 'no <section>', editorDraft(typedEditor('<div>')))
    expect(withExternalChange(refused, 'quote', AGENT).outcome).toBe('conflict')
  })

  test('spec: Given Studio\'s own save coming back from disk, Then nothing changes', () => {
    const typed = typedEditor()
    const saved = savedEditor(savingEditor(typed), 'quote', editorDraft(typed))
    const { editor, outcome } = withExternalChange(saved, 'quote', editorDraft(typed))
    expect(outcome).toBe('unchanged')
    expect(editor).toBe(saved)
  })

  test('spec: Given the agent wrote exactly the draft, Then the draft counts as saved', () => {
    const typed = typedEditor()
    const { editor, outcome } = withExternalChange(typed, 'quote', editorDraft(typed))
    expect(outcome).toBe('caught-up')
    expect(isEditorDirty(editor)).toBe(false)
  })

  test('spec: Given a conflict, When the user loads the files, Then the editor shows them and the typing is set aside', () => {
    const conflict = withExternalChange(typedEditor(), 'quote', AGENT).editor
    const loaded = withExternalLoaded(conflict, 'quote', AGENT)
    expect(editorDraft(loaded)).toEqual(AGENT)
    expect(isEditorDirty(loaded)).toBe(false)
    expect(leaveBlocker(loaded)).toBeNull()
  })

  test('spec: Given a conflict, When the user keeps the typing, Then it is unsaved against the agent\'s text and saved over it next', () => {
    const conflict = withExternalChange(typedEditor(), 'quote', AGENT).editor
    const kept = keptDraft(conflict)
    expect(editorDraft(kept).html).toBe('<section>mine</section>')
    expect(kept.kind === 'ready' && kept.saved).toEqual(AGENT)
    expect(kept.kind === 'ready' && kept.external).toBeNull()
    expect(shouldAutosave(kept)).toBe(true)
  })

  test('adversarial: Given a conflict, When the files change back to what was last saved, Then the conflict goes away and the typing stays unsaved', () => {
    const conflict = withExternalChange(typedEditor(), 'quote', AGENT).editor
    const { editor, outcome } = withExternalChange(conflict, 'quote', FILES)
    expect(outcome).toBe('unchanged')
    expect(editor.kind === 'ready' && editor.external).toBeNull()
    expect(shouldAutosave(editor)).toBe(true)
  })

  test('adversarial: Given a conflict, When the agent writes again, Then the newest text waits beside the typing', () => {
    const conflict = withExternalChange(typedEditor(), 'quote', AGENT).editor
    const newer = { html: '<section>agent 2</section>', css: '' }
    const { editor, outcome } = withExternalChange(conflict, 'quote', newer)
    expect(outcome).toBe('conflict')
    expect(editor.kind === 'ready' && editor.external).toEqual(newer)
  })

  test('adversarial: Given a save running with no typing since, When the files change to something else, Then it is a conflict, not a replace the save would overwrite', () => {
    const running = savingEditor(typedEditor())
    expect(withExternalChange(running, 'quote', AGENT).outcome).toBe('conflict')
  })

  test('adversarial: Given a change to another layout\'s files, or to empty files, Then only the open layout\'s own change counts', () => {
    const editor = loadedEditor('quote', FILES)
    expect(withExternalChange(editor, 'other', AGENT)).toEqual({ editor, outcome: 'ignored' })
    const emptied = withExternalChange(editor, 'quote', { html: '', css: '' })
    expect(emptied.outcome).toBe('replaced')
    expect(editorDraft(emptied.editor)).toEqual({ html: '', css: '' })
  })

  test('adversarial: Given a conflict settled for another layout, or keeping with no conflict, Then nothing changes', () => {
    const conflict = withExternalChange(typedEditor(), 'quote', AGENT).editor
    expect(withExternalLoaded(conflict, 'other', AGENT)).toBe(conflict)
    const typed = typedEditor()
    expect(keptDraft(typed)).toBe(typed)
  })

  test('adversarial: Given a missing CSS file read back, Then it is blank CSS like on loading', () => {
    expect(layoutTextsOf({ html: 'h', css: null })).toEqual({ html: 'h', css: '' })
    expect(layoutTextsOf({ html: '', css: '' })).toEqual({ html: '', css: '' })
  })
})

describe('leaving the editor (another layout, the slides, closing the window)', () => {
  test('spec: Given everything saved, Then nothing keeps the editor from being left', () => {
    expect(leaveBlocker(loadedEditor('quote', FILES))).toBeNull()
  })

  test('spec: Given a draft that still could not be saved, Then leaving is held back', () => {
    const refused = saveFailedEditor(savingEditor(typedEditor('<div>')), 'quote', 'no <section>', editorDraft(typedEditor('<div>')))
    expect(leaveBlocker(refused)).toBe('unsaved')
  })
})

describe('a save meeting newer text', () => {
  test('spec: Given a draft fixed while its save was running, When that save is refused, Then the fix carries no error and is saved next', () => {
    const invalid = typedEditor('<div>invalid</div>')
    const fixed = withTyped(savingEditor(invalid), 'html', '<section>fixed</section>')
    const refused = saveFailedEditor(fixed, 'quote', 'a layout needs a <section> element', editorDraft(invalid))
    expect(refused.kind === 'ready' && refused.error).toBeNull()
    expect(shouldAutosave(refused)).toBe(true)
  })

  test('spec: Given the agent wrote the files during a save, When the save finds them changed, Then nothing is an error of the draft, and reading the change makes it a conflict', () => {
    const running = savingEditor(typedEditor())
    const interrupted = saveInterruptedEditor(running, 'quote')
    expect(interrupted.kind === 'ready' && interrupted.saving).toBe(false)
    expect(interrupted.kind === 'ready' && interrupted.error).toBeNull()
    const { editor, outcome } = withExternalChange(interrupted, 'quote', AGENT)
    expect(outcome).toBe('conflict')
    expect(shouldAutosave(editor)).toBe(false)
  })

  test('adversarial: only the changed-on-disk refusal is told apart, whatever wraps it', () => {
    expect(isLayoutChangedOnDisk(LAYOUT_CHANGED_ON_DISK)).toBe(true)
    expect(isLayoutChangedOnDisk(`Error: ${LAYOUT_CHANGED_ON_DISK}`)).toBe(true)
    for (const message of ['', 'a layout needs a <section> element', 'changed on disk', 'Error: the slides have changes']) {
      expect(isLayoutChangedOnDisk(message)).toBe(false)
    }
  })
})
