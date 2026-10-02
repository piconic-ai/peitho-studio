import { describe, expect, test } from 'bun:test'
import {
  NO_LAYOUT_EDITOR, editorDraft, editorLayoutName, isEditorDirty, loadedEditor, reverted,
  saveFailedEditor, savedEditor, savingEditor, withTyped, type LayoutEditor,
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

  test('spec: Given typing in the HTML, Then the editor has unsaved changes, and Revert puts the saved text back', () => {
    const typed = withTyped(loadedEditor('quote', FILES), 'html', '<section>!</section>')
    expect(isEditorDirty(typed)).toBe(true)
    expect(editorDraft(typed).css).toBe(FILES.css)
    const back = reverted(typed)
    expect(isEditorDirty(back)).toBe(false)
    expect(editorDraft(back)).toEqual(FILES)
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
    const failed = saveFailedEditor(savingEditor(typed), 'quote', 'no <section>')
    expect(failed.kind === 'ready' && failed.error).toBe('no <section>')
    expect(editorDraft(failed).html).toBe('<div>')
    const edited = withTyped(failed, 'html', '<div>!')
    expect(edited.kind === 'ready' && edited.error).toBeNull()
  })

  test('adversarial: Given a save result for another layout (the selection moved on), Then the editor is left as it is', () => {
    const other = withTyped(loadedEditor('other', FILES), 'html', 'x')
    expect(savedEditor(other, 'quote', FILES)).toBe(other)
    expect(saveFailedEditor(other, 'quote', 'why')).toBe(other)
  })

  test('adversarial: Given an editor that isn\'t ready (none, loading, unavailable), Then typing and saving change nothing and it is never dirty', () => {
    const editors: LayoutEditor[] = [NO_LAYOUT_EDITOR, { kind: 'loading', name: 'q' }, { kind: 'unavailable', name: 'q', message: 'built-in' }]
    for (const editor of editors) {
      expect(withTyped(editor, 'html', 'x')).toBe(editor)
      expect(reverted(editor)).toBe(editor)
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
