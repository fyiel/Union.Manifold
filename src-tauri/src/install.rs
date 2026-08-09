use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::downloads::{now_ms, safe_folder_name, DownloadEngine, MANIFEST_NAME};
use crate::error::Result;
use crate::state::AppState;

const ARCHIVE_EXTS: &[&str] = &[
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".001", ".r00",
];

fn has_part_marker(name: &str) -> bool {
    name.contains(".part1.") || name.contains(".part01.")
}

fn is_archive(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    ARCHIVE_EXTS.iter().any(|e| name.ends_with(e)) || has_part_marker(&name)
}

/// Extract an archive into `out_dir`, clearing the engine's extracting
/// flag in both outcomes.
/// Install-concurrency guard: returns the error payload when the app
/// already has an active download or another install holds the lock.
fn install_guard(downloads: &std::sync::Arc<DownloadEngine>, appid: &str) -> Option<Value> {
    if downloads.appid_active(appid) {
        return Some(json!({ "ok": false, "error": "download in progress for this app" }));
    }
    if !downloads.try_install_lock(appid) {
        return Some(json!({ "ok": false, "error": "install already in progress" }));
    }
    None
}

fn archive_download_id(appid: &str, existing: Option<String>) -> String {
    existing.unwrap_or_else(|| format!("{appid}-archive-{}", now_ms()))
}

async fn extract_archive(
    downloads: &std::sync::Arc<DownloadEngine>,
    app: &AppHandle,
    download_id: &str,
    appid: &str,
    game_name: &Option<String>,
    archive: &Path,
    out_dir: &Path,
) -> Result<()> {
    emit_status(app, download_id, appid, game_name, "extracting", None);
    downloads.set_extracting(appid, true);
    let mut result = run_7z(archive, out_dir, progress_emitter(app, download_id, appid, game_name)).await;
    if result.is_ok() {
        result = extract_leftover_tar(out_dir, archive).await;
    }
    downloads.set_extracting(appid, false);
    result
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
    has_part_marker(name) || name.ends_with(".001")
}

pub(crate) fn extract_entry_point(dir: &Path, fallback: &Path) -> PathBuf {
    let name = fallback
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
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
        if name[i + 5..]
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
        {
            return Some(&name[..i]);
        }
    }
    if let Some((stem, ext)) = name.rsplit_once('.') {
        if !stem.is_empty() && ext.len() == 3 && ext.chars().all(|c| c.is_ascii_digit()) {
            return Some(stem);
        }
    }
    None
}

fn archive_files(dir: &Path, save_path: &Path) -> Vec<PathBuf> {
    let name = save_path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
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
            let n = p
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            p.is_file() && part_base(&n) == Some(base.as_str())
        })
        .collect();
    if found.is_empty() {
        found.push(save_path.to_path_buf());
    }
    found.sort();
    found
}

fn progress_emitter<'a>(
    app: &'a AppHandle,
    download_id: &'a str,
    appid: &'a str,
    game_name: &'a Option<String>,
) -> impl Fn(u8) + 'a {
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

