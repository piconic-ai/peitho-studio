// The status bar's message, kept as what happened rather than as text, so a
// language change rewords a message already on screen instead of leaving it
// in the language it was first shown in.
import type { Messages } from './messages'

export type StatusMessage =
  | { kind: 'none' }
  | { kind: 'opened'; deckPath: string }
  | { kind: 'saved' }
  | { kind: 'undone' }
  | { kind: 'redone' }
  | { kind: 'history-cleared' }
  | { kind: 'merged-external-change' }
  | { kind: 'reloaded-external-change' }
  | { kind: 'presenting'; rehearsal: boolean }
  | { kind: 'importing-images'; count: number }
  | { kind: 'imported-images'; count: number }
  | { kind: 'image-layout-added' }
  | { kind: 'layout-created'; layout: string }
  | { kind: 'layout-deleted'; layout: string }
  // Deleted, and the undo history forgotten: some step in it would have
  // pinned a slide back to the deleted layout (`historyPinsLayout`).
  | { kind: 'layout-deleted-history-cleared'; layout: string }
  | { kind: 'layout-saved'; layout: string }
  | { kind: 'layout-applied'; layout: string }

/** `status` worded with `messages` — empty for `none`. */
export function statusText(messages: Messages, status: StatusMessage): string {
  switch (status.kind) {
    case 'none': return ''
    case 'opened': return messages.openedDeck(status.deckPath)
    case 'saved': return messages.saved
    case 'undone': return messages.undone
    case 'redone': return messages.redone
    case 'history-cleared': return messages.historyCleared
    case 'merged-external-change': return messages.mergedExternalChange
    case 'reloaded-external-change': return messages.reloadedExternalChange
    case 'presenting': return status.rehearsal ? messages.presentingRehearsal : messages.presenting
    case 'importing-images': return messages.importingImages(status.count)
    case 'imported-images': return messages.importedImages(status.count)
    case 'image-layout-added': return messages.imageLayoutAdded
    case 'layout-created': return messages.layoutCreated(status.layout)
    case 'layout-deleted': return messages.layoutDeleted(status.layout)
    case 'layout-deleted-history-cleared': return messages.layoutDeletedHistoryCleared(status.layout)
    case 'layout-saved': return messages.layoutSaved(status.layout)
    case 'layout-applied': return messages.layoutApplied(status.layout)
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}
