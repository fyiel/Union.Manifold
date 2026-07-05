use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::State;

use crate::downloads::{now_ms, MANIFEST_NAME};
use crate::state::AppState;

const INSTALLED: &[&str] = &["installed"];
const INSTALLING: &[&str] = &["installing", "queued", "paused", "downloaded", "extracting", "failed", "cancelled"];

static SCAN_CACHE: Mutex<Option<(Instant, String, Vec<(PathBuf, Value)>)>> = Mutex::new(None);
// Serializes the filesystem scan itself so concurrent cache misses (Library
// activation racing the renderer's 3s reconcile tick) coalesce into a single
// read_dir pass. SCAN_CACHE is only ever held for short copy-in/copy-out
// windows; the gate is always acquired first, never while holding SCAN_CACHE.
static SCAN_GATE: Mutex<()> = Mutex::new(());
// 10s TTL: every in-app mutation invalidates explicitly (invalidate_scan), so
// the TTL only bounds staleness from EXTERNAL manifest writes — the download
// engine writes manifests directly (throttled to ~5s) without invalidating this
// cache. 10s keeps installing-progress reads acceptably fresh while letting the
// renderer's 3s reconcile tick hit the cache instead of rescanning every tick.
const SCAN_TTL: Duration = Duration::from_millis(10_000);

// The primary install dir plus any legacy library roots (games installed by the
// old UnionCrax.Direct app). Read-through so old installs still show and launch.
pub(crate) fn scan_roots(state: &AppState) -> Vec<PathBuf> {
    let mut roots = vec![state.download_root()];
    for p in legacy_roots(state) {
        if !roots.contains(&p) {
            roots.push(p);
        }
    }
    roots
}

// Legacy roots cost a stat() per configured path plus the home-dir probe on
// every scan, but legacy install roots do not appear at runtime. Cache the
// existence checks keyed by the legacyLibraryPaths setting: recompute only if
// the setting changes, otherwise reuse for the lifetime of the process.
static LEGACY_ROOTS: Mutex<Option<(Value, Vec<PathBuf>)>> = Mutex::new(None);

