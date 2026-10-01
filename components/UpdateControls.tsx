'use client'
import type { Language } from '../domain/language'
import { canPrepareUpdate, updateBusy, updateMessages, updateStatusText, type UpdateStatus } from '../domain/updates'

export interface UpdateControlsProps {
  language: Language
  status: UpdateStatus
  autoCheck: boolean
  autoUpdate: boolean
  onSettingChange: (field: 'autoCheckUpdates' | 'autoUpdate', on: boolean) => Promise<boolean>
  onCheck: () => void
  onPrepare: () => void
  onOpenReleases: () => void
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
      <label className="flex items-start gap-3 text-sm mb-3 cursor-pointer">
        <input type="checkbox" data-setting="auto-update" checked={props.autoUpdate} className="mt-0.5"
          onChange={e => {
            const box = e.target as HTMLInputElement
            void props.onSettingChange('autoUpdate', box.checked).then(saved => { if (!saved) box.checked = props.autoUpdate })
          }} />
        <span><span className="block">{updateMessages(props.language).autoUpdate}</span><span className="block text-xs text-muted-foreground">{updateMessages(props.language).autoUpdateDescription}</span></span>
      </label>
      <p role="status" data-update-status className="text-sm whitespace-pre-wrap">{updateStatusText(props.status, props.language)}</p>
      <p className="text-sm font-medium whitespace-pre-wrap mt-2" hidden={!props.status.security}>{props.status.security ?? ''}</p>
      <p role="alert" className="text-xs text-destructive mt-2" hidden={!props.status.error}>{props.status.error ?? ''}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={() => props.onCheck()} disabled={updateBusy(props.status)} className="rounded border border-border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50">{updateMessages(props.language).check}</button>
        <button type="button" onClick={() => props.onPrepare()} hidden={!canPrepareUpdate(props.status)} className="rounded bg-primary text-primary-foreground px-3 py-1 text-sm">{updateMessages(props.language).prepare}</button>
        <button type="button" onClick={() => props.onOpenReleases()} className="text-sm underline">{updateMessages(props.language).releases}</button>
      </div>
    </section>
  )
}
