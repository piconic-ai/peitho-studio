//! Minimal in-process static server for what a rendered deck's HTML/CSS
//! references by relative URL: `peitho.css`, `theme-fonts/*`, `katex-fonts/*`
//! (only when the deck uses math), and `assets/<hash>-<name>` (resolved
//! images). Replaces fetching these from a `peitho preview` subprocess.
//!
//! The frontend renders slides into shadow roots, which have no
//! `<base href>` to resolve those relative URLs against, so it rewrites
//! them to absolute URLs under this server's base itself (see
//! `domain/slideCss.ts` and `domain/slideFragment.ts`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tiny_http::{Header, Response, Server};

use super::pipeline::RenderOutput;

pub struct AssetServer {
    pub base_url: String,
    state: Arc<Mutex<ServedState>>,
}

#[derive(Default)]
struct ServedState {
    css: String,
    has_math: bool,
    image_assets: HashMap<String, PathBuf>,
    fonts_dir: Option<PathBuf>,
    deck_dir: PathBuf,
}

impl AssetServer {
    pub fn start() -> std::io::Result<Self> {
        let server = Server::http("127.0.0.1:0")
            .map_err(|err| std::io::Error::other(format!("failed to bind asset server: {err}")))?;
        let port = match server.server_addr() {
            tiny_http::ListenAddr::IP(addr) => addr.port(),
            #[allow(unreachable_patterns)]
            _ => return Err(std::io::Error::other("unexpected listen address kind")),
        };
        let base_url = format!("http://127.0.0.1:{port}/");

        let state = Arc::new(Mutex::new(ServedState::default()));
        let worker_state = state.clone();
        std::thread::spawn(move || {
            for request in server.incoming_requests() {
                let response = respond(&worker_state, request.url());
                let _ = match response {
                    Ok((bytes, content_type)) => {
                        let header = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes())
                            .expect("static content-type header is valid ASCII");
                        request.respond(Response::from_data(bytes).with_header(header))
                    }
                    Err(status) => request.respond(Response::empty(status)),
                };
            }
        });

        Ok(Self { base_url, state })
    }

    pub fn update(&self, output: &RenderOutput) {
        if let Ok(mut state) = self.state.lock() {
            state.css = output.css.clone();
            state.has_math = output.has_math;
            state.image_assets = output.image_assets.clone();
            state.fonts_dir = output.fonts_dir.clone();
            state.deck_dir = output.deck_dir.clone();
        }
    }
}

fn respond(state: &Mutex<ServedState>, url: &str) -> Result<(Vec<u8>, &'static str), u16> {
    let path = url.split('?').next().unwrap_or(url).trim_start_matches('/');
    let state = state.lock().map_err(|_| 500u16)?;

    if path == "peitho.css" {
        return Ok((state.css.clone().into_bytes(), "text/css; charset=utf-8"));
    }

    if let Some(name) = path.strip_prefix("theme-fonts/") {
        if let Some(asset) = peitho_core::theme_fonts().iter().find(|a| a.file_name() == name) {
            return Ok((asset.bytes().to_vec(), font_content_type(name)));
        }
        return Err(404);
    }

    if let Some(name) = path.strip_prefix("katex-fonts/") {
        if state.has_math {
            let math = peitho_core::MathAssets::katex();
            if let Some(asset) = math.fonts().iter().find(|a| a.file_name() == name) {
                return Ok((asset.bytes().to_vec(), font_content_type(name)));
            }
        }
        return Err(404);
    }

    if let Some(name) = path.strip_prefix("fonts/") {
        if name.contains("..") {
            return Err(404);
        }
        if let Some(dir) = state.fonts_dir.as_ref() {
            let candidate = dir.join(name);
            if let Ok(bytes) = std::fs::read(&candidate) {
                return Ok((bytes, font_content_type(name)));
            }
        }
        return Err(404);
    }

    if let Some(name) = path.strip_prefix("assets/") {
        if let Some(source) = state.image_assets.get(name) {
            if let Ok(bytes) = std::fs::read(source) {
                return Ok((bytes, image_content_type(name)));
            }
            return Err(404);
        }
        // Not one of peitho-core's own resolved (markdown-referenced)
        // images — fall back to the deck's own `assets/` directory
        // verbatim, for a layout author's `<video>`/`<script src>` etc.
        // that reference a file there directly, never through markdown
        // image syntax (so peitho-core's asset discovery never counted
        // it in `image_assets` to begin with). Same path-escape guard as
        // `DraftImageResolver` (pipeline.rs): canonicalize and check
        // containment before reading, not just string-level `..`
        // rejection, which a symlink could route around.
        if state.deck_dir.as_os_str().is_empty() {
            return Err(404);
        }
        let Ok(deck_abs) = std::fs::canonicalize(&state.deck_dir) else { return Err(404) };
        let Ok(candidate_abs) = std::fs::canonicalize(deck_abs.join("assets").join(name)) else { return Err(404) };
        if !candidate_abs.starts_with(&deck_abs) {
            return Err(404);
        }
        return match std::fs::read(&candidate_abs) {
            Ok(bytes) => Ok((bytes, asset_content_type(name))),
            Err(_) => Err(404),
        };
    }

    Err(404)
}

