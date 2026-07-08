pub mod aria2;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, Result};
use crate::state::AppState;
use aria2::Aria2Manager;

pub const MANIFEST_NAME: &str = "installed.json";

// Steady-progress manifest checkpoints are throttled to this interval; status
// transitions (queued/downloading/paused/completed/failed/cancelled) still
// write immediately, so on-disk state never misses a lifecycle change.
const MANIFEST_CHECKPOINT_INTERVAL: Duration = Duration::from_secs(5);
// Raw per-tick speed jitter would defeat the poll emit dedupe (a stalled
// download's speed wobbles a few KB/s); compare speeds at this granularity.
const SPEED_EMIT_QUANTUM: u64 = 50 * 1024;

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
        return "unknown".to_string();
    }
    // Dodge Windows device names, which can't be used as file/folder names.
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = trimmed.split('.').next().unwrap_or(trimmed).to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return format!("_{trimmed}");
    }
    trimmed.to_string()
}

fn sanitize_filename(name: &str) -> String {
    // Reduce to a bare basename (strip path components from either platform), map
    // filesystem-invalid characters, and drop trailing dots/spaces so titles like
    // "Half-Life: Alyx" still produce a creatable file on Windows.
    let base = name.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(|c| c == '.' || c == ' ');
    if trimmed.is_empty() {
        "download.archive".to_string()
    } else {
        trimmed.to_string()
    }
}

pub struct DownloadRequest {
    pub appid: String,
    pub id: String,
    pub game_name: Option<String>,
    pub url: String,
    pub filename: Option<String>,
    pub total_bytes: u64,
    pub headers: Option<HashMap<String, String>>,
    pub part_index: Option<u64>,
    pub part_total: Option<u64>,
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
    part_index: Option<u64>,
    part_total: Option<u64>,
    poll_failures: u32,
    // Last time this download's manifest hit disk from the poll loop; gates
    // steady-progress checkpoints, never lifecycle writes.
    last_manifest_write: Instant,
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
            "partIndex": self.part_index,
            "partTotal": self.part_total,
        })
    }
}

#[derive(Default)]
struct EngineState {
    by_id: HashMap<String, Download>,
    queue: Vec<String>,
    active: std::collections::HashSet<String>,
    gid_to_id: HashMap<String, String>,
}

pub struct DownloadEngine {
    app: AppHandle,
    settings: Arc<crate::settings::SettingsStore>,
    default_root: PathBuf,
    aria2: Arc<Aria2Manager>,
    state: Mutex<EngineState>,
    extracting: Mutex<std::collections::HashSet<String>>,
    install_guard: Mutex<std::collections::HashSet<String>>,
}

