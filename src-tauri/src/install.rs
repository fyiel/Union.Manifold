use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

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

fn sniff_archive(path: &Path) -> bool {
    use std::io::Read;
    let mut head = [0u8; 8];
    let read = std::fs::File::open(path)
        .and_then(|mut f| f.read(&mut head))
        .unwrap_or(0);
    let h = &head[..read];
    h.starts_with(b"PK\x03\x04")
        || h.starts_with(b"PK\x05\x06")
        || h.starts_with(b"PK\x07\x08")
        || h.starts_with(b"Rar!\x1a\x07")
        || h.starts_with(b"7z\xbc\xaf\x27\x1c")
        || h.starts_with(b"\x1f\x8b")
        || h.starts_with(b"\xfd7zXZ\x00")
        || h.starts_with(b"BZh")
}

fn is_first_part(name: &str) -> bool {
    name.contains(".part1.") || name.contains(".part01.") || name.ends_with(".001")
}

fn extract_entry_point(dir: &Path, fallback: &Path) -> PathBuf {
    let name = fallback.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if is_first_part(&name) {
        return fallback.to_path_buf();
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if is_first_part(&entry.file_name().to_string_lossy().to_lowercase()) {
                return entry.path();
            }
        }
    }
    fallback.to_path_buf()
}

fn part_base(name: &str) -> Option<&str> {
    if let Some(i) = name.find(".part") {
        if name[i + 5..].chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return Some(&name[..i]);
        }
    }
    if name.len() > 4 {
        let (stem, ext) = name.split_at(name.len() - 4);
        if ext.starts_with('.') && ext[1..].chars().all(|c| c.is_ascii_digit()) {
            return Some(stem);
        }
    }
    None
}

fn archive_files(dir: &Path, save_path: &Path) -> Vec<PathBuf> {
    let name = save_path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let base = match part_base(&name) {
        Some(b) => b.to_string(),
        None => return vec![save_path.to_path_buf()],
    };
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            p.is_file() && part_base(&n) == Some(base.as_str())
        })
        .collect();
    if found.is_empty() {
        found.push(save_path.to_path_buf());
    }
    found.sort();
    found
}

