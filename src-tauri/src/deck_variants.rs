//! Detects a deck's "variants": sibling deck files in the same directory
//! that share its base name, e.g. a translated `deck.ja.md` next to
//! `deck.md`. Pure functions over file *names* only — listing the directory
//! is the caller's side effect (see `list_deck_variants` in `peitho.rs`), so
//! the grouping rules here are unit-testable without touching disk.
//!
//! A deck file name is `<base>.md` or `<base>.<suffix>.md`, where `<base>`
//! ends at the first `.`. Any suffix counts (not just ISO language codes)
//! and is shown to the user as-is. Every comparison is byte-for-byte:
//! `.md` must be lowercase, and `Deck.md` doesn't share `deck.md`'s base.

/// One file in a deck's variant group.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeckVariant {
    pub file_name: String,
    /// `None` for the unsuffixed `<base>.md` itself.
    pub suffix: Option<String>,
    /// Whether this is the file the group was computed for.
    pub is_current: bool,
}

/// A deck file name split into its base and optional suffix, or `None` if
/// `name` isn't a deck file name at all — not ending in `.md`, a hidden
/// dotfile (`.deck.md`), or a suffix with an empty/blank dot-separated
/// segment (`deck..md`, `deck.ja..md`, `deck. .md`), which could never be
/// shown as a meaningful label.
pub fn parse_deck_file_name(name: &str) -> Option<(&str, Option<&str>)> {
    let stem = name.strip_suffix(".md")?;
    if stem.is_empty() || stem.starts_with('.') {
        return None;
    }
    match stem.split_once('.') {
        None => Some((stem, None)),
        Some((base, suffix)) => {
            if suffix.split('.').any(|segment| segment.trim().is_empty()) {
                return None;
            }
            Some((base, Some(suffix)))
        }
    }
}

