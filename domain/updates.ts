import type { Language } from './language'

export const UPDATE_PHASES = ['idle', 'unconfigured', 'checking', 'current', 'available', 'downloading', 'ready', 'saving', 'installing', 'error'] as const
export type UpdatePhase = typeof UPDATE_PHASES[number]
export interface UpdateStatus {
  phase: UpdatePhase
  version: string | null
  notes: string | null
  security: string | null
  downloaded: number
  total: number | null
  error: string | null
  dismissed: boolean
  installOnExit: boolean
}
export function initialUpdateStatus(): UpdateStatus {
  return { phase: 'idle', version: null, notes: null, security: null, downloaded: 0, total: null, error: null, dismissed: false, installOnExit: false }
}
export function parseUpdateStatus(raw: unknown): UpdateStatus {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return initialUpdateStatus()
  const value = raw as Record<string, unknown>
  const text = (key: string) => typeof value[key] === 'string' ? value[key] as string : null
  const count = (raw: unknown) => typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null
  return {
    phase: UPDATE_PHASES.includes(value.phase as UpdatePhase) ? value.phase as UpdatePhase : 'idle',
    version: text('version'), notes: text('notes'), security: text('security'), error: text('error'),
    downloaded: count(value.downloaded) ?? 0, total: count(value.total), dismissed: value.dismissed === true, installOnExit: value.installOnExit === true,
  }
}
export function updateBusy(status: UpdateStatus): boolean {
  return ['checking', 'downloading', 'saving', 'installing'].includes(status.phase)
}
export function updateBlocksEditing(status: UpdateStatus): boolean {
  return status.phase === 'saving' || status.phase === 'installing'
}
export function showUpdateNotice(status: UpdateStatus): boolean {
  return status.security !== null || (status.error !== null && (status.version !== null || status.phase === 'ready')) || (!status.dismissed && (status.phase === 'available' || status.phase === 'ready'))
}
export function canPrepareUpdate(status: UpdateStatus): boolean {
  return status.version !== null && !updateBusy(status) && (status.phase !== 'ready' || !status.installOnExit)
}

/** What the "Check for Updates…" window shows while its check is running:
 * `checking`, unless a download or quit-to-install is already under way or
 * an update is ready — a check then leaves that state as it is. */
export function startUpdateCheck(status: UpdateStatus): UpdateStatus {
  if (updateBusy(status) || status.phase === 'ready') return status
  return { ...status, phase: 'checking', error: null }
}
/** `status` after a check or update command itself failed (IPC error) with `error`. */
export function failUpdateCommand(status: UpdateStatus, error: unknown): UpdateStatus {
  return { ...status, phase: 'error', error: String(error) }
}
/** Whether a failed check can be retried (the update window's Retry). */
export function canRetryUpdate(status: UpdateStatus): boolean {
  return status.phase === 'error'
}
/** The new version's change notes to show, or `null` when there's no new
 * version or its notes are blank. */
export function updateNotes(status: UpdateStatus): string | null {
  return status.version !== null && status.notes !== null && status.notes.trim() !== '' ? status.notes.trim() : null
}
/** Whether the update window links to the GitHub releases: a new version's
 * release notes, or the Releases page for a build without in-app updates. */
export function showsReleasesLink(status: UpdateStatus): boolean {
  return status.version !== null || status.phase === 'unconfigured'
}

const COPY = {
  en: {
    title: 'Updates', prepare: 'Update', later: 'Later', releases: 'Release notes',
    autoCheck: 'Automatically check for updates', autoCheckOff: 'Security update notifications are also off.',
    autoUpdate: 'Automatic updates', autoUpdateDescription: 'Updates when you quit the app.',
    idle: 'Check for a newer version of Peitho Studio.', unconfigured: 'In-app updates are not configured for this build. Download a newer version from Releases.',
    checking: 'Checking for updates…', current: 'You are up to date.', available: 'A new version is available',
    downloading: 'Downloading update…', ready: 'Updates when you quit the app.',
    downloaded: 'Update downloaded. Choose “Update” to apply it.',
    saving: 'Saving all open decks before updating…', installing: 'Installing update…', error: 'Could not complete the update. Please retry.',
    security: 'Security update recommended', saveFailed: 'Could not save update settings',
    retry: 'Retry', openReleases: 'Open Releases', notes: 'What’s new',
  },
  ja: {
    title: 'アップデート', prepare: '更新する', later: '後で', releases: 'リリースノート',
    autoCheck: '更新を自動確認', autoCheckOff: 'セキュリティ更新の通知も停止します。',
    autoUpdate: '自動更新', autoUpdateDescription: 'アプリ終了時に更新します。',
    idle: 'Peitho Studio の新しいバージョンを確認できます。', unconfigured: 'このビルドではアプリ内更新が未設定です。Releases から新しいバージョンをダウンロードできます。',
    checking: '更新を確認しています…', current: '最新版です。', available: '新しいバージョンがあります',
    downloading: '更新をダウンロードしています…', ready: '終了時に更新します。',
    downloaded: '更新をダウンロード済みです。「更新する」で適用できます。',
    saving: '更新前に開いているデッキをすべて保存しています…', installing: '更新を適用しています…', error: '更新を完了できませんでした。再試行してください。',
    security: 'セキュリティ更新を推奨します', saveFailed: '更新設定を保存できませんでした',
    retry: '再試行', openReleases: 'Releasesを開く', notes: '変更点',
  },
} as const
export function updateMessages(language: Language) { return COPY[language] }
export function updateStatusText(status: UpdateStatus, language: Language): string {
  const copy = COPY[language]
  const base = status.phase === 'ready' && !status.installOnExit ? copy.downloaded : status.security && status.phase === 'available' ? copy.security : copy[status.phase]
  const version = status.version ? ` (${status.version})` : ''
  const progress = status.phase === 'downloading' && status.total && status.total > 0
    ? ` ${Math.min(100, Math.floor(status.downloaded / status.total * 100))}%` : ''
  return base + version + progress
}
