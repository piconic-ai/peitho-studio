'use client'

import { type Language } from '../domain/language'
import { messagesFor, type Messages } from '../domain/messages'
import { type Size } from '../domain/geometry'
import { type FileTreeRow } from '../domain/deckFiles'
import { layoutGridThumbnailStyle, type LayoutRow } from '../domain/layoutScreen'
import { STANDARD_LAYOUTS } from '../domain/standardLayouts'
import type { PhoneShape, ViewportMode } from '../domain/viewport'
import { FileTree } from './FileTree'
import { PanelToggle } from './PanelToggle'
import { ViewportToggle } from './ViewportToggle'

/** Where a delete stands, as the screen shows it (`domain/layoutDelete.ts`). */
export type LayoutDeleteView = 'idle' | 'confirming' | 'choosing-replacement' | 'deleting'

// Props are values, not signal getters (BF044) — see `WelcomeScreen.tsx`.
export interface LayoutScreenProps {
  language: Language
  /** The screen stays mounted; this hides it while the slides show. */
  hidden: boolean

  /** Which columns are open: each folds into the rail at the screen's
   * left (`Studio.tsx`) with the ✕ in its top-right corner, as the slides
   * screen's panels do. `filling` names the column that takes the width
   * left over (`layoutColumnFilling`). */
  filesOpen: boolean
  editorOpen: boolean
  listOpen: boolean
  filling: 'editor' | 'list' | 'review' | null
  onCloseFiles: () => void
  onCloseEditor: () => void
  onCloseList: () => void

  /** The file tree (`FileTree.tsx`), leftmost. */
  treeRows: FileTreeRow[]
  collapsedFolders: string[]
  treeWidth: number
  onTreeResize: (event: MouseEvent) => void
  onTreeRowClick: (path: string) => void

  /** The editor's tabs, in order, and the file shown (`null` for none). */
  tabs: EditorTabView[]
  activePath: string | null
  /** The open files' paths, and those holding typing not saved yet. */
  openPaths: string[]
  dirtyPaths: string[]
  onShowTab: (path: string) => void
  onCloseTab: (path: string) => void
  /** What the code editor's host is called for the file shown —
   * `layout-html` or `layout-css` (`data-editor`, as the e2e helpers find
   * it). */
  editorName: string
  /** The code editor's host element: `Studio.tsx` creates one CodeMirror
   * editor (`dom/codeEditor.ts`) in it, as for the slide body, so vim mode
   * reaches it too, and swaps each tab's text (and undo history) in and
   * out of it. Typing comes back through the editor's own `onChange`; a
   * right-click opens the app's menu, whose comment is on the lines picked
   * (`domain/commentMenu.ts`). */
  onEditorHost: (el: HTMLElement) => void
  /** Whether the file shown is open for editing. */
  editorReady: boolean
  /** Why it isn't (or the last save's refusal), `''` for nothing. */
  editorMessage: string
  /** The file shown holds typing not saved yet (each pause in typing saves it). */
  editorDirty: boolean
  editorSaving: boolean
  /** The file shown changed on disk while it held unsaved edits: the user
   * picks a side (`onLoadExternal` / `onKeepDraft`). */
  editorConflict: boolean
  onLoadExternal: () => void
  onKeepDraft: () => void

