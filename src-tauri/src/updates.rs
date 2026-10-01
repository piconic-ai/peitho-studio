//! One updater per app. Downloads are verified before they enter memory;
//! installation only happens on normal app exit, never during editing.
use std::{sync::Mutex, collections::{HashMap, HashSet}, time::{Duration, SystemTime, UNIX_EPOCH}};
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const MANIFEST_URL: &str = "https://github.com/piconic-ai/peitho-studio/releases/latest/download/latest.json";
const CHECK_INTERVAL: u64 = 24 * 60 * 60;
const EVENT: &str = "updates:changed";

#[derive(Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdatePhase {
    #[default]
    Idle,
    Unconfigured,
    Checking,
    Current,
    Available,
    Downloading,
    Ready,
    Saving,
    Installing,
    Error,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub phase: UpdatePhase,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub security: Option<String>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    pub dismissed: bool,
    pub install_on_exit: bool,
}

#[derive(Default)]
struct Inner {
    status: UpdateStatus,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    install_on_exit: bool,
    manual_install: bool,
    last_attempt: u64,
    dismissed_version: Option<String>,
    highest_version: Option<Version>,
    exit_token: u64,
    exit_acks: HashMap<String, Option<bool>>,
    exiting: bool,
    manifest: Option<SignedManifest>,
    pending_check_windows: HashSet<String>,
}

#[derive(Default)]
pub struct AppUpdates {
    inner: Mutex<Inner>,
    operation: tokio::sync::Mutex<()>,
}

#[derive(Clone, Deserialize, Serialize)]
struct SignedManifest { bytes: Vec<u8>, signature: String }
#[derive(Default, Deserialize, Serialize)]
struct History { last_attempt: u64, dismissed_version: Option<String>, manifest: Option<SignedManifest> }

