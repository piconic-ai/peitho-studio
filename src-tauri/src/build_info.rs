//! The Build and Commit the About window shows, as `build.rs` decides them.
//!
//! Pure, and shared by file: `build.rs` includes this file with `#[path]`
//! to compute `PEITHO_STUDIO_BUILD`/`PEITHO_STUDIO_COMMIT`, and the crate
//! compiles it only under `cfg(test)`, for these tests.

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
}
