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
                // The frontend (http://localhost:3003 in dev, a Tauri
                // asset: origin in prod) and this server (its own random
                // 127.0.0.1 port) are always different origins, so every
                // response needs CORS allowed on it — not just images/CSS,
                // which the browser never gate-keeps on Access-Control-
                // Allow-Origin for plain display, but a `<script
                // type="module" src="...">` load does: without this
                // header present, the module is refused outright instead
                // of executing (confirmed on-device — a layout's own
                // <script type="module" src="assets/...">` 200'd but
                // still never ran, until this was added). `*` is safe: no
                // credentials/cookies flow through this server, and it
                // only ever serves the currently-open deck's own public
                // assets.
                let cors_header = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..])
                    .expect("static CORS header is valid ASCII");
                let accept_ranges_header = Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..])
                    .expect("static Accept-Ranges header is valid ASCII");
                let _ = match response {
                    Ok((bytes, content_type)) => {
                        let header = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes())
                            .expect("static content-type header is valid ASCII");
                        // WebKit's <video> (unlike Chromium's) refuses to
                        // initialize playback at all — confirmed on-device,
                        // `networkState` stuck at `NETWORK_NO_SOURCE` —
                        // against a server that never honors a Range
                        // request, always returning the whole body with a
                        // plain 200. A cover layout's `autoplay` looping
                        // clip depends on this.
                        let range = request
                            .headers()
                            .iter()
                            .find(|candidate| candidate.field.equiv("Range"))
                            .and_then(|candidate| parse_range_header(candidate.value.as_str(), bytes.len()));
                        match range {
                            Some((start, end)) => {
                                let total = bytes.len();
                                let content_range = Header::from_bytes(
                                    &b"Content-Range"[..],
                                    format!("bytes {start}-{end}/{total}").into_bytes(),
                                )
                                .expect("computed Content-Range header is valid ASCII");
                                let slice = bytes[start..=end].to_vec();
                                request.respond(
                                    Response::from_data(slice)
                                        .with_status_code(206)
                                        .with_header(header)
                                        .with_header(cors_header)
                                        .with_header(accept_ranges_header)
                                        .with_header(content_range),
                                )
                            }
                            None => request.respond(
                                Response::from_data(bytes)
                                    .with_header(header)
                                    .with_header(cors_header)
                                    .with_header(accept_ranges_header),
                            ),
                        }
                    }
                    Err(status) => request.respond(Response::empty(status).with_header(cors_header)),
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

