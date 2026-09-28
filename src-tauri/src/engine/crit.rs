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
    #[serde(rename_all = "camelCase")]
    Found { id: String, port: u16, file: String, review_round: u32 },
    /// More than one does, and which one the agent is waiting on can't be
    /// told apart — Studio won't guess where to send comments.
    #[serde(rename_all = "camelCase")]
    Ambiguous { ids: Vec<String> },
}

pub fn select_deck_session(mut matches: Vec<DeckSessionMatch>) -> DeckSession {
    match matches.len() {
        0 => DeckSession::None,
        1 => {
            let found = matches.remove(0);
            DeckSession::Found { id: found.session.id, port: found.session.port, file: found.file, review_round: found.review_round }
        }
        _ => {
            let mut ids: Vec<String> = matches.into_iter().map(|found| found.session.id).collect();
            ids.sort();
            DeckSession::Ambiguous { ids }
        }
    }
}

/// A 1-based, inclusive line range in the deck file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub start: u32,
    pub end: u32,
}

/// A comment in the session and the replies under it, as Studio shows it.
/// crit renumbers comment ids between review rounds, so a comment is
/// followed by its `lines` and `quote`, not its `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub id: String,
    /// `None` for a comment on the whole file (crit's line 0).
    pub lines: Option<LineRange>,
    pub body: String,
    /// The Markdown the comment was made on, as Studio sent it.
    pub quote: Option<String>,
    pub author: String,
    pub resolved: bool,
    pub replies: Vec<ReviewReply>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewReply {
    pub id: String,
    pub body: String,
    pub author: String,
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
}

#[derive(Deserialize)]
struct ReplyJson {
    id: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    author: String,
}

/// A line range from crit's numbers: no range for line 0 (or below), and an
/// end before the start is read as the start alone.
fn line_range(start: i64, end: i64) -> Option<LineRange> {
    let start = u32::try_from(start).ok().filter(|start| *start > 0)?;
    let end = u32::try_from(end).ok().filter(|end| *end >= start).unwrap_or(start);
    Some(LineRange { start, end })
}

/// The comments `GET /api/file/comments?path=…` returns. An empty quote is
/// read as none.
pub fn parse_comments(json: &str) -> Result<Vec<ReviewComment>, String> {
    // crit answers `null` for a file with no comments yet.
    let comments: Option<Vec<CommentJson>> = serde_json::from_str(json).map_err(|err| format!("unexpected crit comments: {err}"))?;
    Ok(comments
        .unwrap_or_default()
        .into_iter()
        .map(|comment| ReviewComment {
            id: comment.id,
            lines: line_range(comment.start_line, comment.end_line),
            body: comment.body,
            quote: comment.quote.filter(|quote| !quote.is_empty()),
            author: comment.author,
            resolved: comment.resolved,
            replies: comment
                .replies
                .into_iter()
                .map(|reply| ReviewReply { id: reply.id, body: reply.body, author: reply.author })
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

/// `/api/file/comments?path=<file>`, with `file` percent-encoded.
pub fn comments_endpoint(file: &str) -> String {
    let mut encoded = String::new();
    for byte in file.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~/".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    format!("/api/file/comments?path={encoded}")
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
        && sent.lines == Some(LineRange { start: comment.start_line, end: comment.end_line })
        && sent.body == comment.body
        && sent.author == comment.author
        && sent.quote.as_deref().unwrap_or("") == comment.quote
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
            DeckSession::Found { id: "a".into(), port: 5000, file: "deck.md".into(), review_round: 1 }
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
            serde_json::to_string(&DeckSession::Found { id: "a".into(), port: 1, file: "deck.md".into(), review_round: 2 }).unwrap(),
            r#"{"kind":"found","id":"a","port":1,"file":"deck.md","reviewRound":2}"#
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
            parse_comments(json).unwrap(),
            vec![ReviewComment {
                id: "c_ead7d5".into(),
                lines: Some(LineRange { start: 5, end: 5 }),
                body: "Make it bigger".into(),
                quote: Some("# Hello".into()),
                author: "Studio".into(),
                resolved: false,
                replies: vec![ReviewReply { id: "rp_35db49".into(), body: "Made it bigger".into(), author: "Agent".into() }],
            }]
        );
    }

    #[test]
    fn comment_without_replies_or_quote_reads_as_empty_thread_and_no_quote() {
        let json = r#"[{"id":"c1","start_line":2,"end_line":4,"body":"b","author":"a"},{"id":"c2","start_line":1,"end_line":1,"body":"b","quote":"","author":"a"}]"#;
        let comments = parse_comments(json).unwrap();
        assert_eq!(comments[0].replies, vec![]);
        assert_eq!(comments[0].quote, None);
        assert_eq!(comments[0].lines, Some(LineRange { start: 2, end: 4 }));
        assert_eq!(comments[1].quote, None);
    }

    #[test]
    fn comment_on_line_zero_is_a_whole_file_comment() {
        let json = r#"[{"id":"c1","start_line":0,"end_line":0,"body":"overall","author":"a","scope":"file"}]"#;
        assert_eq!(parse_comments(json).unwrap()[0].lines, None);
    }

    #[test]
    fn comment_with_negative_or_reversed_lines_is_read_leniently() {
        let json = r#"[{"id":"c1","start_line":-1,"end_line":3,"body":"b"},{"id":"c2","start_line":7,"end_line":3,"body":"b"}]"#;
        let comments = parse_comments(json).unwrap();
        assert_eq!(comments[0].lines, None);
        assert_eq!(comments[1].lines, Some(LineRange { start: 7, end: 7 }));
    }

    #[test]
    fn unknown_fields_and_a_resolved_flag_are_handled() {
        let json = r#"[{"id":"c1","start_line":1,"end_line":1,"body":"b","author":"a","resolved":true,"future_field":{"x":1}}]"#;
        assert!(parse_comments(json).unwrap()[0].resolved);
    }

    #[test]
    fn no_comments_yet_reads_as_empty() {
        assert_eq!(parse_comments("[]").unwrap(), vec![]);
        assert_eq!(parse_comments("null").unwrap(), vec![]);
    }

    #[test]
    fn broken_comments_json_is_an_error() {
        for json in ["", "{}", "[{\"body\":\"no id\"}]", "[1]"] {
            assert!(parse_comments(json).is_err(), "{json:?} should be rejected");
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
            lines: Some(LineRange { start: new.start_line, end: new.end_line }),
            body: new.body.clone(),
            quote: (!new.quote.is_empty()).then(|| new.quote.clone()),
            author: new.author.clone(),
            resolved,
            replies: vec![],
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
}