fn font_content_type(name: &str) -> &'static str {
    if name.ends_with(".woff2") {
        "font/woff2"
    } else if name.ends_with(".woff") {
        "font/woff"
    } else {
        "application/octet-stream"
    }
}

fn image_content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Beyond `image_content_type`'s images: video (a layout's own
/// `<video>`/`<source>`) and JS (a layout's own `<script src>`). A
/// `type="module"` script in particular fails to load at all under an
/// incorrect MIME type — browsers enforce a strict JavaScript-MIME check
/// for those, unlike a classic script.
fn asset_content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "mjs" | "js" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        _ => image_content_type(name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn state_for(deck_dir: PathBuf, image_assets: HashMap<String, PathBuf>) -> Mutex<ServedState> {
        Mutex::new(ServedState { deck_dir, image_assets, ..ServedState::default() })
    }

    #[test]
    fn respond_spec_falls_back_to_the_deck_directorys_assets_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/deck.js"), b"console.log(1)").unwrap();
        let state = state_for(dir.path().to_path_buf(), HashMap::new());

        let (bytes, content_type) = respond(&state, "/assets/deck.js").unwrap();

        assert_eq!(bytes, b"console.log(1)");
        assert_eq!(content_type, "text/javascript; charset=utf-8");
    }

    #[test]
    fn respond_spec_video_and_json_get_their_own_content_type() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/hero.mp4"), b"fake video bytes").unwrap();
        std::fs::write(dir.path().join("assets/data.json"), b"{}").unwrap();
        let state = state_for(dir.path().to_path_buf(), HashMap::new());

        assert_eq!(respond(&state, "/assets/hero.mp4").unwrap().1, "video/mp4");
        assert_eq!(respond(&state, "/assets/data.json").unwrap().1, "application/json; charset=utf-8");
    }

    #[test]
    fn respond_spec_a_known_image_asset_is_still_read_from_its_own_resolved_path_first() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        // Deliberately absent from the deck's own assets/ dir — proves this
        // path came from `image_assets`, not the fallback.
        let resolved_source = dir.path().join("elsewhere.png");
        std::fs::write(&resolved_source, b"resolved bytes").unwrap();
        let state = state_for(dir.path().to_path_buf(), HashMap::from([("abc123-photo.png".to_string(), resolved_source)]));

        let (bytes, content_type) = respond(&state, "/assets/abc123-photo.png").unwrap();

        assert_eq!(bytes, b"resolved bytes");
        assert_eq!(content_type, "image/png");
    }

    #[test]
    fn respond_adversarial_a_name_only_present_in_image_assets_is_never_looked_up_in_the_fallback_dir() {
        // A name resolved by peitho-core but whose backing file went
        // missing must 404, not silently fall through to a same-named
        // file that happens to sit in the deck's own assets/ directory.
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/abc123-photo.png"), b"decoy").unwrap();
        let missing_source = dir.path().join("does-not-exist.png");
        let state = state_for(dir.path().to_path_buf(), HashMap::from([("abc123-photo.png".to_string(), missing_source)]));

        assert_eq!(respond(&state, "/assets/abc123-photo.png"), Err(404));
    }

    #[test]
    fn respond_adversarial_rejects_a_path_that_escapes_the_deck_directory() {
        let outer = tempfile::tempdir().unwrap();
        std::fs::write(outer.path().join("secret.txt"), b"nope").unwrap();
        let deck = tempfile::tempdir().unwrap();
        std::fs::create_dir(deck.path().join("assets")).unwrap();
        let state = state_for(deck.path().to_path_buf(), HashMap::new());

        assert_eq!(respond(&state, "/assets/../../secret.txt"), Err(404));
    }

    #[test]
    fn respond_adversarial_a_missing_file_under_a_real_assets_dir_is_404_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        let state = state_for(dir.path().to_path_buf(), HashMap::new());

        assert_eq!(respond(&state, "/assets/nope.js"), Err(404));
    }

    #[test]
    fn respond_adversarial_no_deck_dir_known_yet_is_404_not_a_panic() {
        let state = state_for(PathBuf::new(), HashMap::new());

        assert_eq!(respond(&state, "/assets/deck.js"), Err(404));
    }

    #[test]
    fn respond_adversarial_a_path_outside_assets_at_all_is_404() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_for(dir.path().to_path_buf(), HashMap::new());

        assert_eq!(respond(&state, "/not-an-asset-route"), Err(404));
    }
}
