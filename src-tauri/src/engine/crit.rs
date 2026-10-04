//! The shapes Studio reads from and writes to crit (https://crit.md), the
//! review tool a Coding Agent waits on while Studio collects comments: which
//! of crit's sessions is reviewing the open deck, the comments and replies
//! in it, and the events its daemon streams. Pure — `crate::crit` runs the
//! bundled binary and does the HTTP.
//!
//! crit's HTTP API is the one its own web UI uses, not a published contract,
//! so every field Studio relies on is pinned by a type here and exercised
//! against the bundled version by `crate::crit`'s integration tests. Unknown
//! fields are ignored.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

/// A running review session, as `crit status --json` lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CritSession {
    pub id: String,
    pub port: u16,
}

#[derive(Deserialize)]
struct StatusJson {
    #[serde(default)]
    sessions: Vec<StatusSessionJson>,
}

#[derive(Deserialize)]
struct StatusSessionJson {
    id: String,
    port: u16,
    /// Absent in crit 0.21 (it lists running sessions only); honored when a
    /// version reports it.
    running: Option<bool>,
}

/// The sessions `crit status --json` reports as running. A session without
/// a port (0) can't be talked to, so it's left out.
pub fn parse_status(json: &str) -> Result<Vec<CritSession>, String> {
    let status: StatusJson = serde_json::from_str(json).map_err(|err| format!("unexpected `crit status --json` output: {err}"))?;
    Ok(status
        .sessions
        .into_iter()
        .filter(|session| session.running != Some(false) && session.port != 0)
        .map(|session| CritSession { id: session.id, port: session.port })
        .collect())
}

/// What a session's daemon says about itself (`GET /api/session`): the
/// folder it runs in and the files under review, as paths relative to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CritSessionInfo {
    pub cwd: PathBuf,
    pub files: Vec<String>,
    pub review_round: u32,
}

#[derive(Deserialize)]
struct SessionInfoJson {
    cwd: String,
    #[serde(default)]
    files: Vec<SessionFileJson>,
    #[serde(default)]
    review_round: u32,
}

#[derive(Deserialize)]
struct SessionFileJson {
    path: String,
}

pub fn parse_session_info(json: &str) -> Result<CritSessionInfo, String> {
    let info: SessionInfoJson = serde_json::from_str(json).map_err(|err| format!("unexpected crit session info: {err}"))?;
    if info.cwd.is_empty() {
        return Err("unexpected crit session info: empty cwd".to_string());
    }
    Ok(CritSessionInfo {
        cwd: PathBuf::from(info.cwd),
        files: info.files.into_iter().map(|file| file.path).collect(),
        review_round: info.review_round,
    })
}

/// `path` with `.` and `..` resolved without touching the filesystem.
/// `None` when `..` climbs above the root.
fn normalize(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            other => out.push(other),
        }
    }
    Some(out)
}

/// The path crit knows `deck_path` by in `info`'s session — what its
/// comment endpoints take as `?path=` — or `None` when the session isn't
/// reviewing that file. Both sides are compared as given, so the caller
/// resolves symlinks first (`/tmp` vs `/private/tmp` on macOS).
pub fn deck_file_in(info: &CritSessionInfo, deck_path: &Path) -> Option<String> {
    let deck = normalize(deck_path)?;
    info.files.iter().find(|file| normalize(&info.cwd.join(file)).as_deref() == Some(deck.as_path())).cloned()
}

/// The folders next to the deck file that hold its layouts: a review
/// session covers them too, so a comment on a layout lands on its file.
pub const LAYOUT_DIRS: [&str; 2] = ["layouts", "css"];

/// What `crit` is run with on a deck (in the deck's folder): the deck file,
/// then each of `LAYOUT_DIRS` the deck has (`has_dir`) — crit refuses a
/// folder that isn't there. crit tells sessions apart by these arguments
/// (in any order), so the agent's `crit` (`domain/agentConnect.ts`) joins
/// Studio's session only when it is run with the same ones.
pub fn session_args(deck_file_name: &str, has_dir: impl Fn(&str) -> bool) -> Vec<String> {
    std::iter::once(deck_file_name.to_string()).chain(LAYOUT_DIRS.iter().filter(|dir| has_dir(dir)).map(|dir| dir.to_string())).collect()
}

/// The deck's folder as the session knows it, with a trailing `/` — `""`
/// when crit runs in the deck's folder itself. `deck_file` is the deck's
/// path in the session (`deck_file_in`).
fn deck_dir_prefix(deck_file: &str) -> &str {
    deck_file.rfind('/').map_or("", |at| &deck_file[..=at])
}

/// A file of the deck (`path`, relative to the deck's folder) as the
/// session knows it: crit runs at a git repository's root when the deck is
/// in one, and names files from there.
pub fn session_path(deck_file: &str, path: &str) -> String {
    format!("{}{path}", deck_dir_prefix(deck_file))
}

/// `path` (as the session knows it) relative to the deck's folder — the
/// way back from `session_path`. `None` outside that folder.
pub fn deck_relative_path(deck_file: &str, path: &str) -> Option<String> {
    path.strip_prefix(deck_dir_prefix(deck_file)).filter(|rest| !rest.is_empty()).map(str::to_string)
}

/// Whether `path` (relative to the deck's folder) is one of the deck's
/// layout files: `layouts/<name>.html` or `css/<name>.css`, directly in
/// that folder.
fn is_layout_file(path: &str) -> bool {
    let in_dir = |dir: &str, ext: &str| {
        path.strip_prefix(dir)
            .and_then(|rest| rest.strip_prefix('/'))
            .and_then(|file| file.strip_suffix(ext))
            .is_some_and(|stem| !stem.is_empty() && !stem.contains('/'))
    };
    in_dir("layouts", ".html") || in_dir("css", ".css")
}

/// Those of `files` (a session's, as `/api/session` lists them) that are
/// the deck's layout files (`is_layout_file`), as the session knows them.
pub fn layout_files_in_session(files: &[String], deck_file: &str) -> Vec<String> {
    files
        .iter()
        .filter(|file| deck_relative_path(deck_file, file).is_some_and(|path| is_layout_file(&path)))
        .cloned()
        .collect()
}

/// Layout `name`'s HTML file relative to the deck's folder, or why `name`
/// can't be one (it must be a plain file stem, so the path stays inside
/// `layouts/`).
pub fn layout_html_path(name: &str) -> Result<String, String> {
    let name = super::layout_files::validate_layout_name(name, &[])?;
    Ok(format!("layouts/{name}.html"))
}

/// A session found reviewing the open deck.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeckSessionMatch {
    pub session: CritSession,
    /// The deck's path as crit knows it (see `deck_file_in`).
    pub file: String,
    pub review_round: u32,
}

/// Whether an agent is waiting in a crit session on the open deck.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DeckSession {
    /// No running session reviews the deck.
    None,
    /// `agent_waiting`: whether an agent's `crit` is waiting for the next
    /// round, so that finishing it now would reach the agent — see
    /// `with_finished_round`.
    #[serde(rename_all = "camelCase")]
    Found { id: String, port: u16, file: String, review_round: u32, agent_waiting: bool },
    /// More than one does, and which one the agent is waiting on can't be
    /// told apart — Studio won't guess where to send comments.
    #[serde(rename_all = "camelCase")]
    Ambiguous { ids: Vec<String> },
}

/// A session found here is taken to have an agent waiting in it (see
/// `with_finished_round` for when Studio knows better).
pub fn select_deck_session(mut matches: Vec<DeckSessionMatch>) -> DeckSession {
    match matches.len() {
        0 => DeckSession::None,
        1 => {
            let found = matches.remove(0);
            DeckSession::Found {
                id: found.session.id,
                port: found.session.port,
                file: found.file,
                review_round: found.review_round,
                agent_waiting: true,
            }
        }
        _ => {
            let mut ids: Vec<String> = matches.into_iter().map(|found| found.session.id).collect();
            ids.sort();
            DeckSession::Ambiguous { ids }
        }
    }
}

