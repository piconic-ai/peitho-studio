//! Talks to crit, the review tool bundled next to the app's executable
//! (`bundle.externalBin`, pinned by `crit-release.json`): finds the review
//! session a Coding Agent is waiting in on the open deck, adds line comments
//! to it, finishes the round, reads the comments and replies back, and
//! follows the daemon's event stream. The shapes are `engine::crit`'s; this
//! module runs the binary and does the HTTP. It holds no state of its own —
//! a window's event subscription lives in `peitho.rs`'s session.
//!
//! The HTTP goes to `127.0.0.1` only, over plain HTTP/1.0 so the body simply
//! runs to the end of the connection (no chunked encoding to decode, and a
//! server-sent event stream is just lines). Requests carry no browser
//! `Sec-Fetch-Site` header, which is what crit's CSRF check looks at.

use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::engine::crit::{
    self as shapes, CommentPlace, CritSession, DeckSession, DeckSessionMatch, FinishedRound, NewLayoutComment, NewReviewComment, NewReviewReply,
    ReviewComment, ReviewUpdate, SseParser, SESSION_OPENER_BODY, STUDIO_AUTHOR,
};

/// How long a request (and each read of the event stream) may take. The
/// daemon is local, so anything slower means it's gone.
const TIMEOUT: Duration = Duration::from_secs(5);

/// How often the event stream's reader checks whether it was asked to stop.
const STOP_POLL: Duration = Duration::from_millis(500);

/// The crit binary Studio runs, and the `HOME` it runs under (tests give
/// each crit its own, so their daemons and `~/.crit` never meet the user's).
#[derive(Debug, Clone)]
pub struct CritCli {
    bin: PathBuf,
    home: Option<PathBuf>,
}

