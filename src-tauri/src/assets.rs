use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as AsyncMutex;

use crate::state::AppState;

static NEG_CACHE: Lazy<Mutex<HashMap<String, Instant>>> = Lazy::new(|| Mutex::new(HashMap::new()));
const NEG_TTL: Duration = Duration::from_secs(60);

static MEM_CACHE: Lazy<Mutex<HashMap<String, (Arc<Vec<u8>>, &'static str)>>> = Lazy::new(|| Mutex::new(HashMap::new()));
const MEM_MAX: usize = 512;
static INFLIGHT: Lazy<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn mem_get(key: &str) -> Option<(Vec<u8>, &'static str)> {
    let map = MEM_CACHE.lock().unwrap();
    map.get(key).map(|(b, ct)| (b.as_ref().clone(), *ct))
}

fn mem_put(key: &str, bytes: &[u8], ct: &'static str) {
    let mut map = MEM_CACHE.lock().unwrap();
    if map.len() >= MEM_MAX {
        map.clear();
    }
    map.insert(key.to_string(), (Arc::new(bytes.to_vec()), ct));
}

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
    // Custom (user-picked) images: served from data_dir/custom-images, OUTSIDE
    // the clearable asset cache so "clear cached assets" never eats them. The
    // name is a content hash written by custom_image_import; reject anything
    // that could traverse out of the directory.
    if let Some(name) = query_param(&uri, "c") {
        if name.is_empty() || name.contains("..") || name.contains(['/', '\\', ':']) {
            return (400, b"bad name".to_vec(), "text/plain".to_string());
        }
        let path = app.state::<AppState>().paths.data_dir.join("custom-images").join(&name);
        return match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let ct = content_type_of(&bytes);
                (200, bytes, ct.to_string())
            }
            Err(_) => (404, b"not found".to_vec(), "text/plain".to_string()),
        };
    }
    let remote = match query_param(&uri, "u") {
        Some(u) if !u.is_empty() => u,
        _ => return (400, b"missing u".to_vec(), "text/plain".to_string()),
    };
    let dir = cache_dir(&app);
    let key = hex::encode(Sha256::digest(remote.as_bytes()));
    let path = dir.join(&key);
    if let Some((bytes, ct)) = mem_get(&key) {
        return (200, bytes, ct.to_string());
    }
    if let Ok(bytes) = tokio::fs::read(&path).await {
        let ct = content_type_of(&bytes);
        mem_put(&key, &bytes, ct);
        return (200, bytes, ct.to_string());
    }
    if neg_hit(&key) {
        return (404, b"cached miss".to_vec(), "text/plain".to_string());
    }
    let gate = {
        let mut inflight = INFLIGHT.lock().unwrap();
        inflight.entry(key.clone()).or_insert_with(|| Arc::new(AsyncMutex::new(()))).clone()
    };
    let _held = gate.lock().await;
    if let Some((bytes, ct)) = mem_get(&key) {
        INFLIGHT.lock().unwrap().remove(&key);
        return (200, bytes, ct.to_string());
    }
    if let Ok(bytes) = tokio::fs::read(&path).await {
        let ct = content_type_of(&bytes);
        mem_put(&key, &bytes, ct);
        INFLIGHT.lock().unwrap().remove(&key);
        return (200, bytes, ct.to_string());
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
                let ct = content_type_of(&bytes);
                mem_put(&key, &bytes, ct);
                INFLIGHT.lock().unwrap().remove(&key);
                (200, bytes, ct.to_string())
            }
            Err(_) => {
                neg_mark(&key);
                INFLIGHT.lock().unwrap().remove(&key);
                (502, b"fetch body failed".to_vec(), "text/plain".to_string())
            }
        },
        Ok(resp) => {
            neg_mark(&key);
            INFLIGHT.lock().unwrap().remove(&key);
            (resp.status().as_u16(), b"upstream error".to_vec(), "text/plain".to_string())
        }
        Err(_) => {
            neg_mark(&key);
            INFLIGHT.lock().unwrap().remove(&key);
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