/// The round of a session that Studio last finished. A session is its id
/// *and* its daemon's port: crit reuses the id when a daemon on the same
/// deck is started again (by an agent, after the old one stopped), and that
/// new daemon's rounds say nothing about what Studio finished in the old one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishedRound {
    pub session_id: String,
    pub port: u16,
    pub review_round: u32,
}

/// How many sessions' finished rounds Studio remembers.
pub const MAX_FINISHED_ROUNDS: usize = 64;

/// `rounds` with `finished` recorded: it replaces the entry for the same
/// session and daemon, and only the newest `MAX_FINISHED_ROUNDS` are kept.
pub fn record_finished_round(rounds: &[FinishedRound], finished: FinishedRound) -> Vec<FinishedRound> {
    let mut kept: Vec<FinishedRound> = rounds
        .iter()
        .filter(|round| !(round.session_id == finished.session_id && round.port == finished.port))
        .cloned()
        .collect();
    kept.push(finished);
    let excess = kept.len().saturating_sub(MAX_FINISHED_ROUNDS);
    kept.drain(..excess);
    kept
}

/// The finished rounds Studio saved (`finished_rounds_json`); nothing for a
/// missing, empty or unreadable file — at worst an agent is taken to wait.
pub fn parse_finished_rounds(json: &str) -> Vec<FinishedRound> {
    serde_json::from_str(json).unwrap_or_default()
}

pub fn finished_rounds_json(rounds: &[FinishedRound]) -> String {
    serde_json::to_string(rounds).unwrap_or_else(|_| "[]".to_string())
}

/// `session` with whether an agent waits in it, given the round Studio last
/// finished there. An agent's `crit` waits on `POST /api/review-cycle`, and
/// every call after a session's first finished round starts the next round
/// (`review_round` goes up) — so once Studio has finished round `n`, an
/// agent waits again exactly when the session is past `n`. crit exposes no
/// count of waiting clients, so a session Studio never finished a round of
/// is taken to have its agent waiting: whoever started it runs the `crit`
/// that waits on its first round. (Studio's own sessions are finished once
/// right after they start, `crate::crit::start_deck_session`, so they
/// don't count as waiting until an agent connects.) `rounds` are every
/// session's, as Studio saved them — kept across restarts of Studio.
pub fn with_finished_round(session: DeckSession, rounds: &[FinishedRound]) -> DeckSession {
    match session {
        DeckSession::Found { id, port, file, review_round, .. } => {
            let finished = rounds.iter().rev().find(|round| round.session_id == id && round.port == port);
            let agent_waiting = match finished {
                Some(finished) => review_round > finished.review_round,
                None => true,
            };
            DeckSession::Found { id, port, file, review_round, agent_waiting }
        }
        other => other,
    }
}

/// A 1-based, inclusive line range in the deck file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub start: u32,
    pub end: u32,
}

/// Where a comment sits in the session: on the deck file, on another file
/// of the deck (a layout's HTML — `path` relative to the deck's folder, as
/// `layouts/cover.html`), or on the review as a whole (crit's review-level
/// comments, which carry no file).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommentPlace {
    Deck,
    File { path: String },
    Review,
}

/// A comment in the session and the replies under it, as Studio shows it.
/// crit renumbers comment ids between review rounds, so a comment is
/// followed by its `lines` and `quote`, not its `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub id: String,
    pub place: CommentPlace,
    /// `None` for a comment on the whole file (crit's line 0).
    pub lines: Option<LineRange>,
    pub body: String,
    /// The Markdown the comment was made on, as Studio sent it.
    pub quote: Option<String>,
    pub author: String,
    pub resolved: bool,
    pub replies: Vec<ReviewReply>,
    /// When it was written, as crit recorded it (RFC 3339, UTC); `None`
    /// when crit gave none.
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewReply {
    pub id: String,
    pub body: String,
    pub author: String,
    pub created_at: Option<String>,
}

#[derive(Deserialize)]
struct CommentJson {
    id: String,
    #[serde(default)]
    start_line: i64,
    #[serde(default)]
    end_line: i64,
    #[serde(default)]
    body: String,
    quote: Option<String>,
    #[serde(default)]
    author: String,
    #[serde(default)]
    resolved: bool,
    #[serde(default)]
    replies: Vec<ReplyJson>,
    created_at: Option<String>,
}

#[derive(Deserialize)]
struct ReplyJson {
    id: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    author: String,
    created_at: Option<String>,
}

/// A line range from crit's numbers: no range for line 0 (or below), and an
/// end before the start is read as the start alone.
fn line_range(start: i64, end: i64) -> Option<LineRange> {
    let start = u32::try_from(start).ok().filter(|start| *start > 0)?;
    let end = u32::try_from(end).ok().filter(|end| *end >= start).unwrap_or(start);
    Some(LineRange { start, end })
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

/// The comments `GET /api/file/comments?path=…` (or, for review-level
/// comments, `GET /api/comments`) returns, each at `place`. An empty quote
/// is read as none.
pub fn parse_comments(json: &str, place: &CommentPlace) -> Result<Vec<ReviewComment>, String> {
    // crit answers `null` for a file with no comments yet.
    let comments: Option<Vec<CommentJson>> = serde_json::from_str(json).map_err(|err| format!("unexpected crit comments: {err}"))?;
    Ok(comments
        .unwrap_or_default()
        .into_iter()
        .map(|comment| ReviewComment {
            id: comment.id,
            place: place.clone(),
            lines: line_range(comment.start_line, comment.end_line),
            body: comment.body,
            quote: comment.quote.filter(|quote| !quote.is_empty()),
            author: comment.author,
            resolved: comment.resolved,
            created_at: nonempty(comment.created_at),
            replies: comment
                .replies
                .into_iter()
                .map(|reply| ReviewReply { id: reply.id, body: reply.body, author: reply.author, created_at: nonempty(reply.created_at) })
                .collect(),
        })
        .collect())
}

/// A line comment Studio adds to the session.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewReviewComment {
    pub start_line: u32,
    pub end_line: u32,
    pub body: String,
    /// The Markdown commented on. crit keeps it next to the line numbers,
    /// which lets the agent find the spot after lines have moved.
    pub quote: String,
    pub author: String,
}

#[derive(Serialize)]
struct NewCommentJson<'a> {
    start_line: u32,
    end_line: u32,
    body: &'a str,
    quote: &'a str,
    author: &'a str,
}

/// The JSON body of `POST /api/file/comments?path=…` for `comment`, or why
/// it can't be sent.
pub fn new_comment_body(comment: &NewReviewComment) -> Result<String, String> {
    if comment.start_line == 0 {
        return Err("a comment's lines start at 1".to_string());
    }
    if comment.end_line < comment.start_line {
        return Err(format!("a comment's last line ({}) is before its first ({})", comment.end_line, comment.start_line));
    }
    if comment.body.trim().is_empty() {
        return Err("a comment needs a body".to_string());
    }
    if comment.author.trim().is_empty() {
        return Err("a comment needs an author".to_string());
    }
    serde_json::to_string(&NewCommentJson {
        start_line: comment.start_line,
        end_line: comment.end_line,
        body: &comment.body,
        quote: &comment.quote,
        author: &comment.author,
    })
    .map_err(|err| err.to_string())
}

/// `value` percent-encoded, leaving unreserved characters and `keep` as is.
fn percent_encode(value: &str, keep: &[u8]) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) || keep.contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// `/api/file/comments?path=<file>`, with `file` percent-encoded.
pub fn comments_endpoint(file: &str) -> String {
    format!("/api/file/comments?path={}", percent_encode(file, b"/"))
}

/// `/api/comment/<id><action>?path=<file>` — one comment of `file`
/// (`action` ""), its replies ("/replies") or its resolved flag
/// ("/resolve"). The id is encoded as one path segment.
pub fn comment_endpoint(id: &str, action: &str, file: &str) -> String {
    format!("/api/comment/{}{action}?path={}", percent_encode(id, b""), percent_encode(file, b"/"))
}

