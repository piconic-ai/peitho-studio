// Typed boundary for bringing images into the open deck: the
// `import_deck_image_file`/`import_deck_image_bytes` commands
// (src-tauri/src/peitho.rs, saving through `engine::images`) and the
// window's file drops.
//
// A file dropped from Finder never reaches the page as an HTML5 `drop`:
// Tauri takes file drops itself (the window's `dragDropEnabled`, on by
// default) and reports them as paths through `onDragDropEvent` instead.
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { Point } from '../domain/geometry'
import type { Unsubscribe } from './deckIpc'

/** Files dropped on this window: their paths, and where from the webview's
 * top left, as Tauri reports it — see `dropPointToCss` for its units. */
export interface FileDrop {
  paths: string[]
  position: Point
}

export interface ImageIpc {
  createImageCanvas(content: string, baseLayout: string, count: number, placements: ImagePlacement[], removeSlots?: string[], carryLayout?: string, imageOrder?: string[]): Promise<{ layout: string; slots: string[] }>
  /** Copies the image file at `path` into the open deck's `img/` and
   * returns its deck-relative path (`img/photo.png`). Rejects a file that
   * isn't a PNG, JPEG, GIF or WebP image. */
  importImageFile(path: string): Promise<string>
  /** Saves `bytes`, an image called `name` (its extension says the
   * format), into the open deck's `img/` and returns its deck-relative
   * path. `name` must be ASCII: it travels in a header. */
  importImageBytes(name: string, bytes: Uint8Array): Promise<string>
  /** Fires when files are dropped anywhere on this window. */
  onFileDrop(callback: (drop: FileDrop) => void): Unsubscribe
}

export interface ImagePlacement { slot: string; x: number; y: number; width: number; height: number }

export function createTauriImageIpc(): ImageIpc {
  return {
    createImageCanvas: (content, baseLayout, count, placements, removeSlots = [], carryLayout, imageOrder) => invoke('create_image_canvas', { content, baseLayout, count, placements, removeSlots, carryLayout: carryLayout ?? null, imageOrder: imageOrder ?? null }),
    importImageFile: path => invoke('import_deck_image_file', { path }),
    importImageBytes: (name, bytes) => invoke('import_deck_image_bytes', bytes, { headers: { 'x-image-name': name } }),
    onFileDrop: callback => {
      const unlisten = getCurrentWebview().onDragDropEvent(event => {
        if (event.payload.type !== 'drop') return
        const { paths, position } = event.payload
        callback({ paths, position: { x: position.x, y: position.y } })
      })
      return () => { void unlisten.then(stop => { stop() }) }
    },
  }
}