  /** Every layout, in the grid of small thumbnails. */
  rows: LayoutRow[]
  selectedName: string | null
  /** The selected layout's names and usage, for under its large preview. */
  selectedLabel: string
  selectedEnglishName: string
  selectedUsage: number
  /** The selected layout's large preview's box (`layoutThumbnailStyle`). */
  selectedPreviewStyle: string
  /** The large preview's canvas host, once mounted: `Studio.tsx` draws the
   * selected layout into it — its unsaved draft while it's edited — and
   * draws it again as the selection or the draft changes. */
  onSelectedPreviewHost: (el: HTMLElement) => void
  /** A left-click on the large preview: opens a comment on the selected
   * layout, naming the slot clicked (`dom/layoutComments.ts`). */
  onSelectedPreviewClick: (event: MouseEvent) => void
  /** A left-click on layout `name`'s small thumbnail: selects it. */
  onRowClick: (name: string) => void
  /** A press on the large preview, for telling the click that follows from
   * a drag. */
  onRowPress: (event: MouseEvent) => void
  /** A right-click on layout `name`'s row (or the large preview), or on the
   * list's empty space (`null`) — opens the layout menu
   * (`ContextMenu.tsx`). */
  onContextMenu: (name: string | null, event: MouseEvent) => void
  /** Layout `name`'s small thumbnail host, once its row mounts:
   * `Studio.tsx` draws the layout into it — the saved files' preview, or
   * for the layout being edited, its unsaved draft — and draws it again as
   * the draft changes. A keyed row's `ref` runs only once (CLAUDE.md's
   * BarefootJS pitfalls), so the redraw can't happen here. */
  onThumbnailHost: (el: HTMLElement, name: string) => void
  /** The canvas layout `name`'s thumbnail is drawn on (the PC / Phone
   * switch's, `viewportCanvas`), for its box's proportion. */
  canvasOf: (name: string) => Size
  /** The list column's body under its switch, once mounted: `Studio.tsx`
   * watches its size, which the large preview fits inside
   * (`selectedPreviewRoom`). */
  onListBodyHost: (el: HTMLElement) => void
  /** Why the latest draft didn't render, `''` for nothing — the preview
   * keeps the last one that did. */
  previewError: string
  listWidth: number
  onListResize: (event: MouseEvent) => void
  /** The PC / Phone switch over the list, the same state as the slide
   * preview's (`ViewportToggle`). */
  viewportMode: ViewportMode
  onToggleViewportMode: () => void
  phoneShape: PhoneShape
  phoneShapeMenuOpen: boolean
  onTogglePhoneShapeMenu: () => void
  onClosePhoneShapeMenu: () => void
  onSelectPhoneShape: (shape: PhoneShape) => void
  /** A create/duplicate/delete/apply is running. */
  busy: boolean
  /** The last refused operation's reason, `null` for none. */
  notice: string | null

  newLayoutOpen: boolean
  newLayoutName: string
  newLayoutTemplate: string
  /** What's wrong with the typed name, worded; `''` when nothing is. */
  newLayoutProblem: string
  onNewLayoutName: (name: string) => void
  onNewLayoutTemplate: (template: string) => void
  onCreateLayout: () => void
  onCancelNewLayout: () => void

