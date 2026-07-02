use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::downloads::{now_ms, safe_folder_name, MANIFEST_NAME};
use crate::error::Result;
use crate::state::AppState;

const ARCHIVE_EXTS: &[&str] = &[
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".001", ".r00",
];

fn is_archive(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    ARCHIVE_EXTS.iter().any(|e| name.ends_with(e))
        || name.contains(".part1.")
        || name.contains(".part01.")
}

fn emit_status(app: &AppHandle, download_id: &str, appid: &str, game_name: &Option<String>, status: &str, error: Option<&str>) {
    app.emit(
        "uc:download-update",
        json!({
            "downloadId": download_id,
            "status": status,
            "appid": appid,
            "gameName": game_name,
            "error": error,
        }),
    )
    .ok();
}

fn dir_size(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

async fn run_7z(archive: &Path, out_dir: &Path) -> Result<()> {
    let bin = crate::bins::resolve_sidecar("7z")
        .ok_or_else(|| crate::error::AppError::msg("7z binary not found, run pnpm fetch-sidecars"))?;
    std::fs::create_dir_all(out_dir).ok();
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.arg("x")
        .arg(archive)
        .arg(format!("-o{}", out_dir.display()))
        .arg("-y")
        .arg("-bso0")
        .arg("-bsp0")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output().await.map_err(|e| crate::error::AppError::msg(format!("7z spawn: {e}")))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(crate::error::AppError::msg(format!("extraction failed: {}", err.trim())));
    }
    Ok(())
}

fn finalize_installed(dir: &Path, appid: &str, game_name: &Option<String>, install_path: &Path, metadata: Option<&Value>) {
    let manifest_path = dir.join(MANIFEST_NAME);
    let mut manifest = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    manifest.insert("appid".into(), json!(appid));
    manifest.insert("name".into(), json!(game_name.clone().unwrap_or_else(|| appid.to_string())));
    manifest.insert("installStatus".into(), json!("installed"));
    manifest.insert("installPath".into(), json!(install_path.to_string_lossy()));
    manifest.insert("sizeBytes".into(), json!(dir_size(install_path)));
    manifest.insert("installedAt".into(), json!(now_ms()));
    manifest.insert("updatedAt".into(), json!(now_ms()));
    manifest.remove("installError");
    if let Some(meta) = metadata.and_then(|m| m.as_object()) {
        for (k, v) in meta {
            manifest.insert(k.clone(), v.clone());
        }
    }
    let tmp = manifest_path.with_extension("json.tmp");
    if std::fs::write(&tmp, serde_json::to_string_pretty(&manifest).unwrap_or_default()).is_ok() {
        std::fs::rename(&tmp, &manifest_path).ok();
    }
}

pub async fn auto_install(app: AppHandle, appid: String, download_id: String, game_name: Option<String>, save_path: PathBuf, installing_dir: PathBuf) {
    if !is_archive(&save_path) {
        finalize_installed(&installing_dir, &appid, &game_name, &installing_dir, None);
        emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
        return;
    }
    emit_status(&app, &download_id, &appid, &game_name, "extracting", None);
    match run_7z(&save_path, &installing_dir).await {
        Ok(_) => {
            finalize_installed(&installing_dir, &appid, &game_name, &installing_dir, None);
            emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
            let size = std::fs::metadata(&save_path).map(|m| m.len()).unwrap_or(0);
            app.emit(
                "uc:archive-delete-prompt",
                json!({
                    "appid": appid,
                    "gameName": game_name,
                    "archivePaths": [save_path.to_string_lossy()],
                    "totalBytes": size,
                }),
            )
            .ok();
        }
        Err(e) => {
            let manifest_path = installing_dir.join(MANIFEST_NAME);
            if let Ok(text) = std::fs::read_to_string(&manifest_path) {
                if let Ok(mut v) = serde_json::from_str::<Value>(&text) {
                    if let Some(obj) = v.as_object_mut() {
                        obj.insert("installStatus".into(), json!("failed"));
                        obj.insert("installError".into(), json!(e.to_string()));
                        std::fs::write(&manifest_path, serde_json::to_string_pretty(&v).unwrap_or_default()).ok();
                    }
                }
            }
            emit_status(&app, &download_id, &appid, &game_name, "extract_failed", Some(&e.to_string()));
        }
    }
}

