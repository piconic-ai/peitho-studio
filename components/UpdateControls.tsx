'use client'
import type { Language } from '../domain/language'
import { updateMessages } from '../domain/updates'

export interface UpdateControlsProps {
  language: Language
  autoCheck: boolean
  autoUpdate: boolean
  onSettingChange: (field: 'autoCheckUpdates' | 'autoUpdate', on: boolean) => Promise<boolean>
}
export function UpdateControls(props: UpdateControlsProps) {
  return (
    <section className="px-4 py-4 border-t border-border" aria-label={updateMessages(props.language).title}>
      <h3 className="text-sm font-medium mb-3">{updateMessages(props.language).title}</h3>
      <label className="flex items-start gap-3 text-sm mb-3 cursor-pointer">
        <input type="checkbox" data-setting="auto-check-updates" checked={props.autoCheck} className="mt-0.5"
          onChange={e => {
            const box = e.target as HTMLInputElement
            void props.onSettingChange('autoCheckUpdates', box.checked).then(saved => { if (!saved) box.checked = props.autoCheck })
          }} />
        <span><span className="block">{updateMessages(props.language).autoCheck}</span><span hidden={props.autoCheck} className="block text-xs text-muted-foreground">{updateMessages(props.language).autoCheckOff}</span></span>
      </label>
      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input type="checkbox" data-setting="auto-update" checked={props.autoUpdate} className="mt-0.5"
          onChange={e => {
            const box = e.target as HTMLInputElement
            void props.onSettingChange('autoUpdate', box.checked).then(saved => { if (!saved) box.checked = props.autoUpdate })
          }} />
        <span><span className="block">{updateMessages(props.language).autoUpdate}</span><span className="block text-xs text-muted-foreground">{updateMessages(props.language).autoUpdateDescription}</span></span>
      </label>
    </section>
  )
}