/// The endpoint for comment `id` at `place` (`comment_endpoint`'s
/// `action`s): a review-level comment has routes of its own, without a
/// file. `deck_file` is the deck's path in the session.
pub fn comment_endpoint_at(id: &str, action: &str, place: &CommentPlace, deck_file: &str) -> String {
    match place {
        CommentPlace::Deck => comment_endpoint(id, action, deck_file),
        CommentPlace::File { path } => comment_endpoint(id, action, &session_path(deck_file, path)),
        CommentPlace::Review => format!("/api/review-comment/{}{action}", percent_encode(id, b"")),
    }
}

/// Where a new comment at `place` is posted: a file's comments, or the
/// review's own (`POST /api/comments`).
pub fn add_endpoint_at(place: &CommentPlace, deck_file: &str) -> String {
    match place {
        CommentPlace::Deck => comments_endpoint(deck_file),
        CommentPlace::File { path } => comments_endpoint(&session_path(deck_file, path)),
        CommentPlace::Review => "/api/comments".to_string(),
    }
}

/// A comment on one of the deck's layouts (`layout`: its name), or on all
/// of them (`None`) — written on the layout screen. No lines: the preview
/// of a layout points at nothing in its HTML.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLayoutComment {
    pub layout: Option<String>,
    pub body: String,
    pub author: String,
}

/// Where `comment` goes: on layout `name`'s HTML file as a whole when the
/// deck has that file (`has_file`, given its path relative to the deck's
/// folder), else on the review — a comment on every layout, or on a
/// layout with no file of its own yet (the built-in one) — its label
/// saying what it is about. A name that can't be a layout's is refused.
pub fn layout_comment_place(comment: &NewLayoutComment, has_file: impl Fn(&str) -> bool) -> Result<CommentPlace, String> {
    let Some(name) = &comment.layout else { return Ok(CommentPlace::Review) };
    let path = layout_html_path(name)?;
    Ok(if has_file(&path) { CommentPlace::File { path } } else { CommentPlace::Review })
}

#[derive(Serialize)]
struct NewWholeCommentJson<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    scope: Option<&'a str>,
    body: &'a str,
    author: &'a str,
}

/// The JSON body that posts `comment` at `place` (`layout_comment_place`):
/// a comment on a whole file (crit's `scope: "file"`), or a review-level
/// one. Refused without a body or an author, or for the deck file —
/// comments there are on lines (`new_comment_body`).
pub fn new_layout_comment_body(comment: &NewLayoutComment, place: &CommentPlace) -> Result<String, String> {
    if comment.body.trim().is_empty() {
        return Err("a comment needs a body".to_string());
    }
    if comment.author.trim().is_empty() {
        return Err("a comment needs an author".to_string());
    }
    let scope = match place {
        CommentPlace::File { .. } => Some("file"),
        CommentPlace::Review => None,
        CommentPlace::Deck => return Err("a comment on the deck file is on its lines".to_string()),
    };
    serde_json::to_string(&NewWholeCommentJson { scope, body: &comment.body, author: &comment.author }).map_err(|err| err.to_string())
}

/// Those of `comments` (each with where it goes) not yet in the session:
/// an unresolved comment at the same place with the same body and author
/// is taken to be the same one, as in `unsent_comments`.
pub fn unsent_layout_comments<'a>(comments: &'a [(NewLayoutComment, CommentPlace)], existing: &[ReviewComment]) -> Vec<&'a (NewLayoutComment, CommentPlace)> {
    comments
        .iter()
        .filter(|(comment, place)| {
            !existing.iter().any(|sent| !sent.resolved && sent.place == *place && sent.body == comment.body && sent.author == comment.author)
        })
        .collect()
}

/// Where comment `id` is among `comments`, or why it can't be acted on.
pub fn place_of(comments: &[ReviewComment], id: &str) -> Result<CommentPlace, String> {
    comments.iter().find(|comment| comment.id == id).map(|comment| comment.place.clone()).ok_or_else(|| format!("no comment {id} in the review session"))
}

/// The author Studio's comments carry (`REVIEW_AUTHOR` in
/// `domain/reviewComment.ts`).
pub const STUDIO_AUTHOR: &str = "Peitho Studio";

/// The body Studio's own first comment carries: `crate::crit::start_deck_session`
/// finishes a new session's first round with it (an empty round would be an
/// approval, which stops crit), then deletes it.
pub const SESSION_OPENER_BODY: &str = "Peitho Studio opened this review session.";

/// The id of Studio's session-opening comment among `comments`.
pub fn session_opener_id(comments: &[ReviewComment]) -> Option<String> {
    comments.iter().find(|comment| comment.body == SESSION_OPENER_BODY && comment.author == STUDIO_AUTHOR).map(|comment| comment.id.clone())
}

/// A reply Studio adds under a comment in the session.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewReviewReply {
    pub comment_id: String,
    pub body: String,
    pub author: String,
}

#[derive(Serialize)]
struct NewReplyJson<'a> {
    body: &'a str,
    author: &'a str,
}

/// The JSON body of `POST /api/comment/<id>/replies?path=…` for `reply`, or
/// why it can't be sent.
pub fn new_reply_body(reply: &NewReviewReply) -> Result<String, String> {
    if reply.comment_id.trim().is_empty() {
        return Err("a reply needs the comment it answers".to_string());
    }
    if reply.body.trim().is_empty() {
        return Err("a reply needs a body".to_string());
    }
    if reply.author.trim().is_empty() {
        return Err("a reply needs an author".to_string());
    }
    serde_json::to_string(&NewReplyJson { body: &reply.body, author: &reply.author }).map_err(|err| err.to_string())
}

/// One server-sent event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

/// Assembles server-sent events from a stream's lines
/// (https://html.spec.whatwg.org/multipage/server-sent-events.html).
#[derive(Debug, Default)]
pub struct SseParser {
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    /// Takes one line (with or without its line ending) and returns the
    /// event a blank line completes.
    pub fn push_line(&mut self, line: &str) -> Option<SseEvent> {
        let line = line.strip_suffix('\n').unwrap_or(line);
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            let event = self.event.take();
            let data = std::mem::take(&mut self.data);
            if event.is_none() && data.is_empty() {
                return None;
            }
            return Some(SseEvent { event: event.unwrap_or_else(|| "message".to_string()), data: data.join("\n") });
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };
        match field {
            "event" => self.event = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
        None
    }
}

/// What a crit event means for the open deck's review.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewUpdate {
    /// Comments or replies may have changed — the agent started its next
    /// round, replied, or a file changed. Read the comments again.
    CommentsChanged,
    /// The round was finished and the waiting agent got the comments.
    Finished,
}

pub fn review_update_of(event: &SseEvent) -> Option<ReviewUpdate> {
    match event.event.as_str() {
        "file-changed" | "comments-changed" => Some(ReviewUpdate::CommentsChanged),
        "finish" => Some(ReviewUpdate::Finished),
        _ => None,
    }
}

/// Those of `comments` not yet in the session: an unresolved comment there
/// with the same lines, body, quote and author is taken to be the same one,
/// sent by an earlier attempt that failed partway. Lets a batch be retried
/// whole without the agent seeing its first comments twice.
pub fn unsent_comments<'a>(comments: &'a [NewReviewComment], existing: &[ReviewComment]) -> Vec<&'a NewReviewComment> {
    comments.iter().filter(|comment| !existing.iter().any(|sent| is_same_comment(comment, sent))).collect()
}

fn is_same_comment(comment: &NewReviewComment, sent: &ReviewComment) -> bool {
    !sent.resolved
        && sent.place == CommentPlace::Deck
        && sent.lines == Some(LineRange { start: comment.start_line, end: comment.end_line })
        && sent.body == comment.body
        && sent.author == comment.author
        && sent.quote.as_deref().unwrap_or("") == comment.quote
}

