'use client'

import { createMemo, createSignal, onMount } from '@barefootjs/client'
import {
  ARCH_LABEL,
  PLATFORM_LABEL,
  detectArch,
  detectPlatform,
  formatSize,
  groupByPlatform,
  recommendedAssets,
  type Arch,
  type ClassifiedAsset,
  type Platform,
  type ReleaseAsset,
} from '../domain/releases'

const REPO = 'piconic-ai/peitho-studio'
const RELEASES_URL = `https://github.com/${REPO}/releases`
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`

interface Release {
  tag_name: string
  html_url: string
  published_at: string
  assets: ReleaseAsset[]
}

// `loading` → `ready` when the latest release (with or without assets) was
// fetched; `unavailable` when the API said no (404 while no release exists
// yet, rate limit, offline). The unavailable branch still links the
// Releases page, so a visitor is never left without a way to download.
type Status = 'loading' | 'ready' | 'unavailable'

async function fetchLatest(): Promise<Release | null> {
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    return (await res.json()) as Release
  } catch {
    return null
  }
}

// Chromium exposes the CPU architecture through UA Client Hints; Safari and
// Firefox don't, which the domain layer copes with by offering both Mac
// builds when it's `unknown`.
async function readArch(): Promise<Arch> {
  const uaData = (navigator as Navigator & {
    userAgentData?: { getHighEntropyValues(hints: string[]): Promise<{ architecture?: string; bitness?: string }> }
  }).userAgentData
  if (!uaData) return 'unknown'
  try {
    const v = await uaData.getHighEntropyValues(['architecture', 'bitness'])
    return detectArch(v.architecture, v.bitness)
  } catch {
    return 'unknown'
  }
}

export function DownloadPanel() {
  const [status, setStatus] = createSignal<Status>('loading')
  const [release, setRelease] = createSignal<Release | null>(null)
  const [platform, setPlatform] = createSignal<Platform>('unknown')
  const [arch, setArch] = createSignal<Arch>('unknown')
  const [showAll, setShowAll] = createSignal(false)

  const assets = createMemo<ReleaseAsset[]>(() => release()?.assets ?? [])
  const primary = createMemo<ClassifiedAsset[]>(() => recommendedAssets(assets(), platform(), arch()))
  const groups = createMemo(() => groupByPlatform(assets()))
  const hasDownloads = createMemo(() => groups().length > 0)
  const version = createMemo(() => release()?.tag_name ?? '')
  const publishedOn = createMemo(() => {
    const iso = release()?.published_at
    return iso ? new Date(iso).toISOString().slice(0, 10) : ''
  })

  onMount(() => {
    setPlatform(detectPlatform(navigator.userAgent))
    void readArch().then(setArch)
    void fetchLatest().then((r) => {
      setRelease(r)
      setStatus(r ? 'ready' : 'unavailable')
    })
  })

  return (
    <div className="dl" data-status={status()}>
      <p className={status() === 'loading' ? 'dim' : 'dim hidden'}>Checking the latest release…</p>

      {/* A release with downloadable assets: the visitor's build(s) first. */}
      <div className={status() === 'ready' && hasDownloads() ? 'dl-ready' : 'dl-ready hidden'}>
        <ul className={primary().length > 0 ? 'rows dl-primary' : 'rows dl-primary hidden'} role="list">
          {/* @client */ primary().map((pick) => (
            <li key={pick.asset.name} className="row">
              <a className="row-link" href={pick.asset.browser_download_url} data-primary-download>
                <span className="row-title">Download for {PLATFORM_LABEL[pick.platform]}</span>
                <span className="row-meta">{ARCH_LABEL[pick.arch] || pick.kind} · {pick.kind} · {formatSize(pick.asset.size)}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className={primary().length === 0 ? 'dim' : 'dim hidden'}>
          No {PLATFORM_LABEL[platform()]} build in this release.
        </p>
        <p className="dl-meta">
          <span data-version>{version()}</span>
          <span className={publishedOn() ? '' : 'hidden'}> · {publishedOn()}</span>
          {' · '}
          <a href={release()?.html_url ?? RELEASES_URL}>release notes</a>
          {' · '}
          <button type="button" className="linkish" onClick={() => setShowAll(!showAll())} aria-expanded={showAll()} data-toggle-all>
            {showAll() ? 'hide other downloads' : 'other downloads'}
          </button>
        </p>
        <div className={showAll() ? 'dl-groups' : 'dl-groups hidden'}>
          {/* @client */ groups().map((group) => (
            <div key={group.platform} className="dl-group">
              <h4>{PLATFORM_LABEL[group.platform]}</h4>
              <ul className="rows" role="list">
                {/* @client */ group.assets.map((item) => (
                  <li key={item.asset.name} className="row">
                    <a className="row-link" href={item.asset.browser_download_url}>
                      <span className="row-title">{item.asset.name}</span>
                      <span className="row-meta">{formatSize(item.asset.size)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* No release yet, no assets on it, or the API couldn't be reached. */}
      <div className={status() === 'loading' || (status() === 'ready' && hasDownloads()) ? 'dl-fallback hidden' : 'dl-fallback'}>
        <ul className="rows" role="list">
          <li className="row">
            <a className="row-link" href={RELEASES_URL}>
              <span className="row-title">Releases on GitHub</span>
              <span className="row-meta" data-fallback-note>
                {status() === 'ready'
                  ? `No packaged download in ${version()} yet.`
                  : 'No packaged download yet.'}
              </span>
            </a>
          </li>
        </ul>
      </div>
    </div>
  )
}