#[tauri::command]
pub async fn install_from_archive(state: State<'_, AppState>, app: AppHandle, payload: Value) -> Result<Value> {
    let appid = payload.get("appid").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let game_name = payload.get("gameName").and_then(|v| v.as_str()).map(String::from);
    let download_id = payload
        .get("downloadId")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("{appid}-archive-{}", now_ms()));
    let archive_paths: Vec<PathBuf> = payload
        .get("archivePaths")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|p| p.as_str().map(PathBuf::from)).collect())
        .unwrap_or_default();
    let metadata = payload.get("metadata").cloned();
    if archive_paths.is_empty() {
        return Ok(json!({ "ok": false, "error": "no archive paths" }));
    }
    let folder = safe_folder_name(game_name.as_deref().unwrap_or(&appid));
    let dir = state.download_root().join(folder);
    std::fs::create_dir_all(&dir).ok();
    let primary = archive_paths[0].clone();
    emit_status(&app, &download_id, &appid, &game_name, "extracting", None);
    let mut extracted = 0;
    match run_7z(&primary, &dir).await {
        Ok(_) => {
            extracted = 1;
            finalize_installed(&dir, &appid, &game_name, &dir, metadata.as_ref());
            emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
        }
        Err(e) => {
            emit_status(&app, &download_id, &appid, &game_name, "extract_failed", Some(&e.to_string()));
            return Ok(json!({ "ok": false, "error": e.to_string(), "downloadId": download_id }));
        }
    }
    Ok(json!({ "ok": true, "downloadId": download_id, "extracted": extracted }))
}

#[tauri::command]
pub async fn install_downloaded_archive(state: State<'_, AppState>, app: AppHandle, appid: String) -> Result<Value> {
    let (dir, save_path, game_name, download_id) = {
        let found = find_installing(&state.download_root(), &appid);
        match found {
            Some((dir, manifest)) => {
                let snap = manifest.get("downloadSnapshot");
                let save = snap
                    .and_then(|s| s.get("savePath"))
                    .and_then(|v| v.as_str())
                    .map(PathBuf::from)
                    .unwrap_or_else(|| dir.clone());
                let name = manifest.get("name").and_then(|v| v.as_str()).map(String::from);
                let id = snap
                    .and_then(|s| s.get("downloadId"))
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| format!("{appid}-archive-{}", now_ms()));
                (dir, save, name, id)
            }
            None => return Ok(json!({ "ok": false, "error": "no downloaded archive found" })),
        }
    };
    emit_status(&app, &download_id, &appid, &game_name, "extracting", None);
    match run_7z(&save_path, &dir).await {
        Ok(_) => {
            finalize_installed(&dir, &appid, &game_name, &dir, None);
            emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
            Ok(json!({ "ok": true, "downloadId": download_id, "extracted": 1 }))
        }
        Err(e) => {
            emit_status(&app, &download_id, &appid, &game_name, "extract_failed", Some(&e.to_string()));
            Ok(json!({ "ok": false, "error": e.to_string(), "downloadId": download_id }))
        }
    }
}

pub fn find_installing(root: &Path, appid: &str) -> Option<(PathBuf, Value)> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let dir = entry.path();
        let manifest_path = dir.join(MANIFEST_NAME);
        if let Ok(text) = std::fs::read_to_string(&manifest_path) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if v.get("appid").and_then(|a| a.as_str()) == Some(appid) {
                    return Some((dir, v));
                }
            }
        }
    }
    None
}

#[tauri::command]
pub fn delete_archive_files(payload: Value) -> Value {
    let paths = payload.get("archivePaths").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut deleted = 0;
    for p in paths {
        if let Some(s) = p.as_str() {
            if std::fs::remove_file(s).is_ok() {
                deleted += 1;
            }
        }
    }
    json!({ "ok": true, "deletedCount": deleted })
}
