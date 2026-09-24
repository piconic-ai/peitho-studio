// Typed boundary for what vim mode in the slide editors needs from the OS:
// the keyboard input source (src-tauri/src/input_source.rs) and the system
// clipboard (tauri-plugin-clipboard-manager).
import { invoke } from '@tauri-apps/api/core'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'

export interface EditorIpc {
  /** Switches the OS input source to an ASCII one (e.g. "ABC"), so vim's
   * normal-mode keys aren't taken by a Japanese input method. Does nothing
   * outside macOS. */
  selectAsciiInputSource(): Promise<void>
  /** The OS clipboard's text, or `null` when it holds none (empty, or an
   * image). */
  readClipboardText(): Promise<string | null>
  writeClipboardText(text: string): Promise<void>
}

export function createTauriEditorIpc(): EditorIpc {
  return {
    selectAsciiInputSource: () => invoke('select_ascii_input_source'),
    // The plugin rejects when the clipboard holds no text, which here just
    // means there is nothing to put.
    readClipboardText: async () => {
      try {
        return await readText()
      } catch {
        return null
      }
    },
    writeClipboardText: text => writeText(text),
  }
}
