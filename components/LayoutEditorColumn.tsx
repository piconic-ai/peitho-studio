'use client'

import { messagesFor } from '../domain/messages'
import type { Language } from '../domain/language'
import type { EditorTabView } from './LayoutScreen'
import { PanelToggle } from './PanelToggle'

interface LayoutEditorColumnProps {
  language: Language
  editorOpen: boolean
  filling: 'editor' | 'list' | 'review' | null
  onCloseEditor: () => void
  tabs: EditorTabView[]
  activePath: string | null
  dirtyPaths: string[]
  onShowTab: (path: string) => void
  onCloseTab: (path: string) => void
  editorSaving: boolean
  editorDirty: boolean
  editorMessage: string
  editorConflict: boolean
  onLoadExternal: () => void
  onKeepDraft: () => void
  editorName: string
  editorReady: boolean
  onEditorHost: (el: HTMLElement) => void
  previewError: string
}

function tabClass(active: boolean): string {
  return (active ? 'border-primary text-foreground bg-background ' : 'border-transparent text-muted-foreground ') + 'shrink-0 flex items-center border-b-2'
}

/** The permanently mounted file editor, its tabs and draft feedback. */
export function LayoutEditorColumn(props: LayoutEditorColumnProps) {
  return (
    <div data-panel="layout-editor" hidden={!props.editorOpen} className="studio-panel" style={props.filling === 'editor' ? 'flex: 1; min-width: 0' : ''}>
      <PanelToggle panel="layout-editor" language={props.language} open={true} onToggle={() => props.onCloseEditor()} />
      <div id="panel-layout-editor" data-layout-editor className={(props.editorOpen ? '' : 'hidden ') + 'flex-1 min-w-0 flex flex-col min-h-0 border-r border-border'}>
        {/* `pr-8`: room for the column's ✕ in the top-right corner. */}
        <div data-layout-editor-toolbar className="shrink-0 h-9 flex items-stretch gap-1 pr-8 border-b border-border">
          <div data-layout-tabs role="tablist" className="flex-1 min-w-0 flex items-stretch overflow-x-auto">
            {props.tabs.map(tab => (
              <div
                key={tab.path}
                role="tab"
                data-layout-tab={tab.path}
                aria-selected={props.activePath === tab.path ? 'true' : 'false'}
                className={tabClass(props.activePath === tab.path)}
              >
                <button type="button" data-layout-tab-show title={tab.path} onClick={() => props.onShowTab(tab.path)} className="h-full pl-3 pr-1 text-xs font-medium whitespace-nowrap">
                  {tab.name}
                </button>
                <span data-layout-tab-dirty aria-hidden="true" className={(props.dirtyPaths.includes(tab.path) ? '' : 'invisible ') + 'text-[10px] text-muted-foreground'}>●</span>
                <button
                  type="button"
                  data-layout-tab-close
                  aria-label={messagesFor(props.language).closeTab(tab.name)}
                  title={messagesFor(props.language).closeTab(tab.name)}
                  onClick={() => props.onCloseTab(tab.path)}
                  className="h-full px-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {/* No Save button: each pause in typing saves the draft. */}
          <span data-layout-saving hidden={!props.editorSaving} className="self-center text-xs text-muted-foreground">{messagesFor(props.language).savingLayout}</span>
          <span data-layout-unsaved hidden={!props.editorDirty || props.editorSaving} aria-hidden="true" title={messagesFor(props.language).layoutUnsaved} className="self-center text-xs text-muted-foreground">●</span>
        </div>
        <p role="alert" data-layout-editor-message hidden={props.editorMessage === ''} className="shrink-0 px-3 py-2 text-xs text-destructive whitespace-pre-wrap break-words border-b border-border">{props.editorMessage}</p>
        {/* The file changed on disk under unsaved edits: an in-app choice
            (never `window.confirm`, AGENTS.md), permanently mounted. */}
        <div role="alert" data-layout-conflict className={(props.editorConflict ? 'flex' : 'hidden') + ' shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-xs border-b border-border bg-accent'}>
          <span className="flex-1 min-w-0">{messagesFor(props.language).layoutConflict}</span>
          <button type="button" data-layout-conflict-load disabled={props.editorSaving} onClick={() => props.onLoadExternal()} className="px-2 py-0.5 rounded-md bg-primary text-primary-foreground disabled:opacity-40">
            {messagesFor(props.language).layoutConflictLoad}
          </button>
          <button type="button" data-layout-conflict-keep disabled={props.editorSaving} onClick={() => props.onKeepDraft()} className="px-2 py-0.5 rounded-md hover:bg-background disabled:opacity-40">
            {messagesFor(props.language).layoutConflictKeep}
          </button>
        </div>
        <p data-layout-no-file hidden={props.activePath !== null} className="shrink-0 px-3 py-6 text-xs text-muted-foreground text-center">{messagesFor(props.language).noFileOpen}</p>
        {/* Hidden, not disabled, while the file isn't open: an editor can't
            be typed into then. Permanently mounted (AGENTS.md's BarefootJS
            pitfalls on branches). */}
        <div
          ref={el => props.onEditorHost(el)}
          data-editor={props.editorName}
          data-layout-editor-host
          className={(props.editorReady ? '' : 'hidden ') + 'flex-1 min-h-0 bg-background text-foreground'}
        />
        {/* Under the editor it's about, so the reason stays in sight while
            the text is fixed; the preview keeps the last draft that
            rendered meanwhile. */}
        <p role="alert" data-layout-preview-error hidden={props.previewError === ''} className="shrink-0 px-3 py-2 text-xs text-destructive whitespace-pre-wrap break-words border-t border-border">{props.previewError}</p>
      </div>
    </div>
  )
}