/// Parses a single-range `Range: bytes=...` request header (the only form
/// a `<video>` element ever sends) against a resource of `len` bytes, into
/// an inclusive `(start, end)` byte range. Anything this server isn't
/// prepared to honor exactly — a multi-range request (`bytes=0-1,2-3`), a
/// unit other than `bytes`, a malformed number, an inverted or
/// out-of-bounds range, an empty resource — returns `None` so the caller
/// falls back to an ordinary full-body response instead of guessing.
fn parse_range_header(value: &str, len: usize) -> Option<(usize, usize)> {
    if len == 0 {
        return None;
    }
    let spec = value.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start_str, end_str) = spec.split_once('-')?;
    let last = len - 1;
    let (start, end) = if start_str.is_empty() {
        // Suffix form: `bytes=-500` means "the last 500 bytes".
        let suffix_len: usize = end_str.parse().ok()?;
        if suffix_len == 0 {
            return None;
        }
        (last.saturating_sub(suffix_len.saturating_sub(1)), last)
    } else {
        let start: usize = start_str.parse().ok()?;
        let end = if end_str.is_empty() { last } else { end_str.parse().ok()? };
        (start, end)
    };
    if start > end || end > last {
        return None;
    }
    Some((start, end))
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

    /// Confirmed on a real device: a `<script type="module" src="...">`
    /// this server served with a plain 200 still refused to run, because
    /// the frontend (a different origin) never got an
    /// `Access-Control-Allow-Origin` header back. No HTTP client crate is
    /// a dependency here, so this speaks raw HTTP/1.1 over a `TcpStream`
    /// directly against the real, running `AssetServer` — every layer
    /// (`respond`'s dispatch AND whatever headers the request-handling
    /// thread actually attaches) has to be right for this to pass, unlike
    /// `respond()`'s own unit tests above, which stop at the body/content-
    /// type it returns and never see the response that reaches a client.
    #[test]
    fn asset_server_spec_every_response_allows_cross_origin_reads() {
        use std::io::{Read, Write};
        use std::net::TcpStream;

        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/mount.js"), b"console.log(1)").unwrap();

        let server = AssetServer::start().unwrap();
        server.update(&RenderOutput {
            manifest_json: String::new(),
            fragments: HashMap::new(),
            css: String::new(),
            has_math: false,
            image_assets: HashMap::new(),
            fonts_dir: None,
            deck_dir: dir.path().to_path_buf(),
        });
        let addr = server.base_url.trim_start_matches("http://").trim_end_matches('/').to_string();

        let get = |path: &str| -> String {
            let mut stream = TcpStream::connect(&addr).unwrap();
            write!(stream, "GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        };

        let found = get("/assets/mount.js");
        assert!(found.to_lowercase().contains("access-control-allow-origin: *"), "found response headers:\n{found}");

        let missing = get("/assets/does-not-exist.js");
        assert!(missing.starts_with("HTTP/1.1 404"), "missing response:\n{missing}");
        assert!(missing.to_lowercase().contains("access-control-allow-origin: *"), "missing response headers:\n{missing}");
    }

    #[test]
    fn parse_range_header_spec_a_bounded_range_is_parsed() {
        assert_eq!(parse_range_header("bytes=0-3", 16), Some((0, 3)));
        assert_eq!(parse_range_header("bytes=4-15", 16), Some((4, 15)));
    }

    #[test]
    fn parse_range_header_spec_an_open_ended_range_extends_to_the_last_byte() {
        assert_eq!(parse_range_header("bytes=10-", 16), Some((10, 15)));
    }

    #[test]
    fn parse_range_header_spec_a_suffix_range_counts_back_from_the_end() {
        assert_eq!(parse_range_header("bytes=-4", 16), Some((12, 15)));
    }

    #[test]
    fn parse_range_header_adversarial_an_out_of_bounds_end_is_rejected() {
        assert_eq!(parse_range_header("bytes=0-99", 16), None);
    }

    #[test]
    fn parse_range_header_adversarial_an_inverted_range_is_rejected() {
        assert_eq!(parse_range_header("bytes=10-2", 16), None);
    }

    #[test]
    fn parse_range_header_adversarial_a_non_bytes_unit_is_rejected() {
        assert_eq!(parse_range_header("items=0-3", 16), None);
    }

    #[test]
    fn parse_range_header_adversarial_a_multi_range_request_is_rejected() {
        assert_eq!(parse_range_header("bytes=0-3,8-11", 16), None);
    }

    #[test]
    fn parse_range_header_adversarial_an_empty_resource_is_rejected() {
        assert_eq!(parse_range_header("bytes=0-3", 0), None);
    }

    #[test]
    fn parse_range_header_adversarial_garbage_after_bytes_is_rejected() {
        assert_eq!(parse_range_header("bytes=abc-def", 16), None);
        assert_eq!(parse_range_header("bytes=", 16), None);
        assert_eq!(parse_range_header("nonsense", 16), None);
    }

    fn split_headers_and_body(raw: &str) -> (String, String) {
        let idx = raw.find("\r\n\r\n").expect("response has a header/body separator");
        (raw[..idx].to_string(), raw[idx + 4..].to_string())
    }

    /// tiny_http always sends `Transfer-Encoding: chunked` for
    /// `Response::from_data`, even for small in-memory bodies — confirmed
    /// against the real server via `curl` — so a body-content assertion
    /// has to decode chunks rather than assume a plain `Content-Length`.
    fn decode_chunked_body(body: &str) -> String {
        let mut decoded = String::new();
        let mut rest = body;
        while let Some(line_end) = rest.find("\r\n") {
            let size = usize::from_str_radix(rest[..line_end].trim(), 16).unwrap_or(0);
            if size == 0 {
                break;
            }
            let data_start = line_end + 2;
            let data_end = data_start + size;
            decoded.push_str(&rest[data_start..data_end]);
            rest = &rest[data_end + 2..];
        }
        decoded
    }

    /// Confirmed on a real device: WKWebView's `<video>` element never
    /// leaves `networkState: NETWORK_NO_SOURCE` against a server that
    /// answers every request with a plain 200 and the whole body,
    /// ignoring any `Range` header. This speaks raw HTTP/1.1 the same way
    /// as the CORS test above, against the real running `AssetServer`.
    #[test]
    fn asset_server_spec_a_range_request_returns_a_206_with_the_requested_slice() {
        use std::io::{Read, Write};
        use std::net::TcpStream;

        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/hero.mp4"), b"0123456789abcdef").unwrap();

        let server = AssetServer::start().unwrap();
        server.update(&RenderOutput {
            manifest_json: String::new(),
            fragments: HashMap::new(),
            css: String::new(),
            has_math: false,
            image_assets: HashMap::new(),
            fonts_dir: None,
            deck_dir: dir.path().to_path_buf(),
        });
        let addr = server.base_url.trim_start_matches("http://").trim_end_matches('/').to_string();

        let mut stream = TcpStream::connect(&addr).unwrap();
        write!(
            stream,
            "GET /assets/hero.mp4 HTTP/1.1\r\nHost: {addr}\r\nRange: bytes=0-3\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut raw = String::new();
        stream.read_to_string(&mut raw).unwrap();

        let (headers, body) = split_headers_and_body(&raw);
        let headers_lower = headers.to_lowercase();
        assert!(headers.starts_with("HTTP/1.1 206"), "headers:\n{headers}");
        assert!(headers_lower.contains("content-range: bytes 0-3/16"), "headers:\n{headers}");
        assert!(headers_lower.contains("accept-ranges: bytes"), "headers:\n{headers}");
        let decoded = if headers_lower.contains("transfer-encoding: chunked") { decode_chunked_body(&body) } else { body };
        assert_eq!(decoded.as_bytes(), b"0123");
    }

    #[test]
    fn asset_server_adversarial_an_out_of_bounds_range_falls_back_to_a_full_200_response() {
        use std::io::{Read, Write};
        use std::net::TcpStream;

        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/hero.mp4"), b"0123456789abcdef").unwrap();

        let server = AssetServer::start().unwrap();
        server.update(&RenderOutput {
            manifest_json: String::new(),
            fragments: HashMap::new(),
            css: String::new(),
            has_math: false,
            image_assets: HashMap::new(),
            fonts_dir: None,
            deck_dir: dir.path().to_path_buf(),
        });
        let addr = server.base_url.trim_start_matches("http://").trim_end_matches('/').to_string();

        let mut stream = TcpStream::connect(&addr).unwrap();
        write!(
            stream,
            "GET /assets/hero.mp4 HTTP/1.1\r\nHost: {addr}\r\nRange: bytes=0-99999\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut raw = String::new();
        stream.read_to_string(&mut raw).unwrap();

        let (headers, body) = split_headers_and_body(&raw);
        let headers_lower = headers.to_lowercase();
        assert!(headers.starts_with("HTTP/1.1 200"), "headers:\n{headers}");
        assert!(!headers_lower.contains("content-range"), "headers:\n{headers}");
        let decoded = if headers_lower.contains("transfer-encoding: chunked") { decode_chunked_body(&body) } else { body };
        assert_eq!(decoded.as_bytes(), b"0123456789abcdef");
    }
}