fn legacy_roots(state: &AppState) -> Vec<PathBuf> {
    let configured = state.settings.get("legacyLibraryPaths");
    let mut cache = LEGACY_ROOTS.lock();
    if let Some((key, roots)) = cache.as_ref() {
        if *key == configured {
            return roots.clone();
        }
    }
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(arr) = configured.as_array() {
        for v in arr {
            if let Some(s) = v.as_str().filter(|s| !s.is_empty()) {
                let p = PathBuf::from(s);
                if p.is_dir() && !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        let legacy = home.join("UnionCrax.Direct").join("installed");
        if legacy.is_dir() && !out.contains(&legacy) {
            out.push(legacy);
        }
    }
    *cache = Some((configured, out.clone()));
    out
}

fn roots_key(roots: &[PathBuf]) -> String {
    roots
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("\u{0}")
}

fn cached_scan(key: &str) -> Option<Vec<(PathBuf, Value)>> {
    let guard = SCAN_CACHE.lock();
    match guard.as_ref() {
        Some((at, cached_key, data)) if cached_key == key && at.elapsed() < SCAN_TTL => Some(data.clone()),
        _ => None,
    }
}

fn load_all_cached(roots: &[PathBuf]) -> Vec<(PathBuf, Value)> {
    let key = roots_key(roots);
    if let Some(data) = cached_scan(&key) {
        return data;
    }
    // Coalesce concurrent misses: one caller scans while the rest block on the
    // gate, then find the winner's fresh result on the re-check (double-checked
    // locking). Without this, Library activation and the reconcile tick could
    // run the full read_dir + parse pass twice in parallel.
    let _scan = SCAN_GATE.lock();
    if let Some(data) = cached_scan(&key) {
        return data;
    }
    let data = load_all(roots);
    *SCAN_CACHE.lock() = Some((Instant::now(), key, data.clone()));
    data
}

pub(crate) fn invalidate_scan() {
    *SCAN_CACHE.lock() = None;
}

fn load_all(roots: &[PathBuf]) -> Vec<(PathBuf, Value)> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for root in roots {
        let entries = match std::fs::read_dir(root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let manifest_path = dir.join(MANIFEST_NAME);
            if let Ok(text) = std::fs::read_to_string(&manifest_path) {
                if let Ok(mut v) = serde_json::from_str::<Value>(&text) {
                    if let Some(obj) = v.as_object_mut() {
                        // Legacy manifests carry no installStatus; a folder in an
                        // installed/ root that has an appid is a completed install.
                        if !obj.contains_key("installStatus") && obj.contains_key("appid") {
                            obj.insert("installStatus".into(), json!("installed"));
                        }
                        obj.entry("installPath").or_insert(json!(dir.to_string_lossy()));
                        obj.insert("folder".into(), json!(dir.to_string_lossy()));
                    }
                    // Dedup by appid across roots; the primary root is scanned first
                    // so a re-installed game shadows its legacy copy.
                    if let Some(id) = v.get("appid").and_then(|a| a.as_str()) {
                        if !seen.insert(id.to_string()) {
                            continue;
                        }
                    }
                    out.push((dir, v));
                }
            }
        }
    }
    out
}

fn status_of(v: &Value) -> String {
    v.get("installStatus").and_then(|s| s.as_str()).unwrap_or("").to_string()
}

fn list_by(roots: &[PathBuf], statuses: &[&str]) -> Vec<Value> {
    load_all_cached(roots)
        .into_iter()
        .filter(|(_, v)| statuses.contains(&status_of(v).as_str()))
        .map(|(_, v)| v)
        .collect()
}

fn get_by(roots: &[PathBuf], appid: &str, statuses: &[&str]) -> Option<Value> {
    load_all_cached(roots)
        .into_iter()
        .find(|(_, v)| {
            v.get("appid").and_then(|a| a.as_str()) == Some(appid) && statuses.contains(&status_of(v).as_str())
        })
        .map(|(_, v)| v)
}

pub(crate) fn find_dir(roots: &[PathBuf], appid: &str) -> Option<PathBuf> {
    load_all_cached(roots)
        .into_iter()
        .find(|(_, v)| v.get("appid").and_then(|a| a.as_str()) == Some(appid))
        .map(|(dir, _)| dir)
}

fn merge_into_manifest(roots: &[PathBuf], appid: &str, updates: &Value) -> bool {
    if let Some(dir) = find_dir(roots, appid) {
        let manifest_path = dir.join(MANIFEST_NAME);
        let mut manifest = std::fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        if let Some(obj) = updates.as_object() {
            for (k, v) in obj {
                if v.is_null() {
                    manifest.remove(k);
                } else if k == "metadata" && manifest.get(k).map(|m| m.is_object()).unwrap_or(false) && v.is_object() {
                    let old = manifest.get_mut(k).and_then(|m| m.as_object_mut()).unwrap();
                    for (nk, nv) in v.as_object().unwrap() {
                        if nv.is_null() {
                            old.remove(nk);
                        } else {
                            old.insert(nk.clone(), nv.clone());
                        }
                    }
                } else {
                    manifest.insert(k.clone(), v.clone());
                }
            }
        }
        manifest.insert("updatedAt".into(), json!(now_ms()));
        crate::downloads::write_manifest_atomic(&manifest_path, &Value::Object(manifest));
        invalidate_scan();
        return true;
    }
    false
}

#[tauri::command(async)]
pub fn installed_list(state: State<'_, AppState>) -> Vec<Value> {
    list_by(&scan_roots(&state), INSTALLED)
}

#[tauri::command(async)]
pub fn installed_get(state: State<'_, AppState>, appid: String) -> Value {
    get_by(&scan_roots(&state), &appid, INSTALLED).unwrap_or(Value::Null)
}

#[tauri::command(async)]
pub fn installing_list(state: State<'_, AppState>) -> Vec<Value> {
    list_by(&scan_roots(&state), INSTALLING)
}

#[tauri::command(async)]
pub fn installing_get(state: State<'_, AppState>, appid: String) -> Value {
    get_by(&scan_roots(&state), &appid, INSTALLING).unwrap_or(Value::Null)
}

#[tauri::command(async)]
pub fn installed_save(state: State<'_, AppState>, appid: String, metadata: Value) -> Value {
    let roots = scan_roots(&state);
    if merge_into_manifest(&roots, &appid, &json!({ "metadata": metadata })) {
        return json!({ "ok": true });
    }
    let name = metadata.get("name").and_then(|v| v.as_str()).unwrap_or(&appid).to_string();
    let dir = state.download_root().join(crate::downloads::safe_folder_name(&name));
    std::fs::create_dir_all(&dir).ok();
    crate::downloads::write_manifest_atomic(
        &dir.join(MANIFEST_NAME),
        &json!({
            "appid": appid,
            "name": name,
            "installStatus": "installing",
            "metadata": metadata,
            "updatedAt": now_ms(),
        }),
    );
    invalidate_scan();
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn installed_update_metadata(state: State<'_, AppState>, appid: String, updates: Value) -> Value {
    json!({ "ok": merge_into_manifest(&scan_roots(&state), &appid, &json!({ "metadata": updates })) })
}

#[tauri::command(async)]
pub fn installing_status_set(state: State<'_, AppState>, appid: String, status: String, error: Option<String>) -> Value {
    let updates = json!({ "installStatus": status, "installError": error });
    json!({ "ok": merge_into_manifest(&scan_roots(&state), &appid, &updates) })
}

fn remove_dir_unless_installed(roots: &[PathBuf], appid: &str) {
    if let Some(dir) = find_dir(roots, appid) {
        let installed = std::fs::read_to_string(dir.join(MANIFEST_NAME))
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .map(|v| status_of(&v) == "installed")
            .unwrap_or(false);
        if !installed {
            std::fs::remove_dir_all(&dir).ok();
            invalidate_scan();
        }
    }
}

#[tauri::command(async)]
pub fn installed_delete(state: State<'_, AppState>, appid: String) -> Value {
    if let Some(dir) = find_dir(&scan_roots(&state), &appid) {
        std::fs::remove_dir_all(&dir).ok();
        invalidate_scan();
    }
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn installing_delete(state: State<'_, AppState>, appid: String) -> Value {
    remove_dir_unless_installed(&scan_roots(&state), &appid);
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn installing_dismiss(state: State<'_, AppState>, appid: String) -> Value {
    remove_dir_unless_installed(&scan_roots(&state), &appid);
    json!({ "ok": true, "prompted": false })
}
