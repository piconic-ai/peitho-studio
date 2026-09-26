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
  tauri_build::try_build(tauri_build::Attributes::new().capabilities_path_pattern(pattern))
    .expect("failed to run tauri-build");
}
