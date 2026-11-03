'use client'

import type { JSX } from '@barefootjs/jsx/jsx-runtime'
import type { Language } from '../domain/language'
import type { StudioMode } from '../domain/layoutScreen'
import { PanelToggle } from './PanelToggle'

interface SlidesWorkspaceProps {
  language: Language
  mode: StudioMode
  slidesOpen: boolean
  editorOpen: boolean
  previewOpen: boolean
  reviewOpen: boolean
  assetBaseUrl: string | null
  onOpenSlides: () => void
  onOpenEditor: () => void
  onOpenPreview: () => void
  onOpenReview: () => void
  children: JSX.Element
}

export function SlidesWorkspace(props: SlidesWorkspaceProps) {
  return (
    <div data-slides-screen className={props.mode === 'slides' ? 'contents' : 'hidden'}>
      <div data-panel-rail="" className="panel-rail" hidden={props.slidesOpen && props.editorOpen && props.previewOpen && (props.reviewOpen || !props.assetBaseUrl)}>
        <PanelToggle panel="slides" language={props.language} hidden={props.slidesOpen} open={false} onToggle={props.onOpenSlides} />
        <PanelToggle panel="editor" language={props.language} hidden={props.editorOpen} open={false} onToggle={props.onOpenEditor} />
        <PanelToggle panel="preview" language={props.language} hidden={props.previewOpen} open={false} onToggle={props.onOpenPreview} />
        <PanelToggle panel="review" language={props.language} hidden={props.reviewOpen || !props.assetBaseUrl} open={false} onToggle={props.onOpenReview} />
      </div>
      {props.children}
    </div>
  )
}
