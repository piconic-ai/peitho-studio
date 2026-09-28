//! The Build and Commit the About window shows, as `build.rs` decides them.
//!
//! Pure, and shared by file: `build.rs` includes this file with `#[path]`
//! to compute `PEITHO_STUDIO_BUILD`/`PEITHO_STUDIO_COMMIT`, and the crate
//! compiles it only under `cfg(test)`, for these tests.

use std::path::{Path, PathBuf};

/// What the Build row says when the build didn't come from CI.
pub const LOCAL_BUILD_LABEL: &str = "dev";

/// The Build label: the CI run number (`GITHUB_RUN_NUMBER`) when there is
/// one, `dev` otherwise (a local build, or an empty/blank variable).
pub fn build_label(run_number: Option<&str>) -> String {
    match run_number.map(str::trim) {
        Some(n) if !n.is_empty() => n.to_string(),
        _ => LOCAL_BUILD_LABEL.to_string(),
    }
}

/// The commit SHA out of `git rev-parse HEAD`'s output, or empty when the
/// output isn't one (git failed, printed an error, or isn't a repository).
/// Accepts SHA-1 (40) and SHA-256 (64) object names, lowercased.
pub fn commit_sha(git_output: &str) -> String {
    let sha = git_output.trim().to_ascii_lowercase();
    let is_sha = matches!(sha.len(), 40 | 64) && sha.bytes().all(|b| b.is_ascii_hexdigit());
    if is_sha {
        sha
    } else {
        String::new()
    }
}

/// What to hand cargo's `rerun-if-changed` so a new commit on the branch
/// re-runs the build script: `ref_file` (`refs/heads/<branch>`) itself if
/// it exists, else its nearest existing folder inside `refs_root`. After a
/// `git gc` the branch lives only in `packed-refs` with no loose file, and
/// the next commit creates one — watching the folder catches that. Never
/// climbs above `refs_root` (a watched `.git` would re-run on every index
/// change), and a missing path is never returned (cargo treats one as
/// always changed). `exists` is the filesystem check, passed in to keep
/// this pure.
pub fn ref_rerun_target(ref_file: &Path, refs_root: &Path, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    ref_file.ancestors().take_while(|path| path.starts_with(refs_root)).find(|path| exists(path)).map(Path::to_path_buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "5995c42a1b2c3d4e5f60718293a4b5c6d7e8f901";

    #[test]
    fn given_a_ci_run_number_when_labelled_then_the_build_is_that_number() {
        assert_eq!(build_label(Some("42")), "42");
    }

    #[test]
    fn given_no_ci_run_number_when_labelled_then_the_build_is_dev() {
        assert_eq!(build_label(None), "dev");
    }

    #[test]
    fn given_a_blank_run_number_when_labelled_then_the_build_is_dev() {
        for blank in ["", " ", "\n\t"] {
            assert_eq!(build_label(Some(blank)), "dev", "{blank:?}");
        }
        assert_eq!(build_label(Some(" 7\n")), "7");
    }

    #[test]
    fn given_git_printing_a_sha_when_read_then_that_sha_is_the_commit() {
        assert_eq!(commit_sha(&format!("{SHA}\n")), SHA);
        assert_eq!(commit_sha(&SHA.to_ascii_uppercase()), SHA);
        let sha256 = "a".repeat(64);
        assert_eq!(commit_sha(&sha256), sha256);
    }

    #[test]
    fn given_git_printing_anything_else_when_read_then_there_is_no_commit() {
        for output in [
            "",
            "\n",
            "fatal: not a git repository (or any of the parent directories): .git",
            "HEAD",
            &SHA[..39],
            &format!("{SHA}0"),
            &format!("{}g", &SHA[..39]),
            &format!("{SHA}\n{SHA}"),
        ] {
            assert_eq!(commit_sha(output), "", "{output:?}");
        }
    }

    fn existing(paths: &'static [&'static str]) -> impl Fn(&Path) -> bool {
        move |path| paths.iter().any(|p| Path::new(p) == path)
    }

    #[test]
    fn ref_rerun_target_spec_watches_the_loose_ref_file_when_it_exists() {
        let target = ref_rerun_target(Path::new("/r/.git/refs/heads/main"), Path::new("/r/.git/refs"), existing(&["/r/.git/refs/heads/main", "/r/.git/refs/heads"]));
        assert_eq!(target, Some(PathBuf::from("/r/.git/refs/heads/main")));
    }

    #[test]
    fn ref_rerun_target_adversarial_a_packed_only_branch_watches_its_folder() {
        let target = ref_rerun_target(Path::new("/r/.git/refs/heads/main"), Path::new("/r/.git/refs"), existing(&["/r/.git/refs/heads"]));
        assert_eq!(target, Some(PathBuf::from("/r/.git/refs/heads")));
    }

    #[test]
    fn ref_rerun_target_adversarial_a_nested_branch_name_climbs_to_the_nearest_existing_folder() {
        let target = ref_rerun_target(Path::new("/r/.git/refs/heads/feat/x"), Path::new("/r/.git/refs"), existing(&["/r/.git/refs/heads", "/r/.git/refs"]));
        assert_eq!(target, Some(PathBuf::from("/r/.git/refs/heads")));
    }

    #[test]
    fn ref_rerun_target_adversarial_never_climbs_above_the_refs_root() {
        let target = ref_rerun_target(Path::new("/r/.git/refs/heads/main"), Path::new("/r/.git/refs"), existing(&["/r/.git", "/r"]));
        assert_eq!(target, None);
    }

    #[test]
    fn ref_rerun_target_adversarial_a_ref_outside_the_root_is_none() {
        let target = ref_rerun_target(Path::new("/elsewhere/refs/heads/main"), Path::new("/r/.git/refs"), existing(&["/elsewhere/refs/heads/main"]));
        assert_eq!(target, None);
    }

    #[test]
    fn ref_rerun_target_adversarial_empty_paths_are_none() {
        assert_eq!(ref_rerun_target(Path::new(""), Path::new("/r/.git/refs"), existing(&[""])), None);
    }
}
