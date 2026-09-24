// Pure logic for vim mode in the slide body/notes editors
// (`dom/codeEditor.ts`, `dom/vimClipboard.ts`): which vim modes take
// command keys, and how vim's unnamed register and the OS clipboard are
// kept in step (`clipboard=unnamed`).

/** A vim mode, as `@replit/codemirror-vim`'s `vim-mode-change` names it. */
export type VimMode = 'normal' | 'insert' | 'visual' | 'replace'

const VIM_MODES: readonly VimMode[] = ['normal', 'insert', 'visual', 'replace']

/** The mode named by a `vim-mode-change` event's `mode`, or `null` for
 * anything else. */
export function parseVimMode(raw: unknown): VimMode | null {
  return typeof raw === 'string' && (VIM_MODES as readonly string[]).includes(raw) ? (raw as VimMode) : null
}

/** Whether keys typed in `mode` are commands (`dd`, `j`, `:`) rather than
 * text. In those modes a Japanese input method would take the keys into
 * its conversion, so the OS input source is switched to ASCII. */
export function takesCommandKeys(mode: VimMode): boolean {
  return mode === 'normal' || mode === 'visual'
}

/** What the unnamed register and the OS clipboard were last seen to agree
 * on, and a count of writes to the OS clipboard.
 *
 * `lastSynced` keeps a clipboard read from undoing a yank: the register is
 * loaded from the clipboard only when the clipboard holds something new.
 * `writes` tells a read that started before a later yank's write (both are
 * asynchronous) to drop its now stale answer. */
export interface ClipboardMirror {
  readonly lastSynced: string | null
  readonly writes: number
}

export const INITIAL_CLIPBOARD_MIRROR: ClipboardMirror = { lastSynced: null, writes: 0 }

/** Text for vim's unnamed register. */
export interface RegisterText {
  readonly text: string
  /** Put as whole lines (`p` opens a new line) rather than inside one. */
  readonly linewise: boolean
}

/** After a vim command, with the unnamed register holding `registerText`:
 * the text to write to the OS clipboard, or `null` when there is nothing
 * new (the command yanked or deleted nothing, or the register already
 * matches the clipboard). */
export function afterVimCommand(mirror: ClipboardMirror, registerText: string): { mirror: ClipboardMirror; write: string | null } {
  if (registerText === '' || registerText === mirror.lastSynced) return { mirror, write: null }
  return { mirror: { lastSynced: registerText, writes: mirror.writes + 1 }, write: registerText }
}

/** Identifies a clipboard read, for `afterClipboardRead`. */
export function clipboardReadToken(mirror: ClipboardMirror): number {
  return mirror.writes
}

/** A register's text read from the OS clipboard: whole lines when it ends
 * with a line break, as a line yanked with `yy` does. */
export function registerTextFromClipboard(text: string): RegisterText {
  return { text, linewise: /\n$/.test(text) }
}

/** After a clipboard read started with `token` answers `clipboardText`
 * (`null` when the clipboard holds no text): what to load into the unnamed
 * register, or `null` to leave it. A read that a yank overtook, an empty
 * clipboard, and text the register already holds all leave it. */
export function afterClipboardRead(
  mirror: ClipboardMirror,
  token: number,
  clipboardText: string | null,
): { mirror: ClipboardMirror; load: RegisterText | null } {
  if (token !== mirror.writes) return { mirror, load: null }
  if (clipboardText === null || clipboardText === '' || clipboardText === mirror.lastSynced) return { mirror, load: null }
  return { mirror: { ...mirror, lastSynced: clipboardText }, load: registerTextFromClipboard(clipboardText) }
}
