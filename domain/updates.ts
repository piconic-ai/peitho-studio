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

const COPY = {
  en: {
    title: 'Updates', check: 'Check for updates', prepare: 'Update when I quit', later: 'Later', details: 'View update',
    autoCheck: 'Automatically check for updates', autoCheckDescription: 'Checks after launch and once a day. When off, new security notices cannot be detected.',
    autoUpdate: 'Automatically download and update when I quit', autoUpdateDescription: 'Enables automatic checks. Saves all open decks before applying the update on normal quit.',
    idle: 'Check for a newer version of Peitho Studio.', unconfigured: 'In-app updates are not configured for this build. Download a newer version from Releases.',
    checking: 'Checking for updates…', current: 'You are up to date.', available: 'A new version is available',
    downloading: 'Downloading update…', ready: 'Update ready. Quit Peitho Studio to apply it, then reopen the app.',
    downloaded: 'Update downloaded. Choose “Update when I quit” to apply it.',
    saving: 'Saving all open decks before updating…', installing: 'Installing update…', error: 'Could not complete the update. Please retry.',
    security: 'Security update recommended', saveFailed: 'Could not save update settings',
  },
  ja: {
    title: 'アップデート', check: '更新を確認', prepare: '終了時に更新する', later: '後で', details: '更新の詳細',
    autoCheck: '更新を自動確認', autoCheckDescription: '起動後と1日ごとに確認します。オフの場合、新しいセキュリティ通知も検出できません。',
    autoUpdate: '自動でダウンロードし、終了時に更新', autoUpdateDescription: '自動確認も有効になります。通常終了時に開いているデッキをすべて保存してから更新します。',
    idle: 'Peitho Studio の新しいバージョンを確認できます。', unconfigured: 'このビルドではアプリ内更新が未設定です。Releases から新しいバージョンをダウンロードできます。',
    checking: '更新を確認しています…', current: '最新版です。', available: '新しいバージョンがあります',
    downloading: '更新をダウンロードしています…', ready: '更新の準備ができました。Peitho Studio を終了すると更新します。その後アプリを開き直してください。',
    downloaded: '更新をダウンロード済みです。「終了時に更新する」で適用できます。',
    saving: '更新前に開いているデッキをすべて保存しています…', installing: '更新を適用しています…', error: '更新を完了できませんでした。再試行してください。',
    security: 'セキュリティ更新を推奨します', saveFailed: '更新設定を保存できませんでした',
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
