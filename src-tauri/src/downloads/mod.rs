pub mod aria2;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, Result};
use crate::state::AppState;
use aria2::Aria2Manager;

pub const MANIFEST_NAME: &str = "installed.json";
const RESUME_EXT: &str = ".ucresume";
const NON_ARCHIVE_EXTS: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg", ".bmp", ".ico", ".mp4", ".webm",
    ".mov", ".mkv", ".json", ".txt", ".md", ".log", ".html", ".htm", ".css", ".js", ".aria2",
];
const SIDECAR_STEMS: &[&str] = &[
    "image",
    "splash",
    "hero-image",
    "hero-animated",
    "hero-logo",
    "background-image",
];

pub fn safe_folder_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

fn is_sidecar(name: &str) -> bool {
    let lower = name.to_lowercase();
    if lower == MANIFEST_NAME {
        return true;
    }
    if lower == "screenshots" {
        return true;
    }
    let (stem, ext) = match lower.rfind('.') {
        Some(d) => (&lower[..d], &lower[d..]),
        None => (lower.as_str(), ""),
    };
    for s in SIDECAR_STEMS {
        if stem == *s || stem.starts_with(&format!("{s}-")) || stem.starts_with(&format!("{s}@")) {
            return true;
        }
    }
    NON_ARCHIVE_EXTS.contains(&ext)
}

#[derive(Clone)]
struct Download {
    id: String,
    appid: String,
    game_name: Option<String>,
    url: String,
    headers: Option<HashMap<String, String>>,
    filename: String,
    save_path: PathBuf,
    installing_dir: PathBuf,
    total_bytes: u64,
    received_bytes: u64,
    speed_bps: u64,
    eta_seconds: Option<u64>,
    status: String,
    error: Option<String>,
    gid: Option<String>,
}

impl Download {
    fn payload(&self) -> Value {
        json!({
            "downloadId": self.id,
            "status": self.status,
            "receivedBytes": self.received_bytes,
            "totalBytes": self.total_bytes,
            "speedBps": self.speed_bps,
            "etaSeconds": self.eta_seconds,
            "filename": self.filename,
            "savePath": self.save_path.to_string_lossy(),
            "appid": self.appid,
            "gameName": self.game_name,
            "url": self.url,
            "error": self.error,
        })
    }
}

#[derive(Default)]
struct EngineState {
    by_id: HashMap<String, Download>,
    queue: Vec<String>,
    active: Option<String>,
    gid_to_id: HashMap<String, String>,
    cancelled: HashSet<String>,
}

pub struct DownloadEngine {
    app: AppHandle,
    settings: Arc<crate::settings::SettingsStore>,
    default_root: PathBuf,
    aria2: Arc<Aria2Manager>,
    state: Mutex<EngineState>,
}

