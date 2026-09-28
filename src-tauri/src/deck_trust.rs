//! Which deck folders the user has chosen to trust with running scripts.
//! An untrusted deck is shown with its layout `<script>`s and HTML event
//! handlers stripped (see `dom/slideSanitizer.ts` in the frontend); the
//! user trusts it from the banner that appears, and that choice is kept in
//! a JSON list of folders under the app's data directory — Rust-side, so a
//! deck's own script can't add its folder to it (`update_settings` would
//! let it). See `todo/deck-script-trust.md`.
//!
//! Trust is per folder, not per file: a folder's decks (`deck.md`,
//! `deck.ja.md`, ...) share its `layouts/`, which is where scripts live.
//! Folders are compared by canonical path, so a symlink or a trailing
//! slash doesn't make the same folder look untrusted.
//!
//! Everything here takes plain paths — the caller (`peitho.rs`) resolves
//! where the list lives from its `AppHandle` and serializes access to it.

use std::path::{Path, PathBuf};

/// The form `dir` is stored and compared in: its canonical path, or `dir`
/// as given when it can't be canonicalized (it no longer exists) but is at
/// least absolute. `None` for an empty or relative path that doesn't
/// resolve — such a path means nothing once the working directory changes,
/// so it is never stored or matched.
pub fn trust_key(dir: &Path) -> Option<PathBuf> {
    if dir.as_os_str().is_empty() {
        return None;
    }
    match std::fs::canonicalize(dir) {
        Ok(canonical) => Some(canonical),
        Err(_) if dir.is_absolute() => Some(dir.to_path_buf()),
        Err(_) => None,
    }
}

/// The stored list, read from the file's JSON text. Anything that isn't a
/// JSON array of strings (a truncated write, a hand edit gone wrong) reads
/// as "nothing trusted" — failing closed, never trusting by accident.
pub fn parse_trusted_dirs(json: &str) -> Vec<String> {
    serde_json::from_str(json).unwrap_or_default()
}

/// Whether `dir` is one of the `trusted` folders.
pub fn is_trusted(trusted: &[String], dir: &Path) -> bool {
    trust_key(dir).is_some_and(|key| contains_key(trusted, &key))
}

fn contains_key(trusted: &[String], key: &Path) -> bool {
    trusted.iter().any(|entry| Path::new(entry) == key)
}

/// `trusted` with `dir` added, unless it's already there (or has no
/// usable key — see `trust_key`).
pub fn with_trusted(mut trusted: Vec<String>, dir: &Path) -> Vec<String> {
    if let Some(key) = trust_key(dir) {
        if !contains_key(&trusted, &key) {
            trusted.push(key.display().to_string());
        }
    }
    trusted
}

/// The list stored in `file` — empty when the file doesn't exist yet or
/// can't be read.
pub fn read_trusted_dirs(file: &Path) -> Vec<String> {
    std::fs::read_to_string(file).map(|json| parse_trusted_dirs(&json)).unwrap_or_default()
}

