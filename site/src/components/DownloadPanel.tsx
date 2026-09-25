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
import { RELEASES_URL, fetchLatestRelease, type Release } from '../lib/latestRelease'

// `loading` → `ready` when the latest release (with or without assets) was
// fetched; `unavailable` when the API said no (404 while no release exists
// yet, rate limit, offline). The unavailable branch still links the
// Releases page, so a visitor is never left without a way to download.
type Status = 'loading' | 'ready' | 'unavailable'

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

export interface DownloadPanelProps {
  /** `button`: the hero's call to action. `list`: every build, as an
   * accordion with one entry per platform. */
  part: 'button' | 'list'
}

export function DownloadPanel(props: DownloadPanelProps) {
  const [status, setStatus] = createSignal<Status>('loading')
  const [release, setRelease] = createSignal<Release | null>(null)
  const [platform, setPlatform] = createSignal<Platform>('unknown')
  const [arch, setArch] = createSignal<Arch>('unknown')

  const assets = createMemo<ReleaseAsset[]>(() => release()?.assets ?? [])
  const primary = createMemo<ClassifiedAsset[]>(() => recommendedAssets(assets(), platform(), arch()))
  const groups = createMemo(() => groupByPlatform(assets()))
  const hasDownloads = createMemo(() => groups().length > 0)
  // Nothing to put on the button: an unrecognised platform (a phone) or no
  // build for this one. The hero then points at the full list instead.
  const noPick = createMemo(() => primary().length === 0)
  const version = createMemo(() => release()?.tag_name ?? '')
  const publishedOn = createMemo(() => {
    const iso = release()?.published_at
    return iso ? new Date(iso).toISOString().slice(0, 10) : ''
  })
  const ready = createMemo(() => status() === 'ready' && hasDownloads())
  const empty = createMemo(() => status() === 'unavailable' || (status() === 'ready' && !hasDownloads()))

  onMount(() => {
    setPlatform(detectPlatform(navigator.userAgent))
    void readArch().then(setArch)
    void fetchLatestRelease().then((r) => {
      setRelease(r)
      setStatus(r ? 'ready' : 'unavailable')
    })
  })

  return (
    <div className={props.part === 'button' ? 'dl dl-button' : 'dl dl-list'} data-status={status()} aria-busy={status() === 'loading'}>
      {/* ---- hero button ---- */}
      <div className={props.part === 'button' ? '' : 'hidden'}>
        {/* Same footprint as the real button, so the hero doesn't jump. */}
        <div className={status() === 'loading' ? 'dl-primary' : 'dl-primary hidden'}>
          <span className="btn btn-big is-loading" aria-hidden="true">Download</span>
          <span className="sr-only">Checking the latest release…</span>
        </div>
        <div className={ready() && !noPick() ? 'dl-primary' : 'dl-primary hidden'}>
          {/* @client */ primary().map((pick) => (
            <a key={pick.asset.name} className="btn btn-big" href={pick.asset.browser_download_url} data-primary-download>
              <span>Download for {PLATFORM_LABEL[pick.platform]}</span>
              <small>{ARCH_LABEL[pick.arch] || pick.kind} · {formatSize(pick.asset.size)}</small>
            </a>
          ))}
        </div>
        <div className={ready() && noPick() ? 'dl-primary' : 'dl-primary hidden'}>
          <a className="btn btn-big" href="#download" data-see-all>
            <span>Download</span>
            <small data-no-pick>
              {platform() === 'unknown' ? 'Choose your platform' : `No ${PLATFORM_LABEL[platform()]} build yet`}
            </small>
          </a>
        </div>
        <div className={empty() ? 'dl-primary' : 'dl-primary hidden'}>
          <a className="btn btn-big" href={RELEASES_URL} data-fallback>
            <span>Download from GitHub</span>
            <small data-fallback-note>
              {status() === 'ready' ? `No packaged build in ${version()} yet` : 'Releases page'}
            </small>
          </a>
        </div>
        <p className={ready() ? 'dl-meta' : 'dl-meta hidden'}>
          <span data-version>{version()}</span>
          <span className={publishedOn() ? '' : 'hidden'}> · {publishedOn()}</span>
          {' · '}
          <a href="#download">All downloads</a>
          {' · '}
          <a href={release()?.html_url ?? RELEASES_URL}>Release notes</a>
        </p>
      </div>

      {/* ---- every build, as an accordion ---- */}
      <div className={props.part === 'list' ? '' : 'hidden'}>
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
          No packaged build yet. New builds appear on <a href={RELEASES_URL}>GitHub Releases</a>.
        </p>
      </div>
    </div>
  )
}