impl DownloadEngine {
    pub fn new(app: AppHandle, settings: Arc<crate::settings::SettingsStore>, default_root: PathBuf, aria2: Arc<Aria2Manager>) -> Arc<Self> {
        let engine = Arc::new(DownloadEngine {
            app,
            settings,
            default_root,
            aria2,
            state: Mutex::new(EngineState::default()),
        });
        let poll = engine.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(700)).await;
                poll.poll().await;
            }
        });
        engine
    }

    pub fn aria2(&self) -> Arc<Aria2Manager> {
        self.aria2.clone()
    }

    fn emit(&self, dl: &Download) {
        self.app.emit("uc:download-update", dl.payload()).ok();
    }

    fn root(&self) -> PathBuf {
        self.settings
            .get_string("downloadPath")
            .map(PathBuf::from)
            .unwrap_or_else(|| self.default_root.clone())
    }

    fn installing_dir(&self, game_name: &Option<String>, appid: &str) -> PathBuf {
        let folder = safe_folder_name(game_name.as_deref().unwrap_or(appid));
        let dir = self.root().join(folder);
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    fn resolve_filename(&self, dir: &Path, filename: &Option<String>, url: &str, appid: &str) -> String {
        if let Some(f) = filename {
            let t = f.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
        let manifest = dir.join(MANIFEST_NAME);
        if let Ok(text) = std::fs::read_to_string(&manifest) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if let Some(name) = v.get("downloadSnapshot").and_then(|s| s.get("filename")).and_then(|f| f.as_str()) {
                    if !name.is_empty() {
                        return name.to_string();
                    }
                }
            }
        }
        if let Ok(parsed) = url::Url::parse(url) {
            if let Some(last) = parsed.path_segments().and_then(|s| s.last()) {
                let decoded = percent_encoding::percent_decode_str(last).decode_utf8_lossy().to_string();
                if regex::Regex::new(r"(?i)\.[a-z0-9]{1,6}$").unwrap().is_match(&decoded) {
                    return decoded;
                }
            }
        }
        format!("{}.archive", safe_folder_name(appid))
    }

    fn find_partial(&self, dl: &Download) -> Option<(PathBuf, u64)> {
        for cand in [
            dl.save_path.clone(),
            PathBuf::from(format!("{}.crdownload", dl.save_path.display())),
            PathBuf::from(format!("{}{}", dl.save_path.display(), RESUME_EXT)),
        ] {
            if let Ok(meta) = std::fs::metadata(&cand) {
                if meta.is_file() && meta.len() > 0 {
                    return Some((cand, meta.len()));
                }
            }
        }
        let mut best: Option<(PathBuf, u64)> = None;
        if let Ok(entries) = std::fs::read_dir(&dl.installing_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_sidecar(&name) {
                    continue;
                }
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() && meta.len() > 0 {
                        if best.as_ref().map(|(_, s)| meta.len() > *s).unwrap_or(true) {
                            best = Some((entry.path(), meta.len()));
                        }
                    }
                }
            }
        }
        best
    }

    pub fn enqueue(self: &Arc<Self>, appid: String, game_name: Option<String>, url: String, filename: Option<String>, total_bytes: u64, id: String, headers: Option<HashMap<String, String>>) -> Result<String> {
        if appid.is_empty() {
            return Err(AppError::msg("appid required"));
        }
        let mut st = self.state.lock().unwrap();
        if st.by_id.contains_key(&id) {
            return Ok(id);
        }
        let dir = self.installing_dir(&game_name, &appid);
        let fname = self.resolve_filename(&dir, &filename, &url, &appid);
        let save_path = dir.join(&fname);
        let mut dl = Download {
            id: id.clone(),
            appid,
            game_name,
            url,
            headers,
            filename: fname,
            save_path,
            installing_dir: dir,
            total_bytes,
            received_bytes: 0,
            speed_bps: 0,
            eta_seconds: None,
            status: "queued".to_string(),
            error: None,
            gid: None,
        };
        if let Some((path, size)) = self.find_partial(&dl) {
            if path != dl.save_path {
                std::fs::rename(&path, &dl.save_path).ok();
            }
            if let Ok(meta) = std::fs::metadata(&dl.save_path) {
                dl.received_bytes = meta.len();
            } else {
                dl.received_bytes = size;
            }
        }
        st.queue.push(id.clone());
        self.emit(&dl);
        write_manifest(&dl);
        st.by_id.insert(id.clone(), dl);
        drop(st);
        self.maybe_start_next();
        Ok(id)
    }

    pub fn pause(&self, id: &str) -> bool {
        let mut st = self.state.lock().unwrap();
        let (gid, was_downloading) = match st.by_id.get_mut(id) {
            Some(dl) => {
                if dl.status == "queued" {
                    dl.status = "paused".to_string();
                    let snap = dl.clone();
                    st.queue.retain(|x| x != id);
                    self.emit(&snap);
                    write_manifest(&snap);
                    return true;
                }
                if dl.status != "downloading" {
                    return false;
                }
                dl.status = "paused".to_string();
                dl.speed_bps = 0;
                dl.eta_seconds = None;
                (dl.gid.clone(), true)
            }
            None => return false,
        };
        if let Some(dl) = st.by_id.get(id).cloned() {
            self.emit(&dl);
            write_manifest(&dl);
        }
        drop(st);
        if was_downloading {
            if let Some(gid) = gid {
                let aria2 = self.aria2.clone();
                tokio::spawn(async move { aria2.pause(&gid).await });
            }
        }
        true
    }

    pub fn resume(self: &Arc<Self>, id: &str) -> bool {
        let mut st = self.state.lock().unwrap();
        let dl = match st.by_id.get_mut(id) {
            Some(d) => d,
            None => return false,
        };
        if dl.status == "downloading" || dl.status == "queued" {
            let snap = dl.clone();
            self.emit(&snap);
            return true;
        }
        if dl.status != "paused" && dl.status != "failed" && dl.status != "cancelled" {
            return false;
        }
        let gid = dl.gid.clone();
        if let Some(gid) = gid.clone() {
            if self.aria2.is_ready() {
                dl.status = "downloading".to_string();
                let snap = dl.clone();
                self.emit(&snap);
                drop(st);
                let aria2 = self.aria2.clone();
                tokio::spawn(async move { aria2.unpause(&gid).await });
                return true;
            }
        }
        dl.status = "queued".to_string();
        let snap = dl.clone();
        if !st.queue.contains(&id.to_string()) {
            st.queue.insert(0, id.to_string());
        }
        self.emit(&snap);
        drop(st);
        self.maybe_start_next();
        true
    }

    pub fn cancel(self: &Arc<Self>, id: &str, keep_file: bool) -> Value {
        let mut st = self.state.lock().unwrap();
        st.cancelled.insert(id.to_string());
        let (gid, save_path, appid, snap) = match st.by_id.get_mut(id) {
            Some(dl) => {
                let gid = dl.gid.take();
                dl.status = "cancelled".to_string();
                dl.speed_bps = 0;
                dl.eta_seconds = None;
                dl.error = None;
                (gid, dl.save_path.clone(), dl.appid.clone(), dl.clone())
            }
            None => return json!({ "ok": false }),
        };
        if let Some(g) = &gid {
            st.gid_to_id.remove(g);
        }
        st.queue.retain(|x| x != id);
        if st.active.as_deref() == Some(id) {
            st.active = None;
        }
        self.emit(&snap);
        drop(st);
        if let Some(gid) = gid {
            let aria2 = self.aria2.clone();
            tokio::spawn(async move {
                aria2.force_remove(&gid).await;
                aria2.remove_download_result(&gid).await;
            });
        }
        if !keep_file {
            for suffix in ["", ".crdownload", RESUME_EXT, ".aria2"] {
                let p = PathBuf::from(format!("{}{}", save_path.display(), suffix));
                std::fs::remove_file(&p).ok();
            }
        }
        self.maybe_start_next();
        json!({ "ok": true, "status": "cancelled", "downloadId": id, "appid": appid })
    }

    pub fn list(&self) -> Vec<Value> {
        self.state.lock().unwrap().by_id.values().map(|d| d.payload()).collect()
    }

    pub fn active_status(&self, appid: &str) -> Value {
        let st = self.state.lock().unwrap();
        let downloading = st
            .by_id
            .values()
            .any(|d| d.appid == appid && (d.status == "downloading" || d.status == "queued"));
        json!({ "extracting": false, "downloading": downloading })
    }

    fn maybe_start_next(self: &Arc<Self>) {
        let next = {
            let mut st = self.state.lock().unwrap();
            if st.active.is_some() {
                return;
            }
            let mut chosen = None;
            while let Some(id) = st.queue.first().cloned() {
                st.queue.remove(0);
                match st.by_id.get(&id) {
                    Some(dl) if dl.status == "queued" || dl.status == "paused" || dl.status == "failed" => {
                        chosen = Some(id);
                        break;
                    }
                    _ => continue,
                }
            }
            if let Some(id) = &chosen {
                st.active = Some(id.clone());
            }
            chosen
        };
        if let Some(id) = next {
            let engine = self.clone();
            tokio::spawn(async move { engine.kick_off(id).await });
        }
    }

    async fn kick_off(self: Arc<Self>, id: String) {
        let mut dl = match self.state.lock().unwrap().by_id.get(&id).cloned() {
            Some(d) => d,
            None => return,
        };
        if let Some((path, _)) = self.find_partial(&dl) {
            if path != dl.save_path {
                std::fs::rename(&path, &dl.save_path).ok();
            }
        }
        let offset = std::fs::metadata(&dl.save_path).map(|m| m.len()).unwrap_or(0);
        if offset > 0 && dl.total_bytes > 0 && offset >= dl.total_bytes {
            dl.received_bytes = offset;
            dl.status = "completed".to_string();
            self.commit(&dl);
            self.emit(&dl);
            write_manifest(&dl);
            self.on_complete(dl).await;
            return;
        }
        dl.status = "downloading".to_string();
        dl.error = None;
        if offset > 0 {
            dl.received_bytes = offset;
        }
        self.commit(&dl);
        self.emit(&dl);

        if !self.aria2.ensure_started().await {
            self.fail(&id, "aria2 downloader unavailable, run pnpm fetch-sidecars to bundle it");
            return;
        }
        let mut options = json!({
            "dir": dl.installing_dir.to_string_lossy(),
            "out": dl.filename,
            "continue": "true",
            "auto-file-renaming": "false",
            "allow-overwrite": "true",
        });
        if let Some(headers) = &dl.headers {
            let lines: Vec<String> = headers.iter().map(|(k, v)| format!("{k}: {v}")).collect();
            if !lines.is_empty() {
                options["header"] = json!(lines);
            }
        }
        match self.aria2.add_uri(&dl.url, options).await {
            Ok(gid) => {
                let mut st = self.state.lock().unwrap();
                st.gid_to_id.insert(gid.clone(), id.clone());
                if let Some(d) = st.by_id.get_mut(&id) {
                    d.gid = Some(gid);
                }
            }
            Err(e) => self.fail(&id, &format!("aria2 download failed: {e}")),
        }
    }

    fn commit(&self, dl: &Download) {
        if let Some(existing) = self.state.lock().unwrap().by_id.get_mut(&dl.id) {
            *existing = dl.clone();
        }
    }

    fn fail(self: &Arc<Self>, id: &str, error: &str) {
        let snap = {
            let mut st = self.state.lock().unwrap();
            if let Some(dl) = st.by_id.get_mut(id) {
                dl.status = "failed".to_string();
                dl.error = Some(error.to_string());
                dl.speed_bps = 0;
                dl.eta_seconds = None;
                let snap = dl.clone();
                if st.active.as_deref() == Some(id) {
                    st.active = None;
                }
                Some(snap)
            } else {
                None
            }
        };
        if let Some(dl) = snap {
            self.emit(&dl);
            write_manifest(&dl);
        }
        self.maybe_start_next();
    }

    async fn poll(self: &Arc<Self>) {
        if !self.aria2.is_ready() {
            return;
        }
        let active: Vec<(String, String)> = {
            let st = self.state.lock().unwrap();
            st.by_id
                .values()
                .filter(|d| d.status != "completed" && d.status != "failed" && d.status != "cancelled")
                .filter_map(|d| d.gid.clone().map(|g| (d.id.clone(), g)))
                .collect()
        };
        for (id, gid) in active {
            let status = match self.aria2.tell_status(&gid).await {
                Ok(s) => s,
                Err(_) => continue,
            };
            let s = status.get("status").and_then(|v| v.as_str()).unwrap_or("");
            let completed = status.get("completedLength").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            let total = status.get("totalLength").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            let speed = status.get("downloadSpeed").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            match s {
                "complete" => self.finish_complete(&id).await,
                "error" => {
                    let msg = status.get("errorMessage").and_then(|v| v.as_str()).unwrap_or("aria2 error").to_string();
                    self.finish_error(&id, &msg);
                }
                "removed" => {
                    let mut st = self.state.lock().unwrap();
                    st.gid_to_id.remove(&gid);
                    if let Some(d) = st.by_id.get_mut(&id) {
                        d.gid = None;
                    }
                }
                _ => {
                    let snap = {
                        let mut st = self.state.lock().unwrap();
                        st.by_id.get_mut(&id).map(|dl| {
                            if total > 0 {
                                dl.total_bytes = total;
                            }
                            if completed > 0 {
                                dl.received_bytes = completed;
                            }
                            dl.status = if s == "paused" { "paused".to_string() } else { "downloading".to_string() };
                            dl.speed_bps = if s == "paused" { 0 } else { speed };
                            let remaining = total.saturating_sub(completed);
                            dl.eta_seconds = if speed > 0 && remaining > 0 { Some(remaining / speed) } else { None };
                            dl.clone()
                        })
                    };
                    if let Some(dl) = snap {
                        self.emit(&dl);
                        write_manifest(&dl);
                    }
                }
            }
        }
    }

    async fn finish_complete(self: &Arc<Self>, id: &str) {
        let snap = {
            let mut st = self.state.lock().unwrap();
            if st.active.as_deref() == Some(id) {
                st.active = None;
            }
            let dl = match st.by_id.get_mut(id) {
                Some(d) => d,
                None => return,
            };
            let gid = dl.gid.take();
            if let Ok(meta) = std::fs::metadata(&dl.save_path) {
                dl.received_bytes = meta.len();
            }
            dl.status = "completed".to_string();
            dl.speed_bps = 0;
            dl.eta_seconds = None;
            let snap = dl.clone();
            if let Some(g) = gid {
                st.gid_to_id.remove(&g);
            }
            snap
        };
        std::fs::remove_file(format!("{}{}", snap.save_path.display(), RESUME_EXT)).ok();
        self.emit(&snap);
        write_manifest(&snap);
        self.maybe_start_next();
        self.on_complete(snap).await;
    }

    fn finish_error(self: &Arc<Self>, id: &str, msg: &str) {
        {
            let mut st = self.state.lock().unwrap();
            if let Some(dl) = st.by_id.get_mut(id) {
                if let Some(g) = dl.gid.take() {
                    st.gid_to_id.remove(&g);
                }
            }
        }
        self.fail(id, msg);
    }

    async fn on_complete(self: &Arc<Self>, dl: Download) {
        crate::install::auto_install(
            self.app.clone(),
            dl.appid,
            dl.id,
            dl.game_name,
            dl.save_path,
            dl.installing_dir,
        )
        .await;
    }
}