impl DownloadEngine {
    pub fn new(app: AppHandle, settings: Arc<crate::settings::SettingsStore>, default_root: PathBuf, aria2: Arc<Aria2Manager>) -> Arc<Self> {
        let engine = Arc::new(DownloadEngine {
            app,
            settings,
            default_root,
            aria2,
            state: Mutex::new(EngineState::default()),
            extracting: Mutex::new(Default::default()),
            install_guard: Mutex::new(Default::default()),
        });
        let poll = engine.clone();
        tauri::async_runtime::spawn(async move {
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
                let has_ext = decoded
                    .rsplit_once('.')
                    .map(|(stem, ext)| !stem.is_empty() && (1..=6).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric()))
                    .unwrap_or(false);
                if has_ext {
                    return decoded;
                }
            }
        }
        format!("{}.archive", safe_folder_name(appid))
    }

    pub fn enqueue(self: &Arc<Self>, req: DownloadRequest) -> Result<String> {
        let DownloadRequest { appid, id, game_name, url, filename, total_bytes, headers, part_index, part_total } = req;
        if appid.is_empty() {
            return Err(AppError::msg("appid required"));
        }
        let mut st = self.state.lock();
        if let Some(existing) = st.by_id.get(&id) {
            if !matches!(existing.status.as_str(), "failed" | "cancelled" | "completed") {
                return Ok(id);
            }
            st.queue.retain(|x| x != &id);
        }
        let dir = self.installing_dir(&game_name, &appid);
        let fname = sanitize_filename(&self.resolve_filename(&dir, &filename, &url, &appid));
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
            part_index,
            part_total,
            poll_failures: 0,
            last_manifest_write: Instant::now(),
        };
        if let Ok(meta) = std::fs::metadata(&dl.save_path) {
            dl.received_bytes = meta.len();
        }
        st.queue.push(id.clone());
        self.emit(&dl);
        let snap = dl.clone();
        st.by_id.insert(id.clone(), dl);
        drop(st);
        write_manifest(&snap);
        self.maybe_start_next();
        Ok(id)
    }

    pub fn pause(&self, id: &str) -> bool {
        let mut st = self.state.lock();
        let (snap, gid, was_downloading) = match st.by_id.get_mut(id) {
            Some(dl) if dl.status == "queued" => {
                dl.status = "paused".to_string();
                let snap = dl.clone();
                st.queue.retain(|x| x != id);
                (snap, None, false)
            }
            Some(dl) if dl.status == "downloading" => {
                dl.status = "paused".to_string();
                dl.speed_bps = 0;
                dl.eta_seconds = None;
                (dl.clone(), dl.gid.clone(), true)
            }
            _ => return false,
        };
        drop(st);
        self.emit(&snap);
        write_manifest(&snap);
        if was_downloading {
            if let Some(gid) = gid {
                let aria2 = self.aria2.clone();
                tauri::async_runtime::spawn(async move { aria2.pause(&gid).await });
            }
        }
        true
    }

    pub fn resume(self: &Arc<Self>, id: &str) -> bool {
        let mut st = self.state.lock();
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
        // Only a paused download holds a gid that aria2 can unpause. A failed or
        // cancelled one sits in aria2's stopped list (or is gone entirely), where
        // unpause is a silent no-op and the next poll would just re-surface the
        // stale error and flip the download straight back to "failed". Drop the
        // dead handle and go through a fresh add_uri instead, which resumes from
        // the on-disk partial via --continue.
        if dl.status == "paused" {
            if let Some(gid) = dl.gid.clone() {
                if self.aria2.is_ready() {
                    dl.status = "downloading".to_string();
                    let snap = dl.clone();
                    self.emit(&snap);
                    drop(st);
                    let aria2 = self.aria2.clone();
                    tauri::async_runtime::spawn(async move { aria2.unpause(&gid).await });
                    return true;
                }
            }
        }
        let taken_gid = dl.gid.take();
        dl.status = "queued".to_string();
        dl.error = None;
        dl.poll_failures = 0;
        let snap = dl.clone();
        if let Some(gid) = taken_gid {
            st.gid_to_id.remove(&gid);
            let aria2 = self.aria2.clone();
            tauri::async_runtime::spawn(async move { aria2.remove_download_result(&gid).await });
        }
        if !st.queue.contains(&id.to_string()) {
            st.queue.insert(0, id.to_string());
        }
        st.active.remove(id);
        self.emit(&snap);
        drop(st);
        write_manifest(&snap);
        self.maybe_start_next();
        true
    }

    pub fn cancel(self: &Arc<Self>, id: &str, keep_file: bool) -> Value {
        let mut st = self.state.lock();
        let (gid, save_path, appid, total_bytes, was_completed) = match st.by_id.get(id) {
            Some(dl) => (
                dl.gid.clone(),
                dl.save_path.clone(),
                dl.appid.clone(),
                dl.total_bytes,
                dl.status == "completed",
            ),
            None => return json!({ "ok": false }),
        };
        // A fully-downloaded archive is ready to install, not garbage: keep the file and
        // report install_ready instead of deleting it. Decided per download-id (part).
        let control_present = PathBuf::from(format!("{}.aria2", save_path.display())).exists();
        let file_len = std::fs::metadata(&save_path).map(|m| m.len()).unwrap_or(0);
        let archive_complete =
            was_completed || (total_bytes > 0 && file_len >= total_bytes && !control_present);
        let snap = match st.by_id.get_mut(id) {
            Some(dl) => {
                dl.gid = None;
                dl.speed_bps = 0;
                dl.eta_seconds = None;
                dl.error = None;
                if archive_complete {
                    dl.status = "completed".to_string();
                    dl.received_bytes = file_len.max(dl.received_bytes);
                } else {
                    dl.status = "cancelled".to_string();
                }
                dl.clone()
            }
            None => return json!({ "ok": false }),
        };
        if let Some(g) = &gid {
            st.gid_to_id.remove(g);
        }
        st.queue.retain(|x| x != id);
        st.active.remove(id);
        self.emit(&snap);
        drop(st);
        if archive_complete {
            // Persist installStatus "downloaded" so the archive can be installed later.
            write_manifest(&snap);
        }
        // Release the aria2 handle first, then delete on disk in the same task so aria2
        // can't re-create partials (Linux) or block the delete (Windows).
        let should_delete = !archive_complete && !keep_file;
        let aria2 = self.aria2.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(gid) = gid {
                aria2.force_remove(&gid).await;
                aria2.remove_download_result(&gid).await;
            }
            if should_delete {
                for suffix in ["", ".aria2"] {
                    let p = PathBuf::from(format!("{}{}", save_path.display(), suffix));
                    std::fs::remove_file(&p).ok();
                }
            }
        });
        self.maybe_start_next();
        let status = if archive_complete { "install_ready" } else { "cancelled" };
        json!({ "ok": true, "status": status, "downloadId": id, "appid": appid })
    }

    pub fn busy_appids(&self) -> (usize, Vec<String>) {
        let extracting: Vec<String> = self.extracting.lock().iter().cloned().collect();
        let downloading = self.state.lock()
            .by_id
            .values()
            .filter(|d| d.status == "downloading")
            .count();
        (downloading, extracting)
    }

    pub fn set_extracting(&self, appid: &str, on: bool) {
        let mut ex = self.extracting.lock();
        if on {
            ex.insert(appid.to_string());
        } else {
            ex.remove(appid);
        }
    }

    pub fn try_install_lock(&self, appid: &str) -> bool {
        self.install_guard.lock().insert(appid.to_string())
    }

    pub fn install_unlock(&self, appid: &str) {
        self.install_guard.lock().remove(appid);
    }

    pub fn appid_active(&self, appid: &str) -> bool {
        self.state.lock()
            .by_id
            .values()
            .any(|d| d.appid == appid && (d.status == "downloading" || d.status == "queued"))
    }

    pub fn active_status(&self, appid: &str) -> Value {
        let extracting = self.extracting.lock().contains(appid);
        let st = self.state.lock();
        let downloading = st
            .by_id
            .values()
            .any(|d| d.appid == appid && (d.status == "downloading" || d.status == "queued"));
        json!({ "extracting": extracting, "downloading": downloading })
    }

    fn max_concurrent(&self) -> usize {
        self.settings
            .get("maxConcurrentDownloads")
            .as_u64()
            .map(|n| n.clamp(1, 8) as usize)
            .unwrap_or(3)
    }

    fn maybe_start_next(self: &Arc<Self>) {
        let limit = self.max_concurrent();
        let mut to_start = Vec::new();
        {
            let mut st = self.state.lock();
            while st.active.len() < limit {
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
                match chosen {
                    Some(id) => {
                        st.active.insert(id.clone());
                        to_start.push(id);
                    }
                    None => break,
                }
            }
        }
        for id in to_start {
            let engine = self.clone();
            tauri::async_runtime::spawn(async move { engine.kick_off(id).await });
        }
    }

    async fn kick_off(self: Arc<Self>, id: String) {
        let mut dl = match self.state.lock().by_id.get(&id).cloned() {
            Some(d) => d,
            None => return,
        };
        let offset = std::fs::metadata(&dl.save_path).map(|m| m.len()).unwrap_or(0);
        // aria2 --split writes segments at high offsets, so file length can reach total
        // long before the content is complete; the `.aria2` control file is the real
        // completion signal. Only short-circuit when it is absent.
        let control_present = PathBuf::from(format!("{}.aria2", dl.save_path.display())).exists();
        if offset > 0 && dl.total_bytes > 0 && offset >= dl.total_bytes && !control_present {
            dl.received_bytes = offset;
            dl.status = "completed".to_string();
            self.commit(&dl);
            self.emit(&dl);
            write_manifest(&dl);
            {
                let mut st = self.state.lock();
                st.active.remove(&id);
            }
            self.maybe_start_next();
            let engine = self.clone();
            tauri::async_runtime::spawn(async move { engine.on_complete(dl).await });
            return;
        }
        dl.status = "downloading".to_string();
        dl.error = None;
        if offset > 0 {
            dl.received_bytes = offset;
        }
        self.commit(&dl);
        self.emit(&dl);

        let limit_kbps = self.settings.get("downloadBandwidthLimitKBps").as_u64().unwrap_or(0);
        if !self.aria2.ensure_started(limit_kbps).await {
            self.fail(&id, "aria2 downloader unavailable, run pnpm fetch-sidecars to bundle it");
            return;
        }
        let conns = self
            .settings
            .get("aria2ConnectionsPerDownload")
            .as_u64()
            .map(|n| n.clamp(1, 16))
            .unwrap_or(8);
        let mut options = json!({
            "dir": dl.installing_dir.to_string_lossy(),
            "out": dl.filename,
            "continue": "true",
            "auto-file-renaming": "false",
            "allow-overwrite": "true",
            "max-connection-per-server": conns.to_string(),
            "split": conns.to_string(),
        });
        if let Some(headers) = &dl.headers {
            let lines: Vec<String> = headers.iter().map(|(k, v)| format!("{k}: {v}")).collect();
            if !lines.is_empty() {
                options["header"] = json!(lines);
            }
        }
        match self.aria2.add_uri(&dl.url, options).await {
            Ok(gid) => {
                let (keep, should_pause) = {
                    let mut st = self.state.lock();
                    match st.by_id.get_mut(&id) {
                        Some(d) if d.status != "cancelled" => {
                            d.gid = Some(gid.clone());
                            let paused = d.status == "paused";
                            st.gid_to_id.insert(gid.clone(), id.clone());
                            (true, paused)
                        }
                        _ => (false, false),
                    }
                };
                if !keep {
                    let aria2 = self.aria2.clone();
                    tauri::async_runtime::spawn(async move {
                        aria2.force_remove(&gid).await;
                        aria2.remove_download_result(&gid).await;
                    });
                } else if should_pause {
                    // Paused during the startup window; stop the freshly-attached download.
                    self.aria2.pause(&gid).await;
                }
            }
            Err(e) => self.fail(&id, &format!("aria2 download failed: {e}")),
        }
    }

    fn commit(&self, dl: &Download) {
        if let Some(existing) = self.state.lock().by_id.get_mut(&dl.id) {
            // Preserve a cancel/pause the user issued during the startup window instead
            // of reverting it with this stale startup snapshot.
            if matches!(existing.status.as_str(), "cancelled" | "paused") {
                return;
            }
            *existing = dl.clone();
        }
    }

    fn fail(self: &Arc<Self>, id: &str, error: &str) {
        let snap = {
            let mut st = self.state.lock();
            if let Some(dl) = st.by_id.get_mut(id) {
                dl.status = "failed".to_string();
                dl.error = Some(error.to_string());
                dl.speed_bps = 0;
                dl.eta_seconds = None;
                let snap = dl.clone();
                st.active.remove(id);
                Some(snap)
            } else {
                None
            }
        };
        if let Some(dl) = snap {
            self.emit(&dl);
            write_manifest(&dl);
            let lower = error.to_lowercase();
            if lower.contains("certificate") || lower.contains("ssl") || lower.contains("tls") {
                let host = url::Url::parse(&dl.url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
                self.app
                    .emit(
                        "uc:download-blocked",
                        json!({ "host": host, "gameName": dl.game_name, "appid": dl.appid, "reason": error }),
                    )
                    .ok();
            }
        }
        self.maybe_start_next();
    }

    async fn poll(self: &Arc<Self>) {
        if !self.aria2.is_ready() {
            return;
        }
        let active: Vec<(String, String)> = {
            let st = self.state.lock();
            st.by_id
                .values()
                .filter(|d| d.status != "completed" && d.status != "failed" && d.status != "cancelled")
                .filter_map(|d| d.gid.clone().map(|g| (d.id.clone(), g)))
                .collect()
        };
        // One serial RPC round-trip per download adds up at the 700ms cadence;
        // fetch every status concurrently, then apply the results with the same
        // per-id poll_failures bookkeeping the serial loop had. No state lock is
        // held during the fetches.
        let statuses = futures::future::join_all(active.into_iter().map(|(id, gid)| async move {
            let status = self.aria2.tell_status(&gid).await;
            (id, gid, status)
        }))
        .await;
        for (id, gid, fetched) in statuses {
            let status = match fetched {
                Ok(s) => {
                    if let Some(d) = self.state.lock().by_id.get_mut(&id) {
                        d.poll_failures = 0;
                    }
                    s
                }
                Err(_) => {
                    let failures = {
                        let mut st = self.state.lock();
                        match st.by_id.get_mut(&id) {
                            Some(d) => {
                                d.poll_failures = d.poll_failures.saturating_add(1);
                                d.poll_failures
                            }
                            None => continue,
                        }
                    };
                    if failures >= 8 {
                        self.fail(&id, "download stalled: aria2 stopped responding");
                    }
                    continue;
                }
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
                    let mut st = self.state.lock();
                    st.gid_to_id.remove(&gid);
                    if let Some(d) = st.by_id.get_mut(&id) {
                        d.gid = None;
                    }
                }
                _ => {
                    let snap = {
                        let mut st = self.state.lock();
                        match st.by_id.get_mut(&id) {
                            Some(dl) if !(dl.status == "paused" && s != "paused") => {
                                let status = if s == "paused" { "paused" } else { "downloading" };
                                let speed = if s == "paused" { 0 } else { speed };
                                // Compare speed by bucket so pure jitter on a stalled
                                // download doesn't emit; byte or status changes always do.
                                if dl.status == status
                                    && dl.received_bytes == completed
                                    && dl.speed_bps / SPEED_EMIT_QUANTUM == speed / SPEED_EMIT_QUANTUM
                                {
                                    None
                                } else {
                                    let status_changed = dl.status != status;
                                    if total > 0 {
                                        dl.total_bytes = total;
                                    }
                                    if completed > 0 {
                                        dl.received_bytes = completed;
                                    }
                                    dl.status = status.to_string();
                                    dl.speed_bps = speed;
                                    let remaining = total.saturating_sub(completed);
                                    dl.eta_seconds = if speed > 0 && remaining > 0 { Some(remaining / speed) } else { None };
                                    // Transitions persist immediately; steady progress only
                                    // checkpoints the manifest every few seconds, keeping the
                                    // per-tick path free of disk writes.
                                    let write = status_changed
                                        || dl.last_manifest_write.elapsed() >= MANIFEST_CHECKPOINT_INTERVAL;
                                    if write {
                                        dl.last_manifest_write = Instant::now();
                                    }
                                    Some((dl.clone(), write))
                                }
                            }
                            _ => None,
                        }
                    };
                    if let Some((dl, write)) = snap {
                        self.emit(&dl);
                        if write {
                            write_manifest(&dl);
                        }
                    }
                }
            }
        }
    }

    async fn finish_complete(self: &Arc<Self>, id: &str) {
        let snap = {
            let mut st = self.state.lock();
            st.active.remove(id);
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
        self.emit(&snap);
        write_manifest(&snap);
        self.maybe_start_next();
        let engine = self.clone();
        tauri::async_runtime::spawn(async move { engine.on_complete(snap).await });
    }

    fn finish_error(self: &Arc<Self>, id: &str, msg: &str) {
        {
            let mut st = self.state.lock();
            if let Some(dl) = st.by_id.get_mut(id) {
                if let Some(g) = dl.gid.take() {
                    st.gid_to_id.remove(&g);
                }
            }
        }
        self.fail(id, msg);
    }

    async fn on_complete(self: &Arc<Self>, dl: Download) {
        let ready = {
            let st = self.state.lock();
            match dl.part_total {
                // Multi-part sets are enqueued incrementally, so scanning in-memory
                // siblings misfires; gate on the known part total when we have it.
                Some(total) if total > 1 => {
                    let done = st
                        .by_id
                        .values()
                        .filter(|d| d.appid == dl.appid && d.status == "completed")
                        .count() as u64;
                    done >= total
                }
                _ => !st.by_id.values().any(|d| {
                    d.appid == dl.appid && d.id != dl.id && !matches!(d.status.as_str(), "completed" | "cancelled")
                }),
            }
        };
        if !ready {
            return;
        }
        if !self.try_install_lock(&dl.appid) {
            return;
        }
        let appid = dl.appid.clone();
        crate::install::auto_install(
            self.app.clone(),
            dl.appid,
            dl.id,
            dl.game_name,
            dl.save_path,
            dl.installing_dir,
        )
        .await;
        self.install_unlock(&appid);
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
    write_manifest_atomic(&path, &Value::Object(manifest));
}

fn unique_tmp_path(path: &Path) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    path.with_extension(format!("tmp.{}.{}", std::process::id(), n))
}

