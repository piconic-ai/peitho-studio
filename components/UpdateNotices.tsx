'use client'

import type { Language } from '../domain/language'
import { canPrepareUpdate, showUpdateNotice, updateBlocksEditing, updateMessages, updateStatusText, type UpdateStatus } from '../domain/updates'

interface UpdateNoticesProps {
  status: UpdateStatus
  language: Language
  onPrepare: () => void
  onDismiss: () => void
}

export function UpdateNotices(props: UpdateNoticesProps) {
  return (
    <>
      <div role="status" data-update-notice hidden={!showUpdateNotice(props.status)}
        className="fixed bottom-10 right-4 z-30 max-w-sm rounded-lg border border-border bg-popover text-popover-foreground p-3 shadow-lg">
        <p className="text-sm font-medium">{updateStatusText(props.status, props.language)}</p>
        <p className="text-xs whitespace-pre-wrap mt-2" hidden={!props.status.security}>{props.status.security ?? ''}</p>
        <p role="alert" className="text-xs text-destructive mt-2" hidden={!props.status.error}>{props.status.error ?? ''}</p>
        <div className="flex gap-3 mt-2 text-sm">
          <button type="button" hidden={!canPrepareUpdate(props.status)} onClick={props.onPrepare} className="underline">{updateMessages(props.language).prepare}</button>
          <button type="button" hidden={props.status.security !== null} onClick={props.onDismiss}>{updateMessages(props.language).later}</button>
        </div>
      </div>
      <div role="alert" hidden={!updateBlocksEditing(props.status)} className="fixed top-0 right-0 bottom-0 left-0 z-50 bg-popover text-popover-foreground flex items-center justify-center">
        <p>{updateStatusText(props.status, props.language)}</p>
      </div>
    </>
  )
}
