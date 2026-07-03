use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use tauri::State;

use crate::downloads::{now_ms, MANIFEST_NAME};
use crate::state::AppState;

const INSTALLED: &[&str] = &["installed"];
const INSTALLING: &[&str] = &["installing", "queued", "paused", "downloaded", "extracting", "failed", "cancelled"];

static SCAN_CACHE: Lazy<Mutex<Option<(Instant, PathBuf, Vec<(PathBuf, Value)>)>>> = Lazy::new(|| Mutex::new(None));
const SCAN_TTL: Duration = Duration::from_millis(2000);

fn load_all_cached(root: &Path) -> Vec<(PathBuf, Value)> {
    {
        let guard = SCAN_CACHE.lock().unwrap();
        if let Some((at, cached_root, data)) = guard.as_ref() {
            if cached_root == root && at.elapsed() < SCAN_TTL {
                return data.clone();
            }
        }
    }
    let data = load_all(root);
    *SCAN_CACHE.lock().unwrap() = Some((Instant::now(), root.to_path_buf(), data.clone()));
    data
}

fn invalidate_scan() {
    *SCAN_CACHE.lock().unwrap() = None;
}

fn load_all(root: &Path) -> Vec<(PathBuf, Value)> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let manifest_path = dir.join(MANIFEST_NAME);
            if let Ok(text) = std::fs::read_to_string(&manifest_path) {
                if let Ok(mut v) = serde_json::from_str::<Value>(&text) {
                    if let Some(obj) = v.as_object_mut() {
                        obj.entry("installPath").or_insert(json!(dir.to_string_lossy()));
                        obj.insert("folder".into(), json!(dir.to_string_lossy()));
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

fn list_by(root: &Path, statuses: &[&str]) -> Vec<Value> {
    load_all_cached(root)
        .into_iter()
        .filter(|(_, v)| statuses.contains(&status_of(v).as_str()))
        .map(|(_, v)| v)
        .collect()
}

fn get_by(root: &Path, appid: &str, statuses: &[&str]) -> Option<Value> {
    load_all_cached(root)
        .into_iter()
        .find(|(_, v)| {
            v.get("appid").and_then(|a| a.as_str()) == Some(appid) && statuses.contains(&status_of(v).as_str())
        })
        .map(|(_, v)| v)
}

fn find_dir(root: &Path, appid: &str) -> Option<PathBuf> {
    load_all_cached(root)
        .into_iter()
        .find(|(_, v)| v.get("appid").and_then(|a| a.as_str()) == Some(appid))
        .map(|(dir, _)| dir)
}

fn merge_into_manifest(root: &Path, appid: &str, updates: &Value) -> bool {
    if let Some(dir) = find_dir(root, appid) {
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
    list_by(&state.download_root(), INSTALLED)
}

#[tauri::command(async)]
pub fn installed_get(state: State<'_, AppState>, appid: String) -> Value {
    get_by(&state.download_root(), &appid, INSTALLED).unwrap_or(Value::Null)
}

#[tauri::command(async)]
pub fn installing_list(state: State<'_, AppState>) -> Vec<Value> {
    list_by(&state.download_root(), INSTALLING)
}

#[tauri::command(async)]
pub fn installing_get(state: State<'_, AppState>, appid: String) -> Value {
    get_by(&state.download_root(), &appid, INSTALLING).unwrap_or(Value::Null)
}

#[tauri::command(async)]
pub fn installed_save(state: State<'_, AppState>, appid: String, metadata: Value) -> Value {
    let root = state.download_root();
    if merge_into_manifest(&root, &appid, &json!({ "metadata": metadata })) {
        return json!({ "ok": true });
    }
    let name = metadata.get("name").and_then(|v| v.as_str()).unwrap_or(&appid).to_string();
    let dir = root.join(crate::downloads::safe_folder_name(&name));
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
    json!({ "ok": merge_into_manifest(&state.download_root(), &appid, &json!({ "metadata": updates })) })
}

#[tauri::command(async)]
pub fn installing_status_set(state: State<'_, AppState>, appid: String, status: String, error: Option<String>) -> Value {
    let updates = json!({ "installStatus": status, "installError": error });
    json!({ "ok": merge_into_manifest(&state.download_root(), &appid, &updates) })
}

fn remove_dir_unless_installed(root: &Path, appid: &str) {
    if let Some(dir) = find_dir(root, appid) {
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
    if let Some(dir) = find_dir(&state.download_root(), &appid) {
        std::fs::remove_dir_all(&dir).ok();
        invalidate_scan();
    }
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn installing_delete(state: State<'_, AppState>, appid: String) -> Value {
    remove_dir_unless_installed(&state.download_root(), &appid);
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn installing_dismiss(state: State<'_, AppState>, appid: String) -> Value {
    remove_dir_unless_installed(&state.download_root(), &appid);
    json!({ "ok": true, "prompted": false })
}

