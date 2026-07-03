use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::state::AppState;

static NEG_CACHE: Lazy<Mutex<HashMap<String, Instant>>> = Lazy::new(|| Mutex::new(HashMap::new()));
const NEG_TTL: Duration = Duration::from_secs(60);

fn neg_hit(key: &str) -> bool {
    let mut map = NEG_CACHE.lock().unwrap();
    if let Some(at) = map.get(key) {
        if at.elapsed() < NEG_TTL {
            return true;
        }
        map.remove(key);
    }
    false
}

fn neg_mark(key: &str) {
    NEG_CACHE.lock().unwrap().insert(key.to_string(), Instant::now());
}

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
    let key = hex::encode(Sha256::digest(remote.as_bytes()));
    let path = dir.join(&key);
    if let Ok(bytes) = tokio::fs::read(&path).await {
        let ct = content_type_of(&bytes).to_string();
        return (200, bytes, ct);
    }
    if neg_hit(&key) {
        return (404, b"cached miss".to_vec(), "text/plain".to_string());
    }
    let opts = crate::http::FetchOpts {
        retries: Some(0),
        timeout: Some(Duration::from_secs(6)),
        ..Default::default()
    };
    match crate::http::fetch(&remote, &opts).await {
        Ok(resp) if resp.status().is_success() => match resp.bytes().await {
            Ok(body) => {
                let bytes = body.to_vec();
                tokio::fs::create_dir_all(&dir).await.ok();
                tokio::fs::write(&path, &bytes).await.ok();
                let ct = content_type_of(&bytes).to_string();
                (200, bytes, ct)
            }
            Err(_) => {
                neg_mark(&key);
                (502, b"fetch body failed".to_vec(), "text/plain".to_string())
            }
        },
        Ok(resp) => {
            neg_mark(&key);
            (resp.status().as_u16(), b"upstream error".to_vec(), "text/plain".to_string())
        }
        Err(_) => {
            neg_mark(&key);
            (502, b"fetch failed".to_vec(), "text/plain".to_string())
        }
    }
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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
