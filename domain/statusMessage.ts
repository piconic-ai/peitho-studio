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
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}
