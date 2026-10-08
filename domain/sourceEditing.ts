// The deck-source repair editor's state (todo/open-broken-deck.md): the
// slide editor shows a slide's body and notes only — the YAML frontmatter
// lies outside every slide's range, and a slide's page settings comment
// is stripped from its body (`extractPageComment`) — so an error in
// either (an unknown frontmatter key, a duplicate slide key) can't be
// fixed there. While the deck on disk doesn't build, the editor pane
// offers the whole `deck.md` as one text instead; this is that text's
// draft and what disk last held, as one ADT, with its transitions.

export type SourceEditing =
  | { kind: 'closed' }
  /** `draft` is what the editor shows; `saved` is what disk holds (as far
   * as the app knows) — the two differ while there is typing to save. */
  | { kind: 'open'; draft: string; saved: string }

export const SOURCE_EDITING_CLOSED: SourceEditing = { kind: 'closed' }

/** Opens the editor on `source` — the deck as the user sees it, the open
 * slide's unsaved draft included — with nothing to save yet. */
export function openSourceEditing(source: string): SourceEditing {
  return { kind: 'open', draft: source, saved: source }
}

/** The user typed: the draft is `text`. A closed editor stays closed (a
 * late `onChange` from an editor just hidden changes nothing). */
export function typeInSource(editing: SourceEditing, text: string): SourceEditing {
  return editing.kind === 'open' ? { ...editing, draft: text } : editing
}

/** Whether there is typing not yet on disk. */
export function isSourceDirty(editing: SourceEditing): boolean {
  return editing.kind === 'open' && editing.draft !== editing.saved
}

/** `text` was written to disk: a draft that moved on since stays dirty
 * against it and is saved next. */
export function sourceSaved(editing: SourceEditing, text: string): SourceEditing {
  return editing.kind === 'open' ? { ...editing, saved: text } : editing
}

/** Disk changed from outside (another editor, an agent) to `source`: an
 * editor with nothing to save follows it; one holding typing keeps the
 * typing, now dirty against the new disk state, so nothing typed is lost
 * and the next save decides. */
export function sourceReadFromDisk(editing: SourceEditing, source: string): SourceEditing {
  if (editing.kind !== 'open') return editing
  return isSourceDirty(editing) ? { ...editing, saved: source } : openSourceEditing(source)
}

/** Whether the pane offers the toggle at all: while the deck on disk
 * doesn't build (the repair is what the editor is for), and while the
 * editor is open (so it can always be left, even once the deck builds
 * again). */
export function sourceEditorOffered(editing: SourceEditing, deckBroken: boolean): boolean {
  return editing.kind === 'open' || deckBroken
}

/** Where the slide at `index` of the deck as it was split before the
 * editor's save (`textsBefore`, each slide's text) sits once the saved
 * deck is split again (`textsAfter`): still at `index` when the text
 * there is the same, else the one slide with that text — a whole-source
 * edit can move any slide. `null` when the save rewrote that slide, left
 * two alike, or `index` names no slide: selecting by number alone would
 * open some other slide, so the caller selects nothing. Texts are
 * compared trimmed, as the editor's own saves keep a slide's surrounding
 * blank lines but not always its exact count. */
export function slideIndexAfterSourceSave(index: number, textsBefore: readonly string[], textsAfter: readonly string[]): number | null {
  const text = textsBefore[index]?.trim()
  if (text === undefined) return null
  if (textsAfter[index]?.trim() === text) return index
  const matches = textsAfter.flatMap((candidate, i) => (candidate.trim() === text ? [i] : []))
  return matches.length === 1 ? matches[0] : null
}
