// The deck header's variant switcher (deck.md <-> deck.ja.md <-> ...):
// which decks it offers and what it labels them. Which files count as
// variants is decided Rust-side (`src-tauri/src/deck_variants.rs`); this
// module only projects that list into what the header renders.

/** One entry of `list_deck_variants`' result (`DeckVariantPayload` in
 * peitho.rs). */
export interface DeckVariant {
  path: string
  fileName: string
  /** `null` for the unsuffixed `<base>.md`. */
  suffix: string | null
  isCurrent: boolean
}

export interface VariantOption {
  path: string
  label: string
  /** The file name, shown under the label — `null` when it would just
   * repeat the label. */
  detail: string | null
  isCurrent: boolean
}

/** `hidden` whenever there's nothing to switch to, so the header never
 * renders an empty or single-entry menu. */
export type VariantSwitcher =
  | { kind: 'hidden' }
  | { kind: 'shown'; currentLabel: string; options: readonly VariantOption[] }

/** The suffix as-is (`ja`, `en-US`), or the file name for the unsuffixed
 * deck — which has no suffix to show. A blank suffix falls back the same
 * way rather than rendering an invisible label. */
export function variantLabel(variant: DeckVariant): string {
  return variant.suffix !== null && variant.suffix.trim() !== '' ? variant.suffix : variant.fileName
}

function toOption(variant: DeckVariant): VariantOption {
  const label = variantLabel(variant)
  return {
    path: variant.path,
    label,
    detail: label === variant.fileName ? null : variant.fileName,
    isCurrent: variant.isCurrent,
  }
}

/** Shown only when the list has exactly one current deck and at least one
 * other to switch to. A list with no current entry (or several) can't say
 * which deck this window is showing, so it's hidden rather than guessed. */
export function toVariantSwitcher(variants: readonly DeckVariant[]): VariantSwitcher {
  const current = variants.filter(variant => variant.isCurrent)
  if (current.length !== 1 || variants.length < 2) return { kind: 'hidden' }
  return { kind: 'shown', currentLabel: variantLabel(current[0]), options: variants.map(toOption) }
}

// Flat projections for `DeckHeader`'s props, which keeps the switcher
// permanently mounted and toggles a `hidden` class instead of branching on
// `kind` (see the comment on its JSX for why).

/** The switcher button's text — empty while hidden. */
export function currentVariantLabelOf(switcher: VariantSwitcher): string {
  return switcher.kind === 'shown' ? switcher.currentLabel : ''
}

/** The menu's entries — none while hidden. */
export function variantOptionsOf(switcher: VariantSwitcher): readonly VariantOption[] {
  return switcher.kind === 'shown' ? switcher.options : []
}
