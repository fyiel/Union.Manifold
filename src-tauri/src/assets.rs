use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as AsyncMutex;

use crate::state::AppState;

static NEG_CACHE: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
const NEG_TTL: Duration = Duration::from_secs(60);

static MEM_CACHE: LazyLock<Mutex<HashMap<String, (Arc<Vec<u8>>, &'static str)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
const MEM_MAX: usize = 512;
static INFLIGHT: LazyLock<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn mem_get(key: &str) -> Option<(Vec<u8>, &'static str)> {
    let map = MEM_CACHE.lock();
    map.get(key).map(|(b, ct)| (b.as_ref().clone(), *ct))
}

fn mem_put(key: &str, bytes: &[u8], ct: &'static str) {
    let mut map = MEM_CACHE.lock();
    if map.len() >= MEM_MAX {
        map.clear();
    }
    map.insert(key.to_string(), (Arc::new(bytes.to_vec()), ct));
}

fn neg_hit(key: &str) -> bool {
    let mut map = NEG_CACHE.lock();
    if let Some(at) = map.get(key) {
        if at.elapsed() < NEG_TTL {
            return true;
        }
        map.remove(key);
    }
    false
}

fn neg_mark(key: &str) {
    NEG_CACHE.lock().insert(key.to_string(), Instant::now());
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
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && matches!(&bytes[8..12], b"avif" | b"avis") {
        "image/avif"
    } else if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        "image/x-icon"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else if looks_like_svg(bytes) {
        "image/svg+xml"
    } else {
        // Chromium sniffs raster <img> bodies itself, so octet-stream still
        // renders; only SVG (above) hard-requires the right content type.
        "application/octet-stream"
    }
}

// SVG is the one <img> format Chromium refuses to content-sniff: it renders
// only under image/svg+xml, so a UTF-8 BOM or leading whitespace must not
// knock a real SVG down to octet-stream.
fn looks_like_svg(bytes: &[u8]) -> bool {
    let body = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    let start = body.iter().position(|b| !b.is_ascii_whitespace()).unwrap_or(body.len());
    body[start..].starts_with(b"<svg") || body[start..].starts_with(b"<?xml")
}

// Blank-cover reports from Windows can't be reproduced here, so the first few
// upstream failures are logged with a reason class — enough for a user log to
// pinpoint the layer (DNS/TLS vs upstream status) without per-request spam.
static FAIL_LOGGED: AtomicUsize = AtomicUsize::new(0);
const FAIL_LOG_MAX: usize = 25;

fn log_failure(what: &str, url: &str) {
    let n = FAIL_LOGGED.fetch_add(1, Ordering::Relaxed);
    if n < FAIL_LOG_MAX {
        crate::logging::write_line("warn", &format!("asset: {what}: {url}"));
        if n + 1 == FAIL_LOG_MAX {
            crate::logging::write_line("warn", "asset: more fetch failures; suppressing further logs");
        }
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
            Err(e) => {
                log_failure(&format!("custom image read failed ({e})"), &name);
                (404, b"not found".to_vec(), "text/plain".to_string())
            }
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
        let mut inflight = INFLIGHT.lock();
        inflight.entry(key.clone()).or_insert_with(|| Arc::new(AsyncMutex::new(()))).clone()
    };
    let _held = gate.lock().await;
    if let Some((bytes, ct)) = mem_get(&key) {
        INFLIGHT.lock().remove(&key);
        return (200, bytes, ct.to_string());
    }
    if let Ok(bytes) = tokio::fs::read(&path).await {
        let ct = content_type_of(&bytes);
        mem_put(&key, &bytes, ct);
        INFLIGHT.lock().remove(&key);
        return (200, bytes, ct.to_string());
    }
    let opts = crate::http::FetchOpts {
        retries: Some(0),
        timeout: Some(Duration::from_secs(6)),
        // The shared client's default Accept advertises an HTML/JSON
        // navigation, which picky CDNs/WAFs reject for image URLs with a 403.
        // Send what Chromium sends for an <img> request instead.
        headers: HashMap::from([(
            "accept".to_string(),
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8".to_string(),
        )]),
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
                INFLIGHT.lock().remove(&key);
                (200, bytes, ct.to_string())
            }
            Err(e) => {
                // A body cut mid-transfer is the connection's moment, not the
                // URL's: don't negative-cache it, the next render may succeed.
                log_failure(&format!("fetch body failed ({e})"), &remote);
                INFLIGHT.lock().remove(&key);
                (502, b"fetch body failed".to_vec(), "text/plain".to_string())
            }
        },
        Ok(resp) => {
            // Definitive upstream rejection (404/403/5xx): negative-cache so a
            // dead cover URL stops re-stalling the grid on every render.
            let status = resp.status().as_u16();
            neg_mark(&key);
            log_failure(&format!("upstream status {status}"), &remote);
            INFLIGHT.lock().remove(&key);
            (status, b"upstream error".to_vec(), "text/plain".to_string())
        }
        Err(e) => {
            // Timeout/connect/TLS errors describe the machine right now, not
            // the URL. Negative-caching these turned a launch-before-network
            // (boot autostart, installer relaunch) into a blank grid; return
            // the error but leave the URL retryable.
            let kind = if e.is_timeout() {
                "timeout"
            } else if e.is_connect() {
                "connect"
            } else {
                "network"
            };
            log_failure(&format!("fetch {kind} ({e})"), &remote);
            INFLIGHT.lock().remove(&key);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_common_image_signatures() {
        assert_eq!(content_type_of(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a]), "image/png");
        assert_eq!(content_type_of(&[0xff, 0xd8, 0xff, 0xe0, 0x00]), "image/jpeg");
        assert_eq!(content_type_of(b"GIF89a"), "image/gif");
        assert_eq!(content_type_of(b"RIFF\x12\x34\x56\x78WEBPVP8 "), "image/webp");
        assert_eq!(content_type_of(b"\x00\x00\x00\x1cftypavifmif1"), "image/avif");
        assert_eq!(content_type_of(b"\x00\x00\x00\x1cftypavismif1"), "image/avif");
        assert_eq!(content_type_of(&[0x00, 0x00, 0x01, 0x00, 0x01, 0x00]), "image/x-icon");
        assert_eq!(content_type_of(b"BM\x36\x28\x00\x00"), "image/bmp");
    }

    #[test]
    fn sniffs_svg_despite_bom_and_whitespace() {
        assert_eq!(content_type_of(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), "image/svg+xml");
        assert_eq!(content_type_of(b"<?xml version=\"1.0\"?><svg/>"), "image/svg+xml");
        assert_eq!(content_type_of(b"\xef\xbb\xbf\n  <svg/>"), "image/svg+xml");
    }

    #[test]
    fn unknown_bytes_fall_back_to_octet_stream() {
        assert_eq!(content_type_of(b"not an image"), "application/octet-stream");
        assert_eq!(content_type_of(b""), "application/octet-stream");
    }

    #[test]
    fn query_param_reads_linux_and_windows_uri_shapes() {
        // Linux/macOS: webkit hands the custom scheme through untouched.
        let linux = "uc-asset://localhost/img?u=https%3A%2F%2Fcdn.example%2Fa.jpg";
        assert_eq!(query_param(linux, "u").as_deref(), Some("https://cdn.example/a.jpg"));
        // Windows: wry maps the scheme onto http://uc-asset.localhost and
        // reverts before the handler, but both shapes must parse identically.
        let win = "http://uc-asset.localhost/img?u=https%3A%2F%2Fcdn.example%2Fa.jpg";
        assert_eq!(query_param(win, "u").as_deref(), Some("https://cdn.example/a.jpg"));
        assert_eq!(query_param(win, "c"), None);
    }

    #[test]
    fn query_param_custom_name_empty_and_missing() {
        let uri = "http://uc-asset.localhost/img?c=abcdef0123456789abcdef01.png";
        assert_eq!(query_param(uri, "c").as_deref(), Some("abcdef0123456789abcdef01.png"));
        assert_eq!(query_param("uc-asset://localhost/img", "u"), None);
        assert_eq!(query_param("uc-asset://localhost/img?u=", "u").as_deref(), Some(""));
    }

    #[test]
    fn query_param_keeps_encoded_inner_query_opaque() {
        // Regression guard for the Windows double-wrap: an asset URL encoded
        // inside `u` must stay opaque — no top-level `c` may leak out of it.
        let uri = "http://uc-asset.localhost/img?u=http%3A%2F%2Fuc-asset.localhost%2Fimg%3Fc%3Dx.png";
        assert_eq!(query_param(uri, "c"), None);
        assert_eq!(query_param(uri, "u").as_deref(), Some("http://uc-asset.localhost/img?c=x.png"));
    }
}