fn emit_status(
    app: &AppHandle,
    download_id: &str,
    appid: &str,
    game_name: &Option<String>,
    status: &str,
    error: Option<&str>,
) {
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

pub(crate) fn dir_size(dir: &Path) -> u64 {
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

pub(crate) fn which_extractor() -> Option<String> {
    ["bsdtar", "tar"]
        .into_iter()
        .find_map(|name| crate::bins::find_on_path(name).map(|p| p.to_string_lossy().to_string()))
}

/// Post-extraction containment check: every entry must resolve inside the
/// target directory. The bundled 7z (23.01) and libarchive collapse
/// traversal entries themselves, but this keeps a future sidecar regression
/// or a symlink pointing outside the target from escaping the extract dir.
pub(crate) fn verify_contained(out_dir: &Path) -> std::result::Result<(), String> {
    let root = std::fs::canonicalize(out_dir)
        .map_err(|e| format!("resolve extract dir: {e}"))?;
    for entry in walkdir::WalkDir::new(out_dir).into_iter().flatten() {
        let Ok(canonical) = std::fs::canonicalize(entry.path()) else {
            return Err(format!(
                "extracted entry cannot be resolved: {}",
                entry.path().display()
            ));
        };
        if !canonical.starts_with(&root) {
            return Err(format!(
                "extracted entry escapes the target: {}",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

pub(crate) async fn run_libarchive(bin: &str, archive: &Path, out_dir: &Path) -> Result<()> {
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
        verify_contained(out_dir)
            .map_err(crate::error::AppError::msg)?;
        Ok(())
    } else {
        Err(crate::error::AppError::msg(format!(
            "libarchive extract failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )))
    }
}

pub(crate) async fn run_7z(archive: &Path, out_dir: &Path, on_progress: impl Fn(u8)) -> Result<()> {
    run_7z_pw(archive, out_dir, None, on_progress).await
}

pub(crate) async fn run_7z_pw(
    archive: &Path,
    out_dir: &Path,
    password: Option<&str>,
    on_progress: impl Fn(u8),
) -> Result<()> {
    use tokio::io::AsyncReadExt;
    let bin = crate::bins::resolve_sidecar("7z").ok_or_else(|| {
        crate::error::AppError::msg("7z binary not found, run bun run fetch-sidecars")
    })?;
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
    if let Some(pw) = password {
        cmd.arg(format!("-p{pw}"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| crate::error::AppError::msg(format!("7z spawn: {e}")))?;
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
    let status = child
        .wait()
        .await
        .map_err(|e| crate::error::AppError::msg(format!("7z wait: {e}")))?;
    if !status.success() {
        if let Some(bin) = which_extractor() {
            crate::logging::write_line(
                "warn",
                &format!(
                    "7z failed on {}, retrying with libarchive ({bin})",
                    archive.display()
                ),
            );
            if run_libarchive(&bin, archive, out_dir).await.is_ok() {
                crate::logging::write_line("info", "libarchive fallback extracted the archive");
                on_progress(100);
                return Ok(());
            }
        }
        return Err(crate::error::AppError::msg(format!(
            "extraction failed: {}",
            err_text.trim()
        )));
    }
    verify_contained(out_dir).map_err(crate::error::AppError::msg)?;
    on_progress(100);
    Ok(())
}

pub(crate) async fn run_7z_list(archive: &Path, password: Option<&str>) -> Result<Vec<String>> {
    let bin = crate::bins::resolve_sidecar("7z").ok_or_else(|| {
        crate::error::AppError::msg("7z binary not found, run bun run fetch-sidecars")
    })?;
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.arg("l")
        .arg("-slt")
        .arg(archive)
        .arg("-y")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    if let Some(pw) = password {
        cmd.arg(format!("-p{pw}"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd
        .output()
        .await
        .map_err(|e| crate::error::AppError::msg(format!("7z list: {e}")))?;
    if !out.status.success() {
        return Err(crate::error::AppError::msg("7z list failed"));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .filter_map(|l| l.strip_prefix("Path = "))
        .map(|s| s.to_string())
        .collect())
}

async fn finalize_installed(
    dir: &Path,
    appid: &str,
    game_name: &Option<String>,
    install_path: &Path,
    metadata: Option<&Value>,
) {
    let manifest_path = dir.join(MANIFEST_NAME);
    let mut manifest = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    manifest.insert("appid".into(), json!(appid));
    manifest.insert(
        "name".into(),
        json!(game_name.clone().unwrap_or_else(|| appid.to_string())),
    );
    manifest.insert("installStatus".into(), json!("installed"));
    manifest.insert("installPath".into(), json!(install_path.to_string_lossy()));
    let size = {
        let p = install_path.to_path_buf();
        tokio::task::spawn_blocking(move || dir_size(&p))
            .await
            .unwrap_or(0)
    };
    manifest.insert("sizeBytes".into(), json!(size));
    manifest.insert("installedAt".into(), json!(now_ms()));
    manifest.insert("updatedAt".into(), json!(now_ms()));
    manifest.remove("installError");
    if let Some(meta) = metadata {
        if meta.is_object() {
            manifest.insert("metadata".into(), meta.clone());
        }
    }
    crate::downloads::write_manifest_atomic(&manifest_path, &Value::Object(manifest));
    crate::library::invalidate_scan();
}

fn commit_staged_update(staging_dir: &Path, target_dir: &Path) -> Result<()> {
    let staged_path = staging_dir.join(MANIFEST_NAME);
    let staged = std::fs::read_to_string(&staged_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .ok_or_else(|| crate::error::AppError::msg("staged install manifest is missing"))?;
    let target_path = target_dir.join(MANIFEST_NAME);
    let mut manifest = std::fs::read_to_string(&target_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    crate::library::merge_manifest_updates(&mut manifest, &Value::Object(staged));
    manifest.insert("installPath".into(), json!(target_dir.to_string_lossy()));
    if let Some(snapshot) = manifest
        .get_mut("downloadSnapshot")
        .and_then(Value::as_object_mut)
    {
        let save_path = snapshot
            .get("savePath")
            .and_then(Value::as_str)
            .map(PathBuf::from);
        if let Some(relative) = save_path
            .as_deref()
            .and_then(|path| path.strip_prefix(staging_dir).ok())
        {
            snapshot.insert(
                "savePath".into(),
                json!(target_dir.join(relative).to_string_lossy()),
            );
        }
    }
    crate::downloads::write_json_atomic(&staged_path, &Value::Object(manifest))
        .map_err(|error| crate::error::AppError::msg(format!("write staged manifest: {error}")))?;

    let parent = staging_dir
        .parent()
        .ok_or_else(|| crate::error::AppError::msg("staging directory has no parent"))?;
    let backup = parent.join(format!(
        ".backup-{}-{}-{}",
        safe_folder_name(
            target_dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("game")
        ),
        std::process::id(),
        now_ms(),
    ));
    let had_target = target_dir.exists();
    if had_target {
        std::fs::rename(target_dir, &backup).map_err(|error| {
            crate::error::AppError::msg(format!("stage installed update: {error}"))
        })?;
    }
    if let Err(error) = std::fs::rename(staging_dir, target_dir) {
        if had_target {
            let restore = std::fs::rename(&backup, target_dir);
            return Err(crate::error::AppError::msg(match restore {
                Ok(_) => format!("commit installed update: {error}"),
                Err(restore_error) => format!(
                    "commit installed update: {error}; restore previous install: {restore_error}"
                ),
            }));
        }
        return Err(crate::error::AppError::msg(format!(
            "commit installed update: {error}"
        )));
    }
    if had_target {
        std::fs::remove_dir_all(&backup).ok();
    }
    crate::library::invalidate_scan();
    Ok(())
}

async fn finalize_download_install(
    staging_dir: &Path,
    appid: &str,
    game_name: &Option<String>,
    replace_dir: Option<&Path>,
) -> Result<PathBuf> {
    finalize_installed(staging_dir, appid, game_name, staging_dir, None).await;
    if let Some(target_dir) = replace_dir {
        commit_staged_update(staging_dir, target_dir)?;
        Ok(target_dir.to_path_buf())
    } else {
        Ok(staging_dir.to_path_buf())
    }
}

fn mark_install_failed(dir: &Path, error: &str) {
    let manifest_path = dir.join(MANIFEST_NAME);
    if let Ok(text) = std::fs::read_to_string(&manifest_path) {
        if let Ok(mut v) = serde_json::from_str::<Value>(&text) {
            if let Some(obj) = v.as_object_mut() {
                obj.insert("installStatus".into(), json!("failed"));
                obj.insert("installError".into(), json!(error));
                crate::downloads::write_manifest_atomic(&manifest_path, &v);
            }
        }
    }
    crate::library::invalidate_scan();
}

async fn extract_leftover_tar(out_dir: &Path, source: &Path) -> Result<()> {
    if source
        .extension()
        .map(|x| x.eq_ignore_ascii_case("tar"))
        .unwrap_or(false)
    {
        return Ok(());
    }
    let tars: Vec<PathBuf> = std::fs::read_dir(out_dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p != source
                && p.extension()
                    .map(|x| x.eq_ignore_ascii_case("tar"))
                    .unwrap_or(false)
        })
        .collect();
    if let [tar] = tars.as_slice() {
        run_7z(tar, out_dir, |_| {}).await?;
        std::fs::remove_file(tar).ok();
    }
    Ok(())
}

pub async fn auto_install(
    app: AppHandle,
    appid: String,
    download_id: String,
    game_name: Option<String>,
    save_path: PathBuf,
    installing_dir: PathBuf,
    replace_dir: Option<PathBuf>,
) {
    let archive = extract_entry_point(&installing_dir, &save_path);
    let display_name = game_name.clone().unwrap_or_else(|| appid.clone());
    if !is_archive(&archive) && !sniff_archive(&archive) {
        if let Err(error) =
            finalize_download_install(&installing_dir, &appid, &game_name, replace_dir.as_deref())
                .await
        {
            let message = error.to_string();
            mark_install_failed(&installing_dir, &message);
            emit_status(
                &app,
                &download_id,
                &appid,
                &game_name,
                "extract_failed",
                Some(&message),
            );
            return;
        }
        emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
        crate::notify::send_if(
            &app,
            "notifyInstallDone",
            true,
            "Ready to play",
            &format!("{display_name} finished installing"),
        );
        return;
    }
    let margin_gib = app
        .state::<AppState>()
        .settings
        .get("diskSpaceMarginGiB")
        .as_u64()
        .map(|n| n.clamp(0, 64))
        .unwrap_or(2);
    let download_bytes: u64 = archive_files(&installing_dir, &save_path)
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum();
    let required = crate::storage::estimate_extract(download_bytes, 0, margin_gib);
    let free = crate::storage::free_bytes(&installing_dir);
    if download_bytes > 0 && free < required {
        let msg = format!(
            "Not enough disk space (need {}, free {})",
            crate::storage::human(required),
            crate::storage::human(free),
        );
        mark_install_failed(&installing_dir, &msg);
        emit_status(&app, &download_id, &appid, &game_name, "failed", Some(&msg));
        return;
    }
    let result = extract_archive(
        &app.state::<AppState>().downloads.clone(),
        &app,
        &download_id,
        &appid,
        &game_name,
        &archive,
        &installing_dir,
    )
    .await;
    match result {
        Ok(_) => {
            let installed_dir = match finalize_download_install(
                &installing_dir,
                &appid,
                &game_name,
                replace_dir.as_deref(),
            )
            .await
            {
                Ok(dir) => dir,
                Err(error) => {
                    let message = error.to_string();
                    mark_install_failed(&installing_dir, &message);
                    emit_status(
                        &app,
                        &download_id,
                        &appid,
                        &game_name,
                        "extract_failed",
                        Some(&message),
                    );
                    return;
                }
            };
            emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
            crate::notify::send_if(
                &app,
                "notifyInstallDone",
                true,
                "Ready to play",
                &format!("{display_name} finished installing"),
            );
            let installed_save_path = save_path
                .strip_prefix(&installing_dir)
                .map(|relative| installed_dir.join(relative))
                .unwrap_or_else(|_| save_path.clone());
            let parts = archive_files(&installed_dir, &installed_save_path);
            let size: u64 = parts
                .iter()
                .filter_map(|p| std::fs::metadata(p).ok())
                .map(|m| m.len())
                .sum();
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
            mark_install_failed(&installing_dir, &e.to_string());
            emit_status(
                &app,
                &download_id,
                &appid,
                &game_name,
                "extract_failed",
                Some(&e.to_string()),
            );
            crate::notify::send_if(
                &app,
                "notifyInstallDone",
                true,
                "Install failed",
                &format!("{display_name} could not be extracted"),
            );
        }
    }
}

#[tauri::command]
pub async fn install_from_archive(
    state: State<'_, AppState>,
    app: AppHandle,
    payload: Value,
) -> Result<Value> {
    let appid = payload
        .get("appid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let game_name = payload
        .get("gameName")
        .and_then(|v| v.as_str())
        .map(String::from);
    let download_id = payload
        .get("downloadId")
        .and_then(|v| v.as_str())
        .map(String::from)
        .map(|s| archive_download_id(&appid, Some(s)));
    let archive_paths: Vec<PathBuf> = payload
        .get("archivePaths")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|p| p.as_str().map(PathBuf::from))
                .collect()
        })
        .unwrap_or_default();
    let metadata = payload.get("metadata").cloned();
    if archive_paths.is_empty() {
        return Ok(json!({ "ok": false, "error": "no archive paths" }));
    }
    if let Some(err) = install_guard(&state.downloads, &appid) {
        return Ok(err);
    }
    let out = async {
        let dir = crate::downloads::install_dir_for(&state.download_root(), game_name.as_deref().unwrap_or(&appid));
        std::fs::create_dir_all(&dir).ok();
        let primary = archive_paths[0].clone();
        let result = extract_archive(
            &state.downloads,
            &app,
            &download_id,
            &appid,
            &game_name,
            &primary,
            &dir,
        )
        .await;
        match result {
            Ok(_) => {
                finalize_installed(&dir, &appid, &game_name, &dir, metadata.as_ref()).await;
                emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
            }
            Err(e) => {
                emit_status(
                    &app,
                    &download_id,
                    &appid,
                    &game_name,
                    "extract_failed",
                    Some(&e.to_string()),
                );
                return Ok(
                    json!({ "ok": false, "error": e.to_string(), "downloadId": download_id }),
                );
            }
        }
        Ok(json!({ "ok": true, "downloadId": download_id, "extracted": 1 }))
    }
    .await;
    state.downloads.install_unlock(&appid);
    out
}

#[tauri::command]
pub async fn install_downloaded_archive(
    state: State<'_, AppState>,
    app: AppHandle,
    appid: String,
) -> Result<Value> {
    let (dir, save_path, game_name, download_id) = {
        let found = find_installing(&state.download_root(), &appid);
        match found {
            Some((dir, manifest)) => {
                if manifest.get("installStatus").and_then(|v| v.as_str()) != Some("downloaded") {
                    return Ok(json!({ "ok": false, "error": "archive is not ready to install" }));
                }
                let snap = manifest.get("downloadSnapshot");
                let save = snap
                    .and_then(|s| s.get("savePath"))
                    .and_then(|v| v.as_str())
                    .map(PathBuf::from)
                    .unwrap_or_else(|| dir.clone());
                let name = manifest
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let id = snap
                    .and_then(|s| s.get("downloadId"))
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .map(|s| archive_download_id(&appid, Some(s)))
                    .unwrap_or_else(|| archive_download_id(&appid, None));
                (dir, save, name, id)
            }
            None => return Ok(json!({ "ok": false, "error": "no downloaded archive found" })),
        }
    };
    if state.downloads.appid_active(&appid) {
        return Ok(json!({ "ok": false, "error": "download in progress for this app" }));
    }
    if !state.downloads.try_install_lock(&appid) {
        return Ok(json!({ "ok": false, "error": "install already in progress" }));
    }
    let out = async {
        let entry = extract_entry_point(&dir, &save_path);
        let result = extract_archive(
            &state.downloads,
            &app,
            &download_id,
            &appid,
            &game_name,
            &entry,
            &dir,
        )
        .await;
        match result {
            Ok(_) => {
                finalize_installed(&dir, &appid, &game_name, &dir, None).await;
                emit_status(&app, &download_id, &appid, &game_name, "extracted", None);
                Ok(json!({ "ok": true, "downloadId": download_id, "extracted": 1 }))
            }
            Err(e) => {
                emit_status(
                    &app,
                    &download_id,
                    &appid,
                    &game_name,
                    "extract_failed",
                    Some(&e.to_string()),
                );
                Ok(json!({ "ok": false, "error": e.to_string(), "downloadId": download_id }))
            }
        }
    }
    .await;
    state.downloads.install_unlock(&appid);
    out
}

pub(crate) fn find_installing(root: &Path, appid: &str) -> Option<(PathBuf, Value)> {
    crate::library::scan_root_manifests(root)
        .into_iter()
        .find(|(_, v)| v.get("appid").and_then(|a| a.as_str()) == Some(appid))
}

#[tauri::command(async)]
pub fn delete_archive_files(state: State<'_, AppState>, payload: Value) -> Value {
    let root = match state.download_root().canonicalize() {
        Ok(r) => r,
        Err(_) => return json!({ "ok": false, "error": "download root unavailable" }),
    };
    let paths = payload
        .get("archivePaths")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut deleted = 0;
    for p in paths {
        let Some(s) = p.as_str() else { continue };
        let Ok(real) = Path::new(s).canonicalize() else {
            continue;
        };
        if !real.starts_with(&root) || !real.is_file() {
            continue;
        }
        if std::fs::remove_file(&real).is_ok() {
            deleted += 1;
        }
    }
    json!({ "ok": true, "deletedCount": deleted })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_update_replaces_files_and_merges_latest_installed_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("Game");
        let staging = temp.path().join(".updates").join("game");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(target.join("old.bin"), b"old").unwrap();
        std::fs::write(staging.join("new.bin"), b"new").unwrap();
        crate::downloads::write_json_atomic(
            &target.join(MANIFEST_NAME),
            &json!({
                "appid": "game",
                "installStatus": "installed",
                "metadata": {
                    "downloadedVersion": "1.0",
                    "libraryGameMeta": { "lastPlayedAt": 42 }
                }
            }),
        )
        .unwrap();
        crate::downloads::write_json_atomic(
            &staging.join(MANIFEST_NAME),
            &json!({
                "appid": "game",
                "installStatus": "installed",
                "metadata": {
                    "downloadedVersion": "2.0",
                    "version": "2.0"
                }
            }),
        )
        .unwrap();

        commit_staged_update(&staging, &target).unwrap();

        assert!(!target.join("old.bin").exists());
        assert_eq!(std::fs::read(target.join("new.bin")).unwrap(), b"new");
        let manifest: Value =
            serde_json::from_str(&std::fs::read_to_string(target.join(MANIFEST_NAME)).unwrap())
                .unwrap();
        assert_eq!(manifest["metadata"]["downloadedVersion"], json!("2.0"));
        assert_eq!(
            manifest["metadata"]["libraryGameMeta"]["lastPlayedAt"],
            json!(42)
        );
        assert_eq!(manifest["installPath"], json!(target.to_string_lossy()));
    }

    #[test]
    fn failed_staged_update_commit_restores_previous_install() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("Game");
        let staging = target.join("stage");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(target.join("old.bin"), b"old").unwrap();
        crate::downloads::write_json_atomic(
            &target.join(MANIFEST_NAME),
            &json!({ "appid": "game", "installStatus": "installed" }),
        )
        .unwrap();
        crate::downloads::write_json_atomic(
            &staging.join(MANIFEST_NAME),
            &json!({ "appid": "game", "installStatus": "installed" }),
        )
        .unwrap();

        assert!(commit_staged_update(&staging, &target).is_err());
        assert_eq!(std::fs::read(target.join("old.bin")).unwrap(), b"old");
        assert!(target.join(MANIFEST_NAME).is_file());
    }

    #[test]
    fn t_part_base_multibyte_never_panics() {
        assert_eq!(part_base("café.7z"), None);
        assert_eq!(part_base("游戏.7z"), None);
    }

    #[test]
    fn t_part_base_short_names() {
        assert_eq!(part_base("a"), None);
        assert_eq!(part_base("ab"), None);
        assert_eq!(part_base(""), None);
    }

    #[test]
    fn t_part_base_multibyte_slices_on_char_boundary() {
        assert_eq!(part_base("café.part1.rar"), Some("café"));
        assert_eq!(part_base("游戏.part01.7z"), Some("游戏"));
        assert_eq!(part_base("café.001"), Some("café"));
    }

    #[test]
    fn t_part_base_detects_part_and_numeric_ext() {
        assert_eq!(part_base("game.part01.rar"), Some("game"));
        assert_eq!(part_base("archive.part2.rar"), Some("archive"));
        assert_eq!(part_base("game.001"), Some("game"));
    }

    #[test]
    fn t_part_base_rejects_plain_and_non_digit_part() {
        assert_eq!(part_base("game.zip"), None);
        assert_eq!(part_base("readme.txt"), None);
        assert_eq!(part_base("game.partial.zip"), None);
    }

    #[test]
    fn verify_contained_accepts_normal_trees_and_rejects_escapes() {
        let tmp = tempfile::tempdir().unwrap();
        let out = tmp.path().join("out");
        std::fs::create_dir_all(out.join("deep")).unwrap();
        std::fs::write(out.join("deep/a.txt"), "a").unwrap();
        assert!(verify_contained(&out).is_ok());

        let outside = tmp.path().join("outside.txt");
        std::fs::write(&outside, "secret").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, out.join("escape.txt")).unwrap();
            assert!(verify_contained(&out).is_err());

            std::fs::remove_file(out.join("escape.txt")).unwrap();
            std::os::unix::fs::symlink(out.join("deep/a.txt"), out.join("inside.txt")).unwrap();
            assert!(verify_contained(&out).is_ok());

            std::fs::remove_file(out.join("inside.txt")).unwrap();
            std::os::unix::fs::symlink(out.join("missing"), out.join("dangling.txt")).unwrap();
            assert!(verify_contained(&out).is_err());
        }
    }

}