fn progress_emitter<'a>(app: &'a AppHandle, download_id: &'a str, appid: &'a str, game_name: &'a Option<String>) -> impl Fn(u8) + 'a {
    move |p| {
        app.emit(
            "uc:download-update",
            json!({
                "downloadId": download_id,
                "status": "extracting",
                "appid": appid,
                "gameName": game_name,
                "extractProgress": p,
            }),
        )
        .ok();
    }
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

fn last_percent(s: &str) -> Option<u8> {
    let b = s.as_bytes();
    let mut out = None;
    for (i, &c) in b.iter().enumerate() {
        if c == b'%' {
            let mut j = i;
            while j > 0 && b[j - 1].is_ascii_digit() {
                j -= 1;
            }
            if j < i {
                if let Ok(p) = s[j..i].parse::<u8>() {
                    out = Some(p.min(100));
                }
            }
        }
    }
    out
}

fn which_extractor() -> Option<String> {
    let path = std::env::var("PATH").ok()?;
    let sep = if cfg!(windows) { ';' } else { ':' };
    for name in ["bsdtar", "tar"] {
        let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
        for dir in path.split(sep) {
            let p = std::path::Path::new(dir).join(&file);
            if p.is_file() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    None
}

async fn run_libarchive(bin: &str, archive: &Path, out_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(out_dir).ok();
    let mut cmd = tokio::process::Command::new(bin);
    cmd.arg("-x")
        .arg("-f")
        .arg(archive)
        .arg("-C")
        .arg(out_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd
        .output()
        .await
        .map_err(|e| crate::error::AppError::msg(format!("libarchive spawn: {e}")))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(crate::error::AppError::msg(format!(
            "libarchive extract failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )))
    }
}

async fn run_7z(archive: &Path, out_dir: &Path, on_progress: impl Fn(u8)) -> Result<()> {
    use tokio::io::AsyncReadExt;
    let bin = crate::bins::resolve_sidecar("7z")
        .ok_or_else(|| crate::error::AppError::msg("7z binary not found, run pnpm fetch-sidecars"))?;
    std::fs::create_dir_all(out_dir).ok();
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.arg("x")
        .arg(archive)
        .arg(format!("-o{}", out_dir.display()))
        .arg("-y")
        .arg("-bso0")
        .arg("-bsp1")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd.spawn().map_err(|e| crate::error::AppError::msg(format!("7z spawn: {e}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let progress = async {
        if let Some(mut out) = stdout {
            let mut buf = [0u8; 4096];
            let mut last = 0u8;
            while let Ok(n) = out.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                if let Some(p) = last_percent(&String::from_utf8_lossy(&buf[..n])) {
                    if p != last {
                        last = p;
                        on_progress(p);
                    }
                }
            }
        }
    };
    let drain_err = async {
        let mut err_text = String::new();
        if let Some(mut e) = stderr {
            e.read_to_string(&mut err_text).await.ok();
        }
        err_text
    };
    let (_, err_text) = tokio::join!(progress, drain_err);
    let status = child.wait().await.map_err(|e| crate::error::AppError::msg(format!("7z wait: {e}")))?;
    if !status.success() {
        if let Some(bin) = which_extractor() {
            if run_libarchive(&bin, archive, out_dir).await.is_ok() {
                on_progress(100);
                return Ok(());
            }
        }
        return Err(crate::error::AppError::msg(format!("extraction failed: {}", err_text.trim())));
    }
    on_progress(100);
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
    if let Some(meta) = metadata {
        if meta.is_object() {
            manifest.insert("metadata".into(), meta.clone());
        }
    }
    crate::downloads::write_manifest_atomic(&manifest_path, &Value::Object(manifest));
}

pub async fn auto_install(app: AppHandle, appid: String, download_id: String, game_name: Option<String>, save_path: PathBuf, installing_dir: PathBuf) {
    let archive = extract_entry_point(&installing_dir, &save_path);
    if !is_archive(&archive) && !sniff_archive(&archive) {
        finalize_installed(&installing_dir, &appid, &game_name, &installing_dir, None);
        emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
        return;
    }
    let engine = app.state::<AppState>().downloads.clone();
    emit_status(&app, &download_id, &appid, &game_name, "extracting", None);
    engine.set_extracting(&appid, true);
    let result = run_7z(&archive, &installing_dir, progress_emitter(&app, &download_id, &appid, &game_name)).await;
    engine.set_extracting(&appid, false);
    match result {
        Ok(_) => {
            finalize_installed(&installing_dir, &appid, &game_name, &installing_dir, None);
            emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
            let parts = archive_files(&installing_dir, &save_path);
            let size: u64 = parts.iter().filter_map(|p| std::fs::metadata(p).ok()).map(|m| m.len()).sum();
            app.emit(
                "uc:archive-delete-prompt",
                json!({
                    "appid": appid,
                    "gameName": game_name,
                    "archivePaths": parts.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>(),
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
                        crate::downloads::write_manifest_atomic(&manifest_path, &v);
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
    state.downloads.set_extracting(&appid, true);
    let result = run_7z(&primary, &dir, progress_emitter(&app, &download_id, &appid, &game_name)).await;
    state.downloads.set_extracting(&appid, false);
    match result {
        Ok(_) => {
            finalize_installed(&dir, &appid, &game_name, &dir, metadata.as_ref());
            emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
        }
        Err(e) => {
            emit_status(&app, &download_id, &appid, &game_name, "extract_failed", Some(&e.to_string()));
            return Ok(json!({ "ok": false, "error": e.to_string(), "downloadId": download_id }));
        }
    }
    Ok(json!({ "ok": true, "downloadId": download_id, "extracted": 1 }))
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
    state.downloads.set_extracting(&appid, true);
    let result = run_7z(&extract_entry_point(&dir, &save_path), &dir, progress_emitter(&app, &download_id, &appid, &game_name)).await;
    state.downloads.set_extracting(&appid, false);
    match result {
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

#[tauri::command(async)]
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
