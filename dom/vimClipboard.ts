// Keeps vim's unnamed register and the OS clipboard in step while vim mode
// is on, like Vim's `clipboard=unnamed`: a yank (or delete) lands on the OS
// clipboard, and text copied in another app is what `p` puts.
//
// The vim engine reads its registers synchronously when `p` runs, while the
// OS clipboard can only be read asynchronously. So the clipboard is read
// ahead of time instead, whenever it may have changed: when the window or
// an editor takes focus (back from another app), and after a copy or cut
// inside this window. The register is global to the page, shared by the
// body and the notes editors (and every editor in this window).
//
// What to write or load is decided in `domain/vimMode.ts`; this only moves
// text between the vim engine and the clipboard access it's handed.

import { Vim } from '@replit/codemirror-vim'
import {
  INITIAL_CLIPBOARD_MIRROR,
  afterClipboardRead,
  afterVimCommand,
  clipboardReadToken,
  type ClipboardMirror,
} from '../domain/vimMode'

export interface ClipboardAccess {
  /** The clipboard's text, `null` when it holds none. */
  readText(): Promise<string | null>
  writeText(text: string): Promise<void>
}

export interface VimClipboardBridge {
  /** Call after every vim command: writes a new yank to the clipboard. */
  pushRegister(): void
  /** Reads the clipboard into the unnamed register when it holds new text. */
  pullClipboard(): void
}

export function createVimClipboardBridge(clipboard: ClipboardAccess): VimClipboardBridge {
  let mirror: ClipboardMirror = INITIAL_CLIPBOARD_MIRROR
  const unnamedRegister = () => Vim.getRegisterController().unnamedRegister

  return {
    pushRegister() {
      const step = afterVimCommand(mirror, unnamedRegister().toString())
      mirror = step.mirror
      if (step.write !== null) {
        // Best effort: a failed write leaves the yank in vim's own register,
        // where `p` in this window still finds it.
        clipboard.writeText(step.write).catch(() => {})
      }
    },
    pullClipboard() {
      const token = clipboardReadToken(mirror)
      clipboard.readText().then(text => {
        const step = afterClipboardRead(mirror, token, text)
        mirror = step.mirror
        if (step.load !== null) unnamedRegister().setText(step.load.text, step.load.linewise)
      }, () => {})
    },
  }
}

/** Calls `onChange` whenever the OS clipboard may have changed under this
 * window: the window taking focus, and a copy or cut in it. Returns the
 * unsubscribe. */
export function onClipboardMayHaveChanged(onChange: () => void): () => void {
  // A `copy`/`cut` event fires before the webview writes the clipboard, so
  // the read waits for that write.
  const afterCopy = () => { setTimeout(onChange, 0) }
  window.addEventListener('focus', onChange)
  document.addEventListener('copy', afterCopy)
  document.addEventListener('cut', afterCopy)
  return () => {
    window.removeEventListener('focus', onChange)
    document.removeEventListener('copy', afterCopy)
    document.removeEventListener('cut', afterCopy)
  }
}