fn write_manifest(dl: &Download) {
    let path = dl.installing_dir.join(MANIFEST_NAME);
    let mut manifest = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    if !manifest.contains_key("appid") {
        manifest.insert("appid".into(), json!(dl.appid));
    }
    if !manifest.contains_key("name") {
        manifest.insert("name".into(), json!(dl.game_name.clone().unwrap_or_else(|| dl.appid.clone())));
    }
    let install_status = match dl.status.as_str() {
        "completed" => "downloaded",
        "cancelled" => "cancelled",
        "failed" => "failed",
        "paused" => "paused",
        _ => "installing",
    };
    manifest.insert("installStatus".into(), json!(install_status));
    match &dl.error {
        Some(e) => {
            manifest.insert("installError".into(), json!(e));
        }
        None => {
            manifest.remove("installError");
        }
    }
    manifest.insert("updatedAt".into(), json!(now_ms()));
    manifest.insert(
        "downloadSnapshot".into(),
        json!({
            "url": dl.url,
            "savePath": dl.save_path.to_string_lossy(),
            "filename": dl.filename,
            "downloadId": dl.id,
            "totalBytes": dl.total_bytes,
            "receivedBytes": dl.received_bytes,
            "host": "ucfiles",
            "updatedAt": now_ms(),
        }),
    );
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, serde_json::to_string_pretty(&manifest).unwrap_or_default()).is_ok() {
        std::fs::rename(&tmp, &path).ok();
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn to_headers(v: Option<Value>) -> Option<HashMap<String, String>> {
    v.and_then(|h| h.as_object().cloned()).map(|m| {
        m.into_iter()
            .filter_map(|(k, val)| val.as_str().map(|s| (k, s.to_string())))
            .collect()
    })
}

#[tauri::command]
pub fn download_start(state: State<'_, AppState>, payload: Value) -> Value {
    let appid = payload.get("appid").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let id = payload.get("downloadId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if url.is_empty() || id.is_empty() {
        return json!({ "ok": false, "error": "url and downloadId required" });
    }
    let filename = payload.get("filename").and_then(|v| v.as_str()).map(String::from);
    let game_name = payload.get("gameName").and_then(|v| v.as_str()).map(String::from);
    let total = payload.get("totalBytes").and_then(|v| v.as_u64()).unwrap_or(0);
    let headers = to_headers(payload.get("headers").cloned());
    match state.downloads.enqueue(appid, game_name, url, filename, total, id, headers) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn download_smart_start(state: State<'_, AppState>, payload: Value) -> Value {
    let appid = payload.get("appid").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let id = payload.get("downloadId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let filename = payload.get("filename").and_then(|v| v.as_str()).map(String::from);
    let game_name = payload.get("gameName").and_then(|v| v.as_str()).map(String::from);
    let total = payload.get("totalBytes").and_then(|v| v.as_u64()).unwrap_or(0);
    match state.downloads.enqueue(appid, game_name, url, filename, total, id, None) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn download_pause(state: State<'_, AppState>, download_id: String) -> Value {
    json!({ "ok": state.downloads.pause(&download_id) })
}

#[tauri::command]
pub fn download_resume(state: State<'_, AppState>, download_id: String) -> Value {
    json!({ "ok": state.downloads.resume(&download_id) })
}

#[tauri::command]
pub fn download_cancel(state: State<'_, AppState>, download_id: String) -> Value {
    state.downloads.cancel(&download_id, false)
}

#[tauri::command]
pub fn download_active_status(state: State<'_, AppState>, appid: String) -> Value {
    state.downloads.active_status(&appid)
}

#[tauri::command]
pub fn downloads_state_load(state: State<'_, AppState>) -> Value {
    let path = state.paths.downloads_state_file();
    let downloads = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .unwrap_or_else(|| json!([]));
    json!({ "ok": true, "downloads": downloads })
}

#[tauri::command]
pub fn downloads_state_save(state: State<'_, AppState>, downloads: Value) -> Value {
    let path = state.paths.downloads_state_file();
    let count = downloads.as_array().map(|a| a.len()).unwrap_or(0);
    std::fs::write(&path, serde_json::to_string(&downloads).unwrap_or_default()).ok();
    json!({ "ok": true, "count": count })
}

#[tauri::command]
pub fn catalog_state_load(state: State<'_, AppState>) -> Value {
    let path = state.paths.catalog_state_file();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .map(|mut v| {
            if let Some(obj) = v.as_object_mut() {
                obj.insert("ok".into(), json!(true));
            }
            v
        })
        .unwrap_or_else(|| json!({ "ok": true, "games": [], "stats": {}, "updatedAt": 0, "gamesUpdatedAt": 0, "statsUpdatedAt": 0 }))
}

#[tauri::command]
pub fn catalog_state_save(state: State<'_, AppState>, payload: Value) -> Value {
    let path = state.paths.catalog_state_file();
    let mut stored = payload.clone();
    if let Some(obj) = stored.as_object_mut() {
        obj.insert("updatedAt".into(), json!(now_ms()));
    }
    std::fs::write(&path, serde_json::to_string(&stored).unwrap_or_default()).ok();
    let games = payload.get("games").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    json!({ "ok": true, "games": games, "updatedAt": now_ms() })
}

#[tauri::command]
pub fn download_path_get(state: State<'_, AppState>) -> Value {
    json!({ "path": state.download_root().to_string_lossy() })
}

#[tauri::command]
pub fn download_path_set(state: State<'_, AppState>, target_path: String) -> Value {
    state.settings.set("downloadPath", json!(target_path));
    json!({ "ok": true, "path": target_path })
}

#[tauri::command]
pub fn disk_list() -> Vec<Value> {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .map(|d| {
            let mount = d.mount_point().to_string_lossy().to_string();
            json!({
                "id": mount,
                "name": d.name().to_string_lossy(),
                "path": mount,
                "totalBytes": d.total_space(),
                "freeBytes": d.available_space(),
            })
        })
        .collect()
}
