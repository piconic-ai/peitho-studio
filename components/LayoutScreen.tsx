'use client'

import { type Language } from '../domain/language'
import { messagesFor, type Messages } from '../domain/messages'
import { type Size } from '../domain/geometry'
import { type LayoutField } from '../domain/layoutEditor'
import { type LayoutRow } from '../domain/layoutScreen'
import { STANDARD_LAYOUTS } from '../domain/standardLayouts'
import type { PhoneShape, ViewportMode } from '../domain/viewport'
import { ViewportToggle } from './ViewportToggle'

/** Where a delete stands, as the screen shows it (`domain/layoutDelete.ts`). */
export type LayoutDeleteView = 'idle' | 'confirming' | 'choosing-replacement' | 'deleting'

// Props are values, not signal getters (BF044) — see `WelcomeScreen.tsx`.
export interface LayoutScreenProps {
  language: Language
  /** The screen stays mounted; this hides it while the slides show. */
  hidden: boolean
  rows: LayoutRow[]
  selectedName: string | null
  onSelect: (name: string) => void
  /** A right-click on layout `name`'s row, or on the list's empty space
   * (`null`) — opens the layout menu (`LayoutContextMenu.tsx`). */
  onContextMenu: (name: string | null, event: MouseEvent) => void
  /** Layout `name`'s thumbnail host, once its row mounts: `Studio.tsx`
   * draws the layout into it — the saved files' preview, or for the layout
   * being edited, its unsaved draft — and draws it again as the draft
   * changes. A keyed row's `ref` runs only once (CLAUDE.md's BarefootJS
   * pitfalls), so the redraw can't happen here. */
  onThumbnailHost: (el: HTMLElement, name: string) => void
  /** The canvas layout `name`'s thumbnail is drawn on (the PC / Phone
   * switch's, `viewportCanvas`), for its box's proportion. */
  canvasOf: (name: string) => Size
  /** Why the latest draft didn't render, `''` for nothing — the thumbnail
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

  editorTab: LayoutField
  onEditorTab: (tab: LayoutField) => void
  /** Whether the selected layout's files are open for editing. */
  editorReady: boolean
  /** Why they aren't (or the last save's refusal), `''` for nothing. */
  editorMessage: string
  editorDirty: boolean
  editorSaving: boolean
  /** The HTML and CSS editors' host elements: `Studio.tsx` creates a
   * CodeMirror editor (`dom/codeEditor.ts`) in each, as for the slide
   * body, so vim mode reaches them too. Typing comes back through the
   * editors' own `onChange`. */
  onHtmlEditorHost: (el: HTMLElement) => void
  onCssEditorHost: (el: HTMLElement) => void
  onSave: () => void
  onRevert: () => void
}

function usageText(messages: Messages, count: number): string {
  return messages.layoutUsage(count)
}

function saveLabel(messages: Messages, saving: boolean): string {
  return saving ? messages.savingLayout : messages.saveLayout
}

function confirmLabel(messages: Messages, view: LayoutDeleteView): string {
  return view === 'deleting' ? messages.deleting : messages.deleteLayout
}

function tabClass(active: boolean): string {
  return (active ? 'border-primary text-foreground ' : 'border-transparent text-muted-foreground ') + 'px-3 py-1.5 text-xs font-medium border-b-2'
}

function aspectRatio(canvas: Size): string {
  return `aspect-ratio: ${String(canvas.width)} / ${String(canvas.height)}`
}

/** The deck's layouts in one screen: the selected layout's HTML/CSS
 * (left) and the list (right), whose selected row draws the editor's
 * unsaved draft as it's typed — code on the left, what it looks like on
 * the right; the comments column sits right of both (`Studio.tsx`). Every
 * operation on a layout is in the list's right-click menu
 * (`LayoutContextMenu.tsx`); New Layout and Delete open the modals at the
 * end. Every part is permanently mounted and shown or hidden by class —
 * see CLAUDE.md's BarefootJS pitfalls on branches. */
