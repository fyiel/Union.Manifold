use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::State;

use crate::downloads::{now_ms, MANIFEST_NAME};
use crate::state::AppState;

const INSTALLED: &[&str] = &["installed"];
const INSTALLING: &[&str] = &["installing", "paused", "downloaded", "extracting", "failed"];

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
    load_all(root)
        .into_iter()
        .filter(|(_, v)| statuses.contains(&status_of(v).as_str()))
        .map(|(_, v)| v)
        .collect()
}

fn get_by(root: &Path, appid: &str, statuses: &[&str]) -> Option<Value> {
    load_all(root)
        .into_iter()
        .find(|(_, v)| {
            v.get("appid").and_then(|a| a.as_str()) == Some(appid) && statuses.contains(&status_of(v).as_str())
        })
        .map(|(_, v)| v)
}

fn find_dir(root: &Path, appid: &str) -> Option<PathBuf> {
    load_all(root)
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
                } else {
                    manifest.insert(k.clone(), v.clone());
                }
            }
        }
        manifest.insert("updatedAt".into(), json!(now_ms()));
        crate::downloads::write_manifest_atomic(&manifest_path, &Value::Object(manifest));
        return true;
    }
    false
}

#[tauri::command]
pub fn installed_list(state: State<'_, AppState>) -> Vec<Value> {
    list_by(&state.download_root(), INSTALLED)
}

#[tauri::command]
pub fn installed_get(state: State<'_, AppState>, appid: String) -> Value {
    get_by(&state.download_root(), &appid, INSTALLED).unwrap_or(Value::Null)
}

#[tauri::command]
pub fn installed_list_by_appid(state: State<'_, AppState>, appid: String) -> Vec<Value> {
    load_all(&state.download_root())
        .into_iter()
        .filter(|(_, v)| v.get("appid").and_then(|a| a.as_str()) == Some(appid.as_str()))
        .map(|(_, v)| v)
        .collect()
}

#[tauri::command]
pub fn installing_list(state: State<'_, AppState>) -> Vec<Value> {
    list_by(&state.download_root(), INSTALLING)
}

#[tauri::command]
pub fn installing_get(state: State<'_, AppState>, appid: String) -> Value {
    get_by(&state.download_root(), &appid, INSTALLING).unwrap_or(Value::Null)
}

#[tauri::command]
pub fn installed_save(state: State<'_, AppState>, appid: String, metadata: Value) -> Value {
    json!({ "ok": merge_into_manifest(&state.download_root(), &appid, &metadata) })
}

#[tauri::command]
pub fn installed_update_metadata(state: State<'_, AppState>, appid: String, updates: Value) -> Value {
    json!({ "ok": merge_into_manifest(&state.download_root(), &appid, &updates) })
}

#[tauri::command]
pub fn installing_status_set(state: State<'_, AppState>, appid: String, status: String, error: Option<String>) -> Value {
    let updates = json!({ "installStatus": status, "installError": error });
    json!({ "ok": merge_into_manifest(&state.download_root(), &appid, &updates) })
}

#[tauri::command]
pub fn installed_delete(state: State<'_, AppState>, appid: String) -> Value {
    if let Some(dir) = find_dir(&state.download_root(), &appid) {
        std::fs::remove_dir_all(&dir).ok();
    }
    json!({ "ok": true })
}

#[tauri::command]
pub fn installing_delete(state: State<'_, AppState>, appid: String) -> Value {
    if let Some(dir) = find_dir(&state.download_root(), &appid) {
        std::fs::remove_dir_all(&dir).ok();
    }
    json!({ "ok": true })
}

#[tauri::command]
pub fn installing_dismiss(state: State<'_, AppState>, appid: String) -> Value {
    if let Some(dir) = find_dir(&state.download_root(), &appid) {
        std::fs::remove_dir_all(&dir).ok();
    }
    json!({ "ok": true, "prompted": false })
}

#[tauri::command]
pub fn installed_backup_create(state: State<'_, AppState>, appid: String) -> Value {
    if let Some(dir) = find_dir(&state.download_root(), &appid) {
        let backup = dir.with_file_name(format!(
            "{}.backup-{}",
            dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            now_ms()
        ));
        match std::fs::rename(&dir, &backup) {
            Ok(_) => return json!({ "ok": true, "backupPath": backup.to_string_lossy() }),
            Err(e) => return json!({ "ok": false, "error": e.to_string() }),
        }
    }
    json!({ "ok": false, "error": "not found" })
}

#[tauri::command]
pub fn add_external_game(state: State<'_, AppState>, appid: String, metadata: Value, game_path: String) -> Value {
    let root = state.download_root();
    let name = metadata.get("name").and_then(|v| v.as_str()).unwrap_or(&appid).to_string();
    let folder = root.join(crate::downloads::safe_folder_name(&name));
    std::fs::create_dir_all(&folder).ok();
    let mut manifest = metadata.as_object().cloned().unwrap_or_default();
    manifest.insert("appid".into(), json!(appid));
    manifest.insert("name".into(), json!(name));
    manifest.insert("installStatus".into(), json!("installed"));
    manifest.insert("installPath".into(), json!(game_path));
    manifest.insert("external".into(), json!(true));
    manifest.insert("installedAt".into(), json!(now_ms()));
    manifest.insert("updatedAt".into(), json!(now_ms()));
    let manifest_path = folder.join(MANIFEST_NAME);
    crate::downloads::write_manifest_atomic(&manifest_path, &Value::Object(manifest));
    json!({ "ok": true })
}
