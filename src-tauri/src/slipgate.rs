//! Shared client for the user's self-hosted Slipgate resolver.
//!
//! Slipgate drives a real browser (via FlareSolverr) to clear Cloudflare,
//! captchas, and js-only download pages, then hands back a direct url. The
//! app never solves anything itself: it POSTs a recipe name + params to
//! `/resolve` and feeds the returned url into the normal aria2 pipeline.
//! Consumers: the NexusMods free-download path (`mods::nexus`) and the
//! captcha/browser-only file hosts (`sources::hosts::gate`).

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

use crate::http;
use crate::settings::SettingsStore;

// Runtime-injected (the store only exists after Tauri setup), so OnceLock
// rather than LazyLock. Holding the live store means settings edits apply on
// the next resolve without a restart.
static SETTINGS: OnceLock<Arc<SettingsStore>> = OnceLock::new();

pub fn init(settings: Arc<SettingsStore>) {
    SETTINGS.set(settings).ok();
}

#[derive(Clone)]
pub struct Cfg {
    pub base: String,
    pub key: Option<String>,
}

/// Current Slipgate endpoint, if the user configured one. Tests without a
/// store (livetest) can point at an instance via SLIPGATE_URL / SLIPGATE_KEY.
pub fn cfg() -> Option<Cfg> {
    let (url, key) = match SETTINGS.get() {
        Some(s) => (s.get_string("slipgateUrl"), s.get_string("slipgateKey")),
        None => (std::env::var("SLIPGATE_URL").ok(), std::env::var("SLIPGATE_KEY").ok()),
    };
    let base = url
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())?;
    let key = key.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Some(Cfg { base, key })
}

pub async fn post(cfg: &Cfg, path: &str, body: Value, timeout: Duration) -> Result<Value, String> {
    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("Accept".to_string(), "application/json".to_string());
    if let Some(k) = &cfg.key {
        headers.insert("X-Slipgate-Key".to_string(), k.clone());
    }
    let resp = http::fetch(
        &format!("{}{path}", cfg.base),
        &http::FetchOpts {
            method: Some("POST".to_string()),
            headers,
            body: Some(serde_json::to_vec(&body).map_err(|e| format!("slipgate encode: {e}"))?),
            timeout: Some(timeout),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("Slipgate unreachable: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if status == 401 {
        return Err("Slipgate rejected the request (check the key)".to_string());
    }
    if !(200..300).contains(&status) {
        return Err(format!("Slipgate HTTP {status}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Slipgate bad response: {e}"))
}

pub struct ResolvedLink {
    pub url: String,
    pub file_name: Option<String>,
    pub size_bytes: Option<u64>,
    pub headers: HashMap<String, String>,
}

/// Run one `/resolve` recipe and normalize the reply. `file_name`,
/// `size_bytes`, and `headers` are optional in the protocol; recipes that
/// return cookies for the CDN put them in `headers`.
pub async fn resolve(
    cfg: &Cfg,
    host: &str,
    params: Value,
    cookies: Value,
) -> Result<ResolvedLink, String> {
    let body = json!({ "host": host, "params": params, "cookies": cookies });
    let v = post(cfg, "/resolve", body, Duration::from_secs(180)).await?;
    if !v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
        return Err(v
            .get("error")
            .and_then(|x| x.as_str())
            .unwrap_or("Slipgate could not resolve the download")
            .to_string());
    }
    let url = v
        .get("download_url")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .ok_or_else(|| "Slipgate returned no download url".to_string())?;
    let file_name = v
        .get("file_name")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let size_bytes = v.get("size_bytes").and_then(|x| x.as_u64());
    let headers = v
        .get("headers")
        .and_then(|x| x.as_object())
        .map(|m| {
            m.iter()
                .filter_map(|(k, val)| val.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    Ok(ResolvedLink { url, file_name, size_bytes, headers })
}

/// Probe an instance's `/health` for the Settings connection test.
pub async fn health(base: &str, key: &str) -> Result<Value, String> {
    let mut headers = HashMap::new();
    headers.insert("Accept".to_string(), "application/json".to_string());
    if !key.is_empty() {
        headers.insert("X-Slipgate-Key".to_string(), key.to_string());
    }
    let resp = http::fetch(
        &format!("{base}/health"),
        &http::FetchOpts { headers, timeout: Some(Duration::from_secs(15)), ..Default::default() },
    )
    .await
    .map_err(|e| format!("unreachable: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("bad response: {e}"))?;
    Ok(json!({
        "ok": true,
        "version": v.get("version").and_then(|x| x.as_str()).unwrap_or(""),
        "flaresolverrOk": v.get("flaresolverr_ok").and_then(|x| x.as_bool()).unwrap_or(false),
        "recipes": v.get("recipes").cloned().unwrap_or_else(|| json!([])),
    }))
}
