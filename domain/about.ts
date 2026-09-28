// What the About window (`components/AboutScreen.tsx`) shows, as
// `get_about_info` (src-tauri/src/about.rs) hands it over, and the links it
// can ask Rust to open.

/** The app's name, version, and where this build came from. `commit` is
 * the full SHA, or empty when the build has none; `copyright` is empty
 * when none is set. */
export interface AboutInfo {
  name: string
  version: string
  build: string
  commit: string
  copyright: string
}

/** A link the About window can open — `AboutLink` in about.rs, which
 * builds the URL; the page never sends one. */
export type AboutLink = 'website' | 'github' | 'license' | 'commit'

/** What the window shows until `get_about_info` answers. */
export const EMPTY_ABOUT_INFO: AboutInfo = { name: 'Peitho Studio', version: '', build: '', commit: '', copyright: '' }

/** How many characters of a SHA the Commit row shows, like `git log
 * --oneline`. */
export const SHORT_COMMIT_LENGTH = 7

/** `get_about_info`'s answer as an `AboutInfo`: each field that isn't a
 * string reads as `EMPTY_ABOUT_INFO`'s, so a malformed answer blanks a row
 * rather than breaking the page. */
export function parseAboutInfo(raw: unknown): AboutInfo {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const field = (key: keyof AboutInfo): string => {
    const value = record[key]
    return typeof value === 'string' ? value : EMPTY_ABOUT_INFO[key]
  }
  return { name: field('name'), version: field('version'), build: field('build'), commit: field('commit'), copyright: field('copyright') }
}

/** The SHA as the Commit row shows it: its first `SHORT_COMMIT_LENGTH`
 * characters (all of a shorter one), with surrounding whitespace dropped. */
export function shortCommit(sha: string): string {
  return sha.trim().slice(0, SHORT_COMMIT_LENGTH)
}
