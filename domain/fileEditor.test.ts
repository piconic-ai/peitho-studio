import { describe, expect, test } from 'bun:test'
import {
  FILE_AUTOSAVE_DELAY_MS, FILE_CHANGED_ON_DISK, NO_TABS, activeTab, anyTabDirty, autosavePaths, closeTab, fileDraft, isFileChangedOnDisk, isFileDirty,
  keptDraft, leaveBlocker, loadedFile, newlyOpened, openTabs, saveFailedFile, saveInterruptedFile, savedFile, savingFile, shouldAutosave, showTab,
  tabGone, tabLoaded, tabOf, tabUnavailable, tabsBlocker, updateTab, withExternalChange, withExternalLoaded, withTyped,
  type EditorTabs, type FileEditor,
} from './fileEditor'

const BASE = 'css/base.css'
const HTML = 'layouts/quote.html'
const CSS = 'css/quote.css'
const TEXT = '.x {}'
const AGENT = '.agent {}'

/** `css/base.css` read as `TEXT`, with `typed` typed over it. */
function typedFile(typed = '.mine {}'): FileEditor {
  return withTyped(loadedFile(BASE, TEXT), typed)
}

describe('editing one file', () => {
  test('spec: Given a file is read, Then the editor shows it, with nothing unsaved', () => {
    const file = loadedFile(BASE, TEXT)
    expect(fileDraft(file)).toBe(TEXT)
    expect(isFileDirty(file)).toBe(false)
  })

  test('spec: Given typing, Then the file has unsaved changes, and typing it back to what was saved leaves none', () => {
    const typed = typedFile()
    expect(isFileDirty(typed)).toBe(true)
    expect(isFileDirty(withTyped(typed, TEXT))).toBe(false)
  })

  test('spec: Given typing during a save, When the save lands, Then that typing stays unsaved', () => {
    const typed = typedFile('.one {}')
    const more = withTyped(savingFile(typed), '.two {}')
    const landed = savedFile(more, '.one {}')
    expect(fileDraft(landed)).toBe('.two {}')
    expect(isFileDirty(landed)).toBe(true)
  })

  test('spec: Given a save refused (CSS that would break the deck), Then the reason shows, the typing stays, and the next edit clears the reason', () => {
    const typed = typedFile('.slot-nowhere {}')
    const failed = saveFailedFile(savingFile(typed), 'would stop the deck from building', '.slot-nowhere {}')
    expect(failed.kind === 'ready' && failed.error).toBe('would stop the deck from building')
    expect(fileDraft(failed)).toBe('.slot-nowhere {}')
    const edited = withTyped(failed, '.fixed {}')
    expect(edited.kind === 'ready' && edited.error).toBeNull()
  })

  test('adversarial: Given a file that isn\'t ready (loading, unavailable), Then typing and saving change nothing and it is never dirty', () => {
    const files: FileEditor[] = [{ kind: 'loading', path: BASE }, { kind: 'unavailable', path: BASE, message: 'gone' }]
    for (const file of files) {
      expect(withTyped(file, 'x')).toBe(file)
      expect(keptDraft(file)).toBe(file)
      expect(shouldAutosave(file)).toBe(false)
      expect(leaveBlocker(file)).toBeNull()
      expect(withExternalChange(file, AGENT)).toEqual({ file, outcome: 'ignored' })
      expect(withExternalLoaded(file, AGENT)).toBe(file)
      expect(savingFile(file)).toBe(file)
      expect(savedFile(file, 'x')).toBe(file)
      expect(saveFailedFile(file, 'why', 'x')).toBe(file)
      expect(saveInterruptedFile(file)).toBe(file)
      expect(isFileDirty(file)).toBe(false)
      expect(fileDraft(file)).toBe('')
    }
    expect(fileDraft(undefined)).toBe('')
  })

  test('adversarial: Given typing that changes nothing, or empties the file, Then only a real change counts', () => {
    const file = loadedFile(BASE, TEXT)
    expect(withTyped(file, TEXT)).toBe(file)
    expect(isFileDirty(withTyped(file, ''))).toBe(true)
    expect(isFileDirty(withTyped(loadedFile(BASE, ''), ''))).toBe(false)
  })
})