pub fn write_json_atomic(path: &Path, value: &Value) -> std::io::Result<()> {
    let data = serde_json::to_vec_pretty(value)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let tmp = unique_tmp_path(path);
    std::fs::write(&tmp, &data)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn write_manifest_atomic(path: &Path, manifest: &Value) {
    if let Err(e) = write_json_atomic(path, manifest) {
        crate::logging::write_line("warn", &format!("manifest write failed {}: {e}", path.display()));
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

#[tauri::command(async)]
pub fn download_start(state: State<'_, AppState>, payload: Value) -> Value {
    let req = DownloadRequest {
        appid: payload.get("appid").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        id: payload.get("downloadId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        url: payload.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        filename: payload.get("filename").and_then(|v| v.as_str()).map(String::from),
        game_name: payload.get("gameName").and_then(|v| v.as_str()).map(String::from),
        total_bytes: payload.get("totalBytes").and_then(|v| v.as_u64()).unwrap_or(0),
        headers: to_headers(payload.get("headers").cloned()),
        part_index: payload.get("partIndex").and_then(|v| v.as_u64()),
        part_total: payload.get("partTotal").and_then(|v| v.as_u64()),
    };
    if req.url.is_empty() || req.id.is_empty() {
        return json!({ "ok": false, "error": "url and downloadId required" });
    }
    match state.downloads.enqueue(req) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command(async)]
pub fn download_pause(state: State<'_, AppState>, download_id: String) -> Value {
    json!({ "ok": state.downloads.pause(&download_id) })
}

#[tauri::command(async)]
pub fn download_resume(state: State<'_, AppState>, download_id: String) -> Value {
    json!({ "ok": state.downloads.resume(&download_id) })
}

#[tauri::command(async)]
pub fn download_cancel(state: State<'_, AppState>, download_id: String) -> Value {
    state.downloads.cancel(&download_id, false)
}

#[tauri::command(async)]
pub fn download_active_status(state: State<'_, AppState>, appid: String) -> Value {
    state.downloads.active_status(&appid)
}

// Every enqueued download creates its installing folder up front, so a row whose
// savePath's parent dir is gone is dead: it can't be resumed or installed and
// just restores from downloads-state.json on every launch (an install_ready with
// no real archive — e.g. an old few-byte DataVaults miss parked as "ready" — is
// the classic case). Drop those; a row without a savePath is left for the
// renderer to reconcile. Returns the number pruned.
fn prune_dead_downloads(downloads: &mut Value) -> usize {
    let Some(arr) = downloads.as_array_mut() else {
        return 0;
    };
    let before = arr.len();
    arr.retain(|d| match d.get("savePath").and_then(|p| p.as_str()).filter(|s| !s.is_empty()) {
        Some(save) => std::path::Path::new(save).parent().map(|dir| dir.exists()).unwrap_or(true),
        None => true,
    });
    before - arr.len()
}

#[tauri::command(async)]
pub fn downloads_state_load(state: State<'_, AppState>) -> Value {
    let path = state.paths.downloads_state_file();
    let mut downloads = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .unwrap_or_else(|| json!([]));
    let dropped = prune_dead_downloads(&mut downloads);
    if dropped > 0 {
        crate::logging::write_line(
            "info",
            &format!("downloads_state_load: pruned {dropped} dead download row(s) whose install folder is gone"),
        );
    }
    json!({ "ok": true, "downloads": downloads })
}

#[tauri::command(async)]
pub fn downloads_state_save(state: State<'_, AppState>, downloads: Value) -> Value {
    let path = state.paths.downloads_state_file();
    let count = downloads.as_array().map(|a| a.len()).unwrap_or(0);
    match write_json_atomic(&path, &downloads) {
        Ok(_) => json!({ "ok": true, "count": count }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn catalog_state_save(state: State<'_, AppState>, payload: Value) -> Value {
    let path = state.paths.catalog_state_file();
    let mut stored = payload.clone();
    if let Some(obj) = stored.as_object_mut() {
        obj.insert("updatedAt".into(), json!(now_ms()));
    }
    let games = payload.get("games").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    match write_json_atomic(&path, &stored) {
        Ok(_) => json!({ "ok": true, "games": games, "updatedAt": now_ms() }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command(async)]
pub fn download_path_get(state: State<'_, AppState>) -> Value {
    json!({ "path": state.download_root().to_string_lossy() })
}

#[tauri::command(async)]
pub fn download_path_set(state: State<'_, AppState>, target_path: String) -> Value {
    state.settings.set("downloadPath", json!(target_path));
    json!({ "ok": true, "path": target_path })
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_sanitize_filename_keeps_normal_name() {
        assert_eq!(sanitize_filename("Portal 2.zip"), "Portal 2.zip");
    }

    #[test]
    fn t_sanitize_filename_strips_invalid_chars_keeps_ext() {
        let out = sanitize_filename("Half-Life: Alyx.zip");
        assert!(!out.contains(':'), "colon must be stripped: {out}");
        assert!(out.ends_with(".zip"), "extension must survive: {out}");
        assert_eq!(out, "Half-Life_ Alyx.zip");
    }

    #[test]
    fn t_sanitize_filename_reduces_to_basename() {
        // Path traversal / separators from either platform collapse to a bare name.
        let a = sanitize_filename("../../etc/passwd");
        assert_eq!(a, "passwd");
        assert!(!a.contains('/') && !a.contains(".."));

        assert_eq!(sanitize_filename("a/b/c.zip"), "c.zip");

        let w = sanitize_filename("C:\\x\\y.zip");
        assert_eq!(w, "y.zip");
        assert!(!w.contains('\\') && !w.contains(':'));
    }

    #[test]
    fn t_sanitize_filename_drops_trailing_dots_and_spaces() {
        assert_eq!(sanitize_filename("trailing.dat..."), "trailing.dat");
        assert_eq!(sanitize_filename("spaced.dat   "), "spaced.dat");
        let out = sanitize_filename("game.zip. . .");
        assert!(!out.ends_with('.') && !out.ends_with(' '));
        assert_eq!(out, "game.zip");
    }

    #[test]
    fn t_sanitize_filename_falls_back_when_empty() {
        // Empty or all-separator input still yields a usable, non-empty basename
        // with no path separators (the exact sentinel is an implementation detail).
        assert!(!sanitize_filename("").is_empty());
        let s = sanitize_filename("///");
        assert!(!s.is_empty());
        assert!(!s.contains('/') && !s.contains('\\'));
    }

    #[test]
    fn t_safe_folder_name_keeps_alnum_title() {
        assert_eq!(safe_folder_name("Portal 2"), "Portal 2");
    }

    #[test]
    fn t_safe_folder_name_falls_back_on_blank() {
        assert!(!safe_folder_name("").is_empty());
        assert!(!safe_folder_name("   ").is_empty());
        assert!(!safe_folder_name("...").is_empty());
    }

    #[test]
    fn t_safe_folder_name_escapes_reserved_devices() {
        // Windows-reserved device names must not survive as a bare folder name.
        assert!(!safe_folder_name("CON").eq_ignore_ascii_case("CON"));
        assert!(!safe_folder_name("aux").eq_ignore_ascii_case("aux"));
        assert!(!safe_folder_name("NUL").eq_ignore_ascii_case("NUL"));
        // A longer name that merely starts with a reserved stem is left intact.
        assert_eq!(safe_folder_name("CONSOLE"), "CONSOLE");
    }

    #[test]
    fn t_prune_dead_downloads_drops_only_rows_whose_parent_dir_is_gone() {
        let tmp = tempfile::tempdir().unwrap();

        // Live row: its install folder actually exists on disk, so it survives.
        let live_dir = tmp.path().join("GameA");
        std::fs::create_dir_all(&live_dir).unwrap();
        let live_save = live_dir.join("file.zip");
        let live_save = live_save.to_str().unwrap();

        // Dead row: the parent "Gone" was never created, so its parent dir is
        // missing and the row can never resume — it must be pruned.
        let dead_save = tmp.path().join("Gone").join("file.zip");
        let dead_save = dead_save.to_str().unwrap();

        let mut downloads = json!([
            { "appid": "steam-1", "savePath": live_save },
            { "appid": "steam-2", "savePath": dead_save },
            { "appid": "steam-3" },
            { "appid": "steam-4", "savePath": "" },
        ]);

        let dropped = prune_dead_downloads(&mut downloads);
        assert_eq!(dropped, 1, "only the row with a missing parent dir is pruned");

        // Order is preserved and exactly the three live rows remain.
        let kept: Vec<&str> = downloads
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["appid"].as_str().unwrap())
            .collect();
        assert_eq!(kept, ["steam-1", "steam-3", "steam-4"]);
    }

    #[test]
    fn t_prune_dead_downloads_leaves_non_array_untouched() {
        let mut obj = json!({ "downloads": "not-an-array" });
        let before = obj.clone();
        assert_eq!(prune_dead_downloads(&mut obj), 0);
        assert_eq!(obj, before, "a non-array value is returned unchanged");

        let mut null = json!(null);
        assert_eq!(prune_dead_downloads(&mut null), 0);
        assert_eq!(null, json!(null));
    }
}