export function LayoutScreen(props: LayoutScreenProps) {
  return (
    <div data-layout-screen className={(props.hidden ? 'hidden' : 'flex') + ' flex-1 min-w-0 min-h-0'}>
      <div data-layout-editor className="flex-1 min-w-0 flex flex-col min-h-0 border-r border-border">
        <div className="shrink-0 h-9 flex items-center gap-1 px-2 border-b border-border">
          <button type="button" data-layout-tab="html" aria-pressed={props.editorTab === 'html' ? 'true' : 'false'} onClick={() => props.onEditorTab('html')} className={tabClass(props.editorTab === 'html')}>HTML</button>
          <button type="button" data-layout-tab="css" aria-pressed={props.editorTab === 'css' ? 'true' : 'false'} onClick={() => props.onEditorTab('css')} className={tabClass(props.editorTab === 'css')}>CSS</button>
          <div className="flex-1" />
          <span data-layout-unsaved hidden={!props.editorDirty} aria-hidden="true" title={messagesFor(props.language).layoutUnsaved} className="text-xs text-muted-foreground">●</span>
          <button
            type="button"
            data-revert-layout
            disabled={!props.editorDirty || props.editorSaving}
            onClick={() => props.onRevert()}
            className="px-2 py-0.5 rounded-md text-xs hover:bg-accent disabled:opacity-40"
          >
            {messagesFor(props.language).revertLayout}
          </button>
          <button
            type="button"
            data-save-layout
            disabled={!props.editorReady || !props.editorDirty || props.editorSaving}
            onClick={() => props.onSave()}
            className="px-2 py-0.5 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-40"
          >
            {saveLabel(messagesFor(props.language), props.editorSaving)}
          </button>
        </div>
        <p role="alert" data-layout-editor-message hidden={props.editorMessage === ''} className="shrink-0 px-3 py-2 text-xs text-destructive whitespace-pre-wrap break-words border-b border-border">{props.editorMessage}</p>
        {/* Hidden, not disabled, while the files aren't open: an editor
            can't be typed into then. Both stay mounted (CLAUDE.md's
            BarefootJS pitfalls on branches). */}
        <div
          ref={el => props.onHtmlEditorHost(el)}
          data-editor="layout-html"
          data-layout-editor-host
          className={(props.editorReady && props.editorTab === 'html' ? '' : 'hidden ') + 'flex-1 min-h-0 bg-background text-foreground'}
        />
        <div
          ref={el => props.onCssEditorHost(el)}
          data-editor="layout-css"
          data-layout-editor-host
          className={(props.editorReady && props.editorTab === 'css' ? '' : 'hidden ') + 'flex-1 min-h-0 bg-background text-foreground'}
        />
        {/* Under the editor it's about, so the reason stays in sight while
            the text is fixed; the list's thumbnail keeps the last draft
            that rendered meanwhile. */}
        <p role="alert" data-layout-preview-error hidden={props.previewError === ''} className="shrink-0 px-3 py-2 text-xs text-destructive whitespace-pre-wrap break-words border-t border-border">{props.previewError}</p>
      </div>

      <div className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40" onMouseDown={event => props.onListResize(event)} />

      <div data-layout-list className="shrink-0 flex flex-col min-h-0" style={`width: ${String(props.listWidth)}px`}>
        <div data-layout-list-header className="shrink-0 h-9 flex items-center justify-between gap-2 px-3 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground truncate">{messagesFor(props.language).layoutList}</span>
          <ViewportToggle
            language={props.language}
            viewportMode={props.viewportMode}
            onToggleViewportMode={props.onToggleViewportMode}
            phoneShape={props.phoneShape}
            phoneShapeMenuOpen={props.phoneShapeMenuOpen}
            onTogglePhoneShapeMenu={props.onTogglePhoneShapeMenu}
            onClosePhoneShapeMenu={props.onClosePhoneShapeMenu}
            onSelectPhoneShape={props.onSelectPhoneShape}
            menuSide="right"
          />
        </div>
        <p role="alert" data-layout-notice hidden={props.notice === null} className="shrink-0 px-3 py-2 text-xs text-destructive whitespace-pre-wrap break-words border-b border-border">{props.notice ?? ''}</p>
        <div
          data-layout-rows
          // `pb-16`: room below the last row to right-click for New Layout.
          className="flex-1 min-h-0 overflow-y-auto p-2 pb-16 flex flex-col gap-2"
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
              onClick={() => props.onSelect(row.name)}
              onContextMenu={e => props.onContextMenu(row.name, e)}
              className={(props.selectedName === row.name ? 'border-primary bg-accent ' : 'border-transparent hover:bg-accent ') + 'flex flex-col gap-1 p-1.5 rounded-md border-2 text-left'}
            >
              <span
                data-layout-thumbnail
                className="block relative w-full rounded border border-border bg-black overflow-hidden"
                style={aspectRatio(props.canvasOf(row.name))}
              >
                <span
                  ref={el => props.onThumbnailHost(el, row.name)}
                  className="absolute top-0 right-0 bottom-0 left-0"
                />
              </span>
              <span className="flex items-baseline justify-between gap-2 min-w-0">
                <span className="text-xs truncate">{row.label}</span>
                <span data-layout-usage className="shrink-0 text-[10px] text-muted-foreground">{usageText(messagesFor(props.language), row.usage)}</span>
              </span>
            </button>
          ))}
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
