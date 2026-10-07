//! Long-lived engine for e2e (`e2e/helpers/realEngine.ts`): reads one JSON
//! request per stdin line, `{"deckPath": "...", "cmd": "...", "args": {...}}`,
//! and answers one JSON line, `{"ok": <result>}` or `{"err": "<message>"}`.
use std::io::{BufRead, Write};

fn main() {
    let stdout = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let request: serde_json::Value = serde_json::from_str(&line.expect("stdin")).expect("request JSON");
        let deck_path = std::path::PathBuf::from(request["deckPath"].as_str().unwrap_or_default());
        let cmd = request["cmd"].as_str().unwrap_or_default();
        let reply = match app_lib::invoke_for_e2e(&deck_path, cmd, request["args"].clone()) {
            Ok(value) => serde_json::json!({ "ok": value }),
            Err(err) => serde_json::json!({ "err": err }),
        };
        let mut out = stdout.lock();
        writeln!(out, "{reply}").and_then(|_| out.flush()).expect("stdout");
    }
}