/// The variant group `current` belongs to among `sibling_names` (the
/// directory's file names): every deck file sharing `current`'s base,
/// deduplicated, unsuffixed file first, then by suffix. `current` itself is
/// always included, even if missing from `sibling_names`, so the caller can
/// rely on exactly one entry being `is_current`. Empty when `current` isn't
/// a deck file name — there is nothing to group it with.
pub fn group_deck_variants(current: &str, sibling_names: &[String]) -> Vec<DeckVariant> {
    let Some((current_base, _)) = parse_deck_file_name(current) else {
        return Vec::new();
    };

    let mut variants: Vec<DeckVariant> = std::iter::once(current)
        .chain(sibling_names.iter().map(String::as_str))
        .filter_map(|name| {
            let (base, suffix) = parse_deck_file_name(name)?;
            (base == current_base).then(|| DeckVariant {
                file_name: name.to_string(),
                suffix: suffix.map(str::to_string),
                is_current: name == current,
            })
        })
        .collect();
    variants.sort_by(|a, b| a.suffix.cmp(&b.suffix));
    variants.dedup_by(|a, b| a.file_name == b.file_name);
    variants
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn file_names(variants: &[DeckVariant]) -> Vec<&str> {
        variants.iter().map(|v| v.file_name.as_str()).collect()
    }

    #[test]
    fn parse_deck_file_name_spec_splits_base_and_suffix() {
        assert_eq!(parse_deck_file_name("deck.md"), Some(("deck", None)));
        assert_eq!(parse_deck_file_name("deck.ja.md"), Some(("deck", Some("ja"))));
        assert_eq!(parse_deck_file_name("deck.en-US.md"), Some(("deck", Some("en-US"))));
    }

    #[test]
    fn parse_deck_file_name_spec_base_ends_at_the_first_dot() {
        assert_eq!(parse_deck_file_name("deck.v2.ja.md"), Some(("deck", Some("v2.ja"))));
    }

    #[test]
    fn parse_deck_file_name_adversarial_rejects_non_md_extensions() {
        assert_eq!(parse_deck_file_name(""), None);
        assert_eq!(parse_deck_file_name("deck"), None);
        assert_eq!(parse_deck_file_name("deck.markdown"), None);
        assert_eq!(parse_deck_file_name("deck.md.bak"), None);
        assert_eq!(parse_deck_file_name("deck.MD"), None);
        assert_eq!(parse_deck_file_name("deck.Md"), None);
    }

    #[test]
    fn parse_deck_file_name_adversarial_rejects_an_empty_base() {
        assert_eq!(parse_deck_file_name(".md"), None);
        assert_eq!(parse_deck_file_name("..md"), None);
    }

    #[test]
    fn parse_deck_file_name_adversarial_rejects_hidden_files() {
        assert_eq!(parse_deck_file_name(".deck.md"), None);
        assert_eq!(parse_deck_file_name(".deck.ja.md"), None);
    }

    #[test]
    fn parse_deck_file_name_adversarial_rejects_empty_or_blank_suffix_segments() {
        assert_eq!(parse_deck_file_name("deck..md"), None);
        assert_eq!(parse_deck_file_name("deck..ja.md"), None);
        assert_eq!(parse_deck_file_name("deck.ja..md"), None);
        assert_eq!(parse_deck_file_name("deck. .md"), None);
    }

    #[test]
    fn parse_deck_file_name_adversarial_keeps_non_ascii_names_intact() {
        assert_eq!(parse_deck_file_name("発表.日本語.md"), Some(("発表", Some("日本語"))));
        assert_eq!(parse_deck_file_name("my talk.md"), Some(("my talk", None)));
    }

    #[test]
    fn group_deck_variants_spec_groups_translations_and_skips_unrelated_decks() {
        let variants = group_deck_variants("deck.md", &names(&["deck.md", "deck.ja.md", "deck.en.md", "deck-old.md", "notes.md"]));
        assert_eq!(
            variants,
            vec![
                DeckVariant { file_name: "deck.md".into(), suffix: None, is_current: true },
                DeckVariant { file_name: "deck.en.md".into(), suffix: Some("en".into()), is_current: false },
                DeckVariant { file_name: "deck.ja.md".into(), suffix: Some("ja".into()), is_current: false },
            ]
        );
    }

    #[test]
    fn group_deck_variants_spec_from_a_suffixed_deck_includes_the_unsuffixed_one() {
        let variants = group_deck_variants("deck.ja.md", &names(&["deck.ja.md", "deck.md", "deck.en.md"]));
        assert_eq!(file_names(&variants), vec!["deck.md", "deck.en.md", "deck.ja.md"]);
        let current: Vec<&str> = variants.iter().filter(|v| v.is_current).map(|v| v.file_name.as_str()).collect();
        assert_eq!(current, vec!["deck.ja.md"]);
    }

    #[test]
    fn group_deck_variants_spec_a_lone_deck_groups_only_with_itself() {
        let variants = group_deck_variants("deck.md", &names(&["deck.md", "other.md", "README.txt"]));
        assert_eq!(file_names(&variants), vec!["deck.md"]);
    }

    #[test]
    fn group_deck_variants_adversarial_current_is_included_even_if_not_listed() {
        let variants = group_deck_variants("deck.ja.md", &names(&["deck.md"]));
        assert_eq!(file_names(&variants), vec!["deck.md", "deck.ja.md"]);
        assert!(variants[1].is_current);
    }

    #[test]
    fn group_deck_variants_adversarial_duplicate_names_appear_once() {
        let variants = group_deck_variants("deck.md", &names(&["deck.md", "deck.ja.md", "deck.ja.md"]));
        assert_eq!(file_names(&variants), vec!["deck.md", "deck.ja.md"]);
    }

    #[test]
    fn group_deck_variants_adversarial_current_that_is_not_a_deck_file_yields_nothing() {
        let siblings = names(&["deck.md", "deck.ja.md"]);
        assert!(group_deck_variants("", &siblings).is_empty());
        assert!(group_deck_variants(".deck.md", &siblings).is_empty());
        assert!(group_deck_variants("deck.markdown", &siblings).is_empty());
    }

    #[test]
    fn group_deck_variants_adversarial_ignores_case_mismatches_hidden_files_and_other_extensions() {
        let siblings = names(&["deck.md", "Deck.ja.md", "DECK.md", ".deck.md", ".deck.ja.md", "deck.fr.markdown", "deck.de.MD", "deck..md"]);
        assert_eq!(file_names(&group_deck_variants("deck.md", &siblings)), vec!["deck.md"]);
    }

    #[test]
    fn group_deck_variants_adversarial_empty_sibling_list_still_returns_current() {
        assert_eq!(file_names(&group_deck_variants("deck.md", &[])), vec!["deck.md"]);
    }
}
