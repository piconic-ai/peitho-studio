// The DOM half of pasting an image into the body editor: finding the
// images on a `paste` event's clipboard data, and reading one into the
// bytes `import_deck_image_bytes` saves. Read synchronously from the paste
// event rather than through the async Clipboard API, which WebKit guards
// with a user-gesture check and a system "Paste" callout.

import { isImageMime, pastedImageExtension, pastedImageName } from '../domain/images'

/** The image files on `data` (a paste event's `clipboardData`), in order —
 * none when it holds only text, which the editor then pastes as usual. */
export function imageFilesOf(data: DataTransfer | null): File[] {
  if (data === null) return []
  const files: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !isImageMime(item.type)) continue
    const file = item.getAsFile()
    if (file !== null) files.push(file)
  }
  return files
}

/** A pasted image ready for `importImageBytes`. */
export interface PastedImage {
  name: string
  bytes: Uint8Array
}

/** `file`'s bytes, named for the moment `at` it was pasted. A format
 * peitho-core can't show (a macOS screenshot may come as TIFF) is redrawn
 * as a PNG first; rejects when the webview can't decode it. */
export async function readPastedImage(file: Blob, at: Date): Promise<PastedImage> {
  const extension = pastedImageExtension(file.type)
  if (extension !== null) return { name: pastedImageName(at, extension), bytes: new Uint8Array(await file.arrayBuffer()) }
  return { name: pastedImageName(at, 'png'), bytes: await redrawAsPng(file) }
}

async function redrawAsPng(file: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('could not convert the pasted image to PNG')
    context.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/png') })
    if (png === null) throw new Error('could not convert the pasted image to PNG')
    return new Uint8Array(await png.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
