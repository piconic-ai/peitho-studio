'use client'

import type { JSX } from '@barefootjs/jsx/jsx-runtime'
import type { Language } from '../domain/language'
import { PanelToggle } from './PanelToggle'

interface StudioPanelColumnProps {
  panel: 'slides' | 'preview'
  language: Language
  open: boolean
  className: string
  onToggle: () => void
  children: JSX.Element
}

export function StudioPanelColumn(props: StudioPanelColumnProps) {
  return (
    <div data-panel={props.panel} hidden={!props.open} className={props.className}>
      <PanelToggle panel={props.panel} language={props.language} open={true} onToggle={props.onToggle} />
      <div id={`panel-${props.panel}`} className={props.open ? 'panel-content' : 'hidden'}>
        {props.children}
      </div>
    </div>
  )
}

interface SlidesListDividerProps {
  open: boolean
  onResize: (event: MouseEvent) => void
}

export function SlidesListDivider(props: SlidesListDividerProps) {
  return (
    <div
      hidden={!props.open}
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
      onMouseDown={props.onResize}
    />
  )
}