describe('saving the draft on its own (autosave)', () => {
  test('spec: Given typing not saved yet, When typing pauses, Then the draft is saved', () => {
    expect(shouldAutosave(typedFile())).toBe(true)
  })

  test('spec: Given nothing typed since the file was read or saved, Then nothing is saved', () => {
    const typed = typedFile()
    expect(shouldAutosave(loadedFile(BASE, TEXT))).toBe(false)
    expect(shouldAutosave(savedFile(savingFile(typed), fileDraft(typed)))).toBe(false)
  })

  test('spec: Given a save still running, When typing pauses again, Then no second save starts beside it — and once it lands, the newer typing is saved next', () => {
    const running = withTyped(savingFile(typedFile('.one {}')), '.two {}')
    expect(shouldAutosave(running)).toBe(false)
    expect(shouldAutosave(savedFile(running, '.one {}'))).toBe(true)
  })

  test('spec: Given a refused save, Then it is not tried again until the next edit', () => {
    const refused = saveFailedFile(savingFile(typedFile('bad')), 'no', 'bad')
    expect(shouldAutosave(refused)).toBe(false)
    expect(shouldAutosave(withTyped(refused, 'good'))).toBe(true)
  })

  test('spec: Given the file changed on disk under the draft, Then the draft is not saved over it until the user chooses', () => {
    const conflict = withExternalChange(typedFile(), AGENT).file
    expect(shouldAutosave(conflict)).toBe(false)
    expect(shouldAutosave(keptDraft(conflict))).toBe(true)
  })

  test('non-functional: the autosave waits longer than the live preview\'s 250ms, and at most a couple of seconds', () => {
    expect(FILE_AUTOSAVE_DELAY_MS).toBeGreaterThan(250)
    expect(FILE_AUTOSAVE_DELAY_MS).toBeLessThanOrEqual(2000)
  })
})

