// Pure rules for bringing images into a deck from the body editor: which
// dropped files are images Peitho can show, and what a pasted image is
// called. The files themselves are saved Rust-side
// (`src-tauri/src/engine/images.rs`), which checks the same extensions
// again and the bytes as well — this side only decides what to send and
// what to tell the user.

/** The extensions peitho-core accepts for a Markdown image (lowercase).
 * No SVG: peitho-core doesn't allow it as a Markdown image. */
export const IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp']

/** The last component of a path (`/a/b/photo.png` → `photo.png`), for
 * naming a file in a message. Either separator counts. */
export function fileNameOf(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] ?? ''
}

/** Whether the file at `path` is, by its extension (any case), an image
 * peitho-core can show. */
export function isImportableImagePath(path: string): boolean {
  const name = fileNameOf(path)
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())
}

/** Dropped paths split into the images to import and the rest, each in
 * the order dropped. */
export function partitionDroppedPaths(paths: readonly string[]): { images: string[]; rejected: string[] } {
  const images: string[] = []
  const rejected: string[] = []
  for (const path of paths) (isImportableImagePath(path) ? images : rejected).push(path)
  return { images, rejected }
}

/** The extension a pasted image of MIME type `mime` is saved with, or
 * `null` for an image type peitho-core can't show as is (a macOS
 * screenshot can come as `image/tiff`), which has to be converted to PNG
 * first. */
export function pastedImageExtension(mime: string): 'png' | 'jpg' | 'gif' | 'webp' | null {
  switch (mime.trim().toLowerCase()) {
    case 'image/png': return 'png'
    case 'image/jpeg':
    case 'image/jpg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    default: return null
  }
}

/** Whether a clipboard item of MIME type `mime` is an image at all (any
 * format — see `pastedImageExtension` for which need converting). */
export function isImageMime(mime: string): boolean {
  return /^image\/[^\s/]+$/i.test(mime.trim())
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** The name a pasted image is saved under — `screenshot-20260925-143012.png`
 * for one pasted at that local time — since a clipboard image has no name
 * of its own. An invalid date falls back to `screenshot.<ext>`. */
export function pastedImageName(at: Date, extension: string): string {
  if (Number.isNaN(at.getTime())) return `screenshot.${extension}`
  const date = `${pad(at.getFullYear(), 4)}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `screenshot-${date}-${time}.${extension}`
}
