// Fetch release metadata once per page load for the download list. Keep the
// cache outside components, whose top-level functions are copied per instance.
import type { ReleaseAsset } from '../domain/releases'

export const REPO = 'piconic-ai/peitho-studio'
export const RELEASES_URL = `https://github.com/${REPO}/releases`
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`

export interface Release {
  tag_name: string
  html_url: string
  published_at: string
  assets: ReleaseAsset[]
}

let latest: Promise<Release | null> | undefined

/** Resolves to `null` when there is no release yet (404), GitHub refuses
 * (rate limit), or the network fails — callers then link the Releases page. */
export function fetchLatestRelease(): Promise<Release | null> {
  latest ??= (async () => {
    try {
      const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
      if (!res.ok) return null
      return (await res.json()) as Release
    } catch {
      return null
    }
  })()
  return latest
}