/// Adds `dir` to the list stored in `file`.
pub fn add_trusted_dir(file: &Path, dir: &Path) -> Result<(), String> {
    let json = serde_json::to_string(&with_trusted(read_trusted_dirs(file), dir)).map_err(|err| err.to_string())?;
    std::fs::write(file, json).map_err(|err| format!("failed to write {}: {err}", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canonical(path: &Path) -> String {
        std::fs::canonicalize(path).unwrap().display().to_string()
    }

    #[test]
    fn is_trusted_spec_a_listed_folder_is_trusted() {
        let dir = tempfile::tempdir().unwrap();
        assert!(is_trusted(&[canonical(dir.path())], dir.path()));
    }

    #[test]
    fn is_trusted_spec_an_unlisted_folder_is_not_trusted() {
        let listed = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        assert!(!is_trusted(&[canonical(listed.path())], other.path()));
    }

    #[test]
    fn is_trusted_adversarial_the_same_folder_through_a_symlink_is_trusted() {
        let root = tempfile::tempdir().unwrap();
        let real = root.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let link = root.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        assert!(is_trusted(&[canonical(&real)], &link));
    }

    #[test]
    fn is_trusted_adversarial_a_trailing_slash_is_the_same_folder() {
        let dir = tempfile::tempdir().unwrap();
        let with_slash = PathBuf::from(format!("{}/", dir.path().display()));
        assert!(is_trusted(&[canonical(dir.path())], &with_slash));
    }

    #[test]
    fn is_trusted_adversarial_a_parent_or_child_of_a_trusted_folder_is_not_trusted() {
        let parent = tempfile::tempdir().unwrap();
        let child = parent.path().join("child");
        std::fs::create_dir(&child).unwrap();

        assert!(!is_trusted(&[canonical(parent.path())], &child));
        assert!(!is_trusted(&[canonical(&child)], parent.path()));
    }

    #[test]
    fn is_trusted_adversarial_an_empty_list_trusts_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_trusted(&[], dir.path()));
    }

    #[test]
    fn is_trusted_adversarial_an_empty_path_is_never_trusted() {
        assert!(!is_trusted(&[String::new()], Path::new("")));
    }

    #[test]
    fn is_trusted_adversarial_a_missing_absolute_folder_still_compares_by_its_path() {
        let missing = Path::new("/no/such/peitho/deck/folder");
        assert!(is_trusted(&[missing.display().to_string()], missing));
        assert!(!is_trusted(&["/no/such/other".to_string()], missing));
    }

    #[test]
    fn with_trusted_spec_adds_the_folder_by_its_canonical_path() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(with_trusted(Vec::new(), dir.path()), vec![canonical(dir.path())]);
    }

    #[test]
    fn with_trusted_adversarial_does_not_add_the_same_folder_twice() {
        let root = tempfile::tempdir().unwrap();
        let real = root.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let link = root.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let once = with_trusted(Vec::new(), &real);
        assert_eq!(with_trusted(once.clone(), &link), once);
        assert_eq!(with_trusted(once.clone(), &real), once);
    }

    #[test]
    fn with_trusted_adversarial_a_relative_missing_path_is_not_added() {
        assert_eq!(with_trusted(Vec::new(), Path::new("no-such-relative-folder")), Vec::<String>::new());
        assert_eq!(with_trusted(Vec::new(), Path::new("")), Vec::<String>::new());
    }

    #[test]
    fn parse_trusted_dirs_spec_reads_a_json_array_of_paths() {
        assert_eq!(parse_trusted_dirs(r#"["/a","/b"]"#), vec!["/a".to_string(), "/b".to_string()]);
    }

    #[test]
    fn parse_trusted_dirs_adversarial_broken_or_wrong_shaped_json_trusts_nothing() {
        for json in ["", "not json", "[\"/a\"", "{\"dirs\":[\"/a\"]}", "[1,2]", "null", "\"/a\""] {
            assert_eq!(parse_trusted_dirs(json), Vec::<String>::new(), "input: {json:?}");
        }
    }

    #[test]
    fn add_trusted_dir_spec_persists_the_folder_across_reads() {
        let data = tempfile::tempdir().unwrap();
        let file = data.path().join("trusted_deck_dirs.json");
        let deck = tempfile::tempdir().unwrap();

        add_trusted_dir(&file, deck.path()).unwrap();
        add_trusted_dir(&file, deck.path()).unwrap();

        let stored = read_trusted_dirs(&file);
        assert_eq!(stored, vec![canonical(deck.path())]);
        assert!(is_trusted(&stored, deck.path()));
    }

    #[test]
    fn add_trusted_dir_adversarial_a_broken_file_is_replaced_rather_than_failing() {
        let data = tempfile::tempdir().unwrap();
        let file = data.path().join("trusted_deck_dirs.json");
        std::fs::write(&file, "{broken").unwrap();
        let deck = tempfile::tempdir().unwrap();

        add_trusted_dir(&file, deck.path()).unwrap();
        assert_eq!(read_trusted_dirs(&file), vec![canonical(deck.path())]);
    }

    #[test]
    fn read_trusted_dirs_adversarial_a_missing_file_trusts_nothing() {
        let data = tempfile::tempdir().unwrap();
        assert_eq!(read_trusted_dirs(&data.path().join("absent.json")), Vec::<String>::new());
    }
}
