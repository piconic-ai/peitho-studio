'use client'

import type { JSX } from '@barefootjs/jsx/jsx-runtime'
import type { Language } from '../domain/language'
import { PanelToggle } from './PanelToggle'

interface SlidesEditorColumnProps {
  language: Language
  editorOpen: boolean
  previewOpen: boolean
  editorWidth: number
  onToggle: () => void
  onResize: (event: MouseEvent) => void
  children: JSX.Element
}

export function SlidesEditorColumn(props: SlidesEditorColumnProps) {
  return (
    <>
      <div data-panel="editor" hidden={!props.editorOpen} className="studio-panel slides-editor-panel" style={props.editorOpen && !props.previewOpen ? 'flex: 1; min-width: 0' : ''}>
        <PanelToggle panel="editor" language={props.language} open={true} onToggle={props.onToggle} />
        <div id="panel-editor"
          className={props.editorOpen ? 'panel-content border-r border-border' : 'hidden'}
          style={props.previewOpen ? `width: ${props.editorWidth}px; max-width: 100%` : 'width: 100%'}
        >
          {props.children}
        </div>
      </div>
      <div
        hidden={!props.editorOpen || !props.previewOpen}
        className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
        onMouseDown={props.onResize}
      />
    </>
  )
}
