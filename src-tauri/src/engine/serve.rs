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
        }
        return Err(404);
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