  deleteView: LayoutDeleteView
  /** The delete's question, worded. */
  deleteText: string
  replacementChoices: { name: string; label: string }[]
  replacement: string
  canConfirmDelete: boolean
  onPickReplacement: (name: string) => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

/** One editor tab as the screen shows it: the file's path and name. */
export interface EditorTabView {
  path: string
  name: string
}

function usageText(messages: Messages, count: number): string {
  return messages.layoutUsage(count)
}

function confirmLabel(messages: Messages, view: LayoutDeleteView): string {
  return view === 'deleting' ? messages.deleting : messages.deleteLayout
}

function tabClass(active: boolean): string {
  return (active ? 'border-primary text-foreground bg-background ' : 'border-transparent text-muted-foreground ') + 'shrink-0 flex items-center border-b-2'
}

/** The deck's layouts in one screen, left to right: the deck's files as a
 * tree (`FileTree.tsx`), the files opened from it (or from the list) as
 * editor tabs, and the layout list — the selected layout drawn large on
 * top, the editor's unsaved draft as it's typed, and every layout as a
 * small thumbnail in two columns under it. The comments column sits right
 * of all three (`Studio.tsx`). A click on the large preview opens a
 * comment on that layout, as a click on the slide preview does on the
 * slide; a right-click in the editor opens one on the lines selected.
 * Every operation on a layout is in the list's right-click menu
 * (`ContextMenu.tsx`); New Layout and Delete open the modals at the
 * end. Every part is permanently mounted and shown or hidden by class —
 * see CLAUDE.md's BarefootJS pitfalls on branches. */
export function LayoutScreen(props: LayoutScreenProps) {
  return (
    <div data-layout-screen className={(props.hidden ? 'hidden' : 'flex') + ' flex-1 min-w-0 min-h-0'}>
      <div data-panel="files" hidden={!props.filesOpen} className="studio-panel">
        <PanelToggle panel="files" language={props.language} open={true} onToggle={() => props.onCloseFiles()} />
        <div id="panel-files" className={props.filesOpen ? 'panel-content' : 'hidden'}>
          <FileTree
            rows={props.treeRows}
            collapsed={props.collapsedFolders}
            activePath={props.activePath}
            openPaths={props.openPaths}
            onRowClick={props.onTreeRowClick}
            width={props.treeWidth}
          />
        </div>
      </div>

      <div hidden={!props.filesOpen} className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40" onMouseDown={event => props.onTreeResize(event)} />

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
            (never `window.confirm`, CLAUDE.md), permanently mounted. */}
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
            be typed into then. Permanently mounted (CLAUDE.md's BarefootJS
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

      <div hidden={!props.editorOpen || !props.listOpen} className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40" onMouseDown={event => props.onListResize(event)} />

      <div data-panel="layouts" hidden={!props.listOpen} className="studio-panel" style={props.filling === 'list' ? 'flex: 1; min-width: 0' : ''}>
      <PanelToggle panel="layouts" language={props.language} open={true} onToggle={() => props.onCloseList()} />
      <div id="panel-layouts" data-layout-list className={(props.listOpen ? '' : 'hidden ') + 'flex flex-col flex-1 min-h-0'} style={props.filling === 'list' ? 'width: 100%' : `width: ${String(props.listWidth)}px`}>
        {/* A toolbar for the switch alone, no heading: the window's
            Slides / Layouts switch already says what this column is. At the
            top-left, as tall as the editor's tab row; no rule under it. */}
        <div data-layout-list-header className="shrink-0 h-9 flex items-center justify-start px-2">
          <ViewportToggle
            language={props.language}
            viewportMode={props.viewportMode}
            onToggleViewportMode={props.onToggleViewportMode}
            phoneShape={props.phoneShape}
            phoneShapeMenuOpen={props.phoneShapeMenuOpen}
            onTogglePhoneShapeMenu={props.onTogglePhoneShapeMenu}
            onClosePhoneShapeMenu={props.onClosePhoneShapeMenu}
            onSelectPhoneShape={props.onSelectPhoneShape}
            menuSide="left"
          />
        </div>
        <p role="alert" data-layout-notice hidden={props.notice === null} className="shrink-0 px-3 py-2 text-xs text-destructive whitespace-pre-wrap break-words border-b border-border">{props.notice ?? ''}</p>
        <div ref={el => props.onListBodyHost(el)} data-layout-list-body className="flex-1 min-h-0 flex flex-col">
          {/* The selected layout, large: the preview of what the editor
              holds. A click on it comments on the layout. */}
          <div data-layout-selected className={(props.selectedName === null ? 'hidden ' : '') + 'shrink-0 p-2'}>
            <div
              data-layout-selected-preview={props.selectedName ?? ''}
              onMouseDown={e => props.onRowPress(e)}
              onClick={e => props.onSelectedPreviewClick(e)}
              onContextMenu={e => props.onContextMenu(props.selectedName, e)}
              className="flex flex-col items-center gap-1"
            >
              {/* No frame and the default cursor, as on the slide preview:
                  the drawing stands on its own. */}
              <span
                data-layout-thumbnail
                className="block relative shrink-0 bg-black overflow-hidden"
                style={props.selectedPreviewStyle}
              >
                <span ref={el => props.onSelectedPreviewHost(el)} className="absolute top-0 right-0 bottom-0 left-0" />
              </span>
              <span className="w-full flex items-baseline gap-2 min-w-0 h-4">
                <span data-layout-selected-label className="text-xs font-medium truncate">{props.selectedLabel}</span>
                <span data-layout-selected-english hidden={props.selectedEnglishName === ''} className="text-[10px] font-mono text-muted-foreground truncate">{props.selectedEnglishName}</span>
                <span className="flex-1" />
                <span className="shrink-0 text-[10px] text-muted-foreground">{usageText(messagesFor(props.language), props.selectedUsage)}</span>
              </span>
            </div>
          </div>
          <div
            data-layout-rows
            // `pb-16`: room below the last row to right-click for New Layout.
            className="flex-1 min-h-0 overflow-y-auto p-2 pb-16 grid grid-cols-2 gap-2 content-start"
            // A row's own handler is delegated to this same element, so both
            // fire for a right-click on a row and `stopPropagation()` can't
            // tell them apart (barefootjs#2930, see `SlideList.tsx`): this one
            // skips a click that landed in a row.
            onContextMenu={e => {
              if ((e.target as Element).closest('[data-layout-row]')) return
              props.onContextMenu(null, e)
            }}
          >
            {props.rows.map(row => (
              <button
                type="button"
                key={row.key}
                data-layout-row={row.name}
                aria-current={props.selectedName === row.name ? 'true' : 'false'}
                onClick={() => props.onRowClick(row.name)}
                onContextMenu={e => props.onContextMenu(row.name, e)}
                className="min-w-0 flex flex-col gap-1 p-1 text-left"
              >
                {/* The slide list's thumbnail frame (`SlideList.tsx`), class
                    for class: yellow and thick when selected, gray and
                    thick on hover. */}
                <span
                  data-layout-row-thumbnail
                  className={props.selectedName === row.name
                    ? 'block relative shrink-0 rounded-md overflow-hidden border-4 border-[#eab308] bg-black'
                    : 'block relative shrink-0 rounded-md overflow-hidden border-2 border-border bg-black hover:border-4 hover:border-muted-foreground'}
                  style={layoutGridThumbnailStyle(props.canvasOf(row.name))}
                >
                  <span
                    ref={el => props.onThumbnailHost(el, row.name)}
                    className="absolute top-0 right-0 bottom-0 left-0"
                  />
                </span>
                <span className="text-xs truncate">{row.label}</span>
                <span data-layout-english-name hidden={row.englishName === null} className="text-[10px] font-mono text-muted-foreground truncate">{row.englishName ?? ''}</span>
                <span data-layout-usage className="text-[10px] text-muted-foreground">{usageText(messagesFor(props.language), row.usage)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      </div>
      {/* New Layout, opened from the list's empty-space menu: an in-app
          modal (never `window.confirm`/`prompt`, CLAUDE.md), permanently
          mounted and shown by class like the rest of this screen. */}
      <div className={(props.newLayoutOpen ? '' : 'hidden ') + 'fixed top-0 right-0 bottom-0 left-0 z-40 bg-black/40'} onClick={() => props.onCancelNewLayout()} />
      <div className={(props.newLayoutOpen ? '' : 'hidden ') + 'fixed top-0 right-0 bottom-0 left-0 z-50 flex items-center justify-center pointer-events-none'}>
        <div className="pointer-events-auto w-full max-w-sm">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={messagesFor(props.language).newLayout}
            data-new-layout-form
            className="w-full max-w-sm flex flex-col gap-2 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-4"
            onSubmit={event => {
              event.preventDefault()
              props.onCreateLayout()
            }}
          >
            <div className="text-sm font-medium">{messagesFor(props.language).newLayout}</div>
            <input
              type="text"
              data-new-layout-name
              value={props.newLayoutName}
              placeholder={messagesFor(props.language).newLayoutName}
              spellcheck={false}
              autocomplete="off"
              onInput={event => props.onNewLayoutName(event.target.value)}
              className="w-full px-2 py-1 rounded-md border border-border bg-background text-sm"
            />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {messagesFor(props.language).newLayoutFrom}
              <select
                data-new-layout-template
                onChange={event => props.onNewLayoutTemplate(event.target.value)}
                className="px-2 py-1 rounded-md border border-border bg-background text-sm text-foreground"
              >
                <option value="" selected={props.newLayoutTemplate === ''}>{messagesFor(props.language).blankLayout}</option>
                {STANDARD_LAYOUTS.map(layout => (
                  <option key={layout.name} value={layout.name} selected={props.newLayoutTemplate === layout.name}>{layout.label[props.language]}</option>
                ))}
              </select>
            </label>
            <p role="alert" className="text-xs text-destructive" hidden={props.newLayoutProblem === ''}>{props.newLayoutProblem}</p>
            {/* A refusal from the deck (the name check passed here) shows
                here too: the screen's own notice is behind the backdrop. */}
            <p className="text-xs text-destructive whitespace-pre-wrap break-words" hidden={props.notice === null}>{props.notice ?? ''}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => props.onCancelNewLayout()} className="px-2 py-1 rounded-md text-xs hover:bg-accent">
                {messagesFor(props.language).cancel}
              </button>
              <button
                type="submit"
                data-create-layout
                disabled={props.busy || props.newLayoutProblem !== ''}
                className="px-2 py-1 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-40"
              >
                {messagesFor(props.language).create}
              </button>
            </div>
          </form>
        </div>
      </div>
      {/* Delete, opened from a row's menu: the confirmation, and for a
          layout slides use, the layout to move them to. An in-app modal,
          permanently mounted like the New Layout one. A click outside
          cancels, except while the delete runs. */}
      <div className={(props.deleteView === 'idle' ? 'hidden ' : '') + 'fixed top-0 right-0 bottom-0 left-0 z-40 bg-black/40'} onClick={() => { if (props.deleteView !== 'deleting') props.onCancelDelete() }} />
      <div className={(props.deleteView === 'idle' ? 'hidden ' : '') + 'fixed top-0 right-0 bottom-0 left-0 z-50 flex items-center justify-center pointer-events-none'}>
        <div
          role="alertdialog"
          aria-modal="true"
          data-delete-layout-panel
          className="pointer-events-auto w-full max-w-sm flex flex-col gap-3 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-4"
        >
          <p className="text-sm">{props.deleteText}</p>
          <label className={(props.replacementChoices.length === 0 ? 'hidden ' : '') + 'flex items-center gap-2 text-xs text-muted-foreground'}>
            {messagesFor(props.language).deleteLayoutMoveTo}
            <select
              data-delete-replacement
              disabled={props.deleteView === 'deleting'}
              onChange={event => props.onPickReplacement(event.target.value)}
              className="px-2 py-1 rounded-md border border-border bg-background text-sm text-foreground"
            >
              <option value="" selected={props.replacement === ''} disabled>—</option>
              {props.replacementChoices.map(choice => (
                <option key={choice.name} value={choice.name} selected={props.replacement === choice.name}>{choice.label}</option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={props.deleteView === 'deleting'} onClick={() => props.onCancelDelete()} className="px-2 py-1 rounded-md text-xs hover:bg-accent disabled:opacity-40">
              {messagesFor(props.language).cancel}
            </button>
            <button
              type="button"
              data-confirm-delete-layout
              disabled={!props.canConfirmDelete}
              onClick={() => props.onConfirmDelete()}
              className="px-2 py-1 rounded-md bg-destructive text-white text-xs disabled:opacity-40"
            >
              {confirmLabel(messagesFor(props.language), props.deleteView)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