impl CritCli {
    /// The bundled binary: `bundle.externalBin` puts it next to the app's
    /// executable (`Contents/MacOS/crit`), and tauri-build copies it next to
    /// a dev build's too.
    pub fn bundled() -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|err| format!("can't locate Peitho Studio's executable: {err}"))?;
        let bin = exe.parent().map(|dir| dir.join("crit")).ok_or_else(|| "Peitho Studio's executable has no folder".to_string())?;
        if !bin.is_file() {
            return Err(format!("the bundled crit is missing at {}", bin.display()));
        }
        Ok(Self { bin, home: None })
    }

    /// The crit executable itself.
    pub fn path(&self) -> &Path {
        &self.bin
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.bin);
        // Keeps crit from printing tips about installing its agent plugins.
        command.env("CRIT_NO_INTEGRATION_CHECK", "1");
        // Nor check online for a newer crit on every start: Studio runs it
        // for each status check, and the bundled version is pinned anyway.
        command.env("CRIT_NO_UPDATE_CHECK", "1");
        if let Some(home) = &self.home {
            command.env("HOME", home);
        }
        command
    }

    /// The running sessions `crit status --json` lists in `dir`: the ones
    /// started in that folder, or anywhere in its git repository.
    pub fn status(&self, dir: &Path) -> Result<Vec<CritSession>, String> {
        let output = self
            .command()
            .args(["status", "--json"])
            .current_dir(dir)
            .output()
            .map_err(|err| format!("failed to run {}: {err}", self.bin.display()))?;
        if !output.status.success() {
            return Err(format!("`crit status` failed: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        shapes::parse_status(&String::from_utf8_lossy(&output.stdout))
    }
}

/// Which crit session, if any, reviews `deck_path`. Sessions whose daemon
/// doesn't answer are skipped (it exited after `crit status` read them).
pub fn find_deck_session(cli: &CritCli, deck_path: &Path) -> Result<DeckSession, String> {
    let deck_path = std::fs::canonicalize(deck_path).map_err(|err| format!("{}: {err}", deck_path.display()))?;
    let deck_dir = deck_path.parent().ok_or_else(|| format!("{} has no folder", deck_path.display()))?;
    let mut matches = Vec::new();
    for session in cli.status(deck_dir)? {
        let Ok(mut info) = get(session.port, "/api/session").and_then(|json| shapes::parse_session_info(&json)) else {
            continue;
        };
        // crit's cwd and the deck's path can reach the same folder by
        // different routes (`/tmp` is `/private/tmp` on macOS).
        if let Ok(cwd) = std::fs::canonicalize(&info.cwd) {
            info.cwd = cwd;
        }
        if let Some(file) = shapes::deck_file_in(&info, &deck_path) {
            matches.push(DeckSessionMatch { session, file, review_round: info.review_round });
        }
    }
    Ok(shapes::select_deck_session(matches))
}

/// Adds `comment` on `file` (the deck's path as the session knows it).
pub fn add_comment(port: u16, file: &str, comment: &NewReviewComment) -> Result<(), String> {
    let body = shapes::new_comment_body(comment)?;
    request(port, "POST", &shapes::comments_endpoint(file), Some(&body)).map(|_| ())
}

/// Finishes the review round: the agent's waiting `crit` exits and gets the
/// comments.
pub fn finish(port: u16) -> Result<(), String> {
    request(port, "POST", "/api/finish", None).map(|_| ())
}

/// The comments on the deck file (`deck_file`, its path in the session)
/// and their replies.
pub fn list_comments(port: u16, deck_file: &str) -> Result<Vec<ReviewComment>, String> {
    shapes::parse_comments(&get(port, &shapes::comments_endpoint(deck_file))?, &CommentPlace::Deck)
}

/// Every comment Studio shows for the deck: those on the deck file, on its
/// layout files (`shapes::layout_files_in_session`) and on the review as a
/// whole — the deck's first, then each layout file's, then the review's.
pub fn list_all_comments(port: u16, deck_file: &str) -> Result<Vec<ReviewComment>, String> {
    let info = shapes::parse_session_info(&get(port, "/api/session")?)?;
    let mut comments = list_comments(port, deck_file)?;
    for file in shapes::layout_files_in_session(&info.files, deck_file) {
        let Some(path) = shapes::deck_relative_path(deck_file, &file) else { continue };
        comments.extend(shapes::parse_comments(&get(port, &shapes::comments_endpoint(&file))?, &CommentPlace::File { path })?);
    }
    comments.extend(shapes::parse_comments(&get(port, "/api/comments")?, &CommentPlace::Review)?);
    Ok(comments)
}

/// Adds `comment` (on a layout, or on every one) at `place`
/// (`shapes::layout_comment_place`).
pub fn add_layout_comment(port: u16, deck_file: &str, comment: &NewLayoutComment, place: &CommentPlace) -> Result<(), String> {
    let body = shapes::new_layout_comment_body(comment, place)?;
    request(port, "POST", &shapes::add_endpoint_at(place, deck_file), Some(&body)).map(|_| ())
}

/// Adds `reply` under its comment, which is at `place`.
pub fn add_reply(port: u16, deck_file: &str, reply: &NewReviewReply, place: &CommentPlace) -> Result<(), String> {
    let body = shapes::new_reply_body(reply)?;
    request(port, "POST", &shapes::comment_endpoint_at(&reply.comment_id, "/replies", place, deck_file), Some(&body)).map(|_| ())
}

/// Marks comment `id` (at `place`) resolved: crit stops handing it to the
/// agent.
pub fn resolve_comment(port: u16, deck_file: &str, id: &str, place: &CommentPlace) -> Result<(), String> {
    request(port, "PUT", &shapes::comment_endpoint_at(id, "/resolve", place, deck_file), Some(r#"{"resolved":true}"#)).map(|_| ())
}

fn delete_comment(port: u16, file: &str, id: &str) -> Result<(), String> {
    request(port, "DELETE", &shapes::comment_endpoint(id, "", file), None).map(|_| ())
}

/// How long `start_deck_session` waits for crit's daemon to come up, and
/// for its own `crit` to take the first round.
const START_TIMEOUT: Duration = Duration::from_secs(15);

/// crit writes its review file 200ms after the last change; a round that
/// starts before then carries the deleted opener forward again.
const REVIEW_FILE_SETTLE: Duration = Duration::from_millis(500);

/// What `crit` is run with on `deck_path`, in its folder
/// (`shapes::session_args`): the deck file, and the layout folders it has.
pub fn session_args(deck_path: &Path) -> Result<Vec<String>, String> {
    let dir = deck_path.parent().ok_or_else(|| format!("{} has no folder", deck_path.display()))?;
    let name = deck_path.file_name().ok_or_else(|| format!("{} has no file name", deck_path.display()))?;
    Ok(shapes::session_args(&name.to_string_lossy(), |sub| dir.join(sub).is_dir()))
}

/// Starts a review session on `deck_path` with the bundled crit, the way an
/// agent would (`crit --no-open <deck file> [layouts] [css]` in the deck's
/// folder, `session_args`), so the daemon — which answers every later
/// `crit` on the deck, whatever version the agent runs — is the bundled
/// one. Returns the session and the round Studio finished.
///
/// The `crit` that starts a daemon also waits on its first round, and crit
/// reports nothing when a waiting client connects during that first round —
/// only from the second round on does a connecting agent start a round of
/// its own (`review_round` goes up; see `engine::crit::with_finished_round`).
/// So Studio finishes the first round itself right away, with a comment
/// (a round with none is an approval, which stops the daemon), and deletes
/// that comment again once its own `crit` has taken the round and exited.
pub fn start_deck_session(cli: &CritCli, deck_path: &Path) -> Result<(DeckSession, FinishedRound), String> {
    let deck_path = std::fs::canonicalize(deck_path).map_err(|err| format!("{}: {err}", deck_path.display()))?;
    let deck_dir = deck_path.parent().ok_or_else(|| format!("{} has no folder", deck_path.display()))?;
    let mut child = cli
        .command()
        .arg("--no-open")
        .args(session_args(&deck_path)?)
        .current_dir(deck_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("failed to run {}: {err}", cli.bin.display()))?;
    let result = open_first_round(cli, &deck_path, &mut child);
    // Its round taken (or given up on), Studio's own `crit` has nothing more
    // to do. Killing it outright skips its signal handler, which would stop
    // the daemon it started.
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn open_first_round(cli: &CritCli, deck_path: &Path, child: &mut Child) -> Result<(DeckSession, FinishedRound), String> {
    let deadline = Instant::now() + START_TIMEOUT;
    let (id, port, file, review_round) = loop {
        match find_deck_session(cli, deck_path)? {
            DeckSession::Found { id, port, file, review_round, .. } => break (id, port, file, review_round),
            DeckSession::Ambiguous { ids } => return Err(format!("several crit review sessions review this deck ({})", ids.join(", "))),
            DeckSession::None => {}
        }
        if child.try_wait().map_err(|err| err.to_string())?.is_some() {
            return Err("crit exited before its review session came up".to_string());
        }
        if Instant::now() >= deadline {
            return Err("crit's review session never came up".to_string());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    take_first_round(port, &file, child, deadline).map_err(|err| {
        // The session is Studio's own and half set up (its placeholder
        // comment may still be in it): stop its daemon rather than leave
        // it for the agent's `crit` to join, where the placeholder would
        // arrive as a real comment and no finished round would be on
        // record for Studio to tell a waiting agent by.
        stop_session(cli, deck_path);
        err
    })?;
    let finished = FinishedRound { session_id: id.clone(), port, review_round };
    Ok((DeckSession::Found { id, port, file, review_round, agent_waiting: false }, finished))
}

/// Stops the daemon reviewing `deck_path` (`crit stop <args>` in its
/// folder, with the arguments it was started with). Best effort: there's
/// nothing more to do when it fails.
fn stop_session(cli: &CritCli, deck_path: &Path) {
    let (Some(dir), Ok(args)) = (deck_path.parent(), session_args(deck_path)) else { return };
    let _ = cli.command().arg("stop").args(args).current_dir(dir).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
}

/// Finishes the session's first round with a placeholder comment until
/// Studio's own `crit` (`child`) takes it, then deletes the placeholder.
/// `deadline` is what's left of `START_TIMEOUT` after the session came up:
/// one budget for both.
fn take_first_round(port: u16, file: &str, child: &mut Child, deadline: Instant) -> Result<(), String> {
    let opener = NewReviewComment {
        start_line: 1,
        end_line: 1,
        body: SESSION_OPENER_BODY.into(),
        quote: String::new(),
        author: STUDIO_AUTHOR.into(),
    };
    add_comment(port, file, &opener)?;
    // The daemon lists the session a moment before Studio's `crit` starts
    // waiting on it, and a round finished before then never reaches that
    // `crit`: finish again until it takes the round and exits.
    while !finished_within(port, child, Duration::from_secs(1))? {
        if Instant::now() >= deadline {
            return Err("crit never took the review session's first round".to_string());
        }
    }
    if let Some(opener) = shapes::session_opener_id(&list_comments(port, file)?) {
        delete_comment(port, file, &opener)?;
    }
    std::thread::sleep(REVIEW_FILE_SETTLE);
    Ok(())
}

/// Finishes the round, and whether `child` took it (exited) within `wait`.
fn finished_within(port: u16, child: &mut Child, wait: Duration) -> Result<bool, String> {
    finish(port)?;
    let until = Instant::now() + wait;
    while Instant::now() < until {
        if child.try_wait().map_err(|err| err.to_string())?.is_some() {
            return Ok(true);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Ok(false)
}

fn get(port: u16, path: &str) -> Result<String, String> {
    request(port, "GET", path, None)
}

fn connect(port: u16) -> Result<TcpStream, String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let stream = TcpStream::connect_timeout(&addr, TIMEOUT).map_err(|err| format!("can't reach crit on port {port}: {err}"))?;
    stream.set_write_timeout(Some(TIMEOUT)).map_err(|err| err.to_string())?;
    Ok(stream)
}

/// Sends one request and returns the body of a 2xx response.
fn request(port: u16, method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    let mut stream = connect(port)?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(|err| err.to_string())?;
    stream.write_all(&request_bytes(method, port, path, body)).map_err(|err| format!("crit {method} {path}: {err}"))?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|err| format!("crit {method} {path}: {err}"))?;
    let (status, body) = parse_response(&raw)?;
    if !(200..300).contains(&status) {
        return Err(format!("crit {method} {path} answered {status}: {}", body.trim()));
    }
    Ok(body)
}

/// An HTTP/1.0 request, so the response ends with the connection.
fn request_bytes(method: &str, port: u16, path: &str, body: Option<&str>) -> Vec<u8> {
    let mut head = format!("{method} {path} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nAccept: */*\r\n");
    if let Some(body) = body {
        head.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");
    let mut bytes = head.into_bytes();
    if let Some(body) = body {
        bytes.extend_from_slice(body.as_bytes());
    }
    bytes
}

/// The status code and body of a whole HTTP/1.x response.
fn parse_response(raw: &[u8]) -> Result<(u16, String), String> {
    let split = raw.windows(4).position(|window| window == b"\r\n\r\n").ok_or_else(|| "crit sent an incomplete response".to_string())?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let status = parse_status_line(head.lines().next().unwrap_or_default())?;
    Ok((status, String::from_utf8_lossy(&raw[split + 4..]).into_owned()))
}

/// The status code of an `HTTP/1.x <code> <reason>` line.
fn parse_status_line(line: &str) -> Result<u16, String> {
    let mut parts = line.split_whitespace();
    match (parts.next(), parts.next().and_then(|code| code.parse::<u16>().ok())) {
        (Some(version), Some(code)) if version.starts_with("HTTP/1.") && (100..600).contains(&code) => Ok(code),
        _ => Err(format!("crit sent an unexpected status line: {line:?}")),
    }
}

/// What the event stream reports to its subscriber.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchSignal {
    Update(ReviewUpdate),
    /// The stream closed — the daemon stopped, or never accepted it.
    Ended,
}

/// A subscription to a session's events, running on its own thread until
/// dropped or until the stream ends.
pub struct CritWatch {
    pub port: u16,
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

impl CritWatch {
    /// Whether the stream is still being read (it hasn't ended).
    pub fn is_open(&self) -> bool {
        !self.thread.is_finished()
    }
}

impl Drop for CritWatch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Follows `port`'s `GET /api/events`, calling `on_signal` for each event
/// that changes the review and once with `Ended` when the stream closes
/// (not when the watch is dropped).
pub fn watch_events(port: u16, on_signal: impl Fn(WatchSignal) + Send + 'static) -> Result<CritWatch, String> {
    let mut stream = connect(port)?;
    stream.write_all(&request_bytes("GET", port, "/api/events", None)).map_err(|err| format!("crit events: {err}"))?;
    stream.set_read_timeout(Some(STOP_POLL)).map_err(|err| err.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread = std::thread::spawn(move || {
        if read_events(stream, &thread_stop, &on_signal) {
            on_signal(WatchSignal::Ended);
        }
    });
    Ok(CritWatch { port, stop, thread })
}

/// Reads the stream until it ends (`true`) or `stop` is set (`false`).
fn read_events(stream: TcpStream, stop: &AtomicBool, on_signal: &impl Fn(WatchSignal)) -> bool {
    let mut reader = BufReader::new(stream);
    let mut line = Vec::new();
    let mut in_body = false;
    let mut parser = SseParser::default();
    loop {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        // On a timeout the bytes read so far stay in `line`, so a line split
        // across the timeout is completed by the next call.
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => return true,
            Ok(_) if !line.ends_with(b"\n") => return true,
            Ok(_) => {}
            Err(err) if matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted) => continue,
            Err(_) => return true,
        }
        let text = String::from_utf8_lossy(&line).into_owned();
        line.clear();
        if !in_body {
            if text.starts_with("HTTP/") && parse_status_line(text.trim_end()).map_or(true, |status| status != 200) {
                return true;
            }
            in_body = text.trim_end().is_empty();
            continue;
        }
        if let Some(update) = parser.push_line(&text).as_ref().and_then(shapes::review_update_of) {
            on_signal(WatchSignal::Update(update));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_request_is_http_1_0_to_localhost() {
        assert_eq!(
            String::from_utf8(request_bytes("GET", 5000, "/api/session", None)).unwrap(),
            "GET /api/session HTTP/1.0\r\nHost: 127.0.0.1:5000\r\nAccept: */*\r\n\r\n"
        );
    }

    #[test]
    fn post_request_carries_a_json_body_with_its_byte_length() {
        let bytes = String::from_utf8(request_bytes("POST", 1, "/x", Some("{\"a\":\"é\"}"))).unwrap();
        assert!(bytes.contains("Content-Type: application/json\r\nContent-Length: 10\r\n\r\n{\"a\":\"é\"}"), "{bytes}");
    }

    #[test]
    fn response_status_and_body_are_split_at_the_blank_line() {
        let raw = b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n[{\"a\":1}]\r\n\r\nrest";
        assert_eq!(parse_response(raw).unwrap(), (200, "[{\"a\":1}]\r\n\r\nrest".to_string()));
    }

    #[test]
    fn response_with_an_empty_body_or_an_error_status_is_read() {
        assert_eq!(parse_response(b"HTTP/1.1 204 No Content\r\n\r\n").unwrap(), (204, String::new()));
        assert_eq!(parse_response(b"HTTP/1.0 403 Forbidden\r\n\r\nno").unwrap(), (403, "no".to_string()));
    }

    #[test]
    fn malformed_responses_are_errors() {
        for raw in [&b""[..], b"HTTP/1.0 200 OK\r\n", b"garbage\r\n\r\n", b"HTTP/2 200\r\n\r\n", b"HTTP/1.0 abc\r\n\r\n", b"HTTP/1.0 999 X\r\n\r\n"] {
            assert!(parse_response(raw).is_err(), "{:?} should be rejected", String::from_utf8_lossy(raw));
        }
    }

    /// Runs the bundled crit (`binaries/crit-<target>`, what build.rs
    /// requires and tauri-build copies into the app) in a round trip like an
    /// agent's, under a HOME of its own.
    mod round_trip {
        use super::*;
        use std::process::{Child, Stdio};
        use std::sync::mpsc;
        use std::time::Instant;

        fn bundled_binary() -> PathBuf {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(concat!("crit-", env!("PEITHO_STUDIO_TARGET")))
        }

        /// A deck folder, a HOME for crit, and the agent-side processes —
        /// all stopped on drop.
        struct Sandbox {
            _root: tempfile::TempDir,
            deck_dir: PathBuf,
            cli: CritCli,
            children: Vec<Child>,
        }

        impl Sandbox {
            fn new() -> Self {
                let root = tempfile::tempdir().unwrap();
                let deck_dir = root.path().join("deck");
                let home = root.path().join("home");
                std::fs::create_dir_all(&deck_dir).unwrap();
                std::fs::create_dir_all(&home).unwrap();
                std::fs::write(deck_dir.join("deck.md"), "---\ntitle: T\n---\n\n# Hello\n\nSome text\n").unwrap();
                Self { _root: root, deck_dir, cli: CritCli { bin: bundled_binary(), home: Some(home) }, children: Vec::new() }
            }

            fn deck(&self) -> PathBuf {
                self.deck_dir.join("deck.md")
            }

            /// Starts `crit <args>` in the deck folder, as an agent would.
            fn agent(&mut self, args: &[&str]) -> usize {
                let child = self
                    .cli
                    .command()
                    .args(args)
                    .current_dir(&self.deck_dir)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap();
                self.children.push(child);
                self.children.len() - 1
            }

            fn crit(&self, args: &[&str]) -> std::process::Output {
                self.cli.command().args(args).current_dir(&self.deck_dir).output().unwrap()
            }

            fn wait_for_session(&self) -> (u16, String, String) {
                let deadline = Instant::now() + Duration::from_secs(15);
                loop {
                    if let DeckSession::Found { port, file, id, .. } = find_deck_session(&self.cli, &self.deck()).unwrap() {
                        return (port, file, id);
                    }
                    assert!(Instant::now() < deadline, "crit's session never showed up");
                    std::thread::sleep(Duration::from_millis(100));
                }
            }

            /// The agent's `crit` output once it exits.
            fn agent_output(&mut self, index: usize) -> String {
                let deadline = Instant::now() + Duration::from_secs(15);
                while self.children[index].try_wait().unwrap().is_none() {
                    assert!(Instant::now() < deadline, "the agent's crit never exited");
                    std::thread::sleep(Duration::from_millis(50));
                }
                let mut out = String::new();
                self.children[index].stdout.take().unwrap().read_to_string(&mut out).unwrap();
                out
            }
        }

        impl Drop for Sandbox {
            fn drop(&mut self) {
                for child in &mut self.children {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                let _ = self.crit(&["stop", "--all"]);
            }
        }

        fn next_signal(signals: &mpsc::Receiver<WatchSignal>, wanted: WatchSignal) {
            let deadline = Instant::now() + Duration::from_secs(15);
            loop {
                let left = deadline.saturating_duration_since(Instant::now());
                match signals.recv_timeout(left) {
                    Ok(signal) if signal == wanted => return,
                    Ok(_) => continue,
                    Err(_) => panic!("never got {wanted:?}"),
                }
            }
        }

        #[test]
        fn bundled_crit_is_the_pinned_version() {
            // Given the binary build.rs requires, When asked its version,
            let out = Command::new(bundled_binary()).arg("--version").output().unwrap();
            let pinned: serde_json::Value = serde_json::from_str(include_str!("../crit-release.json")).unwrap();
            // Then it is the one crit-release.json pins.
            let version = pinned["version"].as_str().unwrap();
            assert!(String::from_utf8_lossy(&out.stdout).starts_with(&format!("crit v{version} ")), "{:?}", out);
        }

        #[test]
        fn without_an_agent_waiting_there_is_no_session() {
            // Given a deck nobody runs crit on, Then Studio finds no session.
            let sandbox = Sandbox::new();
            assert_eq!(find_deck_session(&sandbox.cli, &sandbox.deck()).unwrap(), DeckSession::None);
        }

        #[test]
        fn a_session_on_another_file_in_the_folder_is_not_the_decks() {
            // Given an agent waits on notes.md next to the deck,
            let mut sandbox = Sandbox::new();
            std::fs::write(sandbox.deck_dir.join("notes.md"), "# Notes\n").unwrap();
            sandbox.agent(&["--no-open", "notes.md"]);
            let deadline = Instant::now() + Duration::from_secs(15);
            while sandbox.cli.status(&sandbox.deck_dir).unwrap().is_empty() {
                assert!(Instant::now() < deadline, "crit's session never showed up");
                std::thread::sleep(Duration::from_millis(100));
            }
            // Then that session isn't taken for the deck's.
            assert_eq!(find_deck_session(&sandbox.cli, &sandbox.deck()).unwrap(), DeckSession::None);
        }

        #[test]
        fn comments_reach_the_waiting_agent_and_its_replies_come_back() {
            // Given an agent waits in `crit --no-open deck.md`,
            let mut sandbox = Sandbox::new();
            let agent = sandbox.agent(&["--no-open", "deck.md"]);
            let (port, file, session_id) = sandbox.wait_for_session();
            assert_eq!(file, "deck.md");
            // The session is listed once the daemon is up, a moment before
            // the agent's crit starts waiting on it — and a round finished
            // before then never reaches that crit. crit exposes no way to
            // tell (see todo/archive/crit-review-bridge.md), so give it time.
            std::thread::sleep(Duration::from_secs(2));
            let (sender, signals) = mpsc::channel();
            let _watch = watch_events(port, move |signal| {
                let _ = sender.send(signal);
            })
            .unwrap();

            // When Studio adds a line comment,
            let comment = NewReviewComment {
                start_line: 5,
                end_line: 5,
                body: "[Slide 1 › heading] Make it bigger".into(),
                quote: "# Hello".into(),
                author: "Peitho Studio".into(),
            };
            add_comment(port, &file, &comment).unwrap();
            // Then it's in the session with its lines and quote,
            let comments = list_comments(port, &file).unwrap();
            assert_eq!(comments.len(), 1);
            assert_eq!(comments[0].lines, Some(shapes::LineRange { start: 5, end: 5 }));
            assert_eq!(comments[0].quote.as_deref(), Some("# Hello"));
            assert_eq!(comments[0].author, "Peitho Studio");

            // And when Studio finishes the round, the agent's crit exits
            // with the comment and how to reply.
            finish(port).unwrap();
            next_signal(&signals, WatchSignal::Update(ReviewUpdate::Finished));
            let handed_over = sandbox.agent_output(agent);
            assert!(handed_over.contains("Make it bigger"), "{handed_over}");
            assert!(handed_over.contains("--reply-to"), "{handed_over}");

            // When the agent replies and waits for the next round,
            let reply = sandbox.crit(&["comment", "--reply-to", &comments[0].id, "--author", "Agent", "Made it bigger"]);
            assert!(reply.status.success(), "{reply:?}");
            sandbox.agent(&["--session", &session_id]);
            // Then Studio hears about it, and reads the reply under the comment.
            next_signal(&signals, WatchSignal::Update(ReviewUpdate::CommentsChanged));
            let comments = list_comments(port, &file).unwrap();
            assert_eq!(comments.len(), 1);
            assert_eq!(comments[0].replies.len(), 1);
            assert_eq!(comments[0].replies[0].body, "Made it bigger");
            assert_eq!(comments[0].replies[0].author, "Agent");
        }

        /// Whether an agent waits in the deck's session, as Studio tells
        /// after finishing `finished` — polled, since the round counter
        /// moves a moment after the agent connects.
        fn wait_until_agent_waits(sandbox: &Sandbox, finished: &FinishedRound) -> DeckSession {
            let deadline = Instant::now() + Duration::from_secs(15);
            loop {
                let session = shapes::with_finished_round(find_deck_session(&sandbox.cli, &sandbox.deck()).unwrap(), std::slice::from_ref(finished));
                if matches!(session, DeckSession::Found { agent_waiting: true, .. }) {
                    return session;
                }
                assert!(Instant::now() < deadline, "the agent never showed as waiting: {session:?}");
                std::thread::sleep(Duration::from_millis(100));
            }
        }

        #[test]
        fn a_session_studio_starts_waits_for_the_agent_then_hands_it_only_studios_comments() {
            // Given Studio starts the review session on a deck nobody reviews,
            let mut sandbox = Sandbox::new();
            let (session, finished) = start_deck_session(&sandbox.cli, &sandbox.deck()).unwrap();
            let DeckSession::Found { port, file, id, review_round, agent_waiting } = session else { panic!("{session:?}") };
            // Then it is the bundled crit's, no agent waits in it yet, and
            // the comment Studio opened it with is gone.
            assert_eq!(file, "deck.md");
            assert!(!agent_waiting);
            assert_eq!(finished, FinishedRound { session_id: id.clone(), port, review_round });
            assert!(list_comments(port, &file).unwrap().is_empty());
            let (sender, signals) = mpsc::channel();
            let _watch = watch_events(port, move |signal| {
                let _ = sender.send(signal);
            })
            .unwrap();

            // When an agent runs `crit --no-open deck.md` in the deck's folder,
            let agent = sandbox.agent(&["--no-open", "deck.md"]);
            // Then Studio hears of it and sees the agent waiting.
            next_signal(&signals, WatchSignal::Update(ReviewUpdate::CommentsChanged));
            let DeckSession::Found { review_round, .. } = wait_until_agent_waits(&sandbox, &finished) else { unreachable!() };

            // When Studio adds a comment and finishes the round,
            let comment = NewReviewComment {
                start_line: 5,
                end_line: 5,
                body: "[Slide 1 › heading \"Hello\"] Make it bigger".into(),
                quote: "Hello".into(),
                author: STUDIO_AUTHOR.into(),
            };
            add_comment(port, &file, &comment).unwrap();
            finish(port).unwrap();
            // Then the agent's crit exits with that comment alone,
            let handed_over = sandbox.agent_output(agent);
            assert!(handed_over.contains("Make it bigger"), "{handed_over}");
            assert!(!handed_over.contains(SESSION_OPENER_BODY), "{handed_over}");
            // and no agent waits until it comes back for the next round.
            let finished = FinishedRound { session_id: id, port, review_round };
            let now = shapes::with_finished_round(find_deck_session(&sandbox.cli, &sandbox.deck()).unwrap(), std::slice::from_ref(&finished));
            assert!(matches!(now, DeckSession::Found { agent_waiting: false, .. }), "{now:?}");
            sandbox.agent(&["--session", &finished.session_id]);
            wait_until_agent_waits(&sandbox, &finished);
        }

        #[test]
        fn studio_replies_under_a_comment_and_resolves_it() {
            // Given a comment in a session an agent waits in,
            let mut sandbox = Sandbox::new();
            sandbox.agent(&["--no-open", "deck.md"]);
            let (port, file, _) = sandbox.wait_for_session();
            let comment = NewReviewComment { start_line: 5, end_line: 5, body: "Bigger".into(), quote: String::new(), author: STUDIO_AUTHOR.into() };
            add_comment(port, &file, &comment).unwrap();
            let id = list_comments(port, &file).unwrap()[0].id.clone();
            // When Studio replies under it,
            let reply = NewReviewReply { comment_id: id.clone(), body: "Still too small".into(), author: STUDIO_AUTHOR.into() };
            add_reply(port, &file, &reply, &CommentPlace::Deck).unwrap();
            // Then the reply is in its thread,
            let comments = list_comments(port, &file).unwrap();
            assert_eq!(comments[0].replies.len(), 1);
            assert_eq!(comments[0].replies[0].body, "Still too small");
            assert_eq!(comments[0].replies[0].author, STUDIO_AUTHOR);
            // and when Studio resolves it, it is resolved.
            resolve_comment(port, &file, &id, &CommentPlace::Deck).unwrap();
            assert!(list_comments(port, &file).unwrap()[0].resolved);
            // A reply to a comment that isn't there is an error.
            assert!(add_reply(port, &file, &NewReviewReply { comment_id: "c_missing".into(), ..reply }, &CommentPlace::Deck).is_err());
        }

        /// The sandbox's deck with a layout of its own: `layouts/cover.html`
        /// and `css/cover.css`.
        fn with_layout_files(sandbox: &Sandbox) {
            std::fs::create_dir_all(sandbox.deck_dir.join("layouts")).unwrap();
            std::fs::create_dir_all(sandbox.deck_dir.join("css")).unwrap();
            std::fs::write(sandbox.deck_dir.join("layouts").join("cover.html"), "<section class=\"layout-cover\">\n  <h1>{{title}}</h1>\n</section>\n").unwrap();
            std::fs::write(sandbox.deck_dir.join("css").join("cover.css"), ".layout-cover { color: red; }\n").unwrap();
        }

        #[test]
        fn layout_comments_reach_an_agent_that_runs_crit_with_the_same_arguments_and_deck_comments_still_work() {
            // Given a deck with layouts/ and css/, and the session Studio starts on it,
            let mut sandbox = Sandbox::new();
            with_layout_files(&sandbox);
            assert_eq!(session_args(&sandbox.deck()).unwrap(), vec!["deck.md", "layouts", "css"]);
            let (session, finished) = start_deck_session(&sandbox.cli, &sandbox.deck()).unwrap();
            let DeckSession::Found { port, file, .. } = session else { panic!("{session:?}") };
            assert_eq!(file, "deck.md");

            // When an agent runs crit with the same arguments (in another order),
            let agent = sandbox.agent(&["--no-open", "css", "deck.md", "layouts"]);
            // Then it joins Studio's session rather than starting another.
            wait_until_agent_waits(&sandbox, &finished);
            assert_eq!(sandbox.cli.status(&sandbox.deck_dir).unwrap().len(), 1);

            // When Studio comments on the deck, on the cover layout and on every layout,
            let deck_comment = NewReviewComment { start_line: 5, end_line: 5, body: "[Slide 1] Bigger".into(), quote: String::new(), author: STUDIO_AUTHOR.into() };
            add_comment(port, &file, &deck_comment).unwrap();
            let on_cover = NewLayoutComment { layout: Some("cover".into()), body: "[Layout cover] Darker title".into(), author: STUDIO_AUTHOR.into() };
            let cover_place = shapes::layout_comment_place(&on_cover, |path| sandbox.deck_dir.join(path).is_file()).unwrap();
            assert_eq!(cover_place, CommentPlace::File { path: "layouts/cover.html".into() });
            add_layout_comment(port, &file, &on_cover, &cover_place).unwrap();
            let on_all = NewLayoutComment { layout: None, body: "[All layouts] Calmer colors".into(), author: STUDIO_AUTHOR.into() };
            add_layout_comment(port, &file, &on_all, &CommentPlace::Review).unwrap();
            // Then each is listed at its place,
            let comments = list_all_comments(port, &file).unwrap();
            let places: Vec<(&str, &CommentPlace)> = comments.iter().map(|comment| (comment.body.as_str(), &comment.place)).collect();
            assert_eq!(
                places,
                vec![
                    ("[Slide 1] Bigger", &CommentPlace::Deck),
                    ("[Layout cover] Darker title", &cover_place),
                    ("[All layouts] Calmer colors", &CommentPlace::Review),
                ]
            );
            // and the deck's own comments are the deck file's alone.
            assert_eq!(list_comments(port, &file).unwrap().len(), 1);

            // When Studio finishes the round, Then the agent gets all three,
            // the layout comment naming its file.
            finish(port).unwrap();
            let handed_over = sandbox.agent_output(agent);
            for expected in ["Bigger", "Darker title", "Calmer colors", "\"path\":\"layouts/cover.html\"", "\"scope\":\"review\""] {
                assert!(handed_over.contains(expected), "{expected} missing from {handed_over}");
            }

            // When Studio replies to and resolves the layout and review-level comments,
            for comment in comments.iter().filter(|comment| comment.place != CommentPlace::Deck) {
                let reply = NewReviewReply { comment_id: comment.id.clone(), body: "One more thing".into(), author: STUDIO_AUTHOR.into() };
                add_reply(port, &file, &reply, &comment.place).unwrap();
                resolve_comment(port, &file, &comment.id, &comment.place).unwrap();
            }
            // Then both carry the reply and are resolved; the deck's is untouched.
            let comments = list_all_comments(port, &file).unwrap();
            for comment in &comments {
                let touched = comment.place != CommentPlace::Deck;
                assert_eq!(comment.resolved, touched, "{comment:?}");
                assert_eq!(comment.replies.len(), usize::from(touched), "{comment:?}");
            }
        }

        #[test]
        fn given_layout_folders_created_after_the_session_started_an_agent_joining_by_id_lands_in_it() {
            // Given Studio's session on a deck with no layout folders yet,
            let mut sandbox = Sandbox::new();
            let (session, finished) = start_deck_session(&sandbox.cli, &sandbox.deck()).unwrap();
            let DeckSession::Found { port, file, id, .. } = session else { panic!("{session:?}") };
            // When the deck gets its first layout (layouts/ and css/ appear)
            // and an agent joins by the session's id (`domain/agentConnect.ts`),
            with_layout_files(&sandbox);
            let agent = sandbox.agent(&["--no-open", "--session", &id]);
            // Then it waits in Studio's session — no second one on the deck,
            wait_until_agent_waits(&sandbox, &finished);
            assert_eq!(sandbox.cli.status(&sandbox.deck_dir).unwrap().len(), 1);
            // and a comment on the new layout reaches it.
            let on_cover = NewLayoutComment { layout: Some("cover".into()), body: "[Layout cover] Darker".into(), author: STUDIO_AUTHOR.into() };
            let place = shapes::layout_comment_place(&on_cover, |path| sandbox.deck_dir.join(path).is_file()).unwrap();
            add_layout_comment(port, &file, &on_cover, &place).unwrap();
            finish(port).unwrap();
            let handed_over = sandbox.agent_output(agent);
            assert!(handed_over.contains("\"path\":\"layouts/cover.html\""), "{handed_over}");
        }

        #[test]
        fn a_deck_without_layout_folders_is_reviewed_on_its_file_alone() {
            // Given a deck with no layouts/ or css/, Then crit is started on the deck file only,
            let sandbox = Sandbox::new();
            assert_eq!(session_args(&sandbox.deck()).unwrap(), vec!["deck.md"]);
            // and the session Studio starts lists no layout comments.
            let (session, _) = start_deck_session(&sandbox.cli, &sandbox.deck()).unwrap();
            let DeckSession::Found { port, file, .. } = session else { panic!("{session:?}") };
            assert!(list_all_comments(port, &file).unwrap().is_empty());
        }

        #[test]
        fn the_event_stream_ends_when_the_daemon_stops() {
            // Given Studio follows a session's events,
            let mut sandbox = Sandbox::new();
            sandbox.agent(&["--no-open", "deck.md"]);
            let (port, _, _) = sandbox.wait_for_session();
            let (sender, signals) = mpsc::channel();
            let _watch = watch_events(port, move |signal| {
                let _ = sender.send(signal);
            })
            .unwrap();
            // When the daemon stops, Then the subscriber is told the stream ended.
            assert!(sandbox.crit(&["stop", "--all"]).status.success());
            next_signal(&signals, WatchSignal::Ended);
        }

        #[test]
        fn a_request_to_a_closed_port_fails_instead_of_hanging() {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            drop(listener);
            assert!(finish(port).is_err());
            assert!(watch_events(port, |_| {}).is_err());
        }
    }
}
