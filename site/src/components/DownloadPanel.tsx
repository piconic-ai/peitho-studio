'use client'

import { createMemo, createSignal, onMount } from '@barefootjs/client'
import {
  ARCH_LABEL,
  PLATFORM_LABEL,
  detectPlatform,
  formatSize,
  groupByPlatform,
  type Platform,
  type ReleaseAsset,
} from '../domain/releases'
import { RELEASES_URL, fetchLatestRelease, type Release } from '../lib/latestRelease'

// `loading` → `ready` when the latest release (with or without assets) was
// fetched; `unavailable` when the API said no (404 while no release exists
// yet, rate limit, offline). The unavailable branch still links the
// Releases page, so a visitor is never left without a way to download.
type Status = 'loading' | 'ready' | 'unavailable'

export function DownloadPanel() {
  const [status, setStatus] = createSignal<Status>('loading')
  const [release, setRelease] = createSignal<Release | null>(null)
  const [platform, setPlatform] = createSignal<Platform>('unknown')

  const assets = createMemo<ReleaseAsset[]>(() => release()?.assets ?? [])
  const groups = createMemo(() => groupByPlatform(assets()))
  const hasDownloads = createMemo(() => groups().length > 0)
  const ready = createMemo(() => status() === 'ready' && hasDownloads())
  const empty = createMemo(() => status() === 'unavailable' || (status() === 'ready' && !hasDownloads()))

  onMount(() => {
    setPlatform(detectPlatform(navigator.userAgent))
    void fetchLatestRelease().then((r) => {
      setRelease(r)
      setStatus(r ? 'ready' : 'unavailable')
    })
  })

  return (
    <div className="dl dl-list" data-status={status()} aria-busy={status() === 'loading'}>
      <div className={status() === 'loading' ? 'acc is-loading' : 'acc is-loading hidden'} aria-hidden="true">
        <div className="acc-item" /><div className="acc-item" /><div className="acc-item" />
      </div>
      {/* One native <details> per platform: keyboard and screen-reader
          behaviour for free. The visitor's own platform starts open. */}
      <div className={ready() ? 'acc' : 'acc hidden'} data-all-downloads>
        {/* @client */ groups().map((group) => (
          <details key={group.platform} className="acc-item" data-platform={group.platform} open={group.platform === platform()}>
            <summary>
              <span className="acc-name">{PLATFORM_LABEL[group.platform]}</span>
              <span className="acc-count">{group.assets.length === 1 ? '1 file' : `${String(group.assets.length)} files`}</span>
            </summary>
            <ul>
              {/* @client */ group.assets.map((item) => (
                <li key={item.asset.name}>
                  <a href={item.asset.browser_download_url}>
                    <span className="acc-file">{item.asset.name}</span>
                    <span className="acc-kind">{ARCH_LABEL[item.arch] ? `${ARCH_LABEL[item.arch]} · ${item.kind}` : item.kind}</span>
                  </a>
                  <span className="dl-size">{formatSize(item.asset.size)}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <p className={empty() ? 'acc-empty' : 'acc-empty hidden'} data-list-empty>
        {status() === 'unavailable' ? 'Release downloads could not be loaded.' : 'This release does not list downloadable files.'}
        {' '}Install with Homebrew above, or visit <a href={RELEASES_URL}>GitHub Releases</a> for direct downloads and release notes.
      </p>
    </div>
  )
}