describe('the file changing on disk (the agent editing it)', () => {
  test('spec: Given no unsaved typing, When the agent rewrites the file, Then the editor takes the new text', () => {
    const { file, outcome } = withExternalChange(loadedFile(BASE, TEXT), AGENT)
    expect(outcome).toBe('replaced')
    expect(fileDraft(file)).toBe(AGENT)
    expect(isFileDirty(file)).toBe(false)
  })

  test('spec: Given unsaved typing, When the agent rewrites the file, Then the typing is kept and the agent\'s text waits beside it', () => {
    const { file, outcome } = withExternalChange(typedFile(), AGENT)
    expect(outcome).toBe('conflict')
    expect(fileDraft(file)).toBe('.mine {}')
    expect(file.kind === 'ready' && file.external).toBe(AGENT)
    expect(leaveBlocker(file)).toBe('conflict')
  })

  test('spec: Given Studio\'s own save coming back from disk, Then nothing changes', () => {
    const typed = typedFile()
    const saved = savedFile(savingFile(typed), fileDraft(typed))
    expect(withExternalChange(saved, fileDraft(typed))).toEqual({ file: saved, outcome: 'unchanged' })
  })

  test('spec: Given the agent wrote exactly the draft, Then the draft counts as saved', () => {
    const typed = typedFile()
    const { file, outcome } = withExternalChange(typed, fileDraft(typed))
    expect(outcome).toBe('caught-up')
    expect(isFileDirty(file)).toBe(false)
  })

  test('spec: Given a conflict, When the user loads the file, Then the editor shows it and the typing is set aside', () => {
    const loaded = withExternalLoaded(withExternalChange(typedFile(), AGENT).file, AGENT)
    expect(fileDraft(loaded)).toBe(AGENT)
    expect(leaveBlocker(loaded)).toBeNull()
  })

  test('spec: Given a conflict, When the user keeps the typing, Then it is unsaved against the agent\'s text and saved over it next', () => {
    const kept = keptDraft(withExternalChange(typedFile(), AGENT).file)
    expect(fileDraft(kept)).toBe('.mine {}')
    expect(kept.kind === 'ready' && kept.saved).toBe(AGENT)
    expect(shouldAutosave(kept)).toBe(true)
  })

  test('adversarial: Given a conflict, When the file changes back to what was last saved, Then the conflict goes away and the typing stays unsaved', () => {
    const { file, outcome } = withExternalChange(withExternalChange(typedFile(), AGENT).file, TEXT)
    expect(outcome).toBe('unchanged')
    expect(file.kind === 'ready' && file.external).toBeNull()
    expect(shouldAutosave(file)).toBe(true)
  })

  test('adversarial: Given a save running with no typing since, When the file changes to something else, Then it is a conflict, not a replace the save would overwrite', () => {
    expect(withExternalChange(savingFile(typedFile()), AGENT).outcome).toBe('conflict')
  })

  test('adversarial: Given the file emptied on disk, Then it is replaced like any other text; keeping with no conflict changes nothing', () => {
    expect(withExternalChange(loadedFile(BASE, TEXT), '').outcome).toBe('replaced')
    const typed = typedFile()
    expect(keptDraft(typed)).toBe(typed)
  })

  test('spec: Given the agent wrote the file during a save, When the save finds it changed, Then nothing is an error of the draft, and reading the change makes it a conflict', () => {
    const interrupted = saveInterruptedFile(savingFile(typedFile()))
    expect(interrupted.kind === 'ready' && interrupted.saving).toBe(false)
    expect(interrupted.kind === 'ready' && interrupted.error).toBeNull()
    expect(withExternalChange(interrupted, AGENT).outcome).toBe('conflict')
  })

  test('adversarial: only the changed-on-disk refusal is told apart, whatever wraps it', () => {
    expect(isFileChangedOnDisk(FILE_CHANGED_ON_DISK)).toBe(true)
    expect(isFileChangedOnDisk(`Error: ${FILE_CHANGED_ON_DISK}`)).toBe(true)
    for (const message of ['', 'a layout needs a <section> element', 'changed on disk']) expect(isFileChangedOnDisk(message)).toBe(false)
  })
})

/** Tabs with each of `paths` open and read as `TEXT`, the first shown. */
function tabsWith(...paths: string[]): EditorTabs {
  let tabs = openTabs(NO_TABS, paths, paths[0])
  for (const path of paths) tabs = tabLoaded(tabs, path, TEXT)
  return tabs
}