/// Those of `replies` not yet in the session: the comment they answer
/// already has a reply with the same body and author, sent by an earlier
/// attempt that failed partway (or whose finish failed afterwards). Like
/// `unsent_comments`, lets a send be retried whole.
pub fn unsent_replies<'a>(replies: &'a [NewReviewReply], existing: &[ReviewComment]) -> Vec<&'a NewReviewReply> {
    replies
        .iter()
        .filter(|reply| {
            !existing.iter().any(|comment| {
                comment.id == reply.comment_id
                    && comment.replies.iter().any(|sent| sent.body == reply.body && sent.author == reply.author)
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_status ---

    #[test]
    fn status_with_one_session_lists_its_id_and_port() {
        // Given `crit status --json` from crit 0.21 with one session,
        let json = r#"{"branch":"","daemon":{"pid":1,"port":57909,"running":true},"sessions":[{"args":["deck.md"],"branch":"","id":"7dfbb39c5b6d","pid":1,"port":57909,"review_file":"/x/review.json"}],"vcs":""}"#;
        // When it is parsed, Then that session is listed.
        assert_eq!(parse_status(json).unwrap(), vec![CritSession { id: "7dfbb39c5b6d".into(), port: 57909 }]);
    }

    #[test]
    fn status_with_no_sessions_lists_none() {
        let json = r#"{"branch":"","daemon":{"running":false},"sessions":[],"vcs":""}"#;
        assert_eq!(parse_status(json).unwrap(), vec![]);
    }

    #[test]
    fn status_without_a_sessions_field_lists_none() {
        assert_eq!(parse_status("{}").unwrap(), vec![]);
    }

    #[test]
    fn status_leaves_out_a_session_reported_as_not_running() {
        let json = r#"{"sessions":[{"id":"a","port":1,"running":false},{"id":"b","port":2,"running":true}]}"#;
        assert_eq!(parse_status(json).unwrap(), vec![CritSession { id: "b".into(), port: 2 }]);
    }

    #[test]
    fn status_leaves_out_a_session_without_a_port() {
        let json = r#"{"sessions":[{"id":"a","port":0}]}"#;
        assert_eq!(parse_status(json).unwrap(), vec![]);
    }

    #[test]
    fn broken_status_json_is_an_error() {
        for json in ["", "not json", "{\"sessions\":", "{\"sessions\":[{\"id\":\"a\"}]}", "{\"sessions\":[{\"id\":\"a\",\"port\":70000}]}", "\"x\""] {
            assert!(parse_status(json).is_err(), "{json:?} should be rejected");
        }
    }

    // --- parse_session_info / deck_file_in ---

    #[test]
    fn session_info_reads_cwd_files_and_round() {
        let json = r#"{"mode":"files","review_round":2,"files":[{"path":"deck.md","status":"modified"}],"cwd":"/decks/talk","session_key":"x"}"#;
        assert_eq!(
            parse_session_info(json).unwrap(),
            CritSessionInfo { cwd: "/decks/talk".into(), files: vec!["deck.md".into()], review_round: 2 }
        );
    }

    #[test]
    fn session_info_without_cwd_is_an_error() {
        assert!(parse_session_info(r#"{"files":[]}"#).is_err());
        assert!(parse_session_info(r#"{"cwd":""}"#).is_err());
        assert!(parse_session_info("").is_err());
    }

    fn info(cwd: &str, files: &[&str]) -> CritSessionInfo {
        CritSessionInfo { cwd: cwd.into(), files: files.iter().map(|file| file.to_string()).collect(), review_round: 1 }
    }

    #[test]
    fn deck_reviewed_from_its_own_folder_is_found_by_file_name() {
        // Given an agent ran `crit deck.md` in the deck's folder,
        // When Studio looks for the open deck, Then crit knows it as `deck.md`.
        assert_eq!(deck_file_in(&info("/decks/talk", &["deck.md"]), Path::new("/decks/talk/deck.md")), Some("deck.md".into()));
    }

    #[test]
    fn deck_in_a_git_repository_is_found_relative_to_the_repository_root() {
        // Given crit runs at a repository's root and lists the deck under it,
        let session = info("/repo", &["README.md", "talks/a/deck.md"]);
        // Then the deck is found by that repository-relative path.
        assert_eq!(deck_file_in(&session, Path::new("/repo/talks/a/deck.md")), Some("talks/a/deck.md".into()));
    }

    #[test]
    fn dot_segments_on_either_side_still_match() {
        assert_eq!(deck_file_in(&info("/decks/talk", &["./deck.md"]), Path::new("/decks/talk/deck.md")), Some("./deck.md".into()));
        assert_eq!(deck_file_in(&info("/decks/x/../talk", &["deck.md"]), Path::new("/decks/talk/./deck.md")), Some("deck.md".into()));
    }

    #[test]
    fn a_session_on_another_file_or_folder_is_not_the_decks() {
        assert_eq!(deck_file_in(&info("/decks/talk", &["notes.md"]), Path::new("/decks/talk/deck.md")), None);
        assert_eq!(deck_file_in(&info("/decks/other", &["deck.md"]), Path::new("/decks/talk/deck.md")), None);
        assert_eq!(deck_file_in(&info("/decks/talk", &[]), Path::new("/decks/talk/deck.md")), None);
        // A same-named deck in a sibling variant file doesn't count either.
        assert_eq!(deck_file_in(&info("/decks/talk", &["deck.ja.md"]), Path::new("/decks/talk/deck.md")), None);
    }

    #[test]
    fn a_path_climbing_above_the_root_matches_nothing() {
        assert_eq!(deck_file_in(&info("/", &["../../deck.md"]), Path::new("/deck.md")), None);
    }

    // --- select_deck_session ---

    fn found(id: &str, port: u16) -> DeckSessionMatch {
        DeckSessionMatch { session: CritSession { id: id.into(), port }, file: "deck.md".into(), review_round: 1 }
    }

    #[test]
    fn one_matching_session_is_found() {
        assert_eq!(
            select_deck_session(vec![found("a", 5000)]),
            DeckSession::Found { id: "a".into(), port: 5000, file: "deck.md".into(), review_round: 1, agent_waiting: true }
        );
    }

    #[test]
    fn no_matching_session_is_none() {
        assert_eq!(select_deck_session(vec![]), DeckSession::None);
    }

    #[test]
    fn two_sessions_on_the_same_deck_are_ambiguous() {
        assert_eq!(
            select_deck_session(vec![found("b", 2), found("a", 1)]),
            DeckSession::Ambiguous { ids: vec!["a".into(), "b".into()] }
        );
    }

    #[test]
    fn deck_session_serializes_as_a_tagged_union_for_the_frontend() {
        assert_eq!(serde_json::to_string(&DeckSession::None).unwrap(), r#"{"kind":"none"}"#);
        assert_eq!(
            serde_json::to_string(&DeckSession::Found { id: "a".into(), port: 1, file: "deck.md".into(), review_round: 2, agent_waiting: false }).unwrap(),
            r#"{"kind":"found","id":"a","port":1,"file":"deck.md","reviewRound":2,"agentWaiting":false}"#
        );
        assert_eq!(serde_json::to_string(&DeckSession::Ambiguous { ids: vec!["a".into()] }).unwrap(), r#"{"kind":"ambiguous","ids":["a"]}"#);
    }

    // --- parse_comments ---

    #[test]
    fn comment_with_a_reply_keeps_its_lines_quote_and_thread() {
        // Given crit 0.21's comments after the agent replied,
        let json = r##"[{"id":"c_ead7d5","start_line":5,"end_line":5,"body":"Make it bigger","quote":"# Hello","anchor":"# Hello","author":"Studio","scope":"line","created_at":"2026-09-28T14:38:37Z","updated_at":"2026-09-28T14:38:51Z","carried_forward":true,"review_round":1,"replies":[{"id":"rp_35db49","body":"Made it bigger","author":"Agent","created_at":"2026-09-28T14:38:51Z","review_round":1}]}]"##;
        // When they are read, Then the comment and its reply come back.
        assert_eq!(
            parse_comments(json, &CommentPlace::Deck).unwrap(),
            vec![ReviewComment {
                id: "c_ead7d5".into(),
                place: CommentPlace::Deck,
                lines: Some(LineRange { start: 5, end: 5 }),
                body: "Make it bigger".into(),
                quote: Some("# Hello".into()),
                author: "Studio".into(),
                resolved: false,
                replies: vec![ReviewReply {
                    id: "rp_35db49".into(),
                    body: "Made it bigger".into(),
                    author: "Agent".into(),
                    created_at: Some("2026-09-28T14:38:51Z".into()),
                }],
                created_at: Some("2026-09-28T14:38:37Z".into()),
            }]
        );
    }

    #[test]
    fn comment_without_replies_or_quote_reads_as_empty_thread_and_no_quote() {
        let json = r#"[{"id":"c1","start_line":2,"end_line":4,"body":"b","author":"a"},{"id":"c2","start_line":1,"end_line":1,"body":"b","quote":"","author":"a"}]"#;
        let comments = parse_comments(json, &CommentPlace::Deck).unwrap();
        assert_eq!(comments[0].replies, vec![]);
        assert_eq!(comments[0].quote, None);
        assert_eq!(comments[0].lines, Some(LineRange { start: 2, end: 4 }));
        assert_eq!(comments[1].quote, None);
    }

    #[test]
    fn comment_without_or_with_an_empty_time_reads_as_no_time() {
        let json = r#"[{"id":"c1","start_line":1,"end_line":1,"body":"b","author":"a"},{"id":"c2","start_line":1,"end_line":1,"body":"b","author":"a","created_at":"","replies":[{"id":"r","body":"x","author":"y","created_at":""}]}]"#;
        let comments = parse_comments(json, &CommentPlace::Deck).unwrap();
        assert_eq!(comments[0].created_at, None);
        assert_eq!(comments[1].created_at, None);
        assert_eq!(comments[1].replies[0].created_at, None);
    }

    #[test]
    fn comment_on_line_zero_is_a_whole_file_comment() {
        let json = r#"[{"id":"c1","start_line":0,"end_line":0,"body":"overall","author":"a","scope":"file"}]"#;
        assert_eq!(parse_comments(json, &CommentPlace::Deck).unwrap()[0].lines, None);
    }

    #[test]
    fn comment_with_negative_or_reversed_lines_is_read_leniently() {
        let json = r#"[{"id":"c1","start_line":-1,"end_line":3,"body":"b"},{"id":"c2","start_line":7,"end_line":3,"body":"b"}]"#;
        let comments = parse_comments(json, &CommentPlace::Deck).unwrap();
        assert_eq!(comments[0].lines, None);
        assert_eq!(comments[1].lines, Some(LineRange { start: 7, end: 7 }));
    }

    #[test]
    fn unknown_fields_and_a_resolved_flag_are_handled() {
        let json = r#"[{"id":"c1","start_line":1,"end_line":1,"body":"b","author":"a","resolved":true,"future_field":{"x":1}}]"#;
        assert!(parse_comments(json, &CommentPlace::Deck).unwrap()[0].resolved);
    }

    #[test]
    fn no_comments_yet_reads_as_empty() {
        assert_eq!(parse_comments("[]", &CommentPlace::Deck).unwrap(), vec![]);
        assert_eq!(parse_comments("null", &CommentPlace::Deck).unwrap(), vec![]);
    }

    #[test]
    fn broken_comments_json_is_an_error() {
        for json in ["", "{}", "[{\"body\":\"no id\"}]", "[1]"] {
            assert!(parse_comments(json, &CommentPlace::Deck).is_err(), "{json:?} should be rejected");
        }
    }

    // --- new_comment_body ---

    fn comment(start_line: u32, end_line: u32, body: &str) -> NewReviewComment {
        NewReviewComment { start_line, end_line, body: body.into(), quote: "# Hello".into(), author: "Peitho Studio".into() }
    }

    #[test]
    fn new_comment_is_sent_with_crit_field_names() {
        let body: serde_json::Value = serde_json::from_str(&new_comment_body(&comment(5, 6, "Bigger \"title\"")).unwrap()).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"start_line":5,"end_line":6,"body":"Bigger \"title\"","quote":"# Hello","author":"Peitho Studio"})
        );
    }

    #[test]
    fn new_comment_takes_frontend_camel_case() {
        let parsed: NewReviewComment =
            serde_json::from_str(r#"{"startLine":1,"endLine":2,"body":"b","quote":"","author":"me"}"#).unwrap();
        assert_eq!(parsed, NewReviewComment { start_line: 1, end_line: 2, body: "b".into(), quote: "".into(), author: "me".into() });
    }

    #[test]
    fn new_comment_with_bad_lines_or_empty_text_is_refused() {
        assert!(new_comment_body(&comment(0, 1, "b")).is_err());
        assert!(new_comment_body(&comment(3, 2, "b")).is_err());
        assert!(new_comment_body(&comment(1, 1, "")).is_err());
        assert!(new_comment_body(&comment(1, 1, " \n\t")).is_err());
        assert!(new_comment_body(&NewReviewComment { author: " ".into(), ..comment(1, 1, "b") }).is_err());
    }

    #[test]
    fn new_comment_with_an_empty_quote_is_still_sent() {
        assert!(new_comment_body(&NewReviewComment { quote: String::new(), ..comment(1, 1, "b") }).is_ok());
    }

    // --- comments_endpoint ---

    #[test]
    fn comments_endpoint_keeps_a_plain_path_readable() {
        assert_eq!(comments_endpoint("talks/a/deck.md"), "/api/file/comments?path=talks/a/deck.md");
    }

    #[test]
    fn comments_endpoint_encodes_spaces_query_characters_and_non_ascii() {
        assert_eq!(comments_endpoint("my deck&x=1#.md"), "/api/file/comments?path=my%20deck%26x%3D1%23.md");
        assert_eq!(comments_endpoint("発表.md"), "/api/file/comments?path=%E7%99%BA%E8%A1%A8.md");
        assert_eq!(comments_endpoint(""), "/api/file/comments?path=");
    }

    // --- comment_endpoint ---

    #[test]
    fn comment_endpoint_addresses_a_comment_its_replies_or_its_resolved_flag() {
        assert_eq!(comment_endpoint("c_e4b825", "", "deck.md"), "/api/comment/c_e4b825?path=deck.md");
        assert_eq!(comment_endpoint("c_e4b825", "/replies", "talks/a/deck.md"), "/api/comment/c_e4b825/replies?path=talks/a/deck.md");
        assert_eq!(comment_endpoint("c_e4b825", "/resolve", "deck.md"), "/api/comment/c_e4b825/resolve?path=deck.md");
    }

    #[test]
    fn comment_endpoint_keeps_an_odd_id_inside_its_path_segment() {
        // A slash or query character in an id can't reach another route.
        assert_eq!(comment_endpoint("a/replies?x", "", "deck.md"), "/api/comment/a%2Freplies%3Fx?path=deck.md");
        assert_eq!(comment_endpoint("", "/resolve", "my deck.md"), "/api/comment//resolve?path=my%20deck.md");
    }

    // --- with_finished_round ---

    fn found_session(id: &str, port: u16, review_round: u32) -> DeckSession {
        DeckSession::Found { id: id.into(), port, file: "deck.md".into(), review_round, agent_waiting: true }
    }

    fn waiting(session: DeckSession) -> Option<bool> {
        match session {
            DeckSession::Found { agent_waiting, .. } => Some(agent_waiting),
            _ => None,
        }
    }

    fn finished(id: &str, port: u16, review_round: u32) -> FinishedRound {
        FinishedRound { session_id: id.into(), port, review_round }
    }

    #[test]
    fn given_studio_finished_the_current_round_then_no_agent_waits_until_the_next_round() {
        // Given Studio finished round 2, When the session is still in round
        // 2, Then the agent is busy; When it moved on to round 3, it waits.
        assert_eq!(waiting(with_finished_round(found_session("a", 1, 2), &[finished("a", 1, 2)])), Some(false));
        assert_eq!(waiting(with_finished_round(found_session("a", 1, 3), &[finished("a", 1, 2)])), Some(true));
    }

    #[test]
    fn given_a_session_studio_never_finished_a_round_of_then_its_agent_is_taken_to_wait() {
        assert_eq!(waiting(with_finished_round(found_session("a", 1, 1), &[])), Some(true));
        // A round finished in another session says nothing about this one.
        assert_eq!(waiting(with_finished_round(found_session("b", 1, 1), &[finished("a", 1, 5)])), Some(true));
    }

    #[test]
    fn given_a_daemon_started_again_under_the_same_id_then_its_agent_is_taken_to_wait() {
        // crit reuses the id for a new daemon on the same deck (an agent ran
        // `crit` after the old one stopped); only its port tells it apart.
        assert_eq!(waiting(with_finished_round(found_session("a", 2, 5), &[finished("a", 1, 5)])), Some(true));
    }

    #[test]
    fn given_several_saved_rounds_then_the_one_for_this_session_and_daemon_counts() {
        let rounds = [finished("b", 9, 1), finished("a", 1, 3), finished("a", 2, 7)];
        assert_eq!(waiting(with_finished_round(found_session("a", 1, 3), &rounds)), Some(false));
        assert_eq!(waiting(with_finished_round(found_session("a", 2, 8), &rounds)), Some(true));
    }

    #[test]
    fn given_no_single_session_then_there_is_nothing_to_mark() {
        assert_eq!(with_finished_round(DeckSession::None, &[finished("a", 1, 1)]), DeckSession::None);
        let ambiguous = DeckSession::Ambiguous { ids: vec!["a".into(), "b".into()] };
        assert_eq!(with_finished_round(ambiguous.clone(), &[]), ambiguous);
    }

    // --- record_finished_round / saved rounds ---

    #[test]
    fn given_a_round_finished_again_in_the_same_session_then_it_replaces_the_old_one() {
        let rounds = record_finished_round(&[finished("a", 1, 2), finished("b", 3, 1)], finished("a", 1, 3));
        assert_eq!(rounds, vec![finished("b", 3, 1), finished("a", 1, 3)]);
    }

    #[test]
    fn given_the_same_id_on_another_daemon_then_both_are_kept() {
        let rounds = record_finished_round(&[finished("a", 1, 2)], finished("a", 2, 1));
        assert_eq!(rounds, vec![finished("a", 1, 2), finished("a", 2, 1)]);
    }

    #[test]
    fn given_more_than_the_limit_then_only_the_newest_are_kept() {
        let full: Vec<FinishedRound> = (0..MAX_FINISHED_ROUNDS as u16).map(|port| finished("s", port, 1)).collect();
        let rounds = record_finished_round(&full, finished("new", 1, 1));
        assert_eq!(rounds.len(), MAX_FINISHED_ROUNDS);
        assert_eq!(rounds.first(), Some(&finished("s", 1, 1)));
        assert_eq!(rounds.last(), Some(&finished("new", 1, 1)));
    }

    #[test]
    fn saved_rounds_read_back_as_written() {
        let rounds = vec![finished("a", 1, 2), finished("b", 3, 4)];
        assert_eq!(parse_finished_rounds(&finished_rounds_json(&rounds)), rounds);
        assert_eq!(finished_rounds_json(&[finished("a", 1, 2)]), r#"[{"sessionId":"a","port":1,"reviewRound":2}]"#);
    }

    #[test]
    fn missing_empty_or_broken_saved_rounds_read_as_none() {
        for json in ["", "{}", "not json", r#"[{"sessionId":"a"}]"#] {
            assert_eq!(parse_finished_rounds(json), vec![], "{json}");
        }
    }

    // --- session_opener_id ---

    fn review_comment(id: &str, body: &str, author: &str) -> ReviewComment {
        ReviewComment { id: id.into(), place: CommentPlace::Deck, lines: None, body: body.into(), quote: None, author: author.into(), resolved: false, replies: vec![], created_at: None }
    }

    #[test]
    fn studios_session_opener_is_found_among_the_comments() {
        let comments = [review_comment("c1", "Fix this", "Peitho Studio"), review_comment("c2", SESSION_OPENER_BODY, "Peitho Studio")];
        assert_eq!(session_opener_id(&comments), Some("c2".into()));
    }

    #[test]
    fn the_same_words_from_someone_else_or_no_comments_are_not_the_opener() {
        assert_eq!(session_opener_id(&[review_comment("c1", SESSION_OPENER_BODY, "Agent")]), None);
        assert_eq!(session_opener_id(&[]), None);
    }

    // --- new_reply_body ---

    fn reply(comment_id: &str, body: &str, author: &str) -> NewReviewReply {
        NewReviewReply { comment_id: comment_id.into(), body: body.into(), author: author.into() }
    }

    #[test]
    fn reply_body_carries_the_text_and_author() {
        assert_eq!(new_reply_body(&reply("c1", "Still too small", "Peitho Studio")).unwrap(), r#"{"body":"Still too small","author":"Peitho Studio"}"#);
    }

    #[test]
    fn reply_body_escapes_quotes_and_keeps_non_ascii() {
        assert_eq!(new_reply_body(&reply("c1", "\"大きく\"\n", "A")).unwrap(), r#"{"body":"\"大きく\"\n","author":"A"}"#);
    }

    #[test]
    fn a_reply_without_a_comment_body_or_author_is_refused() {
        assert!(new_reply_body(&reply("", "x", "A")).unwrap_err().contains("comment"));
        assert!(new_reply_body(&reply("c1", "  \n", "A")).unwrap_err().contains("body"));
        assert!(new_reply_body(&reply("c1", "x", " ")).unwrap_err().contains("author"));
    }

    #[test]
    fn a_reply_arrives_from_the_frontend_in_camel_case() {
        let parsed: NewReviewReply = serde_json::from_str(r#"{"commentId":"c1","body":"b","author":"a"}"#).unwrap();
        assert_eq!(parsed, reply("c1", "b", "a"));
    }

    // --- SseParser / review_update_of ---

    fn parse_stream(lines: &[&str]) -> Vec<SseEvent> {
        let mut parser = SseParser::default();
        lines.iter().filter_map(|line| parser.push_line(line)).collect()
    }

    #[test]
    fn events_from_crits_stream_are_assembled() {
        // Given crit's stream: a keep-alive comment, then a file-changed event,
        let events = parse_stream(&[":\n", "\n", "event: file-changed\n", "data: {\"type\":\"file-changed\",\"content\":\"session\"}\n", "\n"]);
        // Then exactly one event comes out, with its name and data.
        assert_eq!(events, vec![SseEvent { event: "file-changed".into(), data: r#"{"type":"file-changed","content":"session"}"#.into() }]);
    }

    #[test]
    fn multi_line_data_crlf_and_unnamed_events_follow_the_sse_rules() {
        let events = parse_stream(&["data: a\r\n", "data:b\r\n", "\r\n", "event\n", "\n"]);
        assert_eq!(
            events,
            vec![SseEvent { event: "message".into(), data: "a\nb".into() }, SseEvent { event: "".into(), data: "".into() }]
        );
    }

    #[test]
    fn blank_lines_alone_and_unknown_fields_produce_no_event() {
        assert_eq!(parse_stream(&["\n", "", "id: 3\n", "retry: 10\n", "\n"]), vec![]);
    }

    #[test]
    fn crit_events_map_to_review_updates() {
        let event = |name: &str| SseEvent { event: name.into(), data: String::new() };
        assert_eq!(review_update_of(&event("file-changed")), Some(ReviewUpdate::CommentsChanged));
        assert_eq!(review_update_of(&event("comments-changed")), Some(ReviewUpdate::CommentsChanged));
        assert_eq!(review_update_of(&event("finish")), Some(ReviewUpdate::Finished));
        assert_eq!(review_update_of(&event("base-changed")), None);
        assert_eq!(review_update_of(&event("")), None);
    }

    // --- unsent_comments ---

    fn sent(new: &NewReviewComment, resolved: bool) -> ReviewComment {
        ReviewComment {
            id: "c_1".into(),
            place: CommentPlace::Deck,
            lines: Some(LineRange { start: new.start_line, end: new.end_line }),
            body: new.body.clone(),
            quote: (!new.quote.is_empty()).then(|| new.quote.clone()),
            author: new.author.clone(),
            resolved,
            replies: vec![],
            created_at: None,
        }
    }

    #[test]
    fn given_a_batch_partly_sent_before_when_retried_then_only_the_rest_is_unsent() {
        let batch = [comment(1, 1, "a"), comment(2, 3, "b"), comment(5, 5, "c")];
        let existing = [sent(&batch[0], false), sent(&batch[1], false)];
        assert_eq!(unsent_comments(&batch, &existing), vec![&batch[2]]);
    }

    #[test]
    fn given_an_empty_session_when_checked_then_the_whole_batch_is_unsent() {
        let batch = [comment(1, 1, "a"), comment(2, 2, "b")];
        assert_eq!(unsent_comments(&batch, &[]), vec![&batch[0], &batch[1]]);
    }

    #[test]
    fn given_a_resolved_or_different_comment_in_the_session_when_checked_then_it_does_not_count_as_sent() {
        let batch = [comment(1, 1, "a")];
        let mut other_lines = sent(&batch[0], false);
        other_lines.lines = Some(LineRange { start: 1, end: 2 });
        let mut other_quote = sent(&batch[0], false);
        other_quote.quote = None;
        let mut other_author = sent(&batch[0], false);
        other_author.author = "Agent".into();
        for existing in [sent(&batch[0], true), other_lines, other_quote, other_author] {
            assert_eq!(unsent_comments(&batch, &[existing]), vec![&batch[0]]);
        }
    }

    #[test]
    fn given_an_empty_quote_when_matched_against_crits_missing_quote_then_they_are_the_same() {
        let mut new = comment(1, 1, "a");
        new.quote = String::new();
        assert!(unsent_comments(std::slice::from_ref(&new), &[sent(&new, false)]).is_empty());
    }

    #[test]
    fn given_an_empty_batch_when_checked_then_nothing_is_unsent() {
        assert!(unsent_comments(&[], &[]).is_empty());
    }

    // --- unsent_replies ---

    fn thread(id: &str, replies: &[(&str, &str)]) -> ReviewComment {
        ReviewComment {
            id: id.into(),
            place: CommentPlace::Deck,
            lines: Some(LineRange { start: 1, end: 1 }),
            body: "b".into(),
            quote: None,
            author: "Peitho Studio".into(),
            resolved: false,
            replies: replies
                .iter()
                .enumerate()
                .map(|(i, (author, body))| ReviewReply { id: format!("rp_{i}"), body: (*body).into(), author: (*author).into(), created_at: None })
                .collect(),
            created_at: None,
        }
    }

    fn new_reply(comment_id: &str, body: &str) -> NewReviewReply {
        NewReviewReply { comment_id: comment_id.into(), body: body.into(), author: "Peitho Studio".into() }
    }

    #[test]
    fn given_replies_sent_by_an_attempt_whose_finish_failed_when_retried_then_only_the_rest_are_unsent() {
        let batch = [new_reply("c_1", "Still too long"), new_reply("c_2", "Thanks")];
        let existing = [thread("c_1", &[("Agent", "Shortened"), ("Peitho Studio", "Still too long")]), thread("c_2", &[])];
        assert_eq!(unsent_replies(&batch, &existing), vec![&batch[1]]);
    }

    #[test]
    fn given_the_same_text_from_another_author_or_under_another_comment_when_checked_then_it_is_still_unsent() {
        let batch = [new_reply("c_1", "OK")];
        for existing in [[thread("c_1", &[("Agent", "OK")])], [thread("c_2", &[("Peitho Studio", "OK")])]] {
            assert_eq!(unsent_replies(&batch, &existing), vec![&batch[0]]);
        }
    }

    #[test]
    fn given_no_comments_or_no_replies_when_checked_then_every_reply_is_unsent_and_an_empty_batch_stays_empty() {
        let batch = [new_reply("c_1", "a")];
        assert_eq!(unsent_replies(&batch, &[]), vec![&batch[0]]);
        assert!(unsent_replies(&[], &[thread("c_1", &[])]).is_empty());
    }

    // --- session_args ---

    #[test]
    fn given_a_deck_with_layouts_and_css_when_crit_is_started_then_it_reviews_both_folders_too() {
        assert_eq!(session_args("deck.md", |_| true), vec!["deck.md", "layouts", "css"]);
    }

    #[test]
    fn given_a_deck_missing_a_layout_folder_when_crit_is_started_then_that_folder_is_left_out() {
        // crit refuses a folder that isn't there.
        assert_eq!(session_args("deck.md", |_| false), vec!["deck.md"]);
        assert_eq!(session_args("deck.md", |dir| dir == "css"), vec!["deck.md", "css"]);
        assert_eq!(session_args("talk.ja.md", |dir| dir == "layouts"), vec!["talk.ja.md", "layouts"]);
    }

    // --- session_path / deck_relative_path ---

    #[test]
    fn given_crit_in_the_decks_folder_then_a_deck_file_keeps_its_own_path() {
        assert_eq!(session_path("deck.md", "layouts/cover.html"), "layouts/cover.html");
        assert_eq!(deck_relative_path("deck.md", "layouts/cover.html"), Some("layouts/cover.html".into()));
    }

    #[test]
    fn given_crit_at_a_repository_root_then_deck_files_are_named_under_the_decks_folder() {
        assert_eq!(session_path("talks/a/deck.md", "layouts/cover.html"), "talks/a/layouts/cover.html");
        assert_eq!(deck_relative_path("talks/a/deck.md", "talks/a/css/base.css"), Some("css/base.css".into()));
    }

    #[test]
    fn a_file_outside_the_decks_folder_or_the_folder_itself_has_no_deck_relative_path() {
        assert_eq!(deck_relative_path("talks/a/deck.md", "talks/b/layouts/x.html"), None);
        assert_eq!(deck_relative_path("talks/a/deck.md", "talks/a/"), None);
        assert_eq!(deck_relative_path("talks/a/deck.md", ""), None);
    }

    // --- layout_files_in_session ---

    #[test]
    fn given_a_session_on_the_deck_and_its_folders_then_its_layout_files_are_picked_out() {
        let files: Vec<String> = ["deck.md", "layouts/cover.html", "css/base.css", "css/cover.css"].iter().map(|f| f.to_string()).collect();
        assert_eq!(layout_files_in_session(&files, "deck.md"), vec!["layouts/cover.html", "css/base.css", "css/cover.css"]);
    }

    #[test]
    fn given_files_that_are_not_layout_files_then_they_are_left_out() {
        let files: Vec<String> = [
            "talks/a/deck.md",
            "talks/a/layouts/cover.html",
            "talks/a/layouts/nested/x.html",
            "talks/a/layouts/.html",
            "talks/a/layouts/notes.md",
            "talks/a/css/x.html",
            "talks/b/layouts/other.html",
            "layouts/root.html",
            "talks/a/img/x.css",
        ]
        .iter()
        .map(|f| f.to_string())
        .collect();
        assert_eq!(layout_files_in_session(&files, "talks/a/deck.md"), vec!["talks/a/layouts/cover.html"]);
        assert!(layout_files_in_session(&[], "deck.md").is_empty());
    }

    // --- layout_html_path / layout_comment_place ---

    #[test]
    fn a_layout_name_maps_to_its_html_file() {
        assert_eq!(layout_html_path("cover").unwrap(), "layouts/cover.html");
        assert_eq!(layout_html_path("two-col_2").unwrap(), "layouts/two-col_2.html");
    }

    #[test]
    fn a_name_that_could_leave_the_layouts_folder_is_refused() {
        for name in ["", " ", "../deck", "a/b", "a\\b", ".hidden", "-x", "a.b", &"x".repeat(65)] {
            assert!(layout_html_path(name).is_err(), "{name:?} should be refused");
        }
    }

    fn layout_comment(layout: Option<&str>) -> NewLayoutComment {
        NewLayoutComment { layout: layout.map(str::to_string), body: "[Layout cover] Bigger".into(), author: STUDIO_AUTHOR.into() }
    }

    #[test]
    fn given_a_layout_with_a_file_when_commented_on_then_the_comment_goes_on_that_file() {
        let place = layout_comment_place(&layout_comment(Some("cover")), |path| path == "layouts/cover.html").unwrap();
        assert_eq!(place, CommentPlace::File { path: "layouts/cover.html".into() });
    }

    #[test]
    fn given_every_layout_or_a_layout_without_a_file_when_commented_on_then_the_comment_goes_on_the_review() {
        assert_eq!(layout_comment_place(&layout_comment(None), |_| true).unwrap(), CommentPlace::Review);
        assert_eq!(layout_comment_place(&layout_comment(Some("title-body-code")), |_| false).unwrap(), CommentPlace::Review);
    }

    #[test]
    fn given_a_layout_name_with_a_path_in_it_when_commented_on_then_it_is_refused() {
        assert!(layout_comment_place(&layout_comment(Some("../deck")), |_| true).is_err());
        assert!(layout_comment_place(&layout_comment(Some("")), |_| true).is_err());
    }

    // --- new_layout_comment_body ---

    #[test]
    fn a_comment_on_a_layout_file_is_sent_as_a_whole_file_comment() {
        let body: serde_json::Value =
            serde_json::from_str(&new_layout_comment_body(&layout_comment(Some("cover")), &CommentPlace::File { path: "layouts/cover.html".into() }).unwrap()).unwrap();
        assert_eq!(body, serde_json::json!({"scope":"file","body":"[Layout cover] Bigger","author":"Peitho Studio"}));
    }

    #[test]
    fn a_comment_on_the_review_is_sent_without_a_scope() {
        let body: serde_json::Value = serde_json::from_str(&new_layout_comment_body(&layout_comment(None), &CommentPlace::Review).unwrap()).unwrap();
        assert_eq!(body, serde_json::json!({"body":"[Layout cover] Bigger","author":"Peitho Studio"}));
    }

    #[test]
    fn a_layout_comment_without_text_or_author_or_aimed_at_the_deck_is_refused() {
        let review = CommentPlace::Review;
        assert!(new_layout_comment_body(&NewLayoutComment { body: " \n".into(), ..layout_comment(None) }, &review).is_err());
        assert!(new_layout_comment_body(&NewLayoutComment { author: "".into(), ..layout_comment(None) }, &review).is_err());
        assert!(new_layout_comment_body(&layout_comment(None), &CommentPlace::Deck).is_err());
    }

    #[test]
    fn a_layout_comment_arrives_from_the_frontend_in_camel_case() {
        let parsed: NewLayoutComment = serde_json::from_str(r#"{"layout":null,"body":"b","author":"a"}"#).unwrap();
        assert_eq!(parsed, NewLayoutComment { layout: None, body: "b".into(), author: "a".into() });
    }

    // --- endpoints by place ---

    #[test]
    fn a_comment_is_reached_through_its_file_or_the_reviews_own_routes() {
        let file = CommentPlace::File { path: "layouts/cover.html".into() };
        assert_eq!(comment_endpoint_at("c_1", "/replies", &CommentPlace::Deck, "talks/a/deck.md"), "/api/comment/c_1/replies?path=talks/a/deck.md");
        assert_eq!(comment_endpoint_at("c_1", "/resolve", &file, "talks/a/deck.md"), "/api/comment/c_1/resolve?path=talks/a/layouts/cover.html");
        assert_eq!(comment_endpoint_at("r_1", "/replies", &CommentPlace::Review, "deck.md"), "/api/review-comment/r_1/replies");
        assert_eq!(comment_endpoint_at("r/1?x", "", &CommentPlace::Review, "deck.md"), "/api/review-comment/r%2F1%3Fx");
        assert_eq!(add_endpoint_at(&file, "deck.md"), "/api/file/comments?path=layouts/cover.html");
        assert_eq!(add_endpoint_at(&CommentPlace::Review, "deck.md"), "/api/comments");
        assert_eq!(add_endpoint_at(&CommentPlace::Deck, "my deck.md"), "/api/file/comments?path=my%20deck.md");
    }

    // --- unsent_layout_comments / place_of ---

    fn sent_at(place: CommentPlace, body: &str, resolved: bool) -> ReviewComment {
        ReviewComment { place, resolved, ..review_comment("c_9", body, STUDIO_AUTHOR) }
    }

    #[test]
    fn given_a_layout_comment_already_at_its_place_when_retried_then_it_is_not_sent_again() {
        let file = CommentPlace::File { path: "layouts/cover.html".into() };
        let batch = [(layout_comment(Some("cover")), file.clone()), (layout_comment(None), CommentPlace::Review)];
        let existing = [sent_at(file, "[Layout cover] Bigger", false)];
        assert_eq!(unsent_layout_comments(&batch, &existing), vec![&batch[1]]);
    }

    #[test]
    fn given_the_same_text_elsewhere_or_resolved_when_checked_then_the_layout_comment_is_still_unsent() {
        let batch = [(layout_comment(None), CommentPlace::Review)];
        for existing in [sent_at(CommentPlace::Deck, "[Layout cover] Bigger", false), sent_at(CommentPlace::Review, "[Layout cover] Bigger", true)] {
            assert_eq!(unsent_layout_comments(&batch, &[existing]), vec![&batch[0]]);
        }
        assert!(unsent_layout_comments(&[], &[]).is_empty());
    }

    #[test]
    fn a_deck_comment_with_the_same_lines_and_text_on_a_layout_file_does_not_count_as_sent() {
        let new = comment(1, 1, "a");
        let mut on_layout = sent(&new, false);
        on_layout.place = CommentPlace::File { path: "layouts/cover.html".into() };
        assert_eq!(unsent_comments(std::slice::from_ref(&new), &[on_layout]), vec![&new]);
    }

    #[test]
    fn a_comments_place_is_found_by_its_id() {
        let comments = [sent_at(CommentPlace::Review, "b", false)];
        assert_eq!(place_of(&comments, "c_9").unwrap(), CommentPlace::Review);
        assert!(place_of(&comments, "c_missing").is_err());
        assert!(place_of(&[], "").is_err());
    }

    #[test]
    fn a_comments_place_reaches_the_frontend_as_a_tagged_union() {
        assert_eq!(serde_json::to_string(&CommentPlace::Deck).unwrap(), r#"{"kind":"deck"}"#);
        assert_eq!(serde_json::to_string(&CommentPlace::File { path: "layouts/a.html".into() }).unwrap(), r#"{"kind":"file","path":"layouts/a.html"}"#);
        assert_eq!(serde_json::to_string(&CommentPlace::Review).unwrap(), r#"{"kind":"review"}"#);
    }

    #[test]
    fn review_level_comments_are_read_with_their_place() {
        let json = r#"[{"id":"r_377d11","start_line":0,"end_line":0,"body":"[All layouts] Calmer","author":"Peitho Studio","scope":"review","created_at":"2026-10-02T14:45:51Z","review_round":1}]"#;
        let comments = parse_comments(json, &CommentPlace::Review).unwrap();
        assert_eq!(comments[0].place, CommentPlace::Review);
        assert_eq!(comments[0].lines, None);
    }
}
