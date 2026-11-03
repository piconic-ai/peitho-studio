'use client'

import type { JSX } from '@barefootjs/jsx/jsx-runtime'
import type { Language } from '../domain/language'
import { PanelToggle } from './PanelToggle'

interface ReviewColumnProps {
  language: Language
  shown: boolean
  open: boolean
  fillsRow: boolean
  width: number
  onToggle: () => void
  onResizeStart: (event: MouseEvent) => void
  children: JSX.Element
}

export function ReviewColumn(props: ReviewColumnProps) {
  return (
    <>
      <div
        hidden={!props.shown || !props.open}
        className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
        onMouseDown={props.onResizeStart}
      />
      <div hidden={!props.shown || !props.open} data-panel="review" className="studio-panel" style={props.fillsRow ? 'flex: 1; min-width: 0' : ''}>
        <PanelToggle panel="review" language={props.language} open={true} onToggle={props.onToggle} />
        <div id="panel-review"
          className={props.open ? 'panel-content border-l border-border' : 'hidden'}
          style={props.fillsRow ? 'width: 100%' : `width: ${props.width}px`}
        >
          {props.children}
        </div>
      </div>
    </>
  )
}
