use std::path::{Path, PathBuf};
use std::process::Command;

#[path = "src/build_info.rs"]
mod build_info;

fn main() {
  // `capabilities/e2e/*` grants `playwright:default`, which only resolves
  // (tauri-build validates every listed permission against the plugins
  // actually linked in) when `tauri-plugin-playwright` is — i.e. only in a
  // `--features e2e-testing` build. Scanning that directory in a normal
  // build fails with "Permission playwright:default not found", so it's
  // only included in the capability glob when the feature is on; a normal
  // build's glob never reaches it, since `*` doesn't cross the `e2e/`
  // directory boundary.
  let pattern = if std::env::var_os("CARGO_FEATURE_E2E_TESTING").is_some() {
    "./capabilities/**/*"
  } else {
    "./capabilities/*.json"
  };
  // The engine's test fixtures run `cargo metadata --filter-platform` with
  // this: unfiltered, it wants every platform's dependencies downloaded
  // (Android's included), which `--offline` then fails on.
  println!("cargo:rustc-env=PEITHO_STUDIO_TARGET={}", std::env::var("TARGET").expect("cargo sets TARGET for build scripts"));
  embed_build_info();
  tauri_build::try_build(tauri_build::Attributes::new().capabilities_path_pattern(pattern))
    .expect("failed to run tauri-build");
}

/// The About window's Build and Commit (`about.rs`): the CI run number and
/// the checked-out commit. Neither failing is fatal — a build outside a
/// git checkout just shows no Commit.
fn embed_build_info() {
  println!("cargo:rerun-if-env-changed=GITHUB_RUN_NUMBER");
  let run_number = std::env::var("GITHUB_RUN_NUMBER").ok();
  println!("cargo:rustc-env=PEITHO_STUDIO_BUILD={}", build_info::build_label(run_number.as_deref()));
  let commit = git(&["rev-parse", "HEAD"]).map(|out| build_info::commit_sha(&out)).unwrap_or_default();
  println!("cargo:rustc-env=PEITHO_STUDIO_COMMIT={commit}");

  // Re-run when HEAD moves: a checkout changes `HEAD`, a commit changes the
  // branch's ref file (or `packed-refs`, or `reftable/` on that backend).
  // Only existing paths are listed — cargo treats a missing one as always
  // changed. A branch with no loose ref file yet is watched through its
  // folder (see `build_info::ref_rerun_target`).
  let mut watched = vec![git_path("HEAD"), git_path("packed-refs"), git_path("reftable")];
  if let (Some(branch), Some(refs_root)) = (git(&["symbolic-ref", "-q", "HEAD"]), git_path("refs")) {
    if let Some(ref_file) = git_path(branch.trim()) {
      watched.push(build_info::ref_rerun_target(&ref_file, &refs_root, Path::exists));
    }
  }
  for path in watched.into_iter().flatten().filter(|p| p.exists()) {
    println!("cargo:rerun-if-changed={}", path.display());
  }
}

/// `git <args>` run in this crate's directory: its stdout on success.
fn git(args: &[&str]) -> Option<String> {
  let dir = std::env::var("CARGO_MANIFEST_DIR").ok()?;
  let output = Command::new("git").arg("-C").arg(&dir).args(args).output().ok()?;
  output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Where `name` (`HEAD`, a ref) lives in the git directory, worktrees
/// included (a worktree's refs are in the main repository's directory).
fn git_path(name: &str) -> Option<PathBuf> {
  let out = git(&["rev-parse", "--git-path", name])?;
  let path = Path::new(out.trim());
  if path.as_os_str().is_empty() {
    return None;
  }
  // Relative to the directory `git` ran in (`--path-format=absolute` would
  // say so directly, but needs git 2.31+).
  Some(Path::new(&std::env::var("CARGO_MANIFEST_DIR").ok()?).join(path))
}
