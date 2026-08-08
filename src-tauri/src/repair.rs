use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, Result};
use crate::state::AppState;

const REPAIR_PASSWORD: &str = "online-fix.me";
const MARKERS: &[&str] = &["OnlineFix.ini", "OnlineFix64.dll", "OnlineFix32.dll"];

fn emit(app: &AppHandle, appid: &str, phase: &str, percent: Option<u8>, error: Option<&str>) {
    app.emit(
        "uc:repair-progress",
        json!({ "appid": appid, "phase": phase, "percent": percent, "error": error }),
    )
    .ok();
}

fn referer_headers() -> HashMap<String, String> {
    HashMap::from([("Referer".to_string(), "https://online-fix.me/".to_string())])
}

async fn download_to(app: &AppHandle, appid: &str, url: &str, dest: &Path) -> Result<()> {
    let jar = crate::http::Jar::new();
    let dir = url
        .rsplit_once('/')
        .map(|(d, _)| format!("{d}/"))
        .unwrap_or_else(|| url.to_string());
    let prime = crate::http::FetchOpts {
        headers: referer_headers(),
        jar: Some(jar.clone()),
        timeout: Some(Duration::from_secs(60)),
        ..Default::default()
    };
    let _ = crate::http::fetch(&dir, &prime).await;
    let opts = crate::http::FetchOpts {
        headers: referer_headers(),
        jar: Some(jar),
        timeout: Some(Duration::from_secs(1800)),
        ..Default::default()
    };
    let resp = crate::http::fetch(url, &opts)
        .await
        .map_err(|e| AppError::msg(format!("repair download: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "repair download HTTP {}",
            resp.status()
        )));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| AppError::msg(format!("repair file: {e}")))?;
    let mut stream = resp.bytes_stream();
    let mut done: u64 = 0;
    let mut last = 0u8;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::msg(format!("repair stream: {e}")))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::msg(format!("repair write: {e}")))?;
        done += chunk.len() as u64;
        if let Some(p) = done.saturating_mul(100).checked_div(total) {
            let p = p as u8;
            if p != last {
                last = p;
                emit(app, appid, "downloading", Some(p), None);
            }
        }
    }
    file.flush().await.ok();
    Ok(())
}

fn find_marker(root: &Path, max_depth: usize) -> Option<PathBuf> {
    let mut queue: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    let mut i = 0;
    while i < queue.len() {
        let (d, depth) = queue[i].clone();
        i += 1;
        for m in MARKERS {
            let p = d.join(m);
            if p.is_file() {
                return Some(p);
            }
        }
        if depth < max_depth {
            if let Ok(rd) = std::fs::read_dir(&d) {
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        let name = p
                            .file_name()
                            .map(|n| n.to_string_lossy().to_lowercase())
                            .unwrap_or_default();
                        if name.contains("backup") || name.contains("language pack") {
                            continue;
                        }
                        queue.push((p, depth + 1));
                    }
                }
            }
        }
    }
    None
}

fn strip_rel(dir: &Path, rel: &str) -> Option<PathBuf> {
    let rel_comps: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
    if rel_comps.is_empty() {
        return Some(dir.to_path_buf());
    }
    let dir_comps: Vec<_> = dir.components().collect();
    if dir_comps.len() < rel_comps.len() {
        return None;
    }
    let split = dir_comps.len() - rel_comps.len();
    let tail_matches = dir_comps[split..]
        .iter()
        .zip(&rel_comps)
        .all(|(c, r)| c.as_os_str().to_string_lossy().eq_ignore_ascii_case(r));
    if !tail_matches {
        return None;
    }
    let mut root = PathBuf::new();
    for c in &dir_comps[..split] {
        root.push(c.as_os_str());
    }
    Some(root)
}

fn repair_root(install_dir: &Path, entries: &[String]) -> Option<PathBuf> {
    let rel = entries
        .iter()
        .map(|e| e.replace('\\', "/"))
        .find(|e| {
            let lower = e.to_lowercase();
            MARKERS.iter().any(|m| lower.ends_with(&m.to_lowercase()))
        })
        .map(|e| {
            e.rsplit_once('/')
                .map(|(d, _)| d.to_string())
                .unwrap_or_default()
        })?;
    let existing = find_marker(install_dir, 8)?;
    let existing_dir = existing.parent()?;
    strip_rel(existing_dir, &rel)
}

#[tauri::command]
pub async fn onlinefix_repair(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
    title: String,
) -> Result<Value> {
    if !crate::settings::onlinefix_enabled() {
        let message = "Online-Fix repairs are disabled — enable them in Settings → Sources";
        emit(&app, &appid, "failed", None, Some(message));
        return Ok(json!({ "ok": false, "error": message }));
    }
    if !crate::sources::adapters::onlinefix::is_ready() {
        let message = "Online-Fix requires a healthy Slipgate and a successful live source refresh";
        emit(&app, &appid, "failed", None, Some(message));
        return Ok(json!({ "ok": false, "error": message }));
    }
    let roots = crate::library::scan_roots(&state);
    let Some(install_dir) = crate::library::game_files_dir(&roots, &appid) else {
        emit(
            &app,
            &appid,
            "failed",
            None,
            Some("game not found in library"),
        );
        return Ok(json!({ "ok": false, "error": "game not found in library" }));
    };
    emit(&app, &appid, "resolving", None, None);
    let Some(url) = crate::sources::adapters::onlinefix::repair_url(&title).await else {
        emit(
            &app,
            &appid,
            "failed",
            None,
            Some("no Online-Fix repair found"),
        );
        return Ok(json!({ "ok": false, "error": "no Online-Fix repair found for this title" }));
    };
    emit(&app, &appid, "downloading", Some(0), None);
    let tmp = install_dir.join(".online-fix-repair.rar");
    if let Err(e) = download_to(&app, &appid, &url, &tmp).await {
        std::fs::remove_file(&tmp).ok();
        emit(&app, &appid, "failed", None, Some(&e.to_string()));
        return Ok(json!({ "ok": false, "error": e.to_string() }));
    }
    let entries = crate::install::run_7z_list(&tmp, Some(REPAIR_PASSWORD))
        .await
        .unwrap_or_default();
    let probe_dir = install_dir.clone();
    let target = tokio::task::spawn_blocking(move || repair_root(&probe_dir, &entries))
        .await
        .ok()
        .flatten();
    let Some(target) = target else {
        std::fs::remove_file(&tmp).ok();
        let msg =
            "couldn't locate this game's Online-Fix files to repair — is it an Online-Fix install?";
        emit(&app, &appid, "failed", None, Some(msg));
        return Ok(json!({ "ok": false, "error": msg }));
    };
    emit(&app, &appid, "extracting", Some(0), None);
    let app2 = app.clone();
    let appid2 = appid.clone();
    let result = crate::install::run_7z_pw(&tmp, &target, Some(REPAIR_PASSWORD), move |p| {
        emit(&app2, &appid2, "extracting", Some(p), None);
    })
    .await;
    std::fs::remove_file(&tmp).ok();
    match result {
        Ok(_) => {
            crate::library::invalidate_scan();
            emit(&app, &appid, "done", Some(100), None);
            Ok(json!({ "ok": true }))
        }
        Err(e) => {
            emit(&app, &appid, "failed", None, Some(&e.to_string()));
            Ok(json!({ "ok": false, "error": e.to_string() }))
        }
    }
}