describe('the editor\'s tabs', () => {
  test('spec: Given no tabs, When a layout\'s two files are opened, Then both are tabs, loading, and the HTML is shown', () => {
    const tabs = openTabs(NO_TABS, [HTML, CSS], HTML)
    expect(tabs.tabs.map(tab => [tab.path, tab.kind])).toEqual([[HTML, 'loading'], [CSS, 'loading']])
    expect(tabs.active).toBe(HTML)
    expect(newlyOpened(NO_TABS, tabs)).toEqual([HTML, CSS])
  })

  test('spec: Given base.css open, When a layout is opened, Then its files join after it and base.css keeps its place', () => {
    const tabs = openTabs(tabsWith(BASE), [HTML, CSS], CSS)
    expect(tabs.tabs.map(tab => tab.path)).toEqual([BASE, HTML, CSS])
    expect(tabs.active).toBe(CSS)
  })

  test('adversarial: Given a file already open with typing in it, When it is opened again, Then it is not read again and the typing stays', () => {
    const typed = updateTab(tabsWith(BASE, HTML), BASE, file => withTyped(file, '.mine {}'))
    const again = openTabs(typed, [BASE, BASE], BASE)
    expect(again.tabs.length).toBe(2)
    expect(newlyOpened(typed, again)).toEqual([])
    expect(fileDraft(activeTab(again))).toBe('.mine {}')
  })

  test('spec: Given three tabs, When the shown one is closed, Then its right neighbour is shown; closing the last shows the left one; closing all shows none', () => {
    let tabs = showTab(tabsWith(BASE, HTML, CSS), HTML)
    tabs = closeTab(tabs, HTML)
    expect(tabs.active).toBe(CSS)
    tabs = closeTab(tabs, CSS)
    expect(tabs.active).toBe(BASE)
    expect(closeTab(tabs, BASE)).toEqual(NO_TABS)
  })

  test('adversarial: Given a tab not shown, or not open, When it is closed or shown, Then the shown tab stays', () => {
    const tabs = tabsWith(BASE, HTML)
    expect(closeTab(tabs, HTML).active).toBe(BASE)
    expect(closeTab(tabs, 'css/nowhere.css')).toBe(tabs)
    expect(showTab(tabs, 'css/nowhere.css')).toBe(tabs)
    expect(openTabs(tabs, [], 'css/nowhere.css').active).toBe(BASE)
  })

  test('adversarial: Given a tab closed while its file was read, When the read lands, Then nothing comes back', () => {
    const opened = openTabs(NO_TABS, [BASE], BASE)
    const closed = closeTab(opened, BASE)
    expect(tabLoaded(closed, BASE, TEXT)).toBe(closed)
    expect(tabUnavailable(closed, BASE, 'gone')).toBe(closed)
  })

  test('spec: Given a file that can\'t be read, Then its tab says why', () => {
    const tabs = tabUnavailable(openTabs(NO_TABS, [BASE], BASE), BASE, 'not a file of this deck')
    expect(tabOf(tabs, BASE)).toEqual({ kind: 'unavailable', path: BASE, message: 'not a file of this deck' })
    // A read result after that doesn't replace the reason.
    expect(tabLoaded(tabs, BASE, TEXT)).toBe(tabs)
  })

  test('spec: Given an open file deleted on disk with nothing unsaved, Then its tab closes; with typing in it, the tab stays and says why it can\'t be saved', () => {
    const tabs = tabsWith(BASE, HTML)
    expect(tabGone(tabs, HTML, 'deleted').tabs.map(tab => tab.path)).toEqual([BASE])
    const typed = updateTab(tabs, HTML, file => withTyped(file, '<section>mine</section>'))
    const kept = tabGone(typed, HTML, 'deleted')
    const file = tabOf(kept, HTML)
    expect(file?.kind === 'ready' && file.error).toBe('deleted')
    expect(fileDraft(file)).toBe('<section>mine</section>')
    expect(shouldAutosave(file as FileEditor)).toBe(false)
    expect(tabGone(kept, 'css/nowhere.css', 'deleted')).toBe(kept)
  })

  test('spec: Given typing in two tabs, Then both are saved on their own, in tab order, and leaving is held back by the conflict first', () => {
    let tabs = tabsWith(BASE, HTML, CSS)
    expect(anyTabDirty(tabs)).toBe(false)
    expect(tabsBlocker(tabs)).toBeNull()
    tabs = updateTab(tabs, CSS, file => withTyped(file, '.a {}'))
    tabs = updateTab(tabs, BASE, file => withTyped(file, '.b {}'))
    expect(anyTabDirty(tabs)).toBe(true)
    expect(autosavePaths(tabs)).toEqual([BASE, CSS])
    expect(tabsBlocker(tabs)).toEqual({ path: BASE, blocker: 'unsaved' })
    tabs = updateTab(tabs, CSS, file => withExternalChange(file, AGENT).file)
    expect(tabsBlocker(tabs)).toEqual({ path: CSS, blocker: 'conflict' })
    expect(autosavePaths(tabs)).toEqual([BASE])
  })

  test('adversarial: Given a change that leaves a tab as it was, Then the tabs are the same object (no needless redraw)', () => {
    const tabs = tabsWith(BASE)
    expect(updateTab(tabs, BASE, file => file)).toBe(tabs)
    expect(updateTab(tabs, 'css/nowhere.css', file => withTyped(file, 'x'))).toBe(tabs)
    expect(activeTab(NO_TABS)).toBeUndefined()
    expect(tabOf(tabs, null)).toBeUndefined()
  })
})
