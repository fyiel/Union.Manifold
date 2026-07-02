use std::path::PathBuf;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

fn cache_dir(app: &AppHandle) -> PathBuf {
    app.state::<AppState>().paths.asset_cache_dir.clone()
}

fn content_type_of(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}

fn query_param(uri: &str, key: &str) -> Option<String> {
    let q = uri.split('?').nth(1)?;
    for pair in q.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(percent_encoding::percent_decode_str(v).decode_utf8_lossy().to_string());
            }
        }
    }
    None
}

pub async fn respond(app: AppHandle, uri: String) -> (u16, Vec<u8>, String) {
    let remote = match query_param(&uri, "u") {
        Some(u) if !u.is_empty() => u,
        _ => return (400, b"missing u".to_vec(), "text/plain".to_string()),
    };
    let dir = cache_dir(&app);
    std::fs::create_dir_all(&dir).ok();
    let key = hex::encode(Sha256::digest(remote.as_bytes()));
    let path = dir.join(&key);
    if let Ok(bytes) = std::fs::read(&path) {
        let ct = content_type_of(&bytes).to_string();
        return (200, bytes, ct);
    }
    match crate::http::fetch(&remote, &crate::http::FetchOpts::default()).await {
        Ok(resp) => match resp.bytes().await {
            Ok(body) => {
                let bytes = body.to_vec();
                std::fs::write(&path, &bytes).ok();
                let ct = content_type_of(&bytes).to_string();
                (200, bytes, ct)
            }
            Err(_) => (502, b"fetch body failed".to_vec(), "text/plain".to_string()),
        },
        Err(_) => (502, b"fetch failed".to_vec(), "text/plain".to_string()),
    }
}

pub async fn respond_local(uri: String) -> (u16, Vec<u8>, String) {
    let raw = uri
        .strip_prefix("uc-local://")
        .or_else(|| uri.strip_prefix("uc-local:/"))
        .unwrap_or(&uri);
    let decoded = percent_encoding::percent_decode_str(raw).decode_utf8_lossy().to_string();
    let path = if cfg!(windows) {
        decoded.replace('/', "\\")
    } else {
        format!("/{}", decoded.trim_start_matches('/'))
    };
    match std::fs::read(&path) {
        Ok(bytes) => {
            let ct = content_type_of(&bytes).to_string();
            (200, bytes, ct)
        }
        Err(_) => (404, b"not found".to_vec(), "text/plain".to_string()),
    }
}

#[tauri::command]
pub fn assets_size(app: AppHandle) -> Value {
    let dir = cache_dir(&app);
    let bytes: u64 = walkdir::WalkDir::new(&dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum();
    json!({ "ok": true, "bytes": bytes })
}

#[tauri::command]
pub fn assets_clear(app: AppHandle) -> Value {
    let dir = cache_dir(&app);
    let mut freed = 0u64;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                freed += meta.len();
            }
            std::fs::remove_file(entry.path()).ok();
        }
    }
    json!({ "ok": true, "freed": freed })
}

pub fn assets_state(_state: State<'_, AppState>) {}
