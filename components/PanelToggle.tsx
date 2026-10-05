'use client'

import { type Language } from '../domain/language'

interface PanelToggleProps {
  /** The slides screen's four panels, and the layout screen's file tree,
   * editor and layout list (the comments column is both screens'). */
  panel: 'slides' | 'editor' | 'preview' | 'review' | 'files' | 'layout-editor' | 'layouts'
  language: Language
  hidden?: boolean
  open: boolean
  onToggle: () => void
}

const labels = {
  en: { slides: 'Slides', editor: 'Editor', preview: 'Preview', review: 'Comments', files: 'Files', 'layout-editor': 'Editor', layouts: 'Layouts' },
  ja: { slides: 'スライド', editor: 'エディター', preview: 'プレビュー', review: 'コメント', files: 'ファイル', 'layout-editor': 'エディター', layouts: 'レイアウト' },
}
const icons = {
  slides: 'M5 3h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M5 14h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z',
  editor: 'M15 4l5 5 M4 20l1-6L15.5 3.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L10 19z',
  preview: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  review: 'M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4.2 3.4a.5.5 0 0 1-.8-.4V5a1 1 0 0 1 1-1z',
  files: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  'layout-editor': 'M15 4l5 5 M4 20l1-6L15.5 3.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L10 19z',
  layouts: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
}

/** One quiet control: a cross in the corner or an icon in the folded rail. */
export function PanelToggle(props: PanelToggleProps) {
  return (
    <button
      type="button"
      hidden={props.hidden}
      data-panel-toggle={props.panel}
      className={props.open ? 'panel-toggle panel-close' : 'panel-toggle panel-open'}
      aria-expanded={props.open}
      aria-controls={`panel-${props.panel}`}
      aria-label={`${labels[props.language][props.panel]}${props.language === 'ja' ? (props.open ? 'を閉じる' : 'を開く') : (props.open ? ': Close' : ': Open')}`}
      title={labels[props.language][props.panel]}
      onClick={props.onToggle}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d={props.open ? 'M6 6l12 12 M18 6L6 18' : icons[props.panel]} />
      </svg>
    </button>
  )
}