fn persist(app: &AppHandle) {
    let state = app.state::<AppUpdates>();
    let inner = state.inner.lock().unwrap();
    let history = History { last_attempt: inner.last_attempt, dismissed_version: inner.dismissed_version.clone(), manifest: inner.manifest.clone() };
    if let Ok(dir) = app.path().app_config_dir() {
        if let Ok(json) = serde_json::to_vec(&history) {
            if std::fs::create_dir_all(&dir).is_ok() && std::fs::write(dir.join("update-history.tmp"), json).is_ok() {
                let _ = std::fs::rename(dir.join("update-history.tmp"), dir.join("update-history.json"));
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SecurityAdvisory {
    affected_from: String,
    fixed_in: String,
    reason: String,
}

#[derive(Debug, PartialEq)]
enum SaveOutcome { Waiting, Saved, Failed }
fn save_outcome(acks: &HashMap<String, Option<bool>>) -> SaveOutcome {
    if acks.values().any(|saved| *saved == Some(false)) { SaveOutcome::Failed }
    else if acks.values().all(|saved| *saved == Some(true)) { SaveOutcome::Saved }
    else { SaveOutcome::Waiting }
}

fn security_reason(manifest: &serde_json::Value, current: &Version, latest: &Version) -> Result<Option<String>, String> {
    let Some(value) = manifest.get("security") else { return Ok(None) };
    let advisories: Vec<SecurityAdvisory> = serde_json::from_value(value.clone()).map_err(|_| "Invalid security advisories")?;
    let mut reasons = Vec::new();
    for advisory in advisories {
        let from = Version::parse(&advisory.affected_from).map_err(|_| "Invalid affected version")?;
        let fixed = Version::parse(&advisory.fixed_in).map_err(|_| "Invalid fixed version")?;
        if from >= fixed || fixed > *latest || advisory.reason.trim().is_empty() {
            return Err("Invalid security advisory range or reason".into());
        }
        if current >= &from && current < &fixed { reasons.push(advisory.reason); }
    }
    Ok(if reasons.is_empty() { None } else { Some(reasons.join("\n")) })
}

fn verify_manifest(bytes: &[u8], signature: &str, public_key: &str) -> Result<serde_json::Value, String> {
    let decode = |s: &str| -> Result<String, String> {
        String::from_utf8(STANDARD.decode(s.trim()).map_err(|err| err.to_string())?).map_err(|err| err.to_string())
    };
    let key = PublicKey::decode(&decode(public_key)?).map_err(|err| err.to_string())?;
    let sig = Signature::decode(&decode(signature)?).map_err(|err| err.to_string())?;
    key.verify(bytes, &sig, true).map_err(|err| err.to_string())?;
    serde_json::from_slice(bytes).map_err(|err| err.to_string())
}

fn public_key(app: &AppHandle) -> Option<String> {
    app.config().plugins.0.get("updater")?.get("pubkey")?.as_str().filter(|key| !key.trim().is_empty()).map(str::to_owned)
}

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn due(last: u64, time: u64) -> bool { last == 0 || time.saturating_sub(last) >= CHECK_INTERVAL }

fn publish(app: &AppHandle) -> UpdateStatus {
    let status = get_update_status(app.clone());
    let _ = app.emit(EVENT, &status);
    status
}

fn fail(app: &AppHandle, error: String) -> UpdateStatus {
    let state = app.state::<AppUpdates>();
    {
        let mut inner = state.inner.lock().unwrap();
        inner.status.phase = UpdatePhase::Error;
        inner.status.error = Some(error);
    }
    publish(app)
}

#[tauri::command]
pub fn get_update_status(app: AppHandle) -> UpdateStatus {
    let state = app.state::<AppUpdates>();
    let inner = state.inner.lock().unwrap();
    let mut status = inner.status.clone();
    status.install_on_exit = inner.install_on_exit;
    status
}

async fn fetch_signed_manifest(public_key: &str) -> Result<(serde_json::Value, SignedManifest), String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(|err| err.to_string())?;
    async fn read(client: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
        let mut response = client.get(url).send().await.map_err(|err| err.to_string())?.error_for_status().map_err(|err| err.to_string())?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? {
            if bytes.len() + chunk.len() > limit { return Err("Update metadata is too large".into()); }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
    let bytes = read(&client, MANIFEST_URL, 1024 * 1024).await?;
    let signature = String::from_utf8(read(&client, &format!("{MANIFEST_URL}.sig"), 8192).await?).map_err(|err| err.to_string())?;
    let manifest = verify_manifest(&bytes, &signature, public_key)?;
    Ok((manifest, SignedManifest { bytes, signature }))
}

async fn check(app: &AppHandle, automatic: bool) -> Result<UpdateStatus, String> {
    let state = app.state::<AppUpdates>();
    // Share an in-flight check/download rather than start another request.
    let operation = match state.operation.try_lock() {
        Ok(lock) => lock,
        Err(_) => {
            let _lock = state.operation.lock().await;
            return Ok(get_update_status(app.clone()));
        }
    };
    if automatic {
        let settings = crate::settings::read_settings(app);
        let inner = state.inner.lock().unwrap();
        if !settings.auto_check_updates || !due(inner.last_attempt, now()) || inner.bytes.is_some() {
            let mut status = inner.status.clone();
            status.install_on_exit = inner.install_on_exit;
            return Ok(status);
        }
    }
    let Some(key) = public_key(app) else {
        state.inner.lock().unwrap().status.phase = UpdatePhase::Unconfigured;
        return Ok(publish(app));
    };
    {
        let mut inner = state.inner.lock().unwrap();
        if inner.bytes.is_some() {
            let mut status = inner.status.clone();
            status.install_on_exit = inner.install_on_exit;
            return Ok(status);
        }
        inner.last_attempt = now();
        inner.status.phase = UpdatePhase::Checking;
        inner.status.error = None;
        inner.update = None;
    }
    publish(app);
    persist(app);
    let result = async {
        let (manifest, signed) = fetch_signed_manifest(&key).await?;
        let version = Version::parse(manifest.get("version").and_then(|v| v.as_str()).ok_or("Missing update version")?).map_err(|err| err.to_string())?;
        if !version.pre.is_empty() { return Err("The stable update channel contains a prerelease".into()); }
        {
            let mut inner = state.inner.lock().unwrap();
            if inner.highest_version.as_ref().is_some_and(|previous| &version < previous) { return Err("The update manifest was rolled back".into()); }
            inner.highest_version = Some(version.clone());
        }
        let current = &app.package_info().version;
        let security = security_reason(&manifest, current, &version)?;
        {
            let mut inner = state.inner.lock().unwrap();
            inner.status.security = security.clone();
            inner.status.version = if version > *current { Some(version.to_string()) } else { None };
            inner.status.notes = manifest.get("notes").and_then(|v| v.as_str()).map(str::to_owned);
            inner.status.dismissed = security.is_none() && inner.dismissed_version == inner.status.version;
            inner.manifest = Some(signed.clone());
        }
        // A verified security notice remains available even if fetching the
        // platform-specific archive metadata fails or the app goes offline.
        persist(app);
        publish(app);
        let update = app.updater_builder().timeout(Duration::from_secs(30)).build().map_err(|err| err.to_string())?.check().await.map_err(|err| err.to_string())?;
        if let Some(update) = &update {
            if update.raw_json != manifest { return Err("Update information changed during verification. Please retry.".into()); }
        } else if version > *current {
            return Err("The announced update is not available for this app".into());
        }
        let mut inner = state.inner.lock().unwrap();
        inner.status = UpdateStatus {
            phase: if update.is_some() { UpdatePhase::Available } else { UpdatePhase::Current },
            version: update.as_ref().map(|u| u.version.clone()),
            notes: update.as_ref().and_then(|u| u.body.clone()),
            dismissed: security.is_none() && inner.dismissed_version.as_ref().is_some_and(|v| v == &version.to_string()),
            security,
            ..Default::default()
        };
        inner.update = update;
        inner.manifest = Some(signed);
        Ok::<(), String>(())
    }.await;
    if let Err(error) = result { return Ok(fail(app, error)); }
    persist(app);
    publish(app);
    drop(operation);
    if crate::settings::read_settings(app).auto_update && state.inner.lock().unwrap().update.is_some() {
        download(app, false).await?;
    }
    Ok(get_update_status(app.clone()))
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateStatus, String> { check(&app, false).await }

async fn download(app: &AppHandle, manual: bool) -> Result<UpdateStatus, String> {
    let state = app.state::<AppUpdates>();
    let _operation = state.operation.lock().await;
    if !manual && !crate::settings::read_settings(app).auto_update { return Ok(get_update_status(app.clone())); }
    let update = {
        let mut inner = state.inner.lock().unwrap();
        if inner.bytes.is_some() {
            inner.manual_install |= manual;
            inner.install_on_exit = inner.manual_install || crate::settings::read_settings(app).auto_update;
            drop(inner);
            return Ok(publish(app));
        }
        let update = inner.update.clone().ok_or("No update is available")?;
        inner.status.phase = UpdatePhase::Downloading;
        inner.status.error = None;
        inner.status.downloaded = 0;
        inner.status.total = None;
        update
    };
    publish(app);
    let downloaded = update.download(|length, total| {
        {
            let mut inner = state.inner.lock().unwrap();
            inner.status.downloaded += length as u64;
            inner.status.total = total;
        }
        publish(app);
    }, || {}).await;
    match downloaded {
        Ok(bytes) => {
            let mut inner = state.inner.lock().unwrap();
            inner.bytes = Some(bytes);
            inner.manual_install = manual;
            inner.install_on_exit = manual || crate::settings::read_settings(app).auto_update;
            inner.status.phase = UpdatePhase::Ready;
        }
        Err(error) => { return Ok(fail(app, error.to_string())); }
    }
    Ok(publish(app))
}

// Preparing an update does not grant web content the ability to restart
// or quit the application. Installation waits for the user's normal quit.
#[tauri::command]
pub async fn prepare_update(app: AppHandle) -> Result<UpdateStatus, String> {
    let needs_check = app.state::<AppUpdates>().inner.lock().unwrap().update.is_none();
    if needs_check { check(&app, false).await?; }
    download(&app, true).await
}

#[tauri::command]
pub fn dismiss_update(app: AppHandle) -> UpdateStatus {
    {
        let state = app.state::<AppUpdates>();
        let mut inner = state.inner.lock().unwrap();
        if inner.status.security.is_none() {
            inner.dismissed_version = inner.status.version.clone();
            inner.status.dismissed = true;
        }
    }
    persist(&app);
    publish(&app)
}

pub fn settings_changed(app: &AppHandle, settings: &crate::settings::Settings) {
    let state = app.state::<AppUpdates>();
    {
        let mut inner = state.inner.lock().unwrap();
        inner.install_on_exit = inner.manual_install || settings.auto_update;
    }
    publish(app);
    if settings.auto_check_updates {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let available = app.state::<AppUpdates>().inner.lock().unwrap().update.is_some();
            if available && crate::settings::read_settings(&app).auto_update { let _ = download(&app, false).await; }
            else {
                let cached = app.state::<AppUpdates>().inner.lock().unwrap().status.version.is_some();
                let automatic = !(cached && crate::settings::read_settings(&app).auto_update);
                let _ = check(&app, automatic).await;
            }
        });
    }
}

#[tauri::command]
pub fn open_update_releases(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let version = app.state::<AppUpdates>().inner.lock().unwrap().status.version.clone();
    let url = match version.as_deref().and_then(|value| Version::parse(value).ok()) {
        Some(version) => format!("https://github.com/piconic-ai/peitho-studio/releases/tag/v{version}"),
        None => "https://github.com/piconic-ai/peitho-studio/releases".to_string(),
    };
    app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn take_update_check(app: AppHandle, window: tauri::WebviewWindow) -> bool {
    app.state::<AppUpdates>().inner.lock().unwrap().pending_check_windows.remove(window.label())
}

pub fn show_check_window(app: &AppHandle) -> tauri::Result<()> {
    let windows = app.webview_windows();
    let studio = windows.values().filter(|window| window.label() != "about")
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.values().find(|window| window.label() != "about"));
    if let Some(window) = studio {
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit_to(window.label(), "menu:check-updates", ());
    } else {
        app.state::<AppUpdates>().inner.lock().unwrap().pending_check_windows.insert("main".into());
        if let Err(error) = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("Peitho Studio").inner_size(1440.0, 900.0).build() {
            app.state::<AppUpdates>().inner.lock().unwrap().pending_check_windows.remove("main");
            return Err(error);
        }
    }
    Ok(())
}

pub fn blocks_editing(app: &AppHandle) -> bool {
    let state = app.state::<AppUpdates>();
    let inner = state.inner.lock().unwrap();
    inner.status.phase == UpdatePhase::Saving || inner.status.phase == UpdatePhase::Installing
}

pub fn ensure_can_open_deck(app: &AppHandle) -> Result<(), String> {
    if blocks_editing(app) { Err("Please wait for the update to finish".into()) } else { Ok(()) }
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            let _ = check(&app, true).await;
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

#[tauri::command]
pub fn acknowledge_update_save(app: AppHandle, window: tauri::WebviewWindow, token: u64, saved: bool) {
    let state = app.state::<AppUpdates>();
    let mut inner = state.inner.lock().unwrap();
    if token == inner.exit_token {
        if let Some(ack) = inner.exit_acks.get_mut(window.label()) { *ack = Some(saved); }
    }
}

// Keep the event loop running while saves and macOS authorization complete.
// Installing in RunEvent::Exit would deadlock the updater's admin dialog.
pub fn intercept_exit(app: &AppHandle, api: &tauri::ExitRequestApi) {
    let state = app.state::<AppUpdates>();
    let token = {
        let mut inner = state.inner.lock().unwrap();
        if inner.exiting { return; }
        if inner.status.phase == UpdatePhase::Saving || inner.status.phase == UpdatePhase::Installing {
            api.prevent_exit();
            return;
        }
        if !inner.install_on_exit || inner.bytes.is_none() { return; }
        api.prevent_exit();
        inner.exit_token += 1;
        inner.exit_acks = app.webview_windows().keys().filter(|label| label.as_str() != "about").map(|label| (label.clone(), None)).collect();
        inner.status.phase = UpdatePhase::Saving;
        inner.status.error = None;
        inner.exit_token
    };
    publish(app);
    let _ = app.emit("updates:before-exit", token);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppUpdates>();
        let _operation = state.operation.lock().await;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        loop {
            let result = {
                let inner = state.inner.lock().unwrap();
                save_outcome(&inner.exit_acks)
            };
            if result == SaveOutcome::Failed || tokio::time::Instant::now() >= deadline {
                let mut inner = state.inner.lock().unwrap();
                inner.status.phase = UpdatePhase::Ready;
                inner.status.error = Some("Could not save every window. Save your work and try quitting again.".into());
                drop(inner);
                publish(&app);
                return;
            }
            if result == SaveOutcome::Saved { break; }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        // A window opened while we waited has not consented or saved.
        let changed = {
            let inner = state.inner.lock().unwrap();
            app.webview_windows().keys().any(|label| label != "about" && !inner.exit_acks.contains_key(label))
        };
        if changed {
            fail(&app, "A new window opened. Please try quitting again.".into());
            return;
        }
        let (update, bytes) = {
            let mut inner = state.inner.lock().unwrap();
            inner.status.phase = UpdatePhase::Installing;
            (inner.update.clone().unwrap(), inner.bytes.take().unwrap())
        };
        publish(&app);
        let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
        match result {
            Ok(Ok(())) => {
                state.inner.lock().unwrap().exiting = true;
                app.exit(0);
            }
            result => {
                let error = match result { Ok(Err(error)) => error.to_string(), Err(error) => error.to_string(), _ => unreachable!() };
                fail(&app, error);
                // A failed install is never silently retried on another quit.
                let mut inner = state.inner.lock().unwrap();
                inner.install_on_exit = false;
                inner.manual_install = false;
            }
        }
    });
}

pub fn initialize(app: &AppHandle) {
    let state = app.state::<AppUpdates>();
    let mut inner = state.inner.lock().unwrap();
    inner.status.phase = if public_key(app).is_some() { UpdatePhase::Idle } else { UpdatePhase::Unconfigured };
    if let Ok(dir) = app.path().app_config_dir() {
        if let Ok(bytes) = std::fs::read(dir.join("update-history.json")) {
            if let Ok(history) = serde_json::from_slice::<History>(&bytes) {
                inner.last_attempt = history.last_attempt.min(now());
                inner.dismissed_version = history.dismissed_version;
                if let (Some(signed), Some(key)) = (history.manifest, public_key(app)) {
                    if let Ok(manifest) = verify_manifest(&signed.bytes, &signed.signature, &key) {
                        if let Some(version) = manifest.get("version").and_then(|v| v.as_str()).and_then(|v| Version::parse(v).ok()).filter(|v| v.pre.is_empty()) {
                            let current = &app.package_info().version;
                            if let Ok(security) = security_reason(&manifest, current, &version) {
                                inner.highest_version = Some(version.clone());
                                if version > *current {
                                    inner.status.phase = UpdatePhase::Available;
                                    inner.status.version = Some(version.to_string());
                                    inner.status.notes = manifest.get("notes").and_then(|v| v.as_str()).map(str::to_owned);
                                    inner.status.dismissed = security.is_none() && inner.dismissed_version == inner.status.version;
                                    inner.status.security = security;
                                }
                                inner.manifest = Some(signed);
                            }
                        }
                    }
                }
            }
        }
        if let Ok(error) = std::fs::read_to_string(dir.join("update-error.txt")) {
            inner.status.phase = UpdatePhase::Error;
            inner.status.error = Some(error);
            let _ = std::fs::remove_file(dir.join("update-error.txt"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn installation_waits_for_every_window_and_rejects_any_failed_save() {
        let mut acks = HashMap::from([("main".into(), None), ("deck-2".into(), None)]);
        assert_eq!(save_outcome(&acks), SaveOutcome::Waiting);
        acks.insert("main".into(), Some(true));
        assert_eq!(save_outcome(&acks), SaveOutcome::Waiting);
        acks.insert("deck-2".into(), Some(true));
        assert_eq!(save_outcome(&acks), SaveOutcome::Saved);
        acks.insert("deck-2".into(), Some(false));
        assert_eq!(save_outcome(&acks), SaveOutcome::Failed);
        acks.insert("main".into(), None);
        assert_eq!(save_outcome(&acks), SaveOutcome::Failed);
        assert_eq!(save_outcome(&HashMap::new()), SaveOutcome::Saved);
    }
    #[test]
    fn security_targets_only_affected_versions() {
        let manifest = json!({"security":[{"affectedFrom":"0.1.0-rc.1","fixedIn":"0.1.1","reason":"Unsafe previews"}]});
        let latest = Version::parse("0.1.2").unwrap();
        for (version, affected) in [("0.1.0-rc.1",true),("0.1.0",true),("0.1.1",false),("0.1.2",false),("0.0.9",false)] {
            assert_eq!(security_reason(&manifest, &Version::parse(version).unwrap(), &latest).unwrap().is_some(), affected);
        }
    }
    #[test]
    fn invalid_security_metadata_is_rejected() {
        let current = Version::parse("1.0.0").unwrap();
        for security in [json!(true),json!([{}]),json!([{"affectedFrom":"1.0.0","fixedIn":"1.0.0","reason":"x"}]),json!([{"affectedFrom":"bad","fixedIn":"1.1.0","reason":"x"}]),json!([{"affectedFrom":"0.1.0","fixedIn":"2.0.0","reason":"x"}])] {
            assert!(security_reason(&json!({"security":security}), &current, &current).is_err());
        }
        assert!(security_reason(&json!({}), &current, &current).unwrap().is_none());
    }
    #[test]
    fn scheduler_boundaries_and_clock_rollback() {
        assert!(due(0, 1));
        assert!(!due(100, 99));
        assert!(!due(100, 100 + CHECK_INTERVAL - 1));
        assert!(due(100, 100 + CHECK_INTERVAL));
    }
    #[test]
    fn signed_manifest_is_authenticated_and_tampering_is_rejected() {
        // A disposable test key generated by Tauri CLI; no private key is stored.
        let bytes = include_bytes!("fixtures/updates/latest.json");
        let signature = include_str!("fixtures/updates/latest.json.sig");
        let public_key = include_str!("fixtures/updates/test.pub");
        let manifest = verify_manifest(bytes, signature, public_key).unwrap();
        assert_eq!(manifest["version"], "1.1.0");
        let altered = String::from_utf8(bytes.to_vec()).unwrap().replace("1.1.0", "9.9.9");
        assert!(verify_manifest(altered.as_bytes(), signature, public_key).is_err());
        let mut changed_signature = STANDARD.decode(signature.trim()).unwrap();
        let index = changed_signature.iter().position(|byte| *byte == b'\n').unwrap() + 10;
        changed_signature[index] = if changed_signature[index] == b'A' { b'B' } else { b'A' };
        assert!(verify_manifest(bytes, &STANDARD.encode(changed_signature), public_key).is_err());
    }
    #[test]
    fn invalid_signatures_and_keys_are_rejected() {
        for (sig,key) in [("", ""),("invalid", "invalid"),("eA==", "eA==")] {
            assert!(verify_manifest(b"{}",sig,key).is_err());
        }
    }
}
